import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Display serif: Fraunces (variable). Used for the wordmark, section headers,
// and editorial flourish. Carries gravitas without being cold.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
});

// Body sans: IBM Plex Sans. Precise, technical, warm enough — explicitly
// not Inter/Roboto/Arial.
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

// Mono: JetBrains Mono for clinical data, timestamps, JSON.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Wardly · Pre-visit clinical intake',
  description:
    'AI-driven clinical pre-visit intake. Captures CC, HPI (OLDCARTS), and targeted ROS into a structured brief for the clinician.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plex.variable} ${mono.variable} h-full`}
    >
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
