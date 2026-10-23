/* ============================================================================
   POS — Part 7 admin API layer (window.POSADMIN)
   ----------------------------------------------------------------------------
   − admin.html से पहले load होती है; window.POSADMIN expose करती है।
   − दो मोड:
       SERVER : Settings में API base URL सेट हो (fetch → NestJS backend,
                POST /admin/auth/login का JWT बियरर हेडर; 12 घंटे वाला सेशन)
       OFFLINE: बिना backend वाला डेमो मोड — admin.html अपना seed डेटा दिखाता
                है; हर स्क्री पर साफ़ "डेमो" लेबल रहता है (डेवलपमेंट-ओनली)।
   − टोकन 'pos_admin_jwt' में (WebView localStorage); कोई OTP नहीं — एडमिन
     scrypt-वेरिफ़ाइड पासवर्ड से लॉगिन. Roles हर request पर DB से ताज़ा (रेवोके-
     safe), तो इस पर सिर्फ़ प्रदर्शन निर्भर है, अनुमति नहीं.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- safe storage (pos-api.js जैसी ही fallbacks) ---------- */
  var MEM = {};
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return MEM[k] || null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { MEM[k] = String(v); } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { delete MEM[k]; } }

  /* ---------------- configuration ---------------------------------------- */
  // एडमिन का अपना base सेटिंग; न हो तो मर्चेंट ऐप का pos_api_base ले लिया जाता
  // है (एक ही WebView, एक ही backend पर तो यही सही default है).
  var CONFIG = {
    apiBase: (lsGet('pos_admin_api_base') || lsGet('pos_api_base') || apiBaseFromAndroid() || '').replace(/\/+$/, '')
  };
  function apiBaseFromAndroid() {
    try {
      return (window.POSAndroid && window.POSAndroid.apiBase && window.POSAndroid.apiBase()) || '';
    } catch (e) { return ''; }
  }
  var TOKEN_KEY = 'pos_admin_jwt';
  var ME_KEY = 'pos_admin_me';   // आख़िरी /admin/me का सार (role/tabs के लिए)

  function mode() { return CONFIG.apiBase ? 'server' : 'offline'; }
  function isOffline() { return mode() === 'offline'; }
  function setApiBase(u) {
    CONFIG.apiBase = String(u || '').replace(/\/+$/, '');
    lsSet('pos_admin_api_base', CONFIG.apiBase);
  }
  function getApiBase() { return CONFIG.apiBase; }

  /* ---------------- token / सत्र ------------------------------------------ */
  function token() { return lsGet(TOKEN_KEY) || null; }
  function saveToken(t) { lsSet(TOKEN_KEY, String(t || '')); }
  function saveMe(m) { try { lsSet(ME_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ } }
  function me() { return lsGet(ME_KEY) ? safeParse(lsGet(ME_KEY)) : null; }
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function logout() { lsDel(TOKEN_KEY); lsDel(ME_KEY); }

  /* ---------------- HTTP layer (pos-api.js पैटर्न, एडमिन JWT से) ---------- */
  var LAST_HTTP_ERR = null;
  function http(method, path, body, opts) {
    opts = opts || {};
    if (!window.fetch || !CONFIG.apiBase) {
      return Promise.reject({ http: false, status: 0, message: 'OFFLINE_MODE' });
    }
    var url = CONFIG.apiBase + path;
    var headers = { 'Accept': 'application/json' };
    var t = opts.noAuth ? null : token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var init = { method: method, headers: headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    var ctrl = window.AbortController ? new AbortController() : null;
    if (ctrl) { init.signal = ctrl.signal; setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000); }
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
  /** हिंदी-first त्रुटि संदेश (admin.html दिखाता है). */
  function errText(err) {
    if (err && err.http) {
      var m = err.data && (err.data.message || (err.data && err.data.error && err.data.error.message));
      if (err.status === 401) return 'सेशन समाप्त या विवरण ग़लत — दोबारा लॉगिन करें।';
      if (err.status === 403) return 'आपकी भूमिका को यह काम अनुमति नहीं है।';
      if (err.status === 404) return m || 'चीज़ नहीं मिली।';
      if (err.status === 409) return m || 'यह कदम अब यहाँ नहीं बनता (हाल पहले ही बदल चुका है)।';
      if (err.status === 429) return 'ज़्यादा कोशिश — थोड़ी देर में फिर आइए।';
      return (m || 'सर्वर त्रुटि (' + err.status + ')');
    }
    if (err && err.message === 'OFFLINE_MODE') return 'बैकएंड सेट नहीं — ऑफ़लाइन डेमो मोड में यह नहीं चलेगा।';
    if (err && err.name === 'AbortError') return 'समय पूरा — नेटवर्क धीमा है।';
    return 'नेटवर्क नहीं मिला।';
  }

  /* ---------------- query builder ----------------------------------------- */
  function qs(o) {
    var s = [];
    Object.keys(o || {}).forEach(function (k) {
      if (o[k] === undefined || o[k] === null || o[k] === '') return;
      s.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(o[k])));
    });
    return s.length ? '?' + s.join('&') : '';
  }

  /* ============================================================================
     ADMIN API — NestJS routes का प्रतिबिंब (backup: src/admin/admin.controller.ts,
     src/complaints/complaints.controller.ts). हर सफल auth कॉल के बाद me cache.
     ========================================================================== */
  var API = {

    /* -------------------------------- auth --------------------------------- */
    auth: {
      /** POST /admin/auth/login → {token, admin}. भंडार: token + admin सार. */
      login: function (email, password) {
        return http('POST', '/admin/auth/login', { email: String(email || '').trim(), password: password }, { noAuth: true })
          .then(function (res) {
            saveToken(res.token);
            saveMe(res.admin);
            return res;
          });
      },
      /** GET /admin/me — ताज़ा भूमिका (DB-पढ़ी; revocation-safe display). */
      me: function () {
        return http('GET', '/admin/me').then(function (res) {
          saveMe(res.admin);
          return res;
        });
      },
      cachedMe: me,
      logout: logout,
      token: token
    },

    /* ------------------------------ dashboard ------------------------------ */
    dashboard: function () { return http('GET', '/admin/dashboard'); },

    /* -------------------------------- orders ------------------------------- */
    orders: {
      /** GET /admin/orders?status=&q=&shopId=&page=&limit= */
      list: function (o) { return http('GET', '/admin/orders' + qs(o)); }
    },

    /* ----------------------------- commissions ----------------------------- */
    commissions: {
      /** GET /admin/commissions → { defaultPct, shops[], totalGmv, totalCommission }. */
      summary: function () { return http('GET', '/admin/commissions'); },
      /** PUT /admin/commissions — { defaultPct: 0…30 }; policy में सेव + audit. */
      saveDefault: function (pct) { return http('PUT', '/admin/commissions', { defaultPct: Number(pct) }); }
    },

    /* -------------------------------- shops -------------------------------- */
    shops: {
      /** GET /admin/shops?status=&q=&page=&limit=&queue=1 */
      list: function (o) { return http('GET', '/admin/shops' + qs(o)); },
      /** GET /admin/shops/queue — अप्रूवल कतार (PENDING+DRAFT). */
      queue: function () { return http('GET', '/admin/shops/queue'); },
      get: function (id) { return http('GET', '/admin/shops/' + encodeURIComponent(id)); },
      /** PATCH /admin/shops/:id/status — action: APPROVE|REJECT|SUSPEND|UNSUSPEND.
       *  REJECT/SUSPEND पर reason ज़रूरी होती है (server भी माँगता है). */
      setStatus: function (id, action, reason) {
        var body = { action: action };
        if (reason) body.reason = String(reason).slice(0, 300);
        return http('PATCH', '/admin/shops/' + encodeURIComponent(id) + '/status', body);
      },
      /** PATCH /admin/shops/:id/publish — APPROVED दुकान public on/off.
       *  auto_publish_on_approve=false पर approve के बाद यही switch चलता है. */
      setPublished: function (id, published) {
        return http('PATCH', '/admin/shops/' + encodeURIComponent(id) + '/publish', { published: !!published });
      }
    },

    /* ------------------------------ complaints ----------------------------- */
    complaints: {
      /** GET /admin/complaints?status=&priority=&assigned=&q=&page=&limit= */
      list: function (o) { return http('GET', '/admin/complaints' + qs(o)); },
      /** GET /admin/complaints/:id — {complaint, history, notes, allowedActions}. */
      detail: function (id) { return http('GET', '/admin/complaints/' + encodeURIComponent(id)); },
      /** POST …/:id/status — action: START|RESOLVE|CLOSE|REOPEN.
       *  RESOLVE पर note (हल-नोट) ज़रूरी; START पर ख़ुद को ज़िम्मेदारी लगती है
       *  (assignTo केवल SUPER/ADMIN किसी और को सौंपने के लिए भेज सकते हैं). */
      act: function (id, action, note, assignTo) {
        var body = { action: action };
        if (note) body.note = String(note).slice(0, 2000);
        if (assignTo) body.assignTo = String(assignTo);
        return http('POST', '/admin/complaints/' + encodeURIComponent(id) + '/status', body);
      },
      /** POST …/:id/note — टिप्पणी धागा (internal default true). */
      note: function (id, bodyText, isInternal) {
        return http('POST', '/admin/complaints/' + encodeURIComponent(id) + '/note',
          { body: String(bodyText || '').slice(0, 2000), isInternal: isInternal !== false });
      }
    },

    /* ------------------------------ policies ------------------------------- */
    policies: {
      list: function () { return http('GET', '/admin/policies'); },
      /** PATCH /admin/policies/:key — body { "value": … }; सिर्फ़ SUPER/ADMIN. */
      patch: function (key, value) {
        return http('PATCH', '/admin/policies/' + encodeURIComponent(key), { value: value });
      }
    },

    /* ------------------------------- admins -------------------------------- */
    admins: {
      list: function () { return http('GET', '/admin/admins'); },
      /** POST /admin/admins — {email,name,role,password}; सिर्फ़ SUPER_ADMIN. */
      create: function (dto) { return http('POST', '/admin/admins', dto); },
      /** PATCH /admin/admins/:id — {role?, isActive?, password?}. */
      patch: function (id, dto) { return http('PATCH', '/admin/admins/' + encodeURIComponent(id), dto); }
    },

    /* -------------------------------- audit -------------------------------- */
    audit: {
      /** GET /admin/audit?limit=&action= — सिर्फ़ SUPER/ADMIN. */
      list: function (limit, action) { return http('GET', '/admin/audit' + qs({ limit: limit, action: action })); }
    }
  };

  /* ---------------- public surface ------------------------------------------ */
  window.POSADMIN = {
    CONFIG: CONFIG,
    version: '1.0-part7',
    mode: mode,
    isOffline: isOffline,
    setApiBase: setApiBase,
    getApiBase: getApiBase,
    http: http,
    errText: errText,
    api: API,
    // शॉर्टकट (admin.html में साफ़ पढ़ने के लिए)
    login: API.auth.login,
    me: API.auth.me,
    cachedMe: API.auth.cachedMe,
    logout: API.auth.logout,
    dashboard: API.dashboard
  };
})();
