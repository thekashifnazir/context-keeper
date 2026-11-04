// The event stream's watchdog. Switch pings an open socket every 2 seconds (the event stream's own
// heartbeat lands as often), and every ping, beat and event counts as a sign of life (the runtime's
// onAlive). A stream with no sign of life for CK_STREAM_WATCHDOG_SEC (default 120) has gone quiet
// without ending: a socket left half-open, or a reattach Switch keeps refusing. The runtime's own
// reconnect loop can't see either, so the watchdog stops that stream and opens a fresh one from the
// saved position (nothing is lost; a redelivered message is skipped as already processed). A fresh
// stream that shows no life either counts as a failed restart; after `maxRestarts` of those in a
// row it gives up, and main exits non-zero so the supervisor (systemd Restart=always) starts a new
// process. 0 turns it off.

export interface StreamHandle { stop(): void }

export interface WatchdogOpts {
  staleMs: number;
  /** Failed restarts in a row before giving up. */
  maxRestarts: number;
  now: () => number;
  /** Opens and starts a stream (resuming from the current position); may throw. */
  open: () => StreamHandle;
  log: (line: string) => void;
  giveUp: (why: string) => void;
}

export const DEFAULT_WATCHDOG_SEC = 120;
export const DEFAULT_MAX_RESTARTS = 3;

/** CK_STREAM_WATCHDOG_SEC in ms: unset or bad → the default, 0 → off (null). */
export function watchdogMsFromEnv(v: string | undefined): number | null {
  const n = v === undefined || v.trim() === '' ? DEFAULT_WATCHDOG_SEC : Number(v);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_WATCHDOG_SEC * 1000;
  return n === 0 ? null : n * 1000;
}

export class StreamWatchdog {
  private current: StreamHandle | null = null;
  private lastAlive = 0;
  private failedRestarts = 0;
  private restarts = 0;
  private done = false;

  constructor(private readonly o: WatchdogOpts) {}

  /** Opens the first stream. Throws if that fails: nothing to watch yet. */
  start(): void {
    this.current = this.o.open();
    this.lastAlive = this.o.now();
  }

  /** A sign of life from the current stream: a ping, a beat, an event, a (re)connect. */
  alive(): void {
    this.lastAlive = this.o.now();
    if (this.failedRestarts > 0) this.o.log(`stream watchdog: stream alive again after ${this.failedRestarts} restart(s)`);
    this.failedRestarts = 0;
  }

  get restartCount(): number { return this.restarts; }

  /** Called on a timer. Returns what it did. */
  check(): 'ok' | 'restarted' | 'gave-up' | 'off' {
    if (this.done) return 'off';
    const quiet = this.o.now() - this.lastAlive;
    if (quiet < this.o.staleMs) return 'ok';
    // The current stream showed no life for a whole window (alive() resets the count).
    this.failedRestarts += 1;
    if (this.failedRestarts > this.o.maxRestarts) {
      this.done = true;
      const why = `stream watchdog: no sign of life from Switch for ${Math.round(quiet / 1000)} s, after ${this.o.maxRestarts} restart(s) in a row`;
      this.o.log(why);
      try { this.current?.stop(); } catch { /* going anyway */ }
      this.o.giveUp(why);
      return 'gave-up';
    }
    this.o.log(`stream watchdog: no event, ping or heartbeat for ${Math.round(quiet / 1000)} s; restarting the stream from the saved position (attempt ${this.failedRestarts} of ${this.o.maxRestarts})`);
    try { this.current?.stop(); } catch (e) { this.o.log(`stream watchdog: stopping the old stream failed: ${(e as Error).message}`); }
    this.current = null;
    this.restarts += 1;
    try {
      this.current = this.o.open();
    } catch (e) {
      // Counted like a stream that never came alive: the next check tries again or gives up.
      this.o.log(`stream watchdog: reopening failed: ${(e as Error).message}`);
    }
    this.lastAlive = this.o.now();
    return 'restarted';
  }
}
