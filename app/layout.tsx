import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CardClash',
  description:
    'Real-time multiplayer UNO-style shedding card game built with an authoritative deterministic TypeScript engine.',
  manifest: '/manifest.webmanifest',
  applicationName: 'CardClash',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CardClash',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
  },
  openGraph: {
    title: 'CardClash',
    description:
      'Real-time multiplayer UNO-style shedding card game built with an authoritative deterministic TypeScript engine.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CardClash',
    description:
      'Real-time multiplayer UNO-style shedding card game built with an authoritative deterministic TypeScript engine.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#0B2B26] text-stone-100" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
