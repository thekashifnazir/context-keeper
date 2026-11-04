// burst: how long the listener waits for a person to go quiet before it decides (main.ts enqueue).
// Kash, 4 Nov: "is there a way we can improve our speed to reply?" Measured on the cloud agent's trace
// and the last live eval: the 20 s quiet gap was most of a reply's time (a single message: ~20 s gap,
// then ~5–13 s verdict, ~1 s to post). Two changes, both here and in main.ts:
//   - a message that reads as finished (ends in ? . ! or an emoji, and isn't trailing off) waits the
//     short gap, CK_BURST_GAP_SHORT_S (default 12 s); anything else (no end punctuation, ends with a
//     comma, "…", "and") waits the full CK_BURST_GAP_S (default 20 s). The eval's bursts send their
//     next message 6–8 s apart, so either gap still takes a burst as one.
//   - main.ts starts the verdict call as each message is queued (prefetch), so the model works while
//     the gap runs; nothing is posted before the gap ends and the gate and reviewer have run.
// The 90 s cap from a burst's first message stays.

export const DEFAULT_GAP_S = 20;
export const DEFAULT_SHORT_GAP_S = 12;
export const CAP_MS = 90_000;

const num = (v: string | undefined, d: number) => (v !== undefined && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export interface GapConfig { longMs: number; shortMs: number }
export function gapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GapConfig {
  const longMs = num(env.CK_BURST_GAP_S, DEFAULT_GAP_S) * 1000;
  return { longMs, shortMs: Math.min(longMs, num(env.CK_BURST_GAP_SHORT_S, DEFAULT_SHORT_GAP_S) * 1000) };
}

const TRAILING = /(\.\.\.|…|[,;:\-–—(/&+]|\b(and|or|but|so|also|because|like|then|plus|with|e\.g|i\.e))\s*$/i;
const FINISHED = /([?!.)]|\p{Extended_Pictographic}|:\)|:D)\s*$/u;

/** True when the message reads as a finished thought, so a shorter wait is safe. */
export function looksFinished(body: string): boolean {
  const t = body.trim();
  if (!t || TRAILING.test(t)) return false;
  return FINISHED.test(t);
}

/** How long to wait after this message before deciding, given when the burst started. */
export function quietGapMs(body: string, firstAt: number, now: number, cfg: GapConfig): number {
  const gap = looksFinished(body) ? cfg.shortMs : cfg.longMs;
  return Math.max(0, Math.min(gap, firstAt + CAP_MS - now));
}
