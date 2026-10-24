'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useRouter } from 'next/navigation';

/**
 * PART 5 — ग्राहक cancel (client component).
 * सिर्फ़ NEW (बाकी पुष्टि) ऑर्डर पर ही दिखता है — server के canCancel झंडे से;
 * server भी उसी नियम को दोबारा जाँचता है (409 अगर बीच में स्वीकार हो गया).
 * कारण वैकल्पिक — दुकान को दिखता है, ऑर्डर स्थिति पेज पर भी.
 */
export default function CancelOrderButton({ token, number }: { token: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const router = useRouter();

  if (done) return null;

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      const res = await api.orderCancel(token, reason.trim() || undefined);
      setBusy(false);
      setDone(true);
      router.refresh();
      // साफ़ हिंदी पुष्टि — स्थिति अपने-आप CANCELLED दिखने लगेगी
      if (typeof window !== 'undefined') alert('ऑर्डर ' + res.number + ' रद्द कर दिया गया।');
    } catch (e) {
      setBusy(false);
      setErr(e instanceof ApiError ? e.message : 'नेटवर्क गड़बड़ — फिर कोशिश करें');
    }
  }

  if (!open) {
    return (
      <button className="bigbtn" style={{ background: 'var(--red-soft, #FEF2F2)', color: '#DC2626', display: 'block' }} onClick={() => setOpen(true)}>
        ऑर्डर रद्द करें
      </button>
    );
  }

  return (
    <div className="card" style={{ background: '#FEF2F2' }}>
      <h3 style={{ margin: '0 0 8px' }}>ऑर्डर {number} रद्द करें?</h3>
      <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13.5 }}>
        सामान अभी तैयार होना शुरू हुआ है ही नहीं — रद्द होने पर दुकान को सूचना जाएगी.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="कारण (वैकल्पिक) — जैसे: गलती से ऑर्डर हो गया"
        maxLength={300}
        rows={2}
        style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
      {err && <p style={{ color: '#DC2626', fontSize: 13.5, margin: '8px 0 0' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button className="bigbtn" style={{ flex: 1, background: 'var(--card)', color: 'var(--ink)', display: 'block' }} onClick={() => setOpen(false)} disabled={busy}>
          रहने दें
        </button>
        <button className="bigbtn" style={{ flex: 1, background: '#DC2626', color: '#fff', display: 'block', opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
          {busy ? 'रद्द हो रहा…' : 'हाँ, रद्द करें'}
        </button>
      </div>
    </div>
  );
}
