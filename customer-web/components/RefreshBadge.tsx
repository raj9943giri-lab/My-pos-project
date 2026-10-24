'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** ऑर्डर स्थिति फिर-देखें — server फिर fetch करता है (पेज कोई नहीं बदलता, सिर्फ़ हाल). */
export default function RefreshBadge() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="addbtn" style={{ cursor: 'pointer', marginTop: 8 }}
      disabled={busy}
      onClick={() => { setBusy(true); router.refresh(); setTimeout(() => setBusy(false), 800); }}>
      {busy ? 'देख रहे हैं…' : '↺ स्थिति देखें'}
    </button>
  );
}
