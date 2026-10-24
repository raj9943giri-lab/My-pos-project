'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { inr, productHref } from '@/lib/format';
import { attemptAdd, itemKey, readCart, setQty, startCartFor } from '@/lib/cart';
import type { PublicProduct } from '@/lib/types';
import AskDialog, { AskOptions } from './AskDialog';

/**
 * स्टोर की product card — quick "जोड़ें" सीधे persisted कार्ट में. कार्ट में
 * दूसरी दुकान का सामान हो तो पहले पूछती है (calm dialog, कभी silently delete नहीं).
 */
export default function ProductCard({ slug, product }: { slug: string; product: PublicProduct }) {
  const [qty, setQtyState] = useState(0);
  const [ask, setAsk] = useState<AskOptions | null>(null);
  const out = (product.stock ?? 0) <= 0;
  const key = itemKey(product.id, null);

  useEffect(() => {
    const c = readCart();
    setQtyState(c && c.shopSlug === slug ? c.items.find((i) => itemKey(i.productId, i.variantId) === key)?.qty || 0 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, product.id]);

  const add = () => {
    const res = attemptAdd(slug, product, null, 1);
    if (res.needsSwitch) {
      const other = readCart()?.shopSlug || 'दूसरी दुकान';
      setAsk({
        title: 'कार्ट में दूसरी दुकान का सामान है',
        body: `आपका कार्ट “${other}” का है. एक कार्ट में एक ही दुकान का सामान रखा जाता है — पुराना कार्ट खाली करके “${product.name}” जोड़ें?`,
        yes: 'हाँ, कार्ट खाली करें',
        no: 'नहीं, रद्द',
        danger: true,
      });
      return;
    }
    setQty(product.id, null, qty + 1);
    setQtyState(qty + 1);
  };

  const bump = (next: number) => {
    setQty(product.id, null, next === 0 ? 0 : Math.min(99, next)); // 0 = item हटता है
    setQtyState(next);
  };

  const switchAndAdd = (yes: boolean) => {
    setAsk(null);
    if (!yes) return;
    startCartFor(slug);
    attemptAdd(slug, product, null, 1);
    setQtyState(1);
  };

  return (
    <article className="pcard">
      <Link href={productHref(slug, product.id)} aria-label={product.name}>
        {product.photoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="photo" src={product.photoUrl} alt={product.name} loading="lazy" />
          : <div className="photo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>🧺</div>}
      </Link>
      <div className="b">
        <Link className="n" href={productHref(slug, product.id)}>{product.name}</Link>
        <span className="u">{product.unit}{product.brand ? ' · ' + product.brand : ''}</span>
        <div className="rowbtn">
          <span>
            <span className="pr">{inr(product.price)}</span>
            {product.mrp ? <span className="mrp"> {inr(product.mrp)}</span> : null}
          </span>
          {qty === 0
            ? <button className="addbtn" onClick={add} disabled={out}>{out ? 'ख़त्म' : 'जोड़ें'}</button>
            : (
              <span className="stepper" aria-label="मात्रा बदलें">
                <button onClick={() => bump(qty - 1)} aria-label="कम करें">−</button>
                <span className="q">{qty}</span>
                <button onClick={() => bump(qty + 1)} aria-label="बढ़ाएँ">+</button>
              </span>
            )}
        </div>
      </div>
      <AskDialog options={ask} onResolve={switchAndAdd} />
    </article>
  );
}
