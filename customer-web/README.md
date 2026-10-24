# SOS Local Dukaan — कस्टमर स्टोर (PART 4)

Next.js (App Router) responsive web app — दुकानदार के WhatsApp लिंक (`…/s/<slug>`) से
खुलती है. हिंदी-पहले, green/white Part-1 design system, mobile-first + PWA.

## चलाना (dev)

```bash
cd POS/customer-web
cp .env.example .env.local        # NEXT_PUBLIC_API_BASE=https://<backend-url>
npm install
npm run dev                       # http://localhost:3000
```

Backend NestJS भी चाहिए: `POS/backend` में `npm run start:dev` (विवरण `docs/PART4_SETUP.md`)।

Test दुकान: अपने Part-2 मर्चेंट ऐप से दुकान approve/publish कराकर slug लें →
`http://localhost:3000/s/<slug>`

Production build (hosting):

```bash
npm run build && npm run start
# या अपने platform (Vercel/Cloudflare/VPS) पर NEXT_PUBLIC_API_BASE env के साथ deploy
```

## पेज

| पथ | ज़िम्मा |
|---|---|
| `/s/<slug>` | दुकान होम (status, कैटेगरी, सामान) |
| `/s/<slug>/search` | खोज + कैटेगरी फ़िल्टर + सॉर्ट + pagination |
| `/s/<slug>/p/<id>` | प्रोडक्ट detail + variants |
| `/s/<slug>/cart` | कार्ट (server-सत्यापित कीमत/स्टॉक) |
| `/s/<slug>/checkout` | चेकआउट (गेस्ट, COD/PON/UPI-QR जो दुकान में चालू हो) |
| `/order/<token>` | ऑर्डर स्थिति (random access-token) |

## नियम जो UI भी पालता है

- **एक कार्ट = एक दुकान** — दूसरी दुकान पर "कार्ट खाली करें?" पूछे जाने पर ही switch.
- कीमत/स्टॉक/कूपन/डिलीवरी फीस **सिर्फ़ server** का हिसाब; browser केवल दिखाता है.
- ऑर्डर double-tap/network retry दोनों से सुरक्षित — **Idempotency-Key**.
- ऑर्डर स्थिति के लिए order-number नहीं, **random token**; ग्राहक का पता/नंबर उसी token पर भी नहीं दिखता.

## PWA

`app/manifest.ts` + `public/icon.svg` (installable). Service-worker (offline cache)
Part 5 के लिए बाकी — अभी झूठा वादा नहीं.
