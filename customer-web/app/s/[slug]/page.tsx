import type { Metadata } from 'next';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import CartBadge from '@/components/CartBadge';
import ProductCard from '@/components/ProductCard';

/* Public shop home — slug से ही सही दुकान मिलती है; unpublished यहाँ 404 ही. */

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const { shop, og } = await api.shop(params.slug);
    return {
      title: shop.name,
      description: og.description,
      openGraph: {
        title: og.title,
        description: og.description,
        url: og.url,
        type: 'website',
        images: og.image ? [{ url: og.image }] : undefined,
      },
    };
  } catch {
    return { title: 'दुकान नहीं मिली' };
  }
}

export default async function ShopHome({ params }: { params: { slug: string } }) {
  let shop, cats, prods;
  try {
    [shop, cats, prods] = await Promise.all([
      api.shop(params.slug),
      api.categories(params.slug),
      api.products(params.slug, { limit: 24, page: 1, sort: 'name' }),
    ]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 0)) {
      return (
        <main className="wrap wrap-sm">
          <div className="card" style={{ marginTop: 40 }}>
            <h2>{e.status === 0 ? 'नेटवर्क नहीं मिला' : 'दुकान नहीं मिली'}</h2>
            <p style={{ color: 'var(--muted)' }}>
              {e.status === 0
                ? 'इंटरनेट जाँचें और फिर से लिंक खोलें.'
                : 'यह लिंक अब available नहीं है — दुकानदार से फिर लिंक लें.'}
            </p>
          </div>
        </main>
      );
    }
    throw e;
  }
  const s = shop.shop;
  const open = s.acceptingOrders;

  return (
    <>
      <header className="topbar">
        <Link href="/" aria-label="होम">🏠</Link>
        <span className="title">🛍️ {s.name}</span>
        <CartBadge slug={s.slug} />
      </header>

      <main className="wrap">
        <div className="hero">
          {s.coverUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cover" src={s.coverUrl} alt={s.name} />
          )}
          <div className="pad">
            <h1>{s.emoji || '🏪'} {s.name}</h1>
            <p>{s.description || 'अपनी मोहल्ले की दुकान — ताज़ा सामान, भरोसेमंद दाम।'}</p>
            <div className="shop-meta">
              <span className={'chip' + (open ? '' : ' off')}>
                {open ? '● ऑर्डर ले रही है' : '○ अभी ऑर्डर बंद'}
              </span>
              {s.openTime && s.closeTime && (
                <span className="chip off"> timings: {s.openTime}–{s.closeTime}</span>
              )}
              {s.delivery && <span className="chip"> होम डिलीवरी</span>}
              {s.pickup && <span className="chip"> दुकान से उठाना</span>}
            </div>
            {s.address && <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 14 }}>📍 {s.address}</div>}
            {s.contact && (
              <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 14, direction: 'ltr' }}>
                ☎️ {s.contact}
              </div>
            )}
          </div>
        </div>

        {!open && (
          <div className="closed">
            दुकान अभी ऑर्डर नहीं ले रही — देख-सूची ब्राउज़ कर सकते हैं, बाद में भेजें.
          </div>
        )}

        <nav className="cats" aria-label="कैटेगरी">
          <Link href={`/s/${encodeURIComponent(s.slug)}/search`} className="chip">सब देखें</Link>
          {cats.items.map((c) => (
            <Link
              key={c.id}
              href={`/s/${encodeURIComponent(s.slug)}/search?cat=${encodeURIComponent(c.id)}`}
              className="chip off"
            >
              {c.emoji} {c.name}
            </Link>
          ))}
        </nav>

        <section>
          <h2 style={{ fontSize: 16, margin: '0 0 8px', color: 'var(--muted)' }}>
            {prods.total} प्रोडक्ट · खोज <Link href={`/s/${encodeURIComponent(s.slug)}/search`}>तलाशें</Link>
          </h2>
          <div className="grid">
            {prods.items.map((p) => <ProductCard key={p.id} slug={s.slug} product={p} />)}
          </div>
          {prods.items.length === 0 && (
            <div className="centre">अभी कोई चीज़ available नहीं — थोड़ी देर में देखें.</div>
          )}
        </section>

        <p className="blue">
          आपका कार्ट इसी दुकान का है · <Link href={`/s/${encodeURIComponent(s.slug)}/cart`}>कार्ट खोलें</Link>
        </p>
      </main>
    </>
  );
}
