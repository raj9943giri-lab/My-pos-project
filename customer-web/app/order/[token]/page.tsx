import type { Metadata } from 'next';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { inr, PAY_MODE_HI, PAY_STATUS_HI, STATUS_HI, STATUS_SHORT_HI, whenHi } from '@/lib/format';
import RefreshBadge from '@/components/RefreshBadge';
import CancelOrderButton from '@/components/CancelOrderButton';

/* Order tracking — सिर्फ़ बने-हुए ऑर्डर के random token से (न गिनी जा सकने वाली
 * जगह). ग्राहक का नाम/पता/नंबर यहाँ नहीं दिखता — token धरोहर ही सुरक्षा है.
 * PART 5 — स्थिति टाइमलाइन (कब क्या बदला), रद्द/अस्वीकृत का कारण, और नया ऑर्डर
 * का ग्राहक-cancel (सिर्फ़ पुष्टि बाकी चरण में; server भी नियम दोबारा जाँचता है). */

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  return { title: 'ऑर्डर स्थिति', robots: { index: false } };
}

export default async function OrderPage({ params }: { params: { token: string } }) {
  let res;
  try {
    res = await api.order(params.token);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return (
      <main className="wrap wrap-sm">
        <div className="card" style={{ marginTop: 40 }}>
          <h2>{status === 404 ? 'ऑर्डर नहीं मिला' : 'नेटवर्क गड़बड़'}</h2>
          <p style={{ color: 'var(--muted)' }}>
            लिंक पूरा खुला है? (ये लिंक हर ऑर्डर के लिए अलग होता है — दुकान से नया लें.)</p>
        </div>
      </main>
    );
  }

  const { order, shop, items, history } = res;
  const pending = order.paymentStatus === 'PENDING';
  const bad = order.status === 'CANCELLED' || order.status === 'REJECTED';
  const good = !bad;
  const isDel = order.fulfilment === 'DELIVERY';

  /* टाइमलाइन — history से (server ही लिखता है); रद्द/अस्वीकृत — उसी रंग में. */
  const steps = history.length
    ? history.map((h, i) => ({
        key: h.status + '-' + i,
        label: STATUS_SHORT_HI[h.status] || h.status,
        when: whenHi(h.createdAt),
        done: true,
        bad: h.status === 'CANCELLED' || h.status === 'REJECTED',
        last: i === history.length - 1,
        reason: h.reason,
      }))
    : [{ key: 'new', label: STATUS_SHORT_HI.NEW, when: whenHi(order.placedAt), done: true, bad: false, last: true, reason: null as string | null }];

  return (
    <>
      <header className="topbar">
        <Link href={`/s/${encodeURIComponent(shop.slug)}`} aria-label="दुकान">🏪</Link>
        <span className="title">ऑर्डर · {shop.name}</span>
      </header>

      <main className="wrap wrap-sm">
        <div className="stage">
          <div className="big">{good ? '✅' : '❌'}</div>
          <h2>{STATUS_HI[order.status] || 'ऑर्डर अपडेट'}</h2>
          <p>ऑर्डर नंबर <b>{order.number}</b> · {whenHi(order.placedAt)}</p>
          <RefreshBadge />
        </div>

        {(bad && (order.cancellationReason || order.cancelledAt)) && (
          <div className="card" style={{ background: '#FEF2F2' }}>
            <b>क्यों?</b>
            <p style={{ margin: '4px 0 0' }}>
              {order.cancellationReason || 'दुकान/ग्राहक ने रद्द किया'}
              {order.cancelledAt ? <> · {whenHi(order.cancelledAt)}</> : null}
            </p>
          </div>
        )}

        <div className="card">
          {steps.map((s) => (
            <div className="tr" key={s.key}>
              <span>
                <b style={s.bad ? { color: '#DC2626' } : undefined}>{s.bad ? '✖ ' : s.last ? '▶ ' : '✓ '}{s.label}</b>
                {s.reason ? <small style={{ color: 'var(--muted)' }}> — {s.reason}</small> : null}
              </span>
              <small style={{ color: 'var(--muted)' }}>{s.when}</small>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="tr">
            <span>पेमेंट ({PAY_MODE_HI[order.paymentMode] || order.paymentMode})</span>
            <b>{order.paymentMode === 'UPI_QR' && pending ? 'जमा होना बाक़ी (QR नीचे)' : PAY_STATUS_HI[order.paymentStatus] || order.paymentStatus}</b>
          </div>
          <div className="tr">
            <span>पहुँचने का तरीका</span>
            <b>{isDel ? 'होम डिलीवरी' : 'दुकान से उठाना'}</b>
          </div>
          {!isDel && res.pickup && res.pickup.address && (
            <div className="tr"><span>उठाने का पता (दुकान)</span><span>{res.pickup.address}</span></div>
          )}
        </div>

        <div className="card">
          {items.map((it, i) => (
            <div className="tr" key={i}>
              <span>{it.name}{it.variantName ? ` (${it.variantName})` : ''} × {it.qty} <small style={{ color: 'var(--muted)' }}>({it.unit})</small></span>
              <span>{inr(it.unitPrice * it.qty)}</span>
            </div>
          ))}
          <div className="tr"><span>सामान का जोड़</span><span>{inr(order.totals.subTotal)}</span></div>
          {order.totals.discount > 0 && (
            <div className="tr"><span>कूपन {order.couponCode}</span><span className="off">− {inr(order.totals.discount)}</span></div>
          )}
          {isDel && (
            <div className="tr"><span>डिलीवरी</span><span>{order.totals.deliveryFee ? inr(order.totals.deliveryFee) : 'मुफ़्त'}</span></div>
          )}
          <div className="tr total"><span>आगे देना है</span><span>{inr(order.totals.total)}</span></div>
        </div>

        {order.paymentMode === 'UPI_QR' && pending && order.upiVpa && !bad && (
          <div className="card" style={{ background: 'var(--green-soft)' }}>
            <b>UPI पर भेजें:</b>
            <p style={{ direction: 'ltr', fontSize: 18, fontWeight: 700 }}>{order.upiVpa}</p>
            <small style={{ color: 'var(--muted)' }}>
              भुगतान के बाद दुकान देख-पुष्टि करेगी — इसी पेज पर स्थिति 'बाकी' से बदलेगी.
            </small>
          </div>
        )}

        {order.canCancel && !bad && (
          <CancelOrderButton token={params.token} number={order.number} />
        )}

        {shop.contact ? (
          <a className="bigbtn" href={'tel:' + shop.contact} style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            ☎️ दुकान को कॉल करें
          </a>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--muted)' }}>दुकान का नंबर प्रोफ़ाइल में नहीं मिला.</p>
        )}
        <p className="blue">
          यह पेज बिना लॉग-इन चलता है — लिंक WhatsApp में सेव रखें.
        </p>
      </main>
    </>
  );
}
