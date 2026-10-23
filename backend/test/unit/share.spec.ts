import {
  DEFAULT_SHARE_TEMPLATE,
  absoluteImageUrl,
  buildShareText,
  defaultOgImage,
  normalizePublicOrigin,
  ogFor,
  publicShopUrl,
  sanitizePublicText,
  shareEligibility,
} from '../../src/share/share';

/* PART 6 — shop-link sharing pure helpers (DB-free). */

describe('sanitizePublicText', () => {
  it('control chars/newlines हटाता है और spaces सिमटता है', () => {
    expect(sanitizePublicText('शर्मा\nकिराना\t स्टोर', 80)).toBe('शर्मा किराना स्टोर');
  });
  it('<> हटाता है (कच्चे मार्कअप जैसा टेक्स्ट metadata में न जाए)', () => {
    expect(sanitizePublicText('<script>alert(1)</script>दुकान', 80)).toBe('script alert(1) /script दुकान');
  });
  it('लंबाई cap करता है (… के साथ)', () => {
    const out = sanitizePublicText('अ'.repeat(300), 95);
    expect(out.length).toBe(95);
    expect(out.endsWith('…')).toBe(true);
  });
  it('खाली/null → खाली string', () => {
    expect(sanitizePublicText(null, 80)).toBe('');
    expect(sanitizePublicText('   ', 80)).toBe('');
  });
});

describe('normalizePublicOrigin', () => {
  it('trailing slash हटाता है', () => {
    expect(normalizePublicOrigin('https://dukan.example.com/', false)).toBe('https://dukan.example.com');
  });
  it('production में http अस्वीकार', () => {
    expect(() => normalizePublicOrigin('http://dukan.example.com', true)).toThrow(/https/);
  });
  it('dev में http/localhost चलता है', () => {
    expect(normalizePublicOrigin('http://localhost:3000', false)).toBe('http://localhost:3000');
  });
  it('scheme के बिना अस्वीकार', () => {
    expect(() => normalizePublicOrigin('dukan.example.com', false)).toThrow(/http/);
  });
  it('खाली origin अस्वीकार', () => {
    expect(() => normalizePublicOrigin('', false)).toThrow(/PUBLIC_SHOP_ORIGIN/);
  });
});

describe('publicShopUrl', () => {
  it('canonical URL बनाता है: origin + /s/ + slug', () => {
    expect(publicShopUrl('https://dukan.example.com', 'sharma-kirana', true))
      .toBe('https://dukan.example.com/s/sharma-kirana');
  });
  it('Devanagari slug URL-encode होता है (एक ही URL, दूसरी दुकान नहीं)', () => {
    expect(publicShopUrl('https://d.in', 'दुकान')).toBe('https://d.in/s/%E0%A4%A6%E0%A5%81%E0%A4%95%E0%A4%BE%E0%A4%A8');
  });
  it('दो अलग slugs के URL अलग ही रहते हैं', () => {
    const a = publicShopUrl('https://d.in', 'sharma-kirana');
    const b = publicShopUrl('https://d.in', 'sharma-kirana-2');
    expect(a).not.toBe(b);
  });
});

describe('absoluteImageUrl + defaultOgImage', () => {
  it('absolute URL जैसा है वैसा', () => {
    expect(absoluteImageUrl('https://api.example.com/media', 'https://cdn.example.com/x.png'))
      .toBe('https://cdn.example.com/x.png');
  });
  it('relative → MEDIA_URL_BASE जोड़कर absolute', () => {
    expect(absoluteImageUrl('https://api.example.com/media', 'shop1/logo-a.png'))
      .toBe('https://api.example.com/media/shop1/logo-a.png');
  });
  it('खाली → null', () => {
    expect(absoluteImageUrl('https://api.example.com/media', null)).toBeNull();
    expect(absoluteImageUrl('https://api.example.com/media', '')).toBeNull();
  });
  it('default image origin पर बनती है', () => {
    expect(defaultOgImage('https://dukan.example.com')).toBe('https://dukan.example.com/og-default.png');
  });
});

describe('ogFor', () => {
  const base = { name: 'शर्मा किराना स्टोर', slug: 'sharma-kirana' };
  it('title/description/url/type सही; कोई पता/नंबर/आईडी नहीं', () => {
    const og = ogFor({ ...base, description: 'ताज़ा सब्ज़ी व फल' }, 'https://dukan.example.com', 'https://api.example.com/media');
    expect(og.title).toBe('शर्मा किराना स्टोर');
    expect(og.description).toBe('ताज़ा सब्ज़ी व फल');
    expect(og.url).toBe('https://dukan.example.com/s/sharma-kirana');
    expect(og.type).toBe('website');
    expect(og.siteName).toBe('SOS Local Dukaan');
    expect(og.locale).toBe('hi_IN');
    expect(JSON.stringify(og)).not.toMatch(/address|phone|license|whatsapp/i);
  });
  it('कवर इमेज → summary_large_image; सिर्फ़ लोगो → summary', () => {
    const ogCover = ogFor({ ...base, coverUrl: 'c.jpg', logoUrl: 'l.jpg' }, 'https://d.in', 'https://a.in/m');
    const ogLogo = ogFor({ ...base, logoUrl: 'l.jpg' }, 'https://d.in', 'https://a.in/m');
    expect(ogCover.twitterCard).toBe('summary_large_image');
    expect(ogCover.image).toBe('https://a.in/m/c.jpg');
    expect(ogLogo.twitterCard).toBe('summary');
  });
  it('लोगो/कवर नहीं → safe default image', () => {
    const og = ogFor(base, 'https://dukan.example.com', 'https://api.example.com/media');
    expect(og.image).toBe('https://dukan.example.com/og-default.png');
  });
  it('अजीब/दुर्भावना नाम साफ़ होकर जाता है (कोई कच्चा tag नहीं)', () => {
    const og = ogFor({ ...base, name: 'दुकान <img src=x onerror=alert(1)> "quoted"' }, 'https://d.in', 'https://a.in/m');
    expect(og.title).not.toContain('<');
    expect(og.title).not.toContain('>');
    expect(og.title.startsWith('दुकान')).toBe(true);
  });
  it('description नहीं → हिंदी default', () => {
    const og = ogFor(base, 'https://d.in', 'https://a.in/m');
    expect(og.description.length).toBeGreaterThan(0);
    expect(og.description).toBe('ताज़ा सामान, होम डिलीवरी — अब ऑनलाइन।');
  });
});

describe('buildShareText', () => {
  it('default टेम्पलेट में नाम और URL ठीक-ठीक एक बार आते हैं', () => {
    const text = buildShareText(undefined, 'शर्मा किराना', 'https://dukan.example.com/s/sharma-kirana');
    expect(text).toBe('नमस्ते! हमारी दुकान शर्मा किराना अब ऑनलाइन उपलब्ध है। ' +
      'सामान देखने और ऑर्डर करने के लिए यह लिंक खोलें: https://dukan.example.com/s/sharma-kirana');
    expect(text.split('sharma-kirana').length - 1).toBe(1);
    expect(text.split('शर्मा किराना').length - 1).toBe(1);
  });
  it('placeholder के बिना टेम्पलेट भी URL देता है (गुम नहीं होता)', () => {
    const text = buildShareText('आओ देखो', 'दुकान', 'https://d.in/s/x');
    expect(text).toContain('https://d.in/s/x');
    expect(text).toContain('दुकान');
  });
  it('{shop_url} नहीं हो तो अंत में जुड़ता है; नाम दोहराया नहीं जाता', () => {
    const text = buildShareText('नमस्ते! {shop_name} ऑनलाइन है।', 'मेरी दुकान', 'https://d.in/s/m');
    expect(text).toBe('नमस्ते! मेरी दुकान ऑनलाइन है। https://d.in/s/m');
    expect(text.match(/मेरी दुकान/g)?.length).toBe(1);
  });
  it('नाम में अजीब अक्षर साफ़ होते हैं; URL अछूता रहता है', () => {
    const text = buildShareText(DEFAULT_SHARE_TEMPLATE, 'A\nB <b>', 'https://d.in/s/k');
    expect(text).toContain('https://d.in/s/k');
    expect(text).not.toContain('<b>');
    expect(text).not.toMatch(/\n/);
  });
  it('कस्टम टेम्पलेट (env) भी चलता है', () => {
    const text = buildShareText('{shop_url} — {shop_name}', 'दुकान', 'https://d.in/s/z');
    expect(text).toBe('https://d.in/s/z — दुकान');
  });
});

describe('shareEligibility', () => {
  it('APPROVED + published → shareable', () => {
    expect(shareEligibility('APPROVED', true)).toEqual({ shareable: true, reason: null });
  });
  it('SUSPENDED → बंद + कारण', () => {
    const e = shareEligibility('SUSPENDED', false);
    expect(e.shareable).toBe(false);
    expect(e.reason).toContain('निलंबित');
  });
  it('REJECTED → बंद + कारण', () => {
    expect(shareEligibility('REJECTED', false).shareable).toBe(false);
  });
  it('PENDING (Part-7 enum) → बंद + कारण', () => {
    expect(shareEligibility('PENDING', false).shareable).toBe(false);
  });
  it('PENDING_APPROVAL (legacy वैल्यू) भी वही देता है — नई DB से पहले का डेटा', () => {
    expect(shareEligibility('PENDING_APPROVAL', false).shareable).toBe(false);
  });
  it('APPROVED पर पर published=false → बंद', () => {
    expect(shareEligibility('APPROVED', false).shareable).toBe(false);
  });
  it('DRAFT → बंद', () => {
    expect(shareEligibility('DRAFT', false).shareable).toBe(false);
  });
});
