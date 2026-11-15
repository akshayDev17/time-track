'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { signOut, SIGN_IN_HREF } from '../../lib/api';
import { homeHref } from '../../lib/paths';

/** One of this app's own crumbs after "Time Track"; the last is the current page. */
export type Crumb = { label: string; href?: string };
/** Protected pages are signed in; the public page is `pending` until /me answers. */
export type Session = 'signed-in' | 'signed-out' | 'pending';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The site row as site-shell draws it (shell/nav.ts), with Time Track last and current. It
 * is the slot's fallback: site-shell leaves the slot as the app wrote it until Time Track is
 * in its app list (a follow-up in akshayDev17/site-themes), then fills it from that list.
 */
function fallbackRow(atRoot: boolean): string {
  const apps: [string, string, string?][] = [
    ['Home', '/'], ['AI Digest', '/chat-archives'], ['Quiz Room', '/quiz'],
    ['Graph Notes', '/graph/', ' (sign-in required)'], ['Election Atlas', '/elections/'],
  ];
  const items = apps.map(([label, href, vh]) => `<li><a href="${href}">${label}${vh ? `<span class="site-vh">${vh}</span>` : ''}</a></li>`).join('');
  const current = `<li><a class="sp-app" href="${homeHref()}" aria-current="${atRoot ? 'page' : 'true'}"><span class="sp-label">Time Track</span></a></li>`;
  return `<nav class="sp" aria-label="Site"><ul class="sp-apps">${items}${current}</ul></nav>`;
}

/** The trail on its own line under the row ("Trackers › Workday › Charts"), as site-shell draws it. */
function trailMarkup(tail: Crumb[]): string {
  if (tail.length < 2) return '';
  const items = tail.map((c, i) => {
    const label = esc(c.label);
    if (i === tail.length - 1) return `<li><span aria-current="page">${label}</span></li>`;
    return c.href ? `<li><a href="${esc(c.href)}">${label}</a></li>` : `<li><span>${label}</span></li>`;
  }).join('');
  return `<nav class="sp-trail" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

/**
 * The row site-shell composed into this page's slot (its <style> and nav, without a trail), or
 * null where it left the slot alone. Read once, before React touches the slot.
 */
let composedRow: string | null | undefined;
function readComposedRow(): string | null {
  const slot = document.querySelector('site-slot[name="site-path"]');
  const style = slot?.querySelector(':scope > style[data-site-shell]');
  const nav = slot?.querySelector(':scope > nav.sp');
  if (!style || !nav) return null;
  return style.outerHTML + nav.outerHTML;
}

function slotHtml(tail: Crumb[]): string {
  const row = typeof document === 'undefined' ? null : (composedRow ??= readComposedRow());
  const base = row ?? fallbackRow(tail.length === 0);
  if (!row) return base + trailMarkup(tail);
  // the composed row marks Time Track at its root as the page; below it, as "true"
  const box = document.createElement('template');
  box.innerHTML = base;
  box.content.querySelector('.sp-app[aria-current]')?.setAttribute('aria-current', tail.length === 0 ? 'page' : 'true');
  return box.innerHTML + trailMarkup(tail);
}

/** Keeps the current app in view on a narrow row and fades the edge that has more past it. */
function useRowEdges(slot: React.RefObject<HTMLElement | null>, html: string) {
  useLayoutEffect(() => {
    const row = slot.current?.querySelector<HTMLElement>('.sp-apps');
    if (!row) return;
    const current = row.querySelector<HTMLElement>('.sp-app[aria-current]');
    const reveal = () => {
      if (current) row.scrollLeft = Math.max(0, current.offsetLeft + current.offsetWidth - row.clientWidth);
    };
    const mark = () => {
      const more = [row.scrollLeft > 1 ? 'start' : '', row.scrollLeft + row.clientWidth < row.scrollWidth - 1 ? 'end' : ''].filter(Boolean).join(' ');
      if (more) row.dataset.more = more;
      else delete row.dataset.more;
    };
    // A phone's address bar resizes the window as it scrolls; only a new row width re-reveals.
    let width = row.clientWidth;
    const onResize = () => {
      if (row.clientWidth !== width) {
        width = row.clientWidth;
        reveal();
      }
      mark();
    };
    reveal();
    mark();
    row.addEventListener('scroll', mark, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      row.removeEventListener('scroll', mark);
      window.removeEventListener('resize', onResize);
    };
  }, [slot, html]);
}

/**
 * The page head: the app name (home: Trackers when signed in, the public page when not), the
 * site row and trail in `<site-slot name="site-path">`, who is signed in, Sign in or Sign
 * out, and the shared theme picker (`<site-theme-picker>`, defined by site-shell's site.js).
 */
export default function Masthead({ session, email, tail }: { session: Session; email?: string | null; tail: Crumb[] }) {
  const key = JSON.stringify(tail);
  // First render: what the HTML already holds (the build's fallback, or site-shell's row), so
  // hydration keeps it as is; the effect then redraws it with this page's own trail.
  const [html, setHtml] = useState(() => {
    if (typeof document === 'undefined') return fallbackRow(tail.length === 0) + trailMarkup(tail);
    composedRow ??= readComposedRow();
    return document.querySelector('site-slot[name="site-path"]')?.innerHTML ?? '';
  });
  const slot = useRef<HTMLElement>(null);
  // One object per markup, so React sets innerHTML only when the markup changes.
  const inner = useMemo(() => ({ __html: html }), [html]);
  useEffect(() => {
    setHtml(slotHtml(JSON.parse(key)));
  }, [key]);
  useRowEdges(slot, html);

  return (
    <header className="mh">
      <div className="mh-l">
        <a className="name" href={homeHref()}>Time Track</a>
        <site-slot ref={slot} name="site-path" data-tail={key} dangerouslySetInnerHTML={html ? inner : undefined} suppressHydrationWarning />
      </div>
      <div className="who">
        {session === 'signed-in' && (
          <>
            {email && <span className="uname">{email}</span>}
            <button type="button" className="linkbtn" onClick={() => void signOut()}>Sign out</button>
          </>
        )}
        {session === 'signed-out' && <a className="linkbtn" href={SIGN_IN_HREF}>Sign in</a>}
        <site-theme-picker hide-label="" />
      </div>
    </header>
  );
}
