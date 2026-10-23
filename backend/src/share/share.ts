/**
 * PART 6 — shop-link sharing helpers (pure, DB-free).
 *
 * एक ही जगह से बनते हैं:
 *   - सार्वजनिक दुकान का canonical URL (PUBLIC_SHOP_ORIGIN + /s/<slug>)
 *   - मर्चेंट का WhatsApp/native-share संदेश (हिंदी टेम्पलेट)
 *   - Open Graph / Twitter मेटाडेटा (public दुकान के लिए ही कभी बुलाया जाता है)
 *
 * नियम:
 *   - यहाँ कोई DB/HTTP access नहीं — unit-testable है (test/unit/share.spec.ts).
 *   - merchant-provided text साफ़ किया जाता है (control chars/newlines हटते हैं,
 *     लंबाई cap) ताकि metadata में कचरा/injection-friendly टेक्स्ट न जाए.
 *     (HTML escaping Next.js/React initial-HTML में करता है; यह JSON shape है.)
 *   - उत्पादन (production) में public origin HTTPS ही चलेगा — नहीं तो boot fail.
 */

/** customer-web का दुकान-रास्ता: /s/[slug] (Part 4 से ही). */
export const SHARE_PATH = '/s/';

/** {shop_name} / {shop_url} placeholders — env SHARE_TEXT_TEMPLATE से बदले जा सकते हैं. */
export const DEFAULT_SHARE_TEMPLATE =
  'नमस्ते! हमारी दुकान {shop_name} अब ऑनलाइन उपलब्ध है। ' +
  'सामान देखने और ऑर्डर करने के लिए यह लिंक खोलें: {shop_url}';

/** डिफ़ॉल्ट OG विवरण — जब दुकान ने अपना परिचय नहीं लिखा. */
export const DEFAULT_OG_DESCRIPTION = 'ताज़ा सामान, होम डिलीवरी — अब ऑनलाइन।';

/** OG/Twitter की व्यावहारिक लंबाई-सीमाएँ (title ~60-95, description ~160). */
const TITLE_MAX = 95;
const DESC_MAX = 160;
const NAME_MAX = 80;

/**
 * merchant text को public-safe बनाओ: control/newline हटें, spaces सिमटें, cap.
 * HTML नहीं escape करते (यह JSON है) — पर `<>` हटाने से कच्चे मार्कअप जैसा
 * टेक्स्ट metadata कॉपी में भी ख़तरनाक नहीं रहता.
 */
export function sanitizePublicText(input: unknown, maxLen: number): string {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')   // control chars + angle brackets बाहर
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 1).trimEnd() + '…' : s;
}

/** origin से trailing slash हटाओ; production में https:// ज़रूरी (वरना throw). */
export function normalizePublicOrigin(origin: string, isProduction: boolean): string {
  const o = String(origin || '').trim().replace(/\/+$/, '');
  if (!o) throw new Error('PUBLIC_SHOP_ORIGIN खाली है — public दुकान का URL नहीं बनेगा');
  if (isProduction && !o.startsWith('https://')) {
    throw new Error('PUBLIC_SHOP_ORIGIN प्रोडक्शन में https:// होना चाहिए (वर्तमान: ' + o + ')');
  }
  if (!/^https?:\/\//.test(o)) {
    throw new Error('PUBLIC_SHOP_ORIGIN http(s):// से शुरू होना चाहिए (वर्तमान: ' + o + ')');
  }
  return o;
}

/** Canonical public URL: https://<origin>/s/<slug> — slug URL-encoded. */
export function publicShopUrl(origin: string, slug: string, isProduction = false): string {
  return normalizePublicOrigin(origin, isProduction) + SHARE_PATH + encodeURIComponent(String(slug || ''));
}

/** MEDIA_URL_BASE के साथ इमेज URL पूर्ण (absolute) बनाओ; खाली → null. */
export function absoluteImageUrl(mediaBase: string, url: unknown): string | null {
  const u = String(url ?? '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  const base = String(mediaBase || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  return u.startsWith('/') ? base + u : base + '/' + u;
}

/** दुकान के लोगो/कवर न होने पर safe default OG इमेज (customer-web से serve होती है). */
export function defaultOgImage(origin: string, isProduction = false): string {
  return normalizePublicOrigin(origin, isProduction) + '/og-default.png';
}

export interface ShareOgShop {
  name: unknown;
  description?: unknown;
  about?: unknown;
  slug: string;
  logoUrl?: unknown;
  coverUrl?: unknown;
}

export interface OgMeta {
  title: string;
  description: string;
  url: string;
  type: 'website';
  siteName: string;
  locale: string;
  image: string;
  imageAlt: string;
  twitterCard: 'summary' | 'summary_large_image';
}

/** सार्वजनिक दुकान का OG/Twitter मेटाडेटा — सिर्फ़ public फ़ील्ड, कोई पता/नंबर/आईडी नहीं. */
export function ogFor(shop: ShareOgShop, origin: string, mediaBase: string, isProduction = false): OgMeta {
  const title = sanitizePublicText(shop.name, TITLE_MAX) || 'SOS Local Dukaan';
  const description =
    sanitizePublicText(shop.description, DESC_MAX) ||
    sanitizePublicText(shop.about, DESC_MAX) ||
    DEFAULT_OG_DESCRIPTION;
  const cover = absoluteImageUrl(mediaBase, shop.coverUrl);
  const logo = absoluteImageUrl(mediaBase, shop.logoUrl);
  const image = cover || logo || defaultOgImage(origin, isProduction);
  return {
    title,
    description,
    url: publicShopUrl(origin, shop.slug, isProduction),
    type: 'website',
    siteName: 'SOS Local Dukaan',
    locale: 'hi_IN',
    image,
    imageAlt: title + ' — दुकान की तस्वीर',
    twitterCard: cover ? 'summary_large_image' : 'summary',
  };
}

/**
 * मर्चेंट संदेश: टेम्पलेट के {shop_name}/{shop_url} भरो — दोनों *ठीक एक बार*.
 * टेम्पलेट में {shop_url} न हो तो अंत में जोड़ देते हैं (URL कभी ग़ायब नहीं होता);
 * नाम/url की दोहराव टेम्पलेट लिखने वाले की ग़लती है, इसे और बढ़ाते नहीं.
 */
export function buildShareText(
  template: string | undefined,
  shopName: unknown,
  url: string,
): string {
  const name = sanitizePublicText(shopName, NAME_MAX) || 'दुकान';
  const u = String(url || '').trim();
  let t = String(template && template.trim() ? template : DEFAULT_SHARE_TEMPLATE);
  if (!t.includes('{shop_url}')) t = t.trimEnd() + ' {shop_url}';
  if (!t.includes('{shop_name}')) t = '{shop_name} — ' + t;
  return t
    .replace(/\{shop_name\}/g, name)
    .replace(/\{shop_url\}/g, u)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface ShareEligibility {
  shareable: boolean;
  reason: string | null;
}

/**
 * कौन-सी दुकान share-जानकारी/public page पाने की हक़दार है.
 * Public = approval_status 'APPROVED' AND published TRUE (Part 2/4 जैसा ही).
 */
export function shareEligibility(approvalStatusRaw: unknown, published: unknown): ShareEligibility {
  const status = String(approvalStatusRaw || '').toUpperCase();
  const isPublished = published === true;
  if (status === 'APPROVED' && isPublished) return { shareable: true, reason: null };
  if (status === 'SUSPENDED') {
    return { shareable: false, reason: 'दुकान निलंबित है — सपोर्ट से संपर्क करें। लिंक अभी ग्राहकों के लिए बंद है।' };
  }
  if (status === 'REJECTED') {
    return { shareable: false, reason: 'दुकान अप्रूवल में रिजेक्ट हुई — प्रोफ़ाइल सुधारकर फिर भेजें। लिंक अभी बंद है।' };
  }
  if (status === 'PENDING' || status === 'PENDING_APPROVAL') {
    return { shareable: false, reason: 'एडमिन अप्रूवल की जाँच चल रही है — अप्रूव होते ही लिंक खुल जाएगा।' };
  }
  if (status === 'APPROVED' && !isPublished) {
    return { shareable: false, reason: 'अप्रूवल मिला है, पर दुकान अभी प्रकाशित (publish) नहीं है — लिंक अभी बंद है।' };
  }
  return { shareable: false, reason: 'दुकान ड्राफ़्ट में है — प्रोफ़ाइल पूरी कर अप्रूवल के लिए भेजें।' };
}
