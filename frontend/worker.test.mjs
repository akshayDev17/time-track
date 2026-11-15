// worker.js with a fake ASSETS and SHELL: the prefix strip, the tracker URL mapping, redirect
// re-prefixing, and site-shell failing open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { assetPath } from './worker.js';

const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', etag: '"x"' } });

function assets(routes) {
  const seen = [];
  return {
    seen,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      seen.push(path);
      const hit = routes[path];
      if (typeof hit === 'function') return hit();
      if (hit) return html(hit);
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    },
  };
}

const get = (path, env) => worker.fetch(new Request(`https://akshayprabhakant.com${path}`), env);

test('tracker URLs map to the exported tracker pages; app pages and files do not', () => {
  assert.equal(assetPath('/workday'), '/tracker');
  assert.equal(assetPath('/workday/'), '/tracker');
  assert.equal(assetPath('/guitar-practice/charts'), '/tracker/charts');
  for (const p of ['/', '/new', '/signin', '/tracker', '/_next/static/x.js', '/Workday', '/a.b', '/workday/charts/x']) {
    assert.equal(assetPath(p), p, p);
  }
});

test('the prefix is stripped before the lookup', async () => {
  const A = assets({ '/': 'home', '/new': 'new', '/tracker': 'tracker', '/tracker/charts': 'charts' });
  const env = { ASSETS: A };
  assert.equal(await (await get('/time-track', env)).text(), 'home');
  assert.equal(await (await get('/time-track/new', env)).text(), 'new');
  assert.equal(await (await get('/time-track/workday', env)).text(), 'tracker');
  assert.equal(await (await get('/time-track/workday/charts', env)).text(), 'charts');
  assert.deepEqual(A.seen, ['/', '/new', '/tracker', '/tracker/charts']);
});

test('a redirect from ASSETS stays inside /time-track', async () => {
  const env = { ASSETS: assets({ '/new/': () => new Response(null, { status: 307, headers: { location: '/new' } }) }) };
  const res = await get('/time-track/new/', env);
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/time-track/new');
  const elsewhere = { ASSETS: assets({ '/x.txt': () => new Response(null, { status: 302, headers: { location: 'https://example.com/y' } }) }) };
  assert.equal((await get('/time-track/x.txt', elsewhere)).headers.get('location'), 'https://example.com/y');
});

test('HTML goes through site-shell; anything else does not', async () => {
  const calls = [];
  const SHELL = {
    async compose(res, opts) {
      calls.push(opts);
      return html(`composed:${await res.text()}`);
    },
  };
  const env = { ASSETS: assets({ '/': 'home', '/_next/a.js': () => new Response('js', { headers: { 'content-type': 'text/javascript' } }) }), SHELL };
  assert.equal(await (await get('/time-track', env)).text(), 'composed:home');
  assert.deepEqual(calls, [{ app: 'time-track', assetBase: '/time-track/_site/' }]);
  assert.equal(await (await get('/time-track/_next/a.js', env)).text(), 'js');
  assert.equal(calls.length, 1);
});

test('site-shell failing serves the page as built', async () => {
  const SHELL = { async compose() { throw new Error('down'); } };
  const env = { ASSETS: assets({ '/': 'home' }), SHELL };
  const origError = console.error;
  console.error = () => {};
  try {
    const res = await get('/time-track', env);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'home');
    assert.equal(res.headers.get('etag'), null);
  } finally {
    console.error = origError;
  }
});

test('/_site/ files forward to site-shell', async () => {
  const SHELL = { async fetch(req) { return new Response(`shell:${new URL(req.url).pathname}`); } };
  const env = { ASSETS: assets({}), SHELL };
  assert.equal(await (await get('/time-track/_site/abc/site.js', env)).text(), 'shell:/_site/abc/site.js');
});
