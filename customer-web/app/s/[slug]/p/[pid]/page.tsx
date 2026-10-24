import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import CartBadge from '@/components/CartBadge';
import AddToCart from '@/components/AddToCart';

/* Product detail — images, विवरण, variant चयन, orderable availability. */

export async function generateMetadata({ params }: { params: { slug: string; pid: string } }): Promise<Metadata> {
  try {
    const res = await api.product(params.slug, params.pid);
    const p = res.product;
    return {
      title: p.name,
      description: `${p.name} (${p.unit}) — ₹${p.price}. ${res.shop} की दुकान से अब ऑनलाइन ऑर्डर करें.`,
      openGraph: {
        title: p.name,
        description: `${p.name} (${p.unit}) — ₹${p.price}`,
        type: 'website',
        images: p.photoUrl ? [{ url: p.photoUrl }] : undefined,
      },
    };
  } catch {
    return { title: 'प्रोडक्ट नहीं मिला' };
  }
}

export default async function ProductPage({ params }: { params: { slug: string; pid: string } }) {
  let res;
  try {
    res = await api.product(params.slug, params.pid);
  } catch {
    notFound();
  }
  const { product } = res;
  const variants = product.variants || [];
  const out = (product.stock ?? 0) <= 0;

  return (
    <>
      <header className="topbar">
        <Link href={`/s/${encodeURIComponent(res.shop)}`} aria-label="दुकान">🏪</Link>
        <span className="title">{product.name}</span>
        <CartBadge slug={res.shop} />
      </header>

      <main className="wrap wrap-sm">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {product.photoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={product.photoUrl} alt={product.name} style={{ width: '100%', maxHeight: 340, objectFit: 'cover', display: 'block', background: 'var(--green-soft)' }} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 180, fontSize: 60, background: 'var(--green-soft)' }}>🧺</div>}
        </div>

        <div className="card">
          <h1 style={{ margin: 0, fontSize: 20 }}>{product.name}</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
            {product.unit}{product.brand ? ' · ' + product.brand : ''}
            {product.category ? ' · ' + product.category : ''}
          </p>
          <div className="rowbtn" style={{ margin: '10px 0 0' }}>
            <span>
              <span style={{ fontSize: 22, fontWeight: 800 }}>₹{product.price}</span>
              {product.mrp ? <span className="mrp" style={{ marginLeft: 6 }}>{'₹' + product.mrp}</span> : null}
            </span>
            <span className={'chip' + (out || product.available === false ? ' off' : '')}>
              {out || product.available === false ? '❗ अभी stock में नहीं' : '● stock में है'}
            </span>
          </div>
        </div>

        {(product.fresh || product.life) && (
          <div className="card">
            {product.fresh && <p style={{ margin: '0 0 4px' }}>🌱 ताज़गी: {product.fresh}</p>}
            {product.life && <p style={{ margin: 0 }}>⏳ रखने की उम्र: {product.life}</p>}
          </div>
        )}

        <AddToCart
          slug={res.shop}
          product={{
            id: product.id, name: product.name, unit: product.unit, price: product.price,
            photoUrl: product.photoUrl, stock: product.stock,
          }}
          variants={variants}
          disabled={out || product.available === false}
        />

        <div className="card" style={{ background: 'var(--green-soft)', borderColor: 'transparent' }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--grad-3)' }}>
            ℹ️ ऑर्डर की कीमत/स्टॉक दुकान के server पर फिर जाँची जाएगी — बदली हो तो कार्ट में नई हाल दिखेगी.
          </p>
        </div>
      </main>
    </>
  );
}
