'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { shopHref } from '@/lib/format';
import type { CategoryChip, ProductListResponse } from '@/lib/types';
import CartBadge from '@/components/CartBadge';
import ProductCard from '@/components/ProductCard';

/* खोज + कैटेगरी + सॉर्ट + धीरे-धीरे लोड — सारे हिसाब query params में (shareable). */

/** next build प्रीरेंडर पर useSearchParams को Suspense चाहिए — इसलिए यह घेरा. */
export default function SearchPage() {
  return (
    <Suspense fallback={
      <>
        <header className="topbar">
          <span className="title">🔍 खोजें</span>
        </header>
        <main className="wrap">
          <div className="skeleton" />
          <div className="skeleton" />
        </main>
      </>
    }>
      <SearchScreen />
    </Suspense>
  );
}

function SearchScreen() {
  const { slug } = useParams<{ slug: string }>() as { slug: string };
  const params = useSearchParams();
  const router = useRouter();

  const q0 = params.get('q') || '';
  const cat0 = params.get('cat') || '';
  const sort0 = params.get('sort') || 'name';
  const stock0 = params.get('stock') === 'in' ? true : null;

  const [text, setText] = useState(q0);
  const [cats, setCats] = useState<CategoryChip[]>([]);
  const [list, setList] = useState<ProductListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setText(q0); }, [q0]);

  const load = useCallback(async (p: number, replacing: boolean) => {
    (replacing ? setLoading : setLoadingMore)(true);
    setErr(null);
    try {
      const res = await api.products(slug, {
        q: text.trim() || undefined,
        categoryId: cat0 || undefined,
        sort: sort0,
        inStock: stock0 ? 'true' : undefined,
        page: p,
        limit: 24,
      });
      setList(res);
      setPage(p);
    } catch (e: any) {
      setErr(e?.message || 'नेटवर्क नहीं मिला');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, text, cat0, sort0, stock0]);

  useEffect(() => {
    load(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q0, cat0, sort0, stock0, slug]);

  useEffect(() => {
    api.categories(slug).then((r) => setCats(r.items)).catch(() => setCats([]));
  }, [slug]);

  /* 400ms debounce — हर टाइप पर नयी रिक्वेस्ट नहीं */
  useEffect(() => {
    if (text === q0) return;
    const t = setTimeout(() => {
      const usp = new URLSearchParams(params.toString());
      if (text.trim()) usp.set('q', text.trim());
      else usp.delete('q');
      router.replace(`/s/${encodeURIComponent(slug)}/search?` + usp.toString());
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const setParam = (k: string, v: string) => {
    const usp = new URLSearchParams(params.toString());
    if (v) usp.set(k, v);
    else usp.delete(k);
    router.replace(`/s/${encodeURIComponent(slug)}/search?` + usp.toString());
  };

  return (
    <>
      <header className="topbar">
        <Link href={`/s/${encodeURIComponent(slug)}`} aria-label="दुकान">🏪</Link>
        <span className="title">🔍 खोजें</span>
        <CartBadge slug={slug} />
      </header>

      <main className="wrap">
        <form className="searchbar" onSubmit={(e) => { e.preventDefault(); load(1, true); }} role="search">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="सामान ढूँढें… (जैसे: आटा, चाय)"
            aria-label="प्रोडक्ट खोज"
            inputMode="search"
          />
          <button type="submit" aria-label="खोजें">🔍</button>
        </form>

        <nav className="cats" aria-label="कैटेगरी">
          <button type="button" className={'chip' + (!cat0 ? '' : ' off')} onClick={() => setParam('cat', '')}>सब</button>
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'chip' + (cat0 === c.id ? '' : ' off')}
              aria-pressed={cat0 === c.id}
              onClick={() => setParam('cat', cat0 === c.id ? '' : c.id)}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </nav>

        <div className="rowbtn" style={{ margin: '2px 0 10px' }}>
          <button
            type="button"
            className="chip off"
            aria-pressed={!!stock0}
            onClick={() => setParam('stock', stock0 ? '' : 'in')}
            style={{ border: 'none', cursor: 'pointer' }}
          >
            {stock0 ? '✓ ' : ''}जो stock में है
          </button>
          <select
            value={sort0}
            aria-label="क्रम"
            onChange={(e) => setParam('sort', e.target.value)}
            style={{ minWidth: 150, minHeight: 40, border: '1px solid var(--line)', borderRadius: 10, padding: '0 8px', background: '#fff' }}
          >
            <option value="name">नाम से (क-ह)</option>
            <option value="price_asc">दाम: कम पहले</option>
            <option value="price_desc">दाम: ज़्यादा पहले</option>
          </select>
        </div>

        {loading && (
          <>
            <div className="skeleton" />
            <div className="skeleton" />
          </>
        )}

        {err && !loading && (
          <div className="centre" role="alert">
            <p>⚠️ {err}</p>
            <button className="addbtn" onClick={() => load(1, true)}>फिर कोशिश करें</button>
          </div>
        )}

        {!loading && !err && list && (
          <>
            {list.items.length === 0 ? (
              <div className="centre">
                <p style={{ fontSize: 40, margin: 0 }}>🔎</p>
                <p><b>“{text || 'इस फ़िल्टर'}” के लिए</b> कुछ नहीं मिला</p>
                <p>दूसरे नाम से खोजें या फ़िल्टर हटाएँ.</p>
                <button className="addbtn" onClick={() => router.replace(`/s/${encodeURIComponent(slug)}/search`)}>
                  फ़िल्टर साफ़ करें
                </button>
              </div>
            ) : (
              <>
                <div className="grid">
                  {list.items.map((p) => <ProductCard key={p.id} slug={slug} product={p} />)}
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
                  {list.total} में से {list.items.length} दिख रहे हैं
                </p>
                {list.hasMore && (
                  <div style={{ textAlign: 'center', marginTop: 10 }}>
                    <button className="bigbtn sub" onClick={() => load(page + 1, false)} disabled={loadingMore}>
                      {loadingMore ? 'लोड हो रहा है…' : 'और दिखाएँ'}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
