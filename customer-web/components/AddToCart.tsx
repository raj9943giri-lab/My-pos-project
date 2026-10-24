'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { attemptAdd, itemKey, readCart, setQty, startCartFor } from '@/lib/cart';
import { productHref } from '@/lib/format';
import type { PublicProduct, Variant } from '@/lib/types';
import AskDialog, { AskOptions } from './AskDialog';

interface MiniProduct {
  id: string; name: string; unit: string; price: number; photoUrl: string | null; stock: number;
}

/** Variant चुनें → qty → कार्ट. दूसरी दुकान के कार्ट पर पूछकर खाली होता है. */
export default function AddToCart({ slug, product, variants, disabled }: {
  slug: string;
  product: MiniProduct;
  variants: Variant[];
  disabled: boolean;
}) {
  const [variantId, setVariantId] = useState<string>(variants[0]?.id || '');
  const [qty, setQtyState] = useState(0);
  const [ask, setAsk] = useState<AskOptions | null>(null);

  const variant = variants.find((v) => v.id === variantId) || null;
  const key = itemKey(product.id, variant?.id || null);

  useEffect(() => {
    const c = readCart();
    setQtyState(c && c.shopSlug === slug ? c.items.find((i) => itemKey(i.productId, i.variantId) === key)?.qty || 0 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, product.id, variantId]);

  if (disabled) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>
          यह प्रोडक्ट अभी ऑर्डर नहीं हो सकता (stock ख़त्म/बंद) — दुकानदार से फिर पूछें.
        </p>
        <Link href={productHref(slug, product.id)} style={{ display: 'none' }} aria-hidden>सूची</Link>
      </div>
    );
  }

  const variantOut = variant ? (variant.stock ?? 0) <= 0 : false;

  const add = () => {
    const res = attemptAdd(slug, product as unknown as PublicProduct, variant, 1);
    if (res.needsSwitch) {
      const other = readCart()?.shopSlug || 'दूसरी दुकान';
      setAsk({
        title: 'कार्ट में दूसरी दुकान का सामान है',
        body: `आपका कार्ट “${other}” का है. एक कार्ट में एक ही दुकान का सामान रखा जाता है — पुराना कार्ट खाली करें?`,
        yes: 'हाँ, खाली करके जोड़ें',
        no: 'नहीं, रद्द',
        danger: true,
      });
      return;
    }
    setQty(product.id, variant?.id || null, qty + 1);
    setQtyState(qty + 1);
  };

  const bump = (next: number) => {
    setQty(product.id, variant?.id || null, next <= 0 ? 0 : Math.min(99, next));
    setQtyState(Math.max(0, next));
  };

  const switchAndAdd = (yes: boolean) => {
    setAsk(null);
    if (!yes) return;
    startCartFor(slug);
    attemptAdd(slug, product as unknown as PublicProduct, variant, 1);
    setQtyState(1);
  };

  return (
    <div className="card">
      {variants.length > 0 && (
        <div className="f">
          <label htmlFor="variant">विकल्प चुनें <span className="hint">(साइज़/रंग आदि)</span></label>
          <select id="variant" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            {variants.map((v) => (
              <option key={v.id} value={v.id} disabled={(v.stock ?? 0) <= 0}>
                {v.name}{v.price != null ? ` · ₹${v.price}` : ''}{(v.stock ?? 0) <= 0 ? ' · ख़त्म' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {variantOut && <div className="note warn">यह विकल्प अभी stock में नहीं है — दूसरा चुनें.</div>}

      <div className="rowbtn">
        {qty === 0 ? (
          <button className="bigbtn" onClick={add} disabled={variantOut}>🛒 कार्ट में जोड़ें</button>
        ) : (
          <span className="rowbtn" style={{ width: '100%' }}>
            <span className="stepper" aria-label="मात्रा">
              <button onClick={() => bump(qty - 1)} aria-label="कम करें">−</button>
              <span className="q">{qty}</span>
              <button onClick={() => bump(qty + 1)} aria-label="बढ़ाएँ">+</button>
            </span>
            <Link href={`/s/${encodeURIComponent(slug)}/cart`} className="addbtn" style={{ display: 'inline-flex', alignItems: 'center' }}>
              कार्ट देखें →
            </Link>
          </span>
        )}
      </div>
      <AskDialog options={ask} onResolve={switchAndAdd} />
    </div>
  );
}
