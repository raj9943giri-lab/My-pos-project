/** SOS Local Dukaan storefront — Next.js config (App Router). कोई प्री-प्रोसेसर नहीं: plain CSS. */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Android/arm64 (Termux) पर Next का native SWC बाइनरी उपलब्ध नहीं है;
  // WASM फ़ॉलबैक इस्तेमाल करें ताकि production build यहाँ भी चल सके.
  experimental: { useWasmBinary: true, webpackBuildWorker: false },
  // Termux/Android पर trace worker अलग process में native SWC माँगता है और crash
  // कर देता है; `next start` के लिए tracing ज़रूरी नहीं, इसलिए बंद.
  outputFileTracing: false,
  // Product images backend/media (सामान अक्सर S3/hosted) पर हैं — domain-less remote तक खुला.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: 'localhost' }] },
};

export default nextConfig;
