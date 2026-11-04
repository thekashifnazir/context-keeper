// The event stream's watchdog (src/agent/stream-watchdog.ts), on a fake clock with fake streams: a
// quiet stream is replaced, any sign of life keeps it, a run of dead restarts gives up (main exits
// non-zero for the supervisor), and CK_STREAM_WATCHDOG_SEC is read as documented.
import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCHDOG_SEC, StreamWatchdog, watchdogMsFromEnv } from '../../src/agent/stream-watchdog.ts';

function rig(opts: { maxRestarts?: number; failOpen?: (n: number) => boolean } = {}) {
  let t = 0;
  const opened: { n: number; stopped: boolean }[] = [];
  const logs: string[] = [];
  const gaveUp: string[] = [];
  const w = new StreamWatchdog({
    staleMs: 120_000,
    maxRestarts: opts.maxRestarts ?? 3,
    now: () => t,
    open: () => {
      const n = opened.length + 1;
      if (opts.failOpen?.(n)) { opened.push({ n, stopped: true }); throw new Error(`open ${n} refused`); }
      const s = { n, stopped: false };
      opened.push(s);
      return { stop: () => { s.stopped = true; } };
    },
    log: (l) => logs.push(l),
    giveUp: (why) => gaveUp.push(why),
  });
  return { w, opened, logs, gaveUp, at: (ms: number) => { t = ms; } };
}

describe('stream watchdog', () => {
  it('leaves a stream with regular pings alone', () => {
    const r = rig();
    r.w.start();
    for (let s = 2; s <= 600; s += 2) { r.at(s * 1000); r.w.alive(); expect(r.w.check()).toBe('ok'); }
    expect(r.opened).toHaveLength(1);
    expect(r.opened[0].stopped).toBe(false);
    expect(r.logs).toEqual([]);
  });

  it('restarts a stream quiet for the whole window: the old one stopped, a fresh one opened', () => {
    const r = rig();
    r.w.start();
    r.at(30_000); r.w.alive(); // last ping at 30 s
    r.at(149_000); expect(r.w.check()).toBe('ok'); // 119 s quiet
    r.at(150_000); expect(r.w.check()).toBe('restarted'); // 120 s quiet
    expect(r.opened.map((s) => s.stopped)).toEqual([true, false]);
    expect(r.logs[0]).toMatch(/no event, ping or heartbeat for 120 s; restarting the stream from the saved position \(attempt 1 of 3\)/);
    // the fresh stream gets a full window before it is judged
    r.at(269_000); expect(r.w.check()).toBe('ok');
  });

  it('a fresh stream that comes alive resets the count, so later drops get their own restarts', () => {
    const r = rig({ maxRestarts: 2 });
    r.w.start();
    r.at(120_000); expect(r.w.check()).toBe('restarted');
    r.at(240_000); expect(r.w.check()).toBe('restarted'); // second in a row
    r.at(241_000); r.w.alive();
    expect(r.logs.at(-1)).toMatch(/alive again after 2 restart/);
    r.at(361_000); expect(r.w.check()).toBe('restarted'); // a new drop: attempt 1 again
    expect(r.logs.at(-1)).toMatch(/attempt 1 of 2/);
    expect(r.gaveUp).toEqual([]);
  });

  it('gives up after maxRestarts dead restarts in a row, stopping the last stream', () => {
    const r = rig({ maxRestarts: 3 });
    r.w.start();
    for (let i = 1; i <= 3; i++) { r.at(i * 120_000); expect(r.w.check()).toBe('restarted'); }
    r.at(4 * 120_000);
    expect(r.w.check()).toBe('gave-up');
    expect(r.gaveUp).toHaveLength(1);
    expect(r.gaveUp[0]).toMatch(/after 3 restart\(s\) in a row/);
    expect(r.opened).toHaveLength(4);
    expect(r.opened.every((s) => s.stopped)).toBe(true);
    // once given up it does nothing more (main is exiting)
    r.at(10 * 120_000);
    expect(r.w.check()).toBe('off');
    expect(r.gaveUp).toHaveLength(1);
  });

  it('a reopen that throws counts as a failed restart, not a crash', () => {
    const r = rig({ maxRestarts: 2, failOpen: (n) => n >= 2 });
    r.w.start();
    r.at(120_000); expect(r.w.check()).toBe('restarted');
    expect(r.logs.at(-1)).toMatch(/reopening failed: open 2 refused/);
    r.at(240_000); expect(r.w.check()).toBe('restarted');
    r.at(360_000); expect(r.w.check()).toBe('gave-up');
  });

  it('reads CK_STREAM_WATCHDOG_SEC: unset or junk = 120 s, 0 = off', () => {
    expect(DEFAULT_WATCHDOG_SEC).toBe(120);
    expect(watchdogMsFromEnv(undefined)).toBe(120_000);
    expect(watchdogMsFromEnv('')).toBe(120_000);
    expect(watchdogMsFromEnv('abc')).toBe(120_000);
    expect(watchdogMsFromEnv('-5')).toBe(120_000);
    expect(watchdogMsFromEnv('30')).toBe(30_000);
    expect(watchdogMsFromEnv('0')).toBeNull();
  });
});
