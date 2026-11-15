/**
 * Serves the static export of Time Track at /time-track and /time-track/*.
 *
 * The export is built with basePath /time-track, but the files in `out/` sit at the root of
 * the ASSETS binding, so the prefix is stripped before the lookup, and a same-origin redirect
 * ASSETS answers (`/new/` -> `/new`) is re-prefixed on the way out, or the browser would
 * follow it out of the app.
 *
 * Tracker URLs read as on the board: /time-track/<slug> is the exported tracker page
 * (tracker.html) and /time-track/<slug>/charts is tracker/charts.html; the page reads the slug
 * from the address bar. Slugs never take a page's own name (backend rules.RESERVED_SLUGS).
 *
 * Every HTML page then passes through site-shell (the `SHELL` service binding,
 * akshayDev17/site-themes shell/), which adds the shared theme to <head> and fills the
 * masthead's site row slot, failing open: with site-shell missing or throwing, the page is
 * served exactly as built. `/time-track/_site/*` and `/_site/*` forward to site-shell's own
 * files; in production the zone routes /_site/* to site-shell directly, so a bare `/_site/*`
 * reaches this Worker only under `wrangler dev`.
 */
const PREFIX = /^\/time-track(?=\/|$)/;
const PAGES = new Set(['new', 'signin', 'tracker', 'index', '404']);
const TRACKER = /^\/([a-z0-9-]{1,48})\/?$/;
const CHARTS = /^\/([a-z0-9-]{1,48})\/charts\/?$/;

/** The exported page a stripped path is served from (unchanged when it is not a tracker URL). */
export function assetPath(pathname) {
  const tracker = TRACKER.exec(pathname);
  if (tracker && !PAGES.has(tracker[1])) return '/tracker';
  const charts = CHARTS.exec(pathname);
  if (charts && !PAGES.has(charts[1])) return '/tracker/charts';
  return pathname;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    u.pathname = u.pathname.replace(PREFIX, '') || '/';
    if (u.pathname.startsWith('/_site/') && env.SHELL) return env.SHELL.fetch(new Request(u, req));
    u.pathname = assetPath(u.pathname);
    const page = async () => reprefixRedirect(await env.ASSETS.fetch(new Request(u, req)), u);
    return withShell(await page(), env, page, 'time-track', '/time-track/_site/');
  },
};

function reprefixRedirect(res, origin) {
  const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  if (!location) return res;
  const target = new URL(location, origin);
  if (target.origin !== origin.origin || PREFIX.test(target.pathname)) return res;
  const headers = new Headers(res.headers);
  headers.set('location', `/time-track${target.pathname === '/' ? '' : target.pathname}${target.search}${target.hash}`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * An HTML page through site-shell's compose(), failing open. The page's body went to
 * site-shell with the call, so the fallback fetches the page again (a static asset, free);
 * returning `res` there would answer 500 ("Body has already been used").
 */
async function withShell(res, env, refetch, app, assetBase) {
  const type = res.headers.get('content-type') || '';
  if (!env.SHELL || res.status !== 200 || !type.startsWith('text/html')) return res;
  try {
    return await env.SHELL.compose(res, { app, assetBase });
  } catch (err) {
    console.error('site-shell: compose failed, serving the page as built:', String(err));
    const fallback = await refetch();
    const headers = new Headers(fallback.headers);
    headers.delete('etag');
    headers.delete('last-modified');
    return new Response(fallback.body, { status: fallback.status, statusText: fallback.statusText, headers });
  }
}
