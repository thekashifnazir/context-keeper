// spend: a daily cap on model spend (CK_DAILY_SPEND_CAP_USD, off when unset). Every model call the
// live agent makes goes through deps.claude, so meteredClaude() wraps that one client: after each
// call it adds the call's usage priced at model.ts's table (costUsd) to today's total (UTC day), saved
// in CK_STATE_DIR/spend.json so a restart keeps the count. At 80% of the cap the owner desk gets one
// note; at 100% every further call is refused before it is sent (SpendCapError, which the pipeline
// treats as "paused": no owner note per message, no retry) and the owner desk gets one more note.
// Demo rooms (src/agent/demo.ts) say once per room per day that the demo has paused. Ends at 00:00 UTC.
// The figure is an estimate from the price table: an upper bound, not the bill. ElevenLabs is not in it.
import { existsSync, readFileSync } from 'node:fs';
import { costUsd, usageOf, type Claude } from './model.ts';
import { atomicWriteJson } from './state.ts';

export const WARN_AT = 0.8;

export class SpendCapError extends Error {
  readonly spendCap = true;
  constructor(spent: number, cap: number) {
    super(`daily spend cap reached ($${spent.toFixed(2)} of $${cap.toFixed(2)}); no model call sent`);
    this.name = 'SpendCapError';
  }
}
export const isSpendCapError = (e: unknown): boolean => !!(e as { spendCap?: boolean } | null)?.spendCap;

interface SpendFile { day: string; usd: number; calls: number; warned: boolean; capped_noted: boolean; paused_rooms: string[] }

export type Crossing = 'warn' | 'cap';

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today's estimated spend. `cap` null = count only, never refuse. */
export class SpendMeter {
  private d: SpendFile;
  constructor(readonly opts: { file: string | null; cap: number | null; now?: () => number }) {
    this.d = this.fresh();
    if (opts.file && existsSync(opts.file)) {
      try {
        const r = JSON.parse(readFileSync(opts.file, 'utf8')) as Partial<SpendFile>;
        if (r.day === this.today()) this.d = { ...this.d, ...r, paused_rooms: Array.isArray(r.paused_rooms) ? r.paused_rooms : [] };
      } catch { /* unreadable: start the day at zero rather than crash */ }
    }
  }
  private now() { return (this.opts.now ?? Date.now)(); }
  private today() { return utcDay(this.now()); }
  private fresh(): SpendFile { return { day: this.today(), usd: 0, calls: 0, warned: false, capped_noted: false, paused_rooms: [] }; }
  /** A new UTC day starts the count again. */
  private roll() { if (this.d.day !== this.today()) { this.d = this.fresh(); this.save(); } }
  private save() { if (this.opts.file) atomicWriteJson(this.opts.file, this.d); }

  get cap() { return this.opts.cap; }
  spent(): number { this.roll(); return this.d.usd; }
  calls(): number { this.roll(); return this.d.calls; }
  capped(): boolean { this.roll(); return this.opts.cap !== null && this.d.usd >= this.opts.cap; }

  /** Adds one call's cost. Returns the thresholds this call crossed for the first time today (each
   *  is returned once per day, across restarts), for the owner notes. */
  add(usd: number): Crossing[] {
    this.roll();
    this.d.usd += Math.max(0, usd);
    this.d.calls += 1;
    const out: Crossing[] = [];
    const cap = this.opts.cap;
    if (cap !== null) {
      if (!this.d.warned && this.d.usd >= cap * WARN_AT) { this.d.warned = true; out.push('warn'); }
      if (!this.d.capped_noted && this.d.usd >= cap) { this.d.capped_noted = true; out.push('cap'); }
    }
    this.save();
    return out;
  }

  /** True once per room per day while capped: that room should say the demo has paused. */
  pausedNoticeDue(roomId: string): boolean {
    if (!this.capped() || this.d.paused_rooms.includes(roomId)) return false;
    this.d.paused_rooms.push(roomId);
    this.save();
    return true;
  }
}

export function spendMeterFromEnv(stateDir: string, env: NodeJS.ProcessEnv = process.env, now?: () => number): SpendMeter {
  const raw = (env.CK_DAILY_SPEND_CAP_USD ?? '').trim();
  const n = Number(raw);
  const cap = raw && !/^(0|off|false|no)$/i.test(raw) && Number.isFinite(n) && n > 0 ? n : null;
  return new SpendMeter({ file: `${stateDir}/spend.json`, cap, now });
}

/** The live client, metered: refused once capped, every answered call counted. A call that fails
 *  (timeout, 5xx) has no usage and isn't counted. */
export function meteredClaude(inner: Claude, meter: SpendMeter, onCross: (c: Crossing, meter: SpendMeter) => void = () => {}): Claude {
  return {
    async create(params, opts) {
      if (meter.capped()) throw new SpendCapError(meter.spent(), meter.cap ?? 0);
      const t0 = Date.now();
      const msg = await inner.create(params, opts);
      for (const c of meter.add(costUsd(usageOf(msg, Date.now() - t0)))) {
        try { onCross(c, meter); } catch { /* a failed note never fails the call */ }
      }
      return msg;
    },
  };
}

/** The two owner-desk notes. */
export function spendNote(c: Crossing, meter: SpendMeter): string {
  const s = `$${meter.spent().toFixed(2)}`;
  const cap = `$${(meter.cap ?? 0).toFixed(2)}`;
  return c === 'warn'
    ? `💸 **Spend at 80%** · today's model spend is about ${s} of the ${cap} daily cap (${meter.calls()} calls). At the cap, model calls stop until 00:00 UTC.`
    : `⏸️ **Daily spend cap reached** · about ${s} of ${cap}. No more model calls until 00:00 UTC; demo rooms say so once, other rooms go quiet. To resume today, raise CK_DAILY_SPEND_CAP_USD and restart the agent.`;
}
