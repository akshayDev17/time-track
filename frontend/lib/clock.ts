/**
 * The server's clock, as seen from this browser. Every API answer carries the server's
 * `now_ms`; the request's midpoint is when the server most likely read it, so the offset is
 * `now_ms - midpoint`. The sample with the shortest round trip is the closest, so it is kept.
 * Every device then shows `acc + (serverNow() - running_since)`: the same tenths everywhere.
 */

export type Sample = { offset: number; rtt: number };

export function sampleOf(nowMs: number, sentAt: number, receivedAt: number): Sample {
  return { offset: Math.round(nowMs - (sentAt + receivedAt) / 2), rtt: Math.max(0, receivedAt - sentAt) };
}

/**
 * Keep the better of two samples. A kept one ages, so it is replaced in time; and a new one
 * that disagrees beyond both samples' error bounds means this device's clock jumped (a laptop
 * waking, a manual change), so it wins at once.
 */
export function better(kept: Sample | null, next: Sample): Sample {
  if (!kept) return next;
  if (Math.abs(next.offset - kept.offset) > (next.rtt + kept.rtt) / 2 + 1000) return next;
  return next.rtt <= kept.rtt ? next : { ...kept, rtt: kept.rtt + 10 };
}

let kept: Sample | null = null;

export function recordServerTime(nowMs: number, sentAt: number, receivedAt: number): void {
  kept = better(kept, sampleOf(nowMs, sentAt, receivedAt));
}

export function serverNow(): number {
  return Date.now() + (kept ? kept.offset : 0);
}
