import type { Metadata } from 'next';
import { Syne, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'CardClash',
  description:
    'Real-time multiplayer UNO-style shedding card game built with an authoritative deterministic TypeScript engine.',
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
    <html
      lang="en"
      className={`${syne.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
