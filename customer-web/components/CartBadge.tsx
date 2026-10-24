'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { itemCount, readCart } from '@/lib/cart';

/** हमेशा एक global कार्ट — count हर change पर खुद-अपडेट (storage event + focus). */
export default function CartBadge({ slug }: { slug: string }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const upd = () => {
      const c = readCart();
      setN(c && c.shopSlug === slug ? c.items.reduce((s, i) => s + i.qty, 0) : 0);
    };
    upd();
    window.addEventListener('storage', upd);
    window.addEventListener('focus', upd);
    const t = setInterval(upd, 1500); // उसी tab के add-to-cart के लिए हल्का sync
    return () => {
      window.removeEventListener('storage', upd);
      window.removeEventListener('focus', upd);
      clearInterval(t);
    };
  }, [slug]);

  return (
    <Link href={`/s/${encodeURIComponent(slug)}/cart`} aria-label={`कार्ट${n ? `, ${n} वस्तुएँ` : ' खाली'}`}>
      <span className="badge">🛒{n > 0 && <span className="count">{n}</span>}</span>
    </Link>
  );
}
