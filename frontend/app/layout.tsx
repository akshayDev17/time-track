import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Newsreader } from 'next/font/google';
// The shared theme (boot script, tokens, picker) is not bundled: site-shell adds it to every
// page's <head> at the edge (worker.js). globals.css carries the Classic Light fallback.
import './globals.css';

const newsreader = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], axes: ['opsz'], variable: '--font-newsreader' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

// An inline icon: a /time-track/favicon.ico would sit behind Access for signed-out visitors.
const ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="18" r="11" fill="none" stroke="#1F6B45" stroke-width="3"/><path d="M16 18V11M12 3h8" stroke="#1F6B45" stroke-width="3" stroke-linecap="round"/></svg>')}`;

export const metadata: Metadata = {
  title: 'Time Track',
  description: 'Multi-timer day tracker: start today, time each task, save the day, chart it.',
  icons: { icon: ICON },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: site-shell's boot script sets data-theme on <html> before
    // React hydrates, so the exported markup never carries it.
    <html lang="en" className={`${newsreader.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
