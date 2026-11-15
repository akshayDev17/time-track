/**
 * The app's URLs, as on the board: /time-track (Trackers, or the public page),
 * /time-track/new, /time-track/<slug> and /time-track/<slug>/charts. The exported pages
 * behind the last two are tracker.html and tracker/charts.html; worker.js serves them there.
 */
export const BASE = '/time-track';
export const SLUG = /^[a-z0-9-]{1,48}$/;
/** First segments the app's own pages and files use (backend rules.RESERVED_SLUGS). */
export const RESERVED = new Set(['api', 'new', 'signin', 'tracker', 'charts', 'index', '404', '_next', '_site']);

export const homeHref = () => BASE;
export const newHref = () => `${BASE}/new`;
export const trackerHref = (slug: string) => `${BASE}/${slug}`;
export const chartsHref = (slug: string) => `${BASE}/${slug}/charts`;

/** The tracker slug a page URL names, or null. */
export function slugOf(pathname: string): string | null {
  const m = /^\/time-track\/([^/]+)(?:\/charts)?\/?$/.exec(pathname);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  return SLUG.test(slug) && !RESERVED.has(slug) ? slug : null;
}
