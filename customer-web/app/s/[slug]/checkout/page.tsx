'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { inr, PAY_MODE_HI } from '@/lib/format';
import { clearCart, readCart, type Cart } from '@/lib/cart';
import type { ShopResponse, ValidateResponse } from '@/lib/types';

/* चेकआउट — गेस्ट (कोई अकाउंट नहीं), सर्वर-सत्यापित हिसाब, double-tap सुरक्षा:
 * हर कोशिश कभी-एक Idempotency-Key दोबारा भेजी जाती है; network fail हो भी
 * तो वही key से जुड़ा ऑर्डर फिर वही रहता है (डुप्लिकेट order नहीं बनता). */

export default function CheckoutPage() {
  const { slug } = useParams<{ slug: string }>() as { slug: string };
  const router = useRouter();

  const [shop, setShop] = useState<ShopResponse | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [v, setV] = useState<ValidateResponse | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // फॉर्म (सुरक्षित: selector fail होने पर भी डाटा नहीं गुम)
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fulfil, setFulfil] = useState<'DELIVERY' | 'PICKUP'>(null as never);
  const [address, setAddress] = useState('');
  const [landmark, setLandmark] = useState('');
  const [instructions, setInstructions] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [terms, setTerms] = useState(false);

  const [formErr, setFormErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idemKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const c = readCart();
    if (!c || c.shopSlug !== slug) {
      router.replace(`/s/${encodeURIComponent(slug)}/cart`);
      return;
    }
    setCart(c);
    api.shop(slug)
      .then((res) => {
        setShop(res);
        setFulfil((res.shop.pickup && !res.shop.delivery) ? 'PICKUP' : 'DELIVERY');
      })
      .catch((e) => setLoadErr(e?.message || 'दुकान नहीं मिली'));
  }, [slug, router]);

  /* सर्वर जाँच — हर भरोसेमंद रिक्वेस्ट पर नए items/फी/कूपन से हिसाब */
  const validate = useCallback(async (extra?: { couponCode?: string; fulfilment?: string }) => {
    if (!cart) return;
    setLoadErr(null);
    try {
      const res = await api.validate(slug, {
        items: cart.items.map((i) => ({
          productId: Number(i.productId),
          variantId: i.variantId ? Number(i.variantId) : undefined,
          qty: i.qty,
        })),
        couponCode: (extra?.couponCode ?? couponCode) || undefined,
        fulfilment: extra?.fulfilment ?? fulfil,
      });
      setV(res);
    } catch (e: any) {
      setLoadErr(e?.message || 'जाँच नहीं हो पाई');
      setV(null);
    }
  }, [slug, cart, couponCode, fulfil]);

  useEffect(() => { if (cart && shop) validate(); /* पहली रिक्वेस्ट */ }, [cart, shop]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (shop) validate({ fulfilment: fulfil }); }, [fulfil]); // eslint-disable-line react-hooks/exhaustive-deps

  const payModes = (shop?.shop.paymentMethods || []).filter(
    (m) => (fulfil === 'DELIVERY' ? m !== 'PON' : true),
  );
  useEffect(() => {
    if (!payModes.length) setPaymentMode('');
    else if (!payModes.includes(paymentMode as never)) setPaymentMode(payModes[0]);
  }, [payModes.join(','), paymentMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* गेस्ट फॉर्म जाँच (सर्वर फिर से जाँचता है यहीं quick alert) */
  const check = (): string | null => {
    if (name.trim().length < 2) return 'अपना नाम डालें';
    if (!/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))) return 'सही 10-आँकड़े का मोबाइल नंबर डालें';
    if (fulfil === 'DELIVERY' && address.trim().length < 6) return 'डिलीवरी का अधिक हिस्सा पता डालें';
    if (!paymentMode) return 'पेमेंट तरीका चुनें';
    if (!terms) return 'टर्म्स/प्राइवेसी स्वीकारें';
    return null;
  };

  const submit = async () => {
    const bad = check();
    if (bad) { setFormErr(bad); return; }
    setFormErr(null);
    setSubmitting(true);
    try {
      const payload = {
        items: cart!.items.map((i) => ({
          productId: Number(i.productId),
          variantId: i.variantId ? Number(i.variantId) : undefined,
          qty: i.qty,
        })),
        customer: { name: name.trim(), phone: phone.trim() },
        fulfilment: fulfil,
        address: fulfil === 'DELIVERY' ? address.trim() : undefined,
        landmark: landmark.trim() || undefined,
        instructions: instructions.trim() || undefined,
        couponCode: couponCode.trim() || undefined,
        paymentMode,
      };
      const key = idemKeyRef.current || (idemKeyRef.current = 'web-' + slug + '-' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 10));
      const res = await api.checkout(slug, payload, key);
      // ऑर्डर बन गया (नया हो या वही idempotent duplicate) — हमेशा confirmation पर
      router.replace('/order/' + res.order.publicToken);
      clearCart();
    } catch (e: any) {
      const conflict = e?.status === 409 || e?.body?.reason === 'CART_CONFLICT';
      if (conflict) {
        idemKeyRef.current = null;            // नई हाल अपनानी है — नया प्रयास
        await validate();                     // वही screen मोड़कर नया हिसाब दिखाओ
        setFormErr('स्टॉक/कीमत बदली है — नई हाल ऊपर देखकर फिर भेजें');
      } else {
        setFormErr(e?.message || 'नेटवर्क फ़ैल — डेटा सुरक्षित है, फिर कोशिश वही key से होगी');
        // key वही रखी — retry हमेशा वही ऑर्डर देगा, डुप्लिकेट कभी नहीं
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!cart || !shop || !v) {
    return (
      <main className="wrap wrap-sm">
        <div className="centre">
          <div className="spin" />
          <p>चेकआउट तैयार हो रहा है…</p>
          {loadErr && (
            <div className="note err" role="alert">⚠️ {loadErr}</div>
          )}
          {loadErr && <Link className="addbtn" href={`/s/${encodeURIComponent(slug)}/cart`}>कार्ट पर लौटें</Link>}
        </div>
      </main>
    );
  }

  const disabled = submitting || !v.ok;

  return (
    <>
      <header className="topbar">
        <Link href={`/s/${encodeURIComponent(slug)}/cart`} aria-label="कार्ट">←</Link>
        <span className="title">चेकआउट · {shop.shop.name}</span>
      </header>

      <main className="wrap wrap-sm">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <div className="card">
            <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>1. आपकी जानकारी <span className="hint" style={{ color: 'var(--muted)', fontWeight: 400 }}>उपयोगकर्ता अकाउंट की ज़रूरत नहीं</span></h2>
            <div className="f">
              <label htmlFor="nm">नाम</label>
              <input id="nm" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="जैसे: सुनीता देवी" />
            </div>
            <div className="f">
              <label htmlFor="ph">मोबाइल नंबर <span className="hint">दुकान इसी पर जुड़ेगी</span></label>
              <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel"
                placeholder="9876543210" style={{ direction: 'ltr' }} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>2. सामान कैसे पहुँचे</h2>
            <div className="moves">
              {shop.shop.delivery && (
                <button type="button" className="selcard" aria-pressed={fulfil === 'DELIVERY'} onClick={() => setFulfil('DELIVERY')}>
                  🛵 डिलीवरी{shop.shop.etaNote ? <div style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{shop.shop.etaNote}</div> : null}
                </button>
              )}
              {shop.shop.pickup && (
                <button type="button" className="selcard" aria-pressed={fulfil === 'PICKUP'} onClick={() => setFulfil('PICKUP')}>
                  🏬 दुकान से उठाना<div style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{shop.shop.address || ''}</div>
                </button>
              )}
            </div>

            {fulfil === 'DELIVERY' && (
              <>
                <div className="f">
                  <label htmlFor="ad">पता <span className="hint">डिलीवरी चुनने पर</span></label>
                  <textarea id="ad" value={address} onChange={(e) => setAddress(e.target.value)}
                    placeholder="घर/दुकान का पूरा पता, गली, मंज़िल…" autoComplete="street-address" />
                </div>
                <div className="f">
                  <label htmlFor="lm">पहचान स्थल <span className="hint">(optional)</span></label>
                  <input id="lm" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="जैसे: हनुमान मंदिर के पास" />
                </div>
                <div className="f">
                  <label htmlFor="ins">डिलीवरी निर्देश <span className="hint">(optional)</span></label>
                  <input id="ins" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="जैसे: घंटी बजाएँ" />
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>3. पेमेंट <span className="hint" style={{ color: 'var(--muted)', fontWeight: 400 }}>दुकान के चालू तरीके ही</span></h2>
            {!payModes.length && <div className="note warn">इस दुकान में अभी कोई पेमेंट तरीका चालू नहीं.</div>}
            {payModes.map((m) => (
              <label key={m} className="termrow" style={{ color: 'var(--ink)' }}>
                <input type="radio" name="pay" checked={paymentMode === m} onChange={() => setPaymentMode(m)} />
                <span>{PAY_MODE_HI[m] || m}</span>
              </label>
            ))}
            <div className="f" style={{ marginTop: 10 }}>
              <label htmlFor="cp">कूपन <span className="hint">(दुकान ने अगर दिया है)</span></label>
              <input id="cp" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                onBlur={() => validate({ couponCode })} placeholder="जैसे: SWAGAT10" style={{ textTransform: 'uppercase' }} />
            </div>
          </div>

          <div className="card">
            <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>4. हिसाब <span className="hint" style={{ color: 'var(--muted)', fontWeight: 400 }}>server से गिना हुआ</span></h2>
            {v.lines.filter((l) => l.qty > 0).map((l) => (
              <div className="tr" key={['line', l.productId, l.variantId].join('_')}>
                <span>{l.name}{l.variantName ? ` (${l.variantName})` : ''} × {l.qty}</span>
                <span>{inr(l.lineTotal)}</span>
              </div>
            ))}
            <div className="tr"><span>सामान का जोड़</span><span>{inr(v.totals.subTotal)}</span></div>
            {v.totals.discount > 0 && <div className="tr"><span>कूपन {v.coupon?.code}</span><span className="off">− {inr(v.totals.discount)}</span></div>}
            {fulfil === 'DELIVERY' && <div className="tr"><span>डिलीवरी</span><span>{v.totals.deliveryFee ? inr(v.totals.deliveryFee) : 'मुफ़्त'}</span></div>}
            <div className="tr total"><span>कुल</span><span>{inr(v.totals.total)}</span></div>
            {v.delivery.available && v.totals.deliveryFee === 0 && fulfil === 'DELIVERY' && (
              <p style={{ color: 'var(--grad-2)', fontSize: 13, margin: '4px 0 0' }}>
                🎉 इस रकम (₹{v.delivery.feeRule.freeAbove}) के ऊपर डिलीवरी मुफ़्त!
              </p>
            )}
          </div>

          <label className="termrow">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>मैं समझता/समझती हूँ: ऑर्डर सर्वर पर जाँच के बाद ही बनता है; COD हो तो डिलीवरी पर नकद/दुकान पर भुगतान. टर्म्स व प्राइवेसी नीचे सरल भाषा में लिखी हैं.</span>
          </label>

          {formErr && <div className="note err" role="alert">⚠️ {formErr}</div>}

          <button className="bigbtn" type="submit" disabled={disabled}>
            {submitting ? 'ऑर्डर भेज रहे हैं… एक बार ही टैप करें' : `ऑर्डर करें · ${inr(v.totals.total)}`}
          </button>
          {submitting && <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>नेटवर्क धीमा हो तो भी केवल एक बार भेजा जाता है.</p>}
          <p className="blue">गुप्त: आपका पता/नंबर सिर्फ़ दुकान को मिलता है; ऑर्डर स्टेटस लिंक सिर्फ़ आपके pass.</p>
        </form>
      </main>
    </>
  );
}
