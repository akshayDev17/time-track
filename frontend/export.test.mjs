// The static export (`npm run build`): every page worker.js serves exists, everything it
// loads sits under /time-track (never a site-wide /_next/ or /api/), the favicon is inline
// (a file under /time-track would sit behind Access for signed-out visitors), and it carries
// no theme of its own (site-shell adds the theme at the edge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
const PAGES = ['index.html', 'new.html', 'signin.html', 'tracker.html', 'tracker/charts.html'];

test('every page exists', () => {
  for (const p of PAGES) assert.ok(existsSync(join(out, p)), `${p} missing: run npm run build`);
});

test('pages load only from /time-track and inline', () => {
  for (const p of PAGES) {
    const html = readFileSync(join(out, p), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(data:|https?:\/\/|#)/.test(ref)) continue;
      const siteRow = ['/', '/chat-archives', '/quiz', '/graph/', '/elections/'].includes(ref);
      assert.ok(siteRow || ref.startsWith('/time-track'), `${p}: ${ref} is outside /time-track`);
    }
    assert.ok(!/favicon\.ico/.test(html), `${p}: no favicon file`);
    assert.match(html, /rel="icon" href="data:image\/svg\+xml/, `${p}: inline icon`);
    assert.match(html, /<site-slot name="site-path"/, `${p}: the site row slot`);
    assert.ok(!/data-site-shell/.test(html), `${p}: site-shell parts come from the edge, not the build`);
  }
});
