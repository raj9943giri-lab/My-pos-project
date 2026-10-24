import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SOS Local Dukaan', template: '%s · SOS Local Dukaan' },
  description: 'अपने मोहल्ले की दुकान से ताज़ा सामान — होम डिलीवरी या दुकान से उठाना।',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e9f6e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hi">
      <body>{children}</body>
    </html>
  );
}
