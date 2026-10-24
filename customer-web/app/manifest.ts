import type { MetadataRoute } from 'next';

/** PWA manifest — installable on Android Chrome; हिंदी पहले. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SOS Local Dukaan — अपनी दुकान',
    short_name: 'Dukaan',
    description: 'अपने मोहल्ले की दुकान से ताज़ा सामान — होम डिलीवरी या दुकान से उठाना।',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f7f6',
    theme_color: '#0e9f6e',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
