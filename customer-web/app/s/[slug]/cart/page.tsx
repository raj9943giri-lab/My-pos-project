'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';
import { itemCount, readCart, removeItem, setQty, writeCart, type Cart, type CartItem } from '@/lib/cart';
import type { ValidateResponse } from '@/lib/types';

// CartItem की स्थिर पहचान (product + variant)
const keyOf = (it: CartItem) => it.productId + ':' + (it.variantId || '');

/* कार्ट — सर्वर से सत्यापित (कीमत/स्टॉक/केट पूरे server के सच मारके). */

export default function CartPage() {
  const { slug } = useParams<{ slug: string }>() as { slug: string };
  const router = useRouter();

  const [cart, setCart] = useState<Cart | null>(null);
  const [v, setV] = useState<ValidateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /* पुराने साँचे-साँचे cart दूसरी दुकान का हो सकता है — इस page पर यही दुकान जरूऱी */
  const sync = useCallback(() => {
    const c = readCart();
    if (!c) return null;
    if (c.shopSlug !== slug) return null;
    return c;
  }, [slug]);

  useEffect(() => {
    const c = sync();
    setCart(c);
    setLoading(false);
  }, [sync]);

  const validate = useCallback(async () => {
    const c = sync();
    if (!c) return;
    setErr(null);
    try {
      const res = await api.validate(slug, {
        items: c.items.map((i) => ({
          productId: Number(i.productId),
          variantId: i.variantId ? Number(i.variantId) : undefined,
          qty: i.qty,
        })),
        fulfilment: 'DELIVERY',
      });
      setV(res);
    } catch (e: any) {
      setErr(e?.message || 'जाँच नहीं हो पाई — फिर कोशिश करें');
    }
  }, [slug, sync]);

  useEffect(() => { if (cart) validate(); }, [cart, validate]);

  if (!loading && !cart) {
    // इस page का cart ही दूसरी दुकान का रहा हो तो भी खाली दिखेगा (server-side पक नहीं होता)
    return (
      <>
        <Header slug={slug} />
        <main className="wrap wrap-sm">
          <div className="centre" style={{ padding: '50px 10px' }}>
            <p style={{ fontSize: 44, margin: 0 }}>🛒</p>
            <h2 style={{ margin: '6px 0' }}>कार्ट खाली है</h2>
            <p>दुकान की सूची से सामान चुनें.</p>
            <Link className="addbtn" href={`/s/${encodeURIComponent(slug)}/search`} style={{ display: 'inline-flex', alignItems: 'center' }}>
              खोज शुरू करें
            </Link>
          </div>
        </main>
      </>
    );
  }

  const problems: string[] = [];
  let blocks = false;
  if (v) {
    if (!v.acceptOrders) { problems.push('दुकान अभी ऑर्डर नहीं ले रही.'); blocks = true; }
    if (!v.minOrder.met) { problems.push(`न्यूनतम ऑर्डर ₹${v.minOrder.value} — कार्ट ₹${v.totals.subTotal} का है.`); blocks = true; }
    for (const l of v.lines) {
      if (l.status === 'MISSING') { problems.push(`${l.name || 'एक वस्तु'} अब available नहीं — कार्ट से हटाएँ.`); blocks = true; }
      else if (l.status === 'OUT') { problems.push(`${l.name} अभी stock में नहीं है.`); blocks = true; }
      else if (l.status === 'LOW') { problems.push(`${l.name}: सिर्फ़ ${l.stock} बाकी — qty अपने-आप घटा दी गई है.`); }
    }
  }

  /** हाँ बटन पर server की सत्यापित qty/price की कार्ट में झलक अपडेट करें. */
  const adoptServerLines = () => {
    if (!v || !cart) return;
    for (const l of v.lines) {
      const item = cart.items.find((i) => keyOf(i) === String(l.productId) + ':' + (l.variantId || ''));
      if (!item) continue;
      if (l.status === 'OK') item.price = l.unitPrice; // कीमत भी नई (server truth)
      else removeItem(item.productId, item.variantId);
    }
    writeCart(cart);
    setCart(readCart());
  };

  if (!cart || !v) {
    return (
      <>
        <Header slug={slug} />
        <main className="wrap wrap-sm">
          {(loading || !err) && <div className="skeleton" style={{ height: 160 }} />}
          {err && (
            <div className="centre" role="alert">
              <p>⚠️ {err}</p>
              <button className="addbtn" onClick={() => validate()}>फिर कोशिश करें</button>
            </div>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <Header slug={slug} />
      <main className="wrap">
        {problems.map((p, i) => <div key={i} className="note warn" role="alert">⚠️ {p}</div>)}
        {err && <div className="note err" role="alert">{err}</div>}

        <div className="card">
          {cart.items.map((it) => (
            <CartRow key={keyOf(it)} it={it} v={v} onChange={() => { const c = readCart(); setCart(c); if (!c || !c.items.length) setCart(null); }} />
          ))}
        </div>

        <div className="card">
          <div className="tr"><span>सामान का जोड़</span><span>{inr(v.totals.subTotal)}</span></div>
          {v.totals.discount > 0 && <div className="tr"><span>कूपन {v.coupon?.code}</span><span className="off">− {inr(v.totals.discount)}</span></div>}
          <div className="tr"><span>डिलीवरी (अंदाज़ा{v.delivery.feeRule.freeAbove > v.totals.subTotal ? '' : ' — इस रकम पर मुफ़्त'})</span><span>{inr(v.delivery.available ? v.totals.deliveryFee : 0)}</span></div>
          <div className="tr total"><span>कुल (server जाँच बाद)</span><span>{inr(v.totals.total)}</span></div>
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '6px 0 0' }}>
            कीमत/स्टॉक चेकआउट पर server से फिर जाँची जाएगी.
          </p>
        </div>

        {!blocks && v.ok && (
          <div className="bottombar" style={{ position: 'relative', margin: '0 0 0' }}>
            <div className="sum">
              <b>{inr(v.totals.total)}</b>
              <small>{itemCount()} वस्तुएँ</small>
            </div>
            <button className="addbtn" onClick={() => { adoptServerLines(); router.push(`/s/${encodeURIComponent(slug)}/checkout`); }}>
              चेकआउट →
            </button>
          </div>
        )}
        {(blocks || !v.ok) && (
          <button className="bigbtn" disabled>पहले ऊपर वाली समस्याएँ ठीक करें</button>
        )}
      </main>
    </>
  );
}

function Header({ slug }: { slug: string }) {
  return (
    <header className="topbar">
      <Link href={`/s/${encodeURIComponent(slug)}`} aria-label="दुकान">🏪</Link>
      <span className="title">🛒 कार्ट</span>
    </header>
  );
}

function CartRow({ it, v, onChange }: { it: CartItem; v: ValidateResponse; onChange: () => void }) {
  const line = v.lines.find(
    (l) => String(l.productId) === it.productId && String(l.variantId || '') === (it.variantId || ''),
  );
  const stale = line && line.unitPrice !== it.price;
  return (
    <div className="line-row" style={{ marginBottom: 12 }}>
      <div className="nm">
        <b>{it.name}{it.variantName ? ` (${it.variantName})` : ''}</b>
        <small>
          {inr(it.price)} · {it.unit}
          {stale ? <> · <span style={{ color: 'var(--red)' }}>नई कीमत {inr(line!.unitPrice)}</span></> : null}
        </small>
      </div>
      <span className="stepper">
        <button onClick={() => { setQty(it.productId, it.variantId, it.qty - 1); onChange(); }} aria-label="कम करें">−</button>
        <span className="q">{it.qty}</span>
        <button onClick={() => { setQty(it.productId, it.variantId, Math.min(99, it.qty + 1)); onChange(); }} aria-label="बढ़ाएँ">+</button>
      </span>
      <button
        style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 18, minHeight: 44, minWidth: 34 }}
        onClick={() => { removeItem(it.productId, it.variantId); onChange(); }}
        aria-label={`${it.name} कार्ट से हटाएँ`}
      >
        🗑️
      </button>
    </div>
  );
}
