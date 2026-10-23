/* ============================================================================
   POS — Part 2 API layer (registration / shop profile / public URL)
   ----------------------------------------------------------------------------
   − index.html से पहले load होती है; window.POS expose करती है।
   − दो मोड:
       SERVER : जब Settings में API base URL सेट हो (fetch → NestJS backend)
       OFFLINE: बेर बैकएंड के डेवलपमेंट मोड — mock OTP + स्थानीय पर्सिस्टेंस।
                यह मोड हमेशा "डेवलपमेंट-ओनली" है; UI में साफ़ लेबल दिखता है।
   − OTP कोड कभी plaintext में store/log नहीं होता — सिर्फ़ SHA-256 हैश + TTL,
     मेमोरी में (localStorage में OTP कुछ नहीं जाता)।
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- safe storage (Part 1 pattern, same fallbacks) -------- */
  var MEM = {};
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return MEM[k] || null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { MEM[k] = String(v); } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { delete MEM[k]; } }
  function jget(k, d) { try { return JSON.parse(lsGet(k)) || d; } catch (e) { return d; } }
  function jset(k, v) { lsSet(k, JSON.stringify(v)); }

  /* ---------------- configuration (configurable domain / API) ------------ */
  var CONFIG = {
    apiBase: (lsGet('pos_api_base') || apiBaseFromAndroid() || '').replace(/\/+$/, ''),     // e.g. https://api.meri-dukan.in
    publicBase: lsGet('pos_public_base') || 'https://pos-banner.github.io/demo-store/#/', // demo default; configurable
    otpLength: 6,
    otpTtlMs: 5 * 60 * 1000,
    otpMaxTries: 5
  };
  function apiBaseFromAndroid() {
    try {
      return (window.POSAndroid && window.POSAndroid.apiBase && window.POSAndroid.apiBase()) || '';
    } catch (e) { return ''; }
  }
  function mode() { return CONFIG.apiBase ? 'server' : 'offline'; }
  function isOffline() { return mode() === 'offline'; }

  /* ---------------- small utils ------------------------------------------ */
  function now() { return Date.now(); }
  function sha256Hex(s) {
    // Dev-only OTP hashing. crypto.subtle (file:// = secure context) with a
    // djb2-based fallback for very old WebViews. Plaintext is never stored.
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      var bytes = new TextEncoder ? new TextEncoder().encode(s) : null;
      if (bytes) {
        return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
          var arr = new Uint8Array(buf), hex = '';
          for (var i = 0; i < arr.length; i++) hex += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
          return hex;
        });
      }
    }
    var h1 = 5381, h2 = 52711, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h1 = ((h1 << 5) + h1) ^ c; h2 = ((h2 << 7) + h2) ^ (c + i); }
    return Promise.resolve('fb_' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16));
  }
  function randCode(len) {
    var s = '';
    while (s.length < (len || 6)) s += String(Math.floor(Math.random() * 10));
    return s;
  }
  function randId(pfx) {
    return (pfx || 'id') + '_' + now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  /* ---------------- validation helpers (mirror of server) ---------------- */
  var IND_PHONE = /^[6-9]\d{9}$/;
  function phoneValid(v) { return IND_PHONE.test(String(v || '').replace(/\D/g, '').slice(-10)); }
  // WhatsApp in normalized international format: +<10..15 digits>
  function waNormalize(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    else if (d.length === 11 && d.charAt(0) === '0') d = '91' + d.slice(1);
    if (d.length < 10 || d.length > 15) return { ok: false, reason: 'length' };
    return { ok: true, e164: '+' + d, digits: d, waLink: 'https://wa.me/' + d };
  }
  function slugify(name) {
    var s = String(name || '').toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097F\s-]/g, ' ')
      .trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    // Devanagari-only names → keep them (URL-encoded), else latin fallback
    if (!s) s = 'dukan';
    return s.length > 40 ? s.slice(0, 40).replace(/-+[^-]*$/, '') : s;
  }
  function slugCandidates(name) {
    var base = slugify(name), out = [base], n;
    for (n = 2; n <= 5; n++) out.push(base + '-' + n);
    return out;
  }

  /* ---------------- public URL (configurable domain) --------------------- */
  function publicUrl(slug) {
    var base = (CONFIG.publicBase || '').replace(/\/+$/, '');
    return base + '/' + encodeURIComponent(String(slug || ''));
  }

  /* ---------------- offline persistence (dev-only demo data) ------------- */
  var ACCOUNT_KEY = 'pos_account_v2';   // merchant account + shop profile (offline only)
  var SLUGS_KEY = 'pos_slug_registry';  // claimed slugs (offline only)
  var CATS_KEY = 'pos_shop_categories'; // category cache

  // Server seeds these; offline/dev fallback below. Admin can manage them.
  var SEED_CATEGORIES = [
    { id: 'grocery',            name: 'किराना और ग्रॉसरी',  nameEn: 'Grocery & Kirana',      emoji: '🧺', licenseRequired: false, licenseLabel: '',           sortOrder: 1 },
    { id: 'pharmacy',           name: 'फार्मेसी',           nameEn: 'Pharmacy',              emoji: '💊', licenseRequired: true,  licenseLabel: 'औषधि लाइसेंस (DL) नंबर', sortOrder: 2 },
    { id: 'clothing',           name: 'कपड़े और सिलाई',     nameEn: 'Clothing',              emoji: '🧵', licenseRequired: false, licenseLabel: '',           sortOrder: 3 },
    { id: 'cafe-restaurant',    name: 'कैफ़े और रेस्टोरेंट',  nameEn: 'Cafe & Restaurant',     emoji: '☕', licenseRequired: true,  licenseLabel: 'FSSAI लाइसेंस नंबर',      sortOrder: 4 },
    { id: 'sweets-snacks',      name: 'मिठाई और स्नैक्स',    nameEn: 'Sweets & Snacks',       emoji: '🍮', licenseRequired: true,  licenseLabel: 'FSSAI लाइसेंस नंबर',      sortOrder: 5 },
    { id: 'fruits-vegetables',  name: 'फल और सब्ज़ी',        nameEn: 'Fruits & Vegetables',   emoji: '🍅', licenseRequired: false, licenseLabel: '',           sortOrder: 6 },
    { id: 'bakery-dairy',       name: 'बेकरी और डेयरी',     nameEn: 'Bakery & Dairy',        emoji: '🥛', licenseRequired: true,  licenseLabel: 'FSSAI लाइसेंस नंबर',      sortOrder: 7 },
    { id: 'stationery',         name: 'स्टेशनरी',           nameEn: 'Stationery',            emoji: '📚', licenseRequired: false, licenseLabel: '',           sortOrder: 8 },
    { id: 'mobile-accessories', name: 'मोबाइल एक्सेसरीज़',   nameEn: 'Mobile Accessories',    emoji: '📱', licenseRequired: false, licenseLabel: '',           sortOrder: 9 },
    { id: 'other',              name: 'अन्य',               nameEn: 'Other',                 emoji: '🏪', licenseRequired: false, licenseLabel: '',           sortOrder: 10 }
  ];
  function catsLocal() { return SEED_CATEGORIES.slice(); }
  function catsCache() { var c = jget(CATS_KEY, null); return (c && c.items) ? c.items : null; }
  function catsCacheSave(items) { jset(CATS_KEY, { ts: now(), items: items }); }

  function getAccount() { return jget(ACCOUNT_KEY, null); }
  function saveAccount(a) { jset(ACCOUNT_KEY, a); }
  function getToken() {
    var a = getAccount(); return a ? a.token : null;
  }
  function claimedSlugs() { return jget(SLUGS_KEY, ['sharma-kirana', 'demo-dukan']); }
  function claimSlug(slug) {
    var s = claimedSlugs();
    if (s.indexOf(slug) === -1) { s.push(slug); jset(SLUGS_KEY, s); }
  }
  function releaseSlugs(exceptSlugs) {
    var keep = {};
    for (var i = 0; i < exceptSlugs.length; i++) keep[exceptSlugs[i]] = 1;
    jset(SLUGS_KEY, claimedSlugs().filter(function (x) { return !!keep[x]; }));
  }

  /* ---------------- HTTP layer (server mode) ----------------------------- */
  var LAST_HTTP_ERR = null;
  function http(method, path, body, opts) {
    opts = opts || {};
    if (!window.fetch || !CONFIG.apiBase) {
      return Promise.reject({ http: false, status: 0, message: 'OFFLINE_MODE' });
    }
    var url = CONFIG.apiBase + path;
    var headers = { 'Accept': 'application/json' };
    var token = getToken();
    if (token && !opts.noAuth) headers['Authorization'] = 'Bearer ' + token;
    var init = { method: method, headers: headers };
    if (body !== undefined && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else if (body instanceof FormData) { init.body = body; }
    // timeout (WebView fetch has none)
    var ctrl = window.AbortController ? new AbortController() : null;
    if (ctrl) { init.signal = ctrl.signal; setTimeout(function () { ctrl.abort(); }, opts.timeout || 12000); }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { message: txt }; }
        if (!res.ok) throw { http: true, status: res.status, data: data };
        return data;
      });
    }).catch(function (err) {
      LAST_HTTP_ERR = err && err.message ? err.message : String(err);
      throw err;
    });
  }
  function errText(err) {
    if (err && err.http) {
      var m = err.data && (err.data.message || (err.data.error && err.data.error.message));
      if (err.status === 429) return t('ज़्यादा कोशिश — थोड़ी देर में.', 'Too many attempts — try shortly.');
      if (err.status === 401) return t('सेशन समाप्त — दोबारा लॉगिन करें।','Session over — sign in again.');
      return m || t('सर्वर त्रुटि (' + err.status + ')', 'Server error (' + err.status + ')');
    }
    if (err && err.message === 'OFFLINE_MODE') return t('बैकएंड सेट नहीं — ऑफ़लाइन मोड में नहीं हो सकता।','No backend set — not possible in offline mode.');
    return t('नेटवर्क नहीं मिला','Network unavailable');
  }

  /* ---------------- in-memory OTP state (never persisted, never logged) -- */
  var OTP = { phone: null, hash: null, expires: 0, tries: 0, used: false, devCode: null };

  var auth = {
    register: function (_name, phone) {
      // server mode: primes a pending user; offline: nothing to upload yet
      if (isOffline()) { saveAccount({ user: { name: _name, phone: phone }, token: null, shop: null, ts: now() }); return Promise.resolve({ ok: true, offline: true }); }
      return http('POST', '/auth/register', { name: _name, phone: phone, locale: 'hi' });
    },
    otpRequest: function (phone) {
      if (!phoneValid(phone)) return Promise.reject({ message: 'invalid-phone' });
      if (isOffline()) {
        // DEV-ONLY MOCK OTP: valid code only in memory of this screen flow.
        var code = randCode(CONFIG.otpLength);
        return sha256Hex(phone + ':' + code).then(function (h) {
          OTP = { phone: phone, hash: h, expires: now() + CONFIG.otpTtlMs, tries: 0, used: false, devCode: code };
          return { ok: true, offline: true, ttlSec: CONFIG.otpTtlMs / 1000 };
        });
      }
      return http('POST', '/auth/otp/request', { phone: phone }).then(function (r) {
        OTP = { phone: phone, hash: null, expires: now() + CONFIG.otpTtlMs, tries: 0, used: false, devCode: null };
        return r;
      });
    },
    otpVerify: function (code) {
      var a = getAccount();
      var phone = a && a.user ? a.user.phone : OTP.phone;
      if (isOffline()) {
        if (!OTP.hash || OTP.used) return Promise.reject({ message: 'no-otp' });
        if (now() > OTP.expires) return Promise.reject({ message: 'expired' });
        return sha256Hex(phone + ':' + String(code)).then(function (h) {
          if (h !== OTP.hash) {
            OTP.tries++;
            if (OTP.tries >= CONFIG.otpMaxTries) { OTP.used = true; }
            throw { message: 'wrong-code' };
          }
          OTP.used = true; OTP.devCode = null;           // code never kept after success
          if (!a || !a.user || a.user.phone !== phone) saveAccount({ user: { name: '', phone: phone }, token: 'offline-dev-token', shop: null, ts: now() });
          else { a.token = 'offline-dev-token'; saveAccount(a); }
          return { ok: true, offline: true, hasShop: !!(getAccount() && getAccount().shop) };
        });
      }
      return http('POST', '/auth/otp/verify', { phone: phone, code: String(code) }).then(function (r) {
        var acc = getAccount() || { user: { name: (r.user && r.user.name) || '', phone: phone }, shop: null };
        acc.token = r.token; acc.user = acc.user || {};
        if (r.user) { acc.user.name = acc.user.name || r.user.name; acc.user.phone = r.user.phone || phone; }
        if (r.shop) acc.shop = r.shop;
        saveAccount(acc);
        return { ok: true, hasShop: !!acc.shop };
      });
    },
    // dev helper for the on-screen "DEV कोड" banner (offline only)
    devCode: function () { return isOffline() ? OTP.devCode : null; },
    isExpired: function () { return OTP && now() > OTP.expires; },
    otpState: function () { return { phone: OTP.phone, expires: OTP.expires, tries: OTP.tries, hash: undefined, devCode: undefined }; },
    me: function () {
      if (isOffline()) { var a = getAccount(); return Promise.resolve(a ? { user: a.user, shop: a.shop, mode: 'offline' } : { mode: 'offline' }); }
      return http('GET', '/auth/me');
    },
    logout: function () {
      OTP = { phone: null, hash: null, expires: 0, tries: 0, used: false, devCode: null };
      // offline: account data stays on the device (Part 1 promise); token cleared
      var a = getAccount(); if (a) { a.token = null; saveAccount(a); }
      return Promise.resolve({ ok: true });
    }
  };

  /* ---------------- shop categories -------------------------------------- */
  var cats = {
    list: function () {
      if (isOffline()) { catsCacheSave(catsLocal()); return Promise.resolve(catsLocal()); }
      var cached = catsCache();
      if (cached) return Promise.resolve(cached);
      return http('GET', '/shop-categories').then(function (r) {
        var items = (r && r.items) ? r.items : (r || []);
        catsCacheSave(items); return items;
      }).catch(function (e) { if (e.http) throw e; return catsCache() || catsLocal(); });
    },
    localSeed: catsLocal
  };

  /* ---------------- shop CRUD / slug / media ------------------------------ */
  function offlineShopPatch(shop, patch) {
    var keys = ['name', 'slug', 'categories', 'categoryIds', 'licenseNo', 'emoji', 'address', 'pin',
      'lat', 'lng', 'whatsapp', 'businessPhone', 'description', 'openTime', 'closeTime', 'openAllWeek',
      'pickup', 'delivery', 'logo', 'cover'];
    for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (patch[k] !== undefined) shop[k] = patch[k]; }
    return shop;
  }
  var shops = {
    checkSlug: function (slug) {
      slug = slugify(slug);
      if (isOffline()) {
        var taken = claimedSlugs().indexOf(slug) !== -1;
        var mine = (getAccount() && getAccount().shop && getAccount().shop.slug === slug);
        return Promise.resolve({ slug: slug, available: !taken || mine, suggestions: taken && !mine ? slugCandidates(slugify(slug)).slice(1, 4) : [] });
      }
      return http('GET', '/shops/check-slug?slug=' + encodeURIComponent(slug));
    },
    create: function (payload) {
      if (isOffline()) {
        // DEV: same validations the server applies (except ownership)
        var slug = slugify(payload.slug || payload.name);
        var taken = claimedSlugs().indexOf(slug) !== -1;
        if (taken) return Promise.reject({ message: 'slug-taken', suggestions: slugCandidates(slug).slice(1, 4) });
        var shop = {
          id: randId('shop'), name: payload.name, slug: slug,
          status: 'DRAFT', published: false,       // क्लाइंट approval status सेट नहीं करता
          categories: payload.categories || [], categoryIds: payload.categoryIds || [],
          licenseNo: payload.licenseNo || '', emoji: payload.emoji || '🏪',
          address: payload.address || '', pin: payload.pin || '', lat: payload.lat || null, lng: payload.lng || null,
          whatsapp: waNormalize(payload.whatsapp).digits || '', businessPhone: waNormalize(payload.businessPhone).digits || '',
          description: payload.description || '', openTime: payload.openTime || '07:00', closeTime: payload.closeTime || '22:00',
          openAllWeek: payload.openAllWeek !== false, pickup: payload.pickup !== false, delivery: payload.delivery !== false,
          logo: payload.logo || null, cover: payload.cover || null, ts: now()
        };
        claimSlug(slug);
        var a = getAccount() || { user: { name: '', phone: '' }, token: null, shop: null, ts: now() };
        a.shop = shop; saveAccount(a);
        return Promise.resolve(shop);
      }
      return http('POST', '/shops', payload);
    },
    my: function () {
      if (isOffline()) { var a = getAccount(); return Promise.resolve(a ? a.shop : null); }
      return http('GET', '/shops/my');
    },
    get: function (id) { return isOffline() ? Promise.resolve((getAccount() || {}).shop) : http('GET', '/shops/' + id); },
    update: function (_id, patch) {
      if (isOffline()) {
        var a = getAccount(); if (!a || !a.shop) return Promise.reject({ message: 'no-shop' });
        if (patch.slug !== undefined) {
          var ns = slugify(patch.slug);
          if (ns !== a.shop.slug && claimedSlugs().indexOf(ns) !== -1) {
            return Promise.reject({ message: 'slug-taken', suggestions: slugCandidates(ns).slice(1, 4) });
          }
          if (ns !== a.shop.slug) {
            jset(SLUGS_KEY, claimedSlugs().filter(function (x) { return x !== a.shop.slug; }).concat([ns]));
          }
          patch.slug = ns;
        }
        offlineShopPatch(a.shop, patch); saveAccount(a);
        return Promise.resolve(a.shop);
      }
      return http('PATCH', '/shops/' + _id, patch);
    },
    submitForApproval: function (_id) {
      if (isOffline()) {
        var a = getAccount(); if (!a || !a.shop) return Promise.reject({ message: 'no-shop' });
        a.shop.status = 'PENDING_APPROVAL'; a.shop.submittedAt = now(); saveAccount(a);
        return Promise.resolve(a.shop);
      }
      return http('POST', '/shops/' + _id + '/submit-for-approval', {});
    },
    publicBySlug: function (slug) {
      if (isOffline()) {
        var a = getAccount();
        if (a && a.shop && a.shop.slug === slug && (a.shop.status === 'APPROVED' || a.shop.status === 'PUBLISHED')) return Promise.resolve(a.shop);
        return Promise.reject({ message: 'not-found' });
      }
      return http('GET', '/shops/' + encodeURIComponent(slug) + '/public', undefined, { noAuth: true });
    },
    /** GET /shops/:id/share-info — मर्चेंट share स्क्रीन का स्रोत (PART 6). */
    shareInfo: function (_id) {
      return http('GET', '/shops/' + encodeURIComponent(_id) + '/share-info');
    },
    uploadMedia: function (_id, kind, file) {
      if (isOffline()) return compressImage(file).then(function (rec) {
        var a = getAccount(); if (!a || !a.shop) return Promise.reject({ message: 'no-shop' });
        if (kind === 'logo') a.shop.logo = rec; else if (kind === 'cover') a.shop.cover = rec;
        saveAccount(a); return rec;
      });
      var fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', file, file.name || (kind + '.jpg'));
      return http('POST', '/shops/' + _id + '/media', fd, { timeout: 30000 });
    }
  };

  /* ---------------- image helper (photos → dataURL, iframesafe) ----------- */
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || '')) { reject({ message: 'not-image' }); return; }
      if (!window.FileReader || !document.createElement('canvas').getContext) { reject({ message: 'no-support' }); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 720, w = img.width, h = img.height, sc = Math.min(1, max / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          var url = cv.toDataURL('image/jpeg', 0.82);
          resolve({ dataUrl: url, w: cv.width, h: cv.height, size: Math.round(url.length * 0.75), ts: now() });
        };
        img.onerror = function () { reject({ message: 'bad-image' }); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject({ message: 'read-failed' }); };
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- status names & next steps (Hindi-first) --------------- */
  var STATUS = {
    DRAFT: 'ड्राफ़्ट',
    PENDING_APPROVAL: 'अप्रूवल के लिए भेजा',
    APPROVED: 'अप्रूव्ड — लाइव हो सकता है',
    PUBLISHED: 'पब्लिश्ड — ग्राहकों को दिख रहा',
    REJECTED: 'रिजेक्टेड',
    SUSPENDED: 'सस्पेंडेड'
  };
  function statusKey(k) { return STATUS[k] || k; }
  function statusNext(k) {
    var m = {
      DRAFT: [t('प्रोफ़ाइल पूरी करें','Complete the profile'), t('अप्रूवल के लिए भेजें','Submit for approval')],
      PENDING_APPROVAL: [t('एडमिन जांच कर रहा है — आम तौर पर 24 घंटे में।','Admin reviewing — usually within 24 h.')],
      APPROVED: [t('वेब स्टोर "#/share" से पब्लिश करें और ग्राहकों को लिंक बांटें।','Publish from #/share and circulate your link.')],
      PUBLISHED: [t('दुकान लाइव है — लिंक शेयर करते रहें।','Shop is live — keep sharing the link.')],
      REJECTED: [t('दुकान प्रोफ़ाइल सुधारें और फिर अप्रूवल भेजें।','Fix the profile details and submit again.')],
      SUSPENDED: [t('सपोर्ट से संपर्क करें।','Contact support.')]
    };
    return m[k] || [];
  }

  /* ---------------- product catalogue (PART 3) ----------------------------- */
  /* Thin wrappers over the PART 3 catalogue endpoints (shop scoped on the
     server — the client never sends a shop id; it comes from the JWT member).

       GET    /products?q=&categoryId=&category=&stock=&includeInactive=
       GET    /products/:id
       POST   /products
       PATCH  /products/:id
       DELETE /products/:id                 (soft delete — row kept for orders)
       PATCH  /products/:id/stock           { delta } | { stock } | { lowAt }
       POST   /products/bulk-price          { percent, categoryId?, preview? }
       GET    /product-categories
       POST   /product-categories
       PATCH  /product-categories/:id
       DELETE /product-categories/:id       (409 while products still use it)

       GET    /inventory/summary
       GET    /inventory/movements?productId=&limit=
       POST   /bulk-operations/stock        { items:[{id, delta?|stock?}], note? }
       POST   /bulk-operations/category     { ids:[...], categoryId? | category? }
       POST   /bulk-operations/active       { ids:[...], active: false|true }

     These helpers are SERVER-mode only. In the DEV offline mode the app keeps
     the Part-1 local catalogue (pos_db) and index.html routes around them
     (see the `catalogue` adapter there).                                    */

  /** Build a query string, skipping empty values. */
  function qstr(params) {
    if (!params) return '';
    var out = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return out.length ? '?' + out.join('&') : '';
  }

  var products = {
    /** GET /products → { items: [...], count } */
    list: function (params) {
      return http('GET', '/products' + qstr(params));
    },
    /** GET /products/:id → product row */
    get: function (id) {
      return http('GET', '/products/' + encodeURIComponent(id));
    },
    /** POST /products — { name, unit, price, mrp?, stock?, lowAt?, brand?,
     *                     fresh?, life?, categoryId?, category? } */
    create: function (body) {
      return http('POST', '/products', body);
    },
    /** PATCH /products/:id — partial body (same fields as create) */
    update: function (id, body) {
      return http('PATCH', '/products/' + encodeURIComponent(id), body);
    },
    /** DELETE /products/:id — soft delete */
    remove: function (id) {
      return http('DELETE', '/products/' + encodeURIComponent(id));
    },
    /** PATCH /products/:id/stock — { delta } | { stock } | { lowAt } */
    adjustStock: function (id, body) {
      return http('PATCH', '/products/' + encodeURIComponent(id) + '/stock', body);
    },
    /** POST /products/bulk-price — { percent, categoryId?, category?,
     *                                  preview?, minPrice? } */
    bulkPrice: function (body) {
      return http('POST', '/products/bulk-price', body);
    }
  };

  var productCats = {
    /** GET /product-categories → { items: [...], count } */
    list: function () {
      return http('GET', '/product-categories');
    },
    /** POST /product-categories — { name, emoji? } */
    create: function (body) {
      return http('POST', '/product-categories', body);
    },
    /** PATCH /product-categories/:id — { name?, emoji? } */
    update: function (id, body) {
      return http('PATCH', '/product-categories/' + encodeURIComponent(id), body);
    },
    /** DELETE /product-categories/:id — 409 while products still use it */
    remove: function (id) {
      return http('DELETE', '/product-categories/' + encodeURIComponent(id));
    }
  };

  /* ---------------- inventory (PART 3, server mode) -------------------------- */

  var inventory = {
    /** GET /inventory/summary — { products, low, out, alert, units, value } */
    summary: function () {
      return http('GET', '/inventory/summary');
    },
    /** GET /inventory/movements?productId=&limit= → { items:[{ id, product,
     *    kind, delta, before, after, note, actorName, createdAt }] } */
    movements: function (params) {
      return http('GET', '/inventory/movements' + qstr(params || {}));
    }
  };

  /* ---------------- bulk operations (PART 3, server mode) ------------------- */

  var bulkOps = {
    /** POST /bulk-operations/stock — { items: [{ id, delta?|stock? }], note? }
     *  → { ok, updated, unchanged, missing, changes:[{ id, name, delta,
     *      before, after }] } — one request, up to 200 products. */
    stock: function (body) {
      return http('POST', '/bulk-operations/stock', body);
    },
    /** POST /bulk-operations/category — { ids: [...], categoryId? | category? }
     *  → { ok, categoryId, category, updated, items } */
    assignCategory: function (body) {
      return http('POST', '/bulk-operations/category', body);
    },
    /** POST /bulk-operations/active — { ids: [...], active: false|true }
     *  → { ok, active, updated, items } (false = soft delete, true = restore) */
    setActive: function (body) {
      return http('POST', '/bulk-operations/active', body);
    }
  };

  /* ---------------- orders + notifications (PART 5, server mode) ---------- */  /* Merchant order management wrappers. shopId comes from the login session
     (DB.session.shopId वही है) — client कोई दूसरी दुकान का shopId समझदारी से
     डाले भी तो backend सदस्यता जाँच कर 403 ही देता है.

     POST /shops/:shopId/orders/:id/status — body सिर्फ़ { action, reason? };
     status client नहीं भेजता — server transition map से ही निकलता है. */
  var orders = {
    /** GET /shops/:shopId/orders?status=&date=&q=&page=&limit= */
    list: function (shopId, params) {
      return http('GET', '/shops/' + encodeURIComponent(shopId || '') + '/orders' + qstr(params || {}));
    },
    /** GET /shops/:shopId/orders/:id → { order, items, history } */
    get: function (shopId, id) {
      return http('GET', '/shops/' + encodeURIComponent(shopId || '') + '/orders/' + encodeURIComponent(id));
    },
    /** POST …:id/accept — { reason? } वैकल्पिक. */
    accept: function (shopId, id, reason) {
      return http('POST', '/shops/' + encodeURIComponent(shopId || '') + '/orders/' + encodeURIComponent(id) + '/accept', { reason: reason || undefined });
    },
    /** POST …:id/reject — reason डालना ठीक. */
    reject: function (shopId, id, reason) {
      return http('POST', '/shops/' + encodeURIComponent(shopId || '') + '/orders/' + encodeURIComponent(id) + '/reject', { reason: reason || undefined });
    },
    /** POST …:id/cancel — reason साथ; स्टॉक वापसी server उसी tx में करता है. */
    cancel: function (shopId, id, reason) {
      return http('POST', '/shops/' + encodeURIComponent(shopId || '') + '/orders/' + encodeURIComponent(id) + '/cancel', { reason: reason || undefined });
    },
    /** POST …:id/status — { action: ACCEPT|REJECT|START_PREPARING|MARK_READY|
     *  OUT_FOR_DELIVERY|COMPLETE|CANCEL|MARK_PAID, reason? } */
    setStatus: function (shopId, id, action, reason) {
      return http('POST', '/shops/' + encodeURIComponent(shopId || '') + '/orders/' + encodeURIComponent(id) + '/status', { action: action, reason: reason || undefined });
    },
    /** GET …:id/history → { items: [...] } */
    history: function (shopId, id) {
      return http('GET', '/shops/' + encodeURIComponent(shopId || '') + '/orders/' + encodeURIComponent(id) + '/history');
    }
  };

  var notifs = {
    /** GET /notifications?limit= → { items, unread } (अपने shops का इतिहास). */
    list: function (limit) {
      return http('GET', '/notifications' + qstr({ limit: limit || 50 }));
    },
    /** POST /notifications/:id/read */
    read: function (id) {
      return http('POST', '/notifications/' + encodeURIComponent(id) + '/read', {});
    },
    /** POST /notifications/device-tokens — FCM push पाने के लिए (token device)
     *  push configured (FCM_SERVER_KEY) नहीं हो तो भी safe: in-app इतिहास बनता
     *  रहेगा. WhatsApp/Email fetch नीचे। */
    registerDevice: function (token, platform) {
      return http('POST', '/notifications/device-tokens', { token: token, platform: platform || 'ANDROID' });
    }
  };

  /* ---------------- share + native bridge (PART 6) ------------------------ */
  /* दुकान लिंक का शेयर-सिस्टम:
     - SERVER mode → GET /shops/:shopId/share-info (सर्वर-configured domain से
       बना public URL + OG + अप्रूव्ड हिंदी संदेश — दुकानदार का सच्चा स्रोत).
     - OFFLINE (डेव मोड) → device-config publicBase से URL + एक ही हिंदी टेम्पलेट
       (online सर्वर वाले template से परिपाटी रखता है).
     - Android bridge (MainActivity.POSAndroid) उपलब्ध हो तो native share sheet,
       WhatsApp deep-link (इंस्टॉल हो तो), clipboard, browser, QR सेव/प्रिंट;
       न हो तो wa.me link / navigator.share / clipboard Web-API fallback.
     कोई जगह "भेजा गया" जैसा झूठा दावा नहीं — सिर्फ़ असली हुए अमल की पुष्टि. */

  // सर्वर share.ts के DEFAULT_SHARE_TEMPLATE से एक जैसा (offline/dev parity).
  var SHARE_TEMPLATE =
    'नमस्ते! हमारी दुकान {shop_name} अब ऑनलाइन उपलब्ध है। ' +
    'सामान देखने और ऑर्डर करने के लिए यह लिंक खोलें: {shop_url}';

  function shareTextFor(shopName, url) {
    var name = String(shopName == null ? '' : shopName)
      .replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() || 'दुकान';
    if (name.length > 80) name = name.slice(0, 79).trimEnd() + '…';
    var u = String(url || '').trim();
    var t = SHARE_TEMPLATE;
    if (t.indexOf('{shop_url}') === -1) t = t.trimEnd() + ' {shop_url}';
    if (t.indexOf('{shop_name}') === -1) t = '{shop_name} — ' + t;
    return t.replace(/\{shop_name\}/g, name).replace(/\{shop_url\}/g, u)
      .replace(/[ \t]{2,}/g, ' ').trim();
  }

  function nativeBridge() {
    return window.POSAndroid || null;
  }

  var native = {
    has: function () { return !!nativeBridge(); },
    /** Native share sheet → true जब खुला; बिना bridge न navigator.share हो तो false. */
    share: function (subject, text, title) {
      var b = nativeBridge();
      if (b && typeof b.share === 'function') {
        return Promise.resolve(b.share(String(subject || ''), String(text || '')) === 'ok');
      }
      if (navigator.share) {
        var payload = { text: String(text || '') };
        if (title) payload.title = title;
        return navigator.share(payload).then(function () { return true; }).catch(function (e) {
          if (e && e.name === 'AbortError') return null;   // user cancel — कोई toast नहीं
          return false;
        });
      }
      return Promise.resolve(false);
    },
    /**
     * WhatsApp deep-link (bridge) — इंस्टॉल नहीं तो native share-sheet fallback.
     * resolve: { opened:true, via:'whatsapp' } | { opened:true, via:'share-sheet' }
     *        | { opened:false, via:'wa.me-link' | 'none' }  (कोई 'sent' दावा नहीं)
     */
    whatsapp: function (text) {
      var b = nativeBridge();
      if (b && typeof b.whatsapp === 'function') {
        var pkg = b.whatsapp(String(text || ''));
        if (pkg) return Promise.resolve({ opened: true, via: 'whatsapp' });
        return b.share('दुकान का लिंक', String(text || '')) === 'ok'
          ? Promise.resolve({ opened: true, via: 'share-sheet' })
          : Promise.resolve({ opened: false, via: 'none' });
      }
      // बिना bridge (डेव ब्राउज़र): सीधा wa.me <a> रास्ता — caller href खोलता है
      return Promise.resolve({ opened: false, via: 'wa.me-link' });
    },
    /** Clipboard लिखो — bridge न Web API. पुष्टि caller असली सफलता पर ही देता है. */
    copy: function (text) {
      var b = nativeBridge();
      if (b && typeof b.copy === 'function') {
        try { b.copy(String(text || '')); return Promise.resolve(true); } catch (e) { /* fallback */ }
      }
      function legacy() {
        try {
          var ta = document.createElement('textarea');
          ta.value = String(text || '');
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        } catch (e) { return false; }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(String(text || '')).then(function () { return true; },
          function () { return legacy(); });
      }
      return Promise.resolve(legacy());
    },
    /** दुकान का URL बाहर खोलो — bridge, वरना window.open (डेव ब्राउज़र). */
    openUrl: function (url) {
      var b = nativeBridge();
      if (b && typeof b.openUrl === 'function') {
        try { return !!b.openUrl(String(url || '')); } catch (e) { return false; }
      }
      try { window.open(String(url || ''), '_blank'); return true; } catch (e) { return false; }
    },
    /** QR PNG सेव → असली फ़ाइल-पथ या null (bridge न हो/fail). */
    saveImage: function (base64, fileName) {
      var b = nativeBridge();
      if (b && typeof b.saveImage === 'function') {
        try {
          var p = b.saveImage(String(base64 || ''), String(fileName || ''));
          return p ? p : null;
        } catch (e) { return null; }
      }
      return null;
    },
    /** Android प्रिंट (QR print screen से). bridge न हो तो झूठा वादा नहीं → false. */
    print: function () {
      var b = nativeBridge();
      if (b && typeof b.print === 'function') {
        try { b.print(); return true; } catch (e) { return false; }
      }
      return false;
    }
  };

  /* ---------------- public surface ---------------------------------------- */
  window.POS = {
    CONFIG: CONFIG,           // read-only use; Settings बदलती है get/setters से
    version: '2.3-part6',
    mode: mode, isOffline: isOffline,
    setApiBase: function (u) { CONFIG.apiBase = (u || '').replace(/\/+$/, ''); lsSet('pos_api_base', CONFIG.apiBase); },
    setPublicBase: function (u) { CONFIG.publicBase = u; lsSet('pos_public_base', u); },
    lastHttpErr: function () { return LAST_HTTP_ERR; },
    errText: errText,
    auth: auth,
    cats: cats,
    shops: shops,
    products: products,
    productCats: productCats,
    inventory: inventory,
    bulkOps: bulkOps,
    orders: orders,           // PART 5 — merchant order management (server)
    notifs: notifs,           // PART 5 — in-app notification history (server)
    shareTextFor: shareTextFor,   // PART 6 — हिंदी संदेश (offline parity)
    native: native,               // PART 6 — Android bridge / Web API शेयर-लेयर
    slugify: slugify, slugCandidates: slugCandidates,
    waNormalize: waNormalize, phoneValid: phoneValid, publicUrl: publicUrl,
    compressImage: compressImage,
    statusKey: statusKey, statusNext: statusNext,
    account: { get: getAccount, save: saveAccount },
    statusLabel: { DRAFT: STATUS.DRAFT, PENDING_APPROVAL: STATUS.PENDING_APPROVAL, APPROVED: STATUS.APPROVED, PUBLISHED: STATUS.PUBLISHED, REJECTED: STATUS.REJECTED, SUSPENDED: STATUS.SUSPENDED }
  };
})();
