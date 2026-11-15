/**
 * Every call to the Time Track API (backend/time_track/api.py), same-origin in production.
 *
 * `redirect: 'manual'`: with no Access session, Access answers an API call with a 302 to
 * `<team>.cloudflareaccess.com`. A followed redirect would be a cross-origin fetch failing
 * with an opaque network error; manual mode turns it into an `opaqueredirect`, which reads as
 * "signed out". A real 401 from the Worker (it failed to read a valid session's identity) is
 * retried once, as the quiz app learned to.
 */
import { recordServerTime } from './clock.ts';
import type { DayStamp } from './zones.ts';
import type { HistoryResponse, Me, TrackerResponse, TrackersResponse } from './types.ts';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
export const BASE_PATH = '/time-track';
/** A protected page whose only job is to be reached: Access signs the visitor in on the way. */
export const SIGN_IN_HREF = `${BASE_PATH}/signin`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly signedOut: boolean;

  constructor(status: number, message: string, code = '', signedOut = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.signedOut = signedOut;
  }
}

export const isSignedOut = (e: unknown) => e instanceof ApiError && (e.signedOut || e.status === 401);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const call = async () => {
    const sentAt = Date.now();
    const res = await fetch(`${API_BASE}${BASE_PATH}/api${path}`, {
      method,
      credentials: 'include',
      redirect: 'manual',
      cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { res, sentAt, receivedAt: Date.now() };
  };
  let got = await call();
  if (got.res.status === 401) {
    await new Promise((r) => setTimeout(r, 300));
    got = await call();
  }
  const { res } = got;
  if (res.type === 'opaqueredirect') throw new ApiError(401, 'Not signed in.', '', true);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; now_ms?: number };
  if (typeof data.now_ms === 'number') recordServerTime(data.now_ms, got.sentAt, got.receivedAt);
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed: HTTP ${res.status}`, data.code ?? '');
  return data;
}

const e = encodeURIComponent;

export const getMe = () => request<Me>('GET', '/me');
export const listTrackers = () => request<TrackersResponse>('GET', '/trackers');
export const createTracker = (name: string, timers: number) => request<TrackerResponse>('POST', '/trackers', { name, timers });
export const getTracker = (slug: string) => request<TrackerResponse>('GET', `/trackers/${e(slug)}`);
export const deleteTracker = (slug: string) => request<void>('DELETE', `/trackers/${e(slug)}`);
export const getHistory = (slug: string) => request<HistoryResponse>('GET', `/trackers/${e(slug)}/history`);

export const startToday = (slug: string, stamp: DayStamp, lastDay?: 'save' | 'discard') =>
  request<TrackerResponse>('POST', `/trackers/${e(slug)}/start-today`, lastDay ? { ...stamp, last_day: lastDay } : stamp);
export const saveDay = (slug: string) => request<TrackerResponse>('POST', `/trackers/${e(slug)}/save-day`);
export const discardDay = (slug: string) => request<TrackerResponse>('POST', `/trackers/${e(slug)}/discard-day`);

export type TrackerAction = 'start-all' | 'stop-all' | 'relaunch' | 'clear-all';
export const trackerAction = (slug: string, action: TrackerAction) => request<TrackerResponse>('POST', `/trackers/${e(slug)}/${action}`);
export const timerAction = (slug: string, id: number, action: 'start' | 'stop' | 'clear') =>
  request<TrackerResponse>('POST', `/trackers/${e(slug)}/timers/${id}/${action}`);
export const addTimer = (slug: string) => request<TrackerResponse>('POST', `/trackers/${e(slug)}/timers`);
export const renameTimer = (slug: string, id: number, name: string) => request<TrackerResponse>('PATCH', `/trackers/${e(slug)}/timers/${id}`, { name });
export const removeTimer = (slug: string, id: number) => request<TrackerResponse>('DELETE', `/trackers/${e(slug)}/timers/${id}`);

/**
 * Sign out. Access's logout endpoint has no return target, so it is called in the background
 * (a same-origin fetch still gets its Set-Cookie applied) and the visitor lands on the public
 * page; if the session survived, the full navigation to the endpoint always works.
 */
export async function signOut(): Promise<void> {
  const logout = `${API_BASE}/cdn-cgi/access/logout`;
  try {
    await fetch(logout, { credentials: 'include', redirect: 'manual' });
  } catch {
    // leaving is the intent; a failed call must not trap the visitor here
  }
  const stillIn = await getMe().then(() => true, () => false);
  window.location.href = stillIn ? logout : BASE_PATH;
}
