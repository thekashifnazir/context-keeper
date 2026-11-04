// demo: rooms open to the public (a Discord channel judges can join, docs/demo-channel.md), named by
// CK_DEMO_ROOMS (comma-separated prefixes; unset = no demo rooms, and nothing here changes anything).
// A prefix matches the room's full Switch name ("Guild: try-context-keeper") or the channel part after
// the last ": " ("try-context-keeper"). In a demo room:
//   - jobs A to D run as anywhere else, answers cite the seeded record, quiet-on-chatter rules unchanged;
//   - job E (Claude Code hand-off) is off whatever the global flags say, so nobody there can start a
//     build. Voice (audio clip, talk link) is off too unless CK_DEMO_VOICE=1; then it follows the
//     global flags, capped: CK_DEMO_VOICE_PER_DAY (default 15) audio clips + talk links per UTC day
//     across all demo rooms (a brief with both counts 2), and one voice brief per person per day (the
//     owner and CK_DEMO_EXEMPT count towards the day's total only). Over a cap the text brief still
//     posts, with VOICE_CAP_LINE instead of the talk link;
//   - per-person limits: at most CK_DEMO_PER_PERSON_HOUR replies (default 6) and
//     CK_DEMO_TRIES_PER_PERSON_HOUR decisions, silent ones included (default 20, each costs a model
//     call), per person per rolling hour; at most CK_DEMO_PER_ROOM_HOUR replies per room (default 40,
//     a catch-up brief counts). Over a limit: LIMIT_LINE once per person per hour, then silence.
//     The owner (CK_OWNER_SENDER / state/owner.json) and CK_DEMO_EXEMPT (sender ids or handles) are
//     never limited;
//   - when the daily spend cap is reached (src/agent/spend.ts): PAUSED_LINE once per room per day.
// The demo room is posted in and listened to even when CK_POST_ROOMS / CK_LISTEN_ROOMS don't list it.
// Counts are saved in CK_STATE_DIR/demo-limits.json, so a restart doesn't reset them.
import { existsSync, readFileSync } from 'node:fs';
import type { Features } from './features.ts';
import type { SpendMeter } from './spend.ts';
import { atomicWriteJson } from './state.ts';

export const LIMIT_LINE = "You've hit the demo limit for now — try again in a bit.";
export const PAUSED_LINE = 'The demo has paused for today — back tomorrow.';
export const VOICE_CAP_LINE = "Voice catch-ups have hit today's demo limit — back tomorrow.";
const HOUR = 3_600_000;

export interface DemoConfig { prefixes: string[]; perPersonHour: number; triesPerPersonHour: number; perRoomHour: number; exempt: Set<string>; voice?: boolean; voicePerDay?: number }

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const int = (v: string | undefined, d: number) => { const n = Number(v); return v && Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };

/** null when CK_DEMO_ROOMS is unset or empty: no room is a demo room. */
export function demoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DemoConfig | null {
  const prefixes = list(env.CK_DEMO_ROOMS);
  if (!prefixes.length) return null;
  return {
    prefixes,
    perPersonHour: int(env.CK_DEMO_PER_PERSON_HOUR, 6),
    triesPerPersonHour: int(env.CK_DEMO_TRIES_PER_PERSON_HOUR, 20),
    perRoomHour: int(env.CK_DEMO_PER_ROOM_HOUR, 40),
    exempt: new Set(list(env.CK_DEMO_EXEMPT)),
    voice: env.CK_DEMO_VOICE === '1',
    voicePerDay: int(env.CK_DEMO_VOICE_PER_DAY, 15),
  };
}

/** The full Switch room name, or the channel part after the last ": ", starts with a prefix. */
export function matchesRoom(name: string, prefixes: string[]): boolean {
  if (!name) return false;
  const channel = name.includes(': ') ? name.slice(name.lastIndexOf(': ') + 2) : name;
  return prefixes.some((p) => name.startsWith(p) || channel.startsWith(p));
}

/** What a room may use: in a demo room, job E is off regardless of the global flags, and voice is
 *  too unless `voice` (CK_DEMO_VOICE=1), when it follows the global flags (the daily caps are
 *  DemoLimiter.takeVoice's). */
export function roomFeatures(f: Features, demo: boolean, voice = false): Features {
  if (!demo) return f;
  return { jobE: false, audioBrief: voice && f.audioBrief, talkLink: voice && f.talkLink };
}

/** A brief's voice in a room, given what the room may use (roomFeatures) and whether a talk agent
 *  exists. `voice`: run the clip / link at all. `closing`: the brief's closing line to force ('' = no
 *  talk line, VOICE_CAP_LINE over a demo cap), or undefined to keep the usual one. Outside a demo room
 *  it only says whether any voice part is on. Takes the demo voice cap (takeVoice) when it says yes. */
export function briefVoice(o: {
  demo: boolean; rf: Features; talkAgent: boolean; limiter: DemoLimiter | null;
  sender: string; handle?: string | null; owner?: string | null;
}): { voice: boolean; closing?: string; capped?: true } {
  const on = o.rf.audioBrief || o.rf.talkLink;
  if (!o.demo) return { voice: on };
  if (!on) return { voice: false, closing: '' }; // no "talk it through" line where there is no voice
  const units = (o.rf.audioBrief ? 1 : 0) + (o.rf.talkLink && o.talkAgent ? 1 : 0);
  if (o.limiter && !o.limiter.takeVoice(o.sender, units, o.handle ?? null, o.owner ?? null)) return { voice: false, closing: VOICE_CAP_LINE, capped: true };
  return { voice: true, closing: '' }; // the talk link, when it's made, replaces this
}

/** Voice spend in demo rooms for one UTC day: clips + links in total, and voice briefs per person. */
interface VoiceDay { day: string; total: number; people: Record<string, number> }
interface LimitsFile { tries: Record<string, number[]>; replies: Record<string, number[]>; room: Record<string, number[]>; notified: Record<string, number>; voice?: VoiceDay }

export type LimitCheck = 'ok' | 'notify' | 'silent';

/** Rolling-hour counters per person (room + sender) and per room. */
export class DemoLimiter {
  private d: LimitsFile = { tries: {}, replies: {}, room: {}, notified: {} };
  constructor(readonly cfg: DemoConfig, private file: string | null = null, private now: () => number = Date.now) {
    if (file && existsSync(file)) {
      try { this.d = { ...this.d, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<LimitsFile>) }; } catch { /* start clean */ }
    }
  }
  private save() { if (this.file) atomicWriteJson(this.file, this.d); }
  private recent(map: Record<string, number[]>, key: string): number[] {
    const cut = this.now() - HOUR;
    const kept = (map[key] ?? []).filter((t) => t > cut);
    if (kept.length) map[key] = kept; else delete map[key];
    return kept;
  }
  private push(map: Record<string, number[]>, key: string) { this.recent(map, key); (map[key] ??= []).push(this.now()); }

  exempt(sender: string, handle: string | null, owner: string | null): boolean {
    return (!!owner && sender === owner) || this.cfg.exempt.has(sender) || (!!handle && this.cfg.exempt.has(handle));
  }

  /** Over a limit? 'notify' the first time in an hour (post LIMIT_LINE), 'silent' after that. */
  check(roomId: string, sender: string, handle: string | null = null, owner: string | null = null): LimitCheck {
    if (this.exempt(sender, handle, owner)) return 'ok';
    const who = `${roomId}|${sender}`;
    const over = this.recent(this.d.replies, who).length >= this.cfg.perPersonHour
      || this.recent(this.d.tries, who).length >= this.cfg.triesPerPersonHour
      || this.recent(this.d.room, roomId).length >= this.cfg.perRoomHour;
    if (!over) return 'ok';
    const last = this.d.notified[who];
    if (last !== undefined && this.now() - last < HOUR) return 'silent';
    this.d.notified[who] = this.now();
    this.save();
    return 'notify';
  }

  private voiceDay(): VoiceDay {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.d.voice?.day !== day) this.d.voice = { day, total: 0, people: {} };
    return this.d.voice;
  }

  /** May this person's brief carry voice? `units`: the clips + links it would use (1 or 2). True:
   *  counted and saved now (before any ElevenLabs call, so a crash never under-counts). False: over
   *  the day's total (CK_DEMO_VOICE_PER_DAY) or this person already had a voice brief today. */
  takeVoice(sender: string, units: number, handle: string | null = null, owner: string | null = null): boolean {
    if (units <= 0) return true;
    const v = this.voiceDay();
    const cap = this.cfg.voicePerDay ?? 15;
    const exempt = this.exempt(sender, handle, owner);
    if (v.total + units > cap || (!exempt && (v.people[sender] ?? 0) >= 1)) { this.save(); return false; }
    v.total += units;
    if (!exempt) v.people[sender] = (v.people[sender] ?? 0) + 1;
    this.save();
    return true;
  }

  /** Clips + links used today across the demo rooms. */
  voiceUsedToday(): number { return this.voiceDay().total; }

  /** A decision ran for this person (a model call, whether or not it replied). */
  noteTry(roomId: string, sender: string) { this.push(this.d.tries, `${roomId}|${sender}`); this.save(); }
  /** The agent replied in the room: to this person, or (sender null) a brief, which counts for the room only. */
  noteReply(roomId: string, sender: string | null) {
    if (sender) this.push(this.d.replies, `${roomId}|${sender}`);
    this.push(this.d.room, roomId);
    this.save();
  }
}

export type Gate = { go: true } | { go: false; say: string | null; why: string };

/** Before anything runs for a person's message: the spend cap first (everywhere), then a demo room's
 *  limits. `say` is the one line to post in the message's thread, or null for silence. */
export function gateMessage(o: {
  roomId: string; demo: boolean; sender: string; handle?: string | null; owner?: string | null;
  meter?: SpendMeter | null; limiter?: DemoLimiter | null;
}): Gate {
  if (o.meter?.capped()) {
    return { go: false, say: o.demo && o.meter.pausedNoticeDue(o.roomId) ? PAUSED_LINE : null, why: 'spend_cap' };
  }
  if (o.demo && o.limiter) {
    const c = o.limiter.check(o.roomId, o.sender, o.handle ?? null, o.owner ?? null);
    if (c !== 'ok') return { go: false, say: c === 'notify' ? LIMIT_LINE : null, why: 'demo_limit' };
  }
  return { go: true };
}
