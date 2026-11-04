// status: the public "Context Keeper · live" page, served by the voice tool server (talk-tool.ts) at
// GET / and /status (one static HTML page) and /status.json, so anyone with the link can see the
// running agent is real: which rooms it's in, how many times it replied or stayed quiet today, where
// job E's ideas are, the last answers it posted in public rooms, today's model spend against the cap,
// and the Switch pieces it uses. CK_STATUS_PAGE=0 turns it off (on by default when the tool server runs).
//
// Built from the agent's own state only, never a Switch call: the room list main.ts keeps, the trace
// file (ck.trace/1), the hand-off store's file (read-only), the spend meter and the seed records
// (state/seed/*.json, for each room's bridge). The snapshot is rebuilt at most once per cacheMs
// (45 s), and each IP gets 30 requests a minute (behind the Cloudflare Tunnel the socket is always
// loopback, so the IP is cf-connecting-ip, trusted only from loopback).
//
// Privacy: public, so it shows only what the rooms themselves already show. Never: anything from an
// owner desk (its trace lines, its posts, its name), owner_private posts, Trust settings, sender ids,
// handles, emails, message or event ids. People's words (a question, an idea) are clipped and scrubbed
// of emails, links, @handles and raw ids. Rooms for tests are counted, not named.
import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { HandoffStore, type IdeaRecord } from './handoff/store.ts';
import { TraceLine } from '../shared/trace.ts';
import { rawIdsIn } from '../shared/refs.ts';

export const STATUS_PATHS = ['/', '/status', '/status/', '/status.json'] as const;
export const STATUS_SCHEMA = 'ck.status/1';

// ---- what the page is built from ----------------------------------------------------------------

export interface StatusRoom { id: string; name: string; posting: boolean }
export interface StatusSpend { usd: number; cap: number | null; calls: number }

export interface StatusSource {
  startedAt: Date;
  /** Every room the agent is connected to (main.ts roomNames), with whether it may post there. */
  rooms: () => StatusRoom[];
  /** Owner desks: never named, never read from. main.ts: the owner desk plus every seed record's desk. */
  privateRoomIds: () => Iterable<string>;
  traceFile: string;
  /** state/handoff.json; null = job E off. */
  handoffFile: string | null;
  /** state/seed: each seeded room's bridge type. Absent = bridges unknown. */
  seedDir?: string | null;
  /** Today's metered spend; null = not metered (no cap and no demo room). */
  spend: () => StatusSpend | null;
  features: { jobE: boolean; voice: boolean };
  now?: () => Date;
}

export interface StatusSnapshot {
  schema: typeof STATUS_SCHEMA;
  generated_at: string;
  up_since: string;
  rooms: { named: { name: string; bridge: string | null; kind: 'team' | 'build' }[]; test_rooms: number; listening_only: number };
  today: { day: string; replies: number; briefs: number; silences: number };
  ideas: { ref: string; idea: string; raiser: string; stage: string; changed_at: string | null; issue_url: string | null }[];
  recent: { at: string; room: string; label: string; question: string; source: { label: string; url: string | null } | null; withdrawn: boolean }[];
  spend: { metered: boolean; usd: number | null; cap_usd: number | null; calls: number | null; capped: boolean };
  switch_pieces: { piece: string; in_use: boolean; detail: string }[];
}

// ---- scrubbing people's words -------------------------------------------------------------------

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** A person's words, safe to show on a public page: no emails, links, @handles, chat tokens or raw
 *  ids; markdown marks dropped; one line, clipped. */
export function scrub(text: string, n = 140): string {
  let t = String(text ?? '')
    .replace(/<[@#!][^>]*>/g, ' ') // Slack <@U123>, <#C123|name>, <!here>
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/(^|[\s(])@[\w.-]+/g, '$1@someone')
    .replace(UUID, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  for (const id of rawIdsIn(t)) t = t.replace(id, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
}

const firstName = (name: string) => scrub(name, 40).split(/\s+/)[0] || 'someone';

// ---- the trace ---------------------------------------------------------------------------------

/** The newest part of the trace (the last 4 MB at most), one valid line per entry. Lines in another
 *  shape (an older listener's, or torn) are skipped, never a crash. */
export function readTraceTail(file: string, maxBytes = 4 * 1024 * 1024): TraceLine[] {
  if (!existsSync(file)) return [];
  let text: string;
  const size = statSync(file).size;
  if (size <= maxBytes) text = readFileSync(file, 'utf8');
  else {
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      readSync(fd, buf, 0, maxBytes, size - maxBytes);
      text = buf.toString('utf8');
      text = text.slice(text.indexOf('\n') + 1); // drop the partial first line
    } finally { closeSync(fd); }
  }
  const out: TraceLine[] = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try {
      const r = TraceLine.safeParse(JSON.parse(l));
      if (r.success) out.push(r.data);
    } catch { /* not JSON: skip */ }
  }
  return out;
}

/** Public-post labels as people see them (post.ts LABEL, the bold words only). */
const VERDICT_LABEL: Record<string, string> = {
  covered: '📌 In the record',
  parked: '🗂️ Parked',
  'parked-recall': '🗂️ Parked for later',
  'contradicts-record': '⚠️ The record says otherwise',
  'might-be-related': '🔎 Related',
  reopen: '↩️ Reopen request',
  new: '💡 New idea',
  decision: '🗳️ Decision',
};

/** The label a public post opened with ("📌 **In the record** · …" → "📌 In the record"). */
export function postLabel(body: string): string | null {
  const first = body.split('\n')[0] ?? '';
  const m = first.match(/^([^\w*\s]{1,4}️?\s+)?\*\*([^*]{2,40})\*\*/u);
  if (!m || /^#\d/.test(m[2])) return null;
  return `${m[1] ?? ''}${m[2].trim()}`.trim();
}

/** A source as the post named it (refs.ts sourceText): "[Label](url) (20 Oct)" or "Rowan, 4 Nov". */
export function sourceOf(s: string | undefined): { label: string; url: string | null } | null {
  if (!s || !s.trim()) return null;
  const m = s.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)\s*(.*)$/);
  if (m) return { label: `${m[1]}${m[3] ? ` ${m[3]}` : ''}`.trim(), url: m[2] };
  if (/\]\(|https?:\/\//.test(s)) return { label: scrub(s.replace(/\[([^\]]+)\]\(\S*\)/g, '$1'), 80), url: null };
  return { label: scrub(s, 80), url: null };
}

// ---- job E's ideas ------------------------------------------------------------------------------

/** Job E's stage, in a few words. */
export function ideaStage(r: Pick<IdeaRecord, 'status' | 'stage'>): string {
  switch (r.status) {
    case 'noted': return 'Noted · waiting for approval';
    case 'approved': return 'Approved · handing to Claude Code';
    case 'stalled': return 'Approved · hand-off retrying';
    case 'not_permitted': return 'Approved · hand-off refused by Switch';
    case 'handed_off':
      return r.stage === 'building' ? 'Claude Code · building'
        : r.stage === 'blocked' ? 'Claude Code · waiting for an OK'
        : 'Claude Code · waiting to start';
    case 'timed_out': return 'Claude Code · no result yet';
    case 'not_done': return 'Not done';
    case 'awaiting_signoff': return 'Done · waiting for sign-off';
    case 'signed_off': return 'Done · signed off';
    case 'reopened': return 'Reopened';
    default: return String(r.status).replace(/_/g, ' ');
  }
}

const issueUrl = (links: string[] | undefined) =>
  (links ?? []).find((l) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+$/.test(l)) ?? null;

function ideaChangedAt(r: IdeaRecord): string | null {
  const ts = [r.at, r.approved?.at, r.handed_at, r.report?.at, r.signoff?.at].map((t) => Date.parse(String(t ?? ''))).filter((n) => !Number.isNaN(n));
  return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
}

// ---- rooms and bridges --------------------------------------------------------------------------

interface SeedRecord { room_id?: string; owner_desk_room?: string; bridge?: { type?: string } | null }
function readSeeds(dir: string | null | undefined): SeedRecord[] {
  if (!dir || !existsSync(dir)) return [];
  const out: SeedRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'last.json') continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as SeedRecord); } catch { /* skip */ }
  }
  return out;
}
const BRIDGE_NAME: Record<string, string> = { slack: 'Slack', discord: 'Discord', mattermost: 'Mattermost' };
const isTestRoom = (name: string) => /^(ck-smoke-|ck-eval-)|^Mattermost \(eval\)/i.test(name);
const isDeskName = (name: string) => /desk/i.test(name);

// ---- the snapshot -------------------------------------------------------------------------------

export function buildStatus(src: StatusSource): StatusSnapshot {
  const now = (src.now ?? (() => new Date()))();
  const seeds = readSeeds(src.seedDir);
  const priv = new Set<string>([...src.privateRoomIds(), ...seeds.map((s) => s.owner_desk_room).filter((x): x is string => !!x)]);
  const bridgeOf = new Map(seeds.filter((s) => s.room_id && s.bridge?.type).map((s) => [s.room_id!, BRIDGE_NAME[s.bridge!.type!.toLowerCase()] ?? null]));
  let store: HandoffStore | null = null;
  try { store = src.handoffFile && existsSync(src.handoffFile) ? new HandoffStore(src.handoffFile) : null; } catch { store = null; }
  const buildRoomIds = new Set((store?.all() ?? []).map((i) => i.build_room?.id).filter((x): x is string => !!x));

  // Rooms: owner desks never; build rooms named as such; test rooms and listen-only rooms counted.
  const rooms = src.rooms().filter((r) => !priv.has(r.id) && !isDeskName(r.name));
  const named: StatusSnapshot['rooms']['named'] = [];
  let testRooms = 0, listeningOnly = 0;
  for (const r of rooms) {
    if (buildRoomIds.has(r.id) && r.posting) named.push({ name: r.name, bridge: bridgeOf.get(r.id) ?? null, kind: 'build' });
    else if (isTestRoom(r.name)) testRooms++;
    else if (!r.posting) listeningOnly++;
    else named.push({ name: r.name, bridge: bridgeOf.get(r.id) ?? null, kind: 'team' });
  }
  named.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'team' ? -1 : 1));
  const publicRoom = (id: string, name: string) => !priv.has(id) && !isDeskName(name);

  // Today, from the trace (UTC day, like the spend cap).
  const day = now.toISOString().slice(0, 10);
  const lines = readTraceTail(src.traceFile).filter((l) => publicRoom(l.room_id, l.room_name));
  const isPublic = (l: TraceLine) => l.posts.some((p) => p.route !== 'owner_private' && publicRoom(p.room_id, p.room_name));
  const todays = lines.filter((l) => l.ts.slice(0, 10) === day);
  const today = {
    day,
    replies: todays.filter((l) => l.kind === 'reply' && isPublic(l)).length,
    briefs: todays.filter((l) => l.kind === 'brief' && isPublic(l)).length,
    silences: todays.filter((l) => l.kind === 'silence').length,
  };

  // The last answers and decisions posted in public rooms (jobs A, B, D; not job E's stage lines).
  const withdrawn = new Set(lines.filter((l) => l.kind === 'retract' && l.retract).map((l) => l.retract!.answer_decision_id));
  const recent: StatusSnapshot['recent'] = [];
  for (const l of [...lines].reverse()) {
    if (recent.length >= 8) break;
    if (l.kind !== 'reply' || l.handoff) continue;
    const post = l.posts.find((p) => (p.route === 'public_thread' || p.route === 'public_top') && publicRoom(p.room_id, p.room_name));
    if (!post) continue;
    const item = l.items.find((i) => ['A', 'B', 'D'].includes(i.job) && (i.verdict || i.decision_record || i.restriction));
    if (!item) continue;
    const label = postLabel(post.body)
      ?? (item.verdict ? VERDICT_LABEL[item.verdict] : null)
      ?? (item.job === 'B' ? VERDICT_LABEL.decision : item.restriction === 'personal' ? '🙋 Preference noted' : item.restriction === 'project' ? '🧱 Constraint' : null);
    if (!label) continue;
    const asked = l.inputs.find((i) => i.message_id === item.message_id) ?? l.inputs[0];
    recent.push({
      at: l.ts,
      room: post.room_name,
      label,
      question: asked ? scrub(asked.body, 120) : '',
      source: sourceOf(item.sources.find((s) => s.source)?.source),
      withdrawn: withdrawn.has(l.decision_id),
    });
  }

  // Job E's ideas, newest change first (never an idea from a desk).
  const ideas = (store?.all() ?? [])
    .filter((r) => publicRoom(r.room_id, r.room_name))
    .map((r) => ({ ref: r.ref, idea: scrub(r.text, 140), raiser: firstName(r.sender_name), stage: ideaStage(r), changed_at: ideaChangedAt(r), issue_url: issueUrl(r.report?.links) }))
    .sort((a, b) => (b.changed_at ?? '').localeCompare(a.changed_at ?? '') || Number(b.ref.replace(/\D/g, '')) - Number(a.ref.replace(/\D/g, '')))
    .slice(0, 10);

  let sp: StatusSpend | null = null;
  try { sp = src.spend(); } catch { sp = null; }
  const spend = sp
    ? { metered: true, usd: Math.round(sp.usd * 100) / 100, cap_usd: sp.cap, calls: sp.calls, capped: sp.cap !== null && sp.usd >= sp.cap }
    : { metered: false, usd: null, cap_usd: null, calls: null, capped: false };

  const bridges = [...new Set(src.rooms().filter((r) => !priv.has(r.id)).map((r) => bridgeOf.get(r.id)).filter((b): b is string => !!b))].sort();
  const handedOff = (store?.all() ?? []).filter((r) => r.handed_at).length;
  const switch_pieces = [
    { piece: 'Rooms and the agent event stream', in_use: rooms.length > 0, detail: `${rooms.length} room${rooms.length === 1 ? '' : 's'} connected; every message heard, tagged or not` },
    { piece: 'Bridges', in_use: bridges.length > 0, detail: bridges.length ? `${bridges.join(', ')}: one agent, one Switch server` : 'none recorded' },
    { piece: 'Room documents and the Decision log', in_use: rooms.length > 0, detail: "the record it cites, read from each room's documents and history" },
    { piece: 'Claude Code, by targeted message', in_use: src.features.jobE, detail: src.features.jobE ? `job E on; ${handedOff} idea${handedOff === 1 ? '' : 's'} handed off, each step behind an approval card` : 'job E off' },
    { piece: 'Switch Trust', in_use: true, detail: 'a guardrail policy on the server (settings not shown here)' },
  ];

  return {
    schema: STATUS_SCHEMA,
    generated_at: now.toISOString(),
    up_since: src.startedAt.toISOString(),
    rooms: { named, test_rooms: testRooms, listening_only: listeningOnly },
    today, ideas, recent, spend, switch_pieces,
  };
}

// ---- the HTML ------------------------------------------------------------------------------------

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`;
};
export function ago(fromIso: string, nowIso: string): string {
  const mins = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(fromIso)) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 48) return `${h} h${m ? ` ${m} min` : ''}`;
  return `${Math.floor(h / 24)} days`;
}

// The look is the "nightshift" direction from our design language (a late-shift control desk), its
// tokens copied as they are. Every colour has one job: blue is progress and the one action, green is
// done, amber is waiting on someone, red is a problem, and grey-blue hatching is idle time. Two
// changes forced by the page's CSP (no fonts or images from anywhere): type falls back to the system
// sans, condensed for display, and the hatching is a CSS gradient rather than an SVG mask.
// Three hues added for this page, each with one job too: teal (from the design repo's apricot-teal
// palette) is context handed to people (catch-up briefs, "Related"), and plum and blurple tag a room's
// platform (Slack, Discord). A tone class sets --c; tiles, bars, badges and chips read it.
const CSS = `
:root{color-scheme:light;--ds-color-background:#EDEFF2;--ds-color-foreground:#14171C;--ds-color-card:#F7F8FA;--ds-color-muted:#E4E6E9;--ds-color-muted-foreground:#4B525C;--ds-color-primary:#1F5BD0;--ds-color-primary-foreground:#FFFFFF;--ds-color-secondary:#DFE3E9;--ds-color-border:#BFC3C9;--ds-color-input:#7B838E;--ds-color-ring:#1F5BD0;--ds-color-destructive:#B91C1C;--ds-color-highlight:#DFE3E9;--ds-color-raised:#FFFFFF;--ds-color-success:#17703F;--ds-color-warning:#8C5300;--ds-color-signal:#95A1B3;--ck-teal:#0E655F;--ck-slack:#7C2D6B;--ck-discord:#4650C8;--ck-red-text:#B91C1C;
--ds-font-sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--ds-font-display:"IBM Plex Sans","IBM Plex Sans Condensed",system-ui,-apple-system,"Segoe UI",sans-serif;
--ds-font-size-xs:12px;--ds-font-size-sm:14px;--ds-font-size-base:16px;--ds-font-size-lg:18px;--ds-font-size-xl:20px;--ds-font-size-2xl:24px;--ds-font-size-3xl:30px;--ds-font-size-4xl:36px;--ds-font-size-5xl:48px;--ds-font-size-6xl:60px;
--ds-spacing-1:4px;--ds-spacing-2:8px;--ds-spacing-3:12px;--ds-spacing-4:16px;--ds-spacing-6:24px;--ds-spacing-8:32px;--ds-spacing-12:48px;--ds-spacing-16:64px;
--ds-radius-control:4px;--ds-radius-full:9999px;--ds-border-width:1px;--ds-duration-slow:320ms;--ds-easing-standard:cubic-bezier(0.2,0,0,1);
--hatch:repeating-linear-gradient(135deg,transparent 0 6px,var(--ds-color-signal) 6px 7px)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--ds-color-background:#09090B;--ds-color-foreground:#F4F4F5;--ds-color-card:#18181B;--ds-color-muted:#232327;--ds-color-muted-foreground:#94949C;--ds-color-primary:#5C9BFF;--ds-color-primary-foreground:#0A0F1A;--ds-color-secondary:#232327;--ds-color-border:#4D4D53;--ds-color-input:#6E6E76;--ds-color-ring:#5C9BFF;--ds-color-destructive:#EF4444;--ds-color-highlight:#242931;--ds-color-raised:#232327;--ds-color-success:#4CC38A;--ds-color-warning:#E6B450;--ds-color-signal:#5E6B7F;--ck-teal:#6CC8BC;--ck-slack:#E39AD3;--ck-discord:#A3AAFF;--ck-red-text:#F87171}}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--ds-color-background);color:var(--ds-color-foreground);font:var(--ds-font-size-base)/1.55 var(--ds-font-sans);-webkit-font-smoothing:antialiased}
body{margin:0;overflow-x:hidden}
p,h1,h2,h3,ul,ol,dl,dd{margin:0}ul,ol{padding:0;list-style:none}
a{color:var(--ds-color-primary);text-underline-offset:3px}
:focus-visible{outline:2px solid var(--ds-color-ring);outline-offset:3px}
.num{font-variant-numeric:tabular-nums}
.display{font-family:var(--ds-font-display);font-weight:600;font-stretch:85%;letter-spacing:-.01em;line-height:1.04}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:1200px;margin:0 auto;padding:0 var(--ds-spacing-6)}
.card{background:var(--ds-color-card);border:var(--ds-border-width) solid var(--ds-color-border);border-radius:var(--ds-radius-control)}
.muted{color:var(--ds-color-muted-foreground);font-size:var(--ds-font-size-sm)}
.mark{display:inline-block;flex:none;width:.9em;height:.9em;vertical-align:-.08em;border:var(--ds-border-width) solid var(--ds-color-foreground);background:var(--hatch)}
.solid{display:inline-block;flex:none;width:.9em;height:.9em;vertical-align:-.08em;background:var(--ds-color-success)}
.c-blue{--c:var(--ds-color-primary)}.c-teal{--c:var(--ck-teal)}.c-green{--c:var(--ds-color-success)}.c-amber{--c:var(--ds-color-warning)}.c-red{--c:var(--ds-color-destructive);--ct:var(--ck-red-text)}.c-idle{--c:var(--ds-color-signal)}.c-slack{--c:var(--ck-slack)}.c-discord{--c:var(--ck-discord)}
.sw{display:inline-block;flex:none;width:.75em;height:.75em;background:var(--c,var(--ds-color-border))}
.sw.c-idle{background:var(--hatch);border:var(--ds-border-width) solid var(--ds-color-signal)}
.bar{position:relative}
.bar::before{content:"";position:absolute;left:-1px;top:-1px;bottom:-1px;width:var(--ds-spacing-1);background:var(--c,var(--ds-color-border));border-radius:var(--ds-radius-control) 0 0 var(--ds-radius-control)}
.intro{max-width:68ch;color:var(--ds-color-muted-foreground);margin-bottom:var(--ds-spacing-6)}
h3.sub{font-size:var(--ds-font-size-base);font-weight:600;margin:var(--ds-spacing-8) 0 var(--ds-spacing-3)}
.top{display:flex;align-items:center;gap:var(--ds-spacing-3);min-height:72px;border-bottom:var(--ds-border-width) solid var(--ds-color-border)}
.logo{display:inline-flex;align-items:center;gap:var(--ds-spacing-2);font-size:var(--ds-font-size-2xl);color:var(--ds-color-foreground)}
.logo svg{width:28px;height:28px}.logo .t{fill:var(--ds-color-primary)}.logo .b{fill:var(--ds-color-primary-foreground)}
.top .muted{margin-left:auto}
.hero{position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:var(--ds-spacing-12);align-items:center;--now:57%}
.wrap.hero{padding-block:var(--ds-spacing-16) var(--ds-spacing-12)}
.hero::before,.hero::after{content:"";position:absolute;z-index:-1;top:0;bottom:0;pointer-events:none}
.hero::before{left:var(--now);right:min(0px,calc((100% - 100vw)/2));background:repeating-linear-gradient(135deg,transparent 0 6px,color-mix(in srgb,var(--ds-color-signal) 42%,transparent) 6px 7px)}
.hero::after{left:var(--now);width:var(--ds-border-width);background:var(--ds-color-input)}
.hero h1{font-size:clamp(var(--ds-font-size-4xl),4.6vw,var(--ds-font-size-6xl));max-width:16ch;text-wrap:balance}
.lede{font-size:var(--ds-font-size-lg);color:var(--ds-color-muted-foreground);max-width:52ch;margin-top:var(--ds-spacing-6)}
.actions{display:flex;flex-wrap:wrap;gap:var(--ds-spacing-3);margin-top:var(--ds-spacing-8)}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 var(--ds-spacing-6);border-radius:var(--ds-radius-control);font-weight:600;text-decoration:none;transition:background-color var(--ds-duration-slow) var(--ds-easing-standard)}
.btn-p{background:var(--ds-color-primary);color:var(--ds-color-primary-foreground)}
.btn-p:hover{background:color-mix(in srgb,var(--ds-color-primary) 88%,var(--ds-color-foreground))}
.btn-s{background:var(--ds-color-secondary);color:var(--ds-color-foreground)}
.btn-s:hover{background:var(--ds-color-border)}
.live{padding:var(--ds-spacing-6);background:var(--ds-color-raised)}
.live-top{display:flex;justify-content:space-between;align-items:center;gap:var(--ds-spacing-4)}
.pulse{display:inline-flex;align-items:center;gap:var(--ds-spacing-2);font-weight:600;color:var(--ds-color-success)}
.pulse i{position:relative;width:10px;height:10px;border-radius:var(--ds-radius-full);background:currentColor}
.pulse i::after{content:"";position:absolute;inset:-4px;border-radius:inherit;border:2px solid currentColor;opacity:0}
@media (prefers-reduced-motion:no-preference){.pulse i::after{animation:ping 2.4s var(--ds-easing-standard) infinite}}
@keyframes ping{0%{transform:scale(.6);opacity:.7}70%,100%{transform:scale(1.6);opacity:0}}
.live-num{font-size:var(--ds-font-size-6xl);margin-top:var(--ds-spacing-4)}
.rows{margin-top:var(--ds-spacing-6)}
.rows div{display:flex;justify-content:space-between;gap:var(--ds-spacing-4);padding:var(--ds-spacing-3) 0;border-top:var(--ds-border-width) solid var(--ds-color-border);font-size:var(--ds-font-size-sm)}
.rows dt{color:var(--ds-color-muted-foreground)}.rows dd{font-weight:600;text-align:right;overflow-wrap:anywhere}
section.wrap{padding-block:var(--ds-spacing-12)}
.band{background:var(--ds-color-highlight);border-block:var(--ds-border-width) solid var(--ds-color-border)}
.band .wrap{padding-block:var(--ds-spacing-8) var(--ds-spacing-12)}
.band h2{font-size:var(--ds-font-size-2xl)}
.steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--ds-spacing-6);margin-top:var(--ds-spacing-6)}
.step{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:var(--ds-spacing-3);align-content:start;border-top:3px solid var(--c,var(--ds-color-foreground));padding-top:var(--ds-spacing-3)}
.step-n{grid-row:span 2;font-size:var(--ds-font-size-4xl);color:var(--c,var(--ds-color-foreground))}
.step h3{font-size:var(--ds-font-size-base);font-weight:600;line-height:1.3;padding-top:var(--ds-spacing-1)}
.step p{font-size:var(--ds-font-size-sm);color:var(--ds-color-muted-foreground);margin-top:var(--ds-spacing-1)}
.wrap.split{padding-block:var(--ds-spacing-12) var(--ds-spacing-8)}
.head{display:flex;justify-content:space-between;align-items:baseline;gap:var(--ds-spacing-4);flex-wrap:wrap;margin-bottom:var(--ds-spacing-2)}
.head h2{font-size:var(--ds-font-size-3xl)}
.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.7fr);overflow:hidden}
.kpi{position:relative;padding:var(--ds-spacing-8) var(--ds-spacing-6) var(--ds-spacing-6);border-left:var(--ds-border-width) solid var(--ds-color-border);background:color-mix(in srgb,var(--c) 6%,var(--ds-color-card))}
.kpi::before{content:"";position:absolute;left:0;right:0;top:0;height:6px;background:var(--c)}
.kpi.c-idle{background:var(--ds-color-card)}
.kpi.c-idle::before{background:repeating-linear-gradient(135deg,transparent 0 3px,var(--ds-color-signal) 3px 4px);border-bottom:var(--ds-border-width) solid var(--ds-color-signal)}
.kpi:first-child{border-left:0}
.kpi-l{display:flex;align-items:center;gap:var(--ds-spacing-2);font-size:var(--ds-font-size-sm);font-weight:600;color:var(--ds-color-muted-foreground)}
.kpi-n{font-size:var(--ds-font-size-6xl);margin-top:var(--ds-spacing-3);color:var(--c)}
.kpi.c-idle .kpi-n{color:var(--ds-color-foreground)}
.kpi-n small{font-size:var(--ds-font-size-xl);font-weight:400;color:var(--ds-color-muted-foreground);margin-left:var(--ds-spacing-2);letter-spacing:0}
.kpi-d{margin-top:var(--ds-spacing-2);font-size:var(--ds-font-size-sm);color:var(--ds-color-muted-foreground)}
.meter{height:var(--ds-spacing-2);background:var(--ds-color-muted);border-radius:var(--ds-radius-control);margin-top:var(--ds-spacing-4);overflow:hidden}
.meter{background:color-mix(in srgb,var(--c) 18%,var(--ds-color-muted))}.meter i{display:block;height:100%;background:var(--c)}
.rule{position:relative;height:var(--ds-spacing-3)}
.rule::before{content:"";position:absolute;left:0;right:0;top:50%;height:var(--ds-border-width);background:linear-gradient(to right,var(--ds-color-input) 0 64%,transparent 64% 82%,var(--ds-color-input) 82%)}
.rule::after{content:"";position:absolute;top:0;bottom:0;left:64%;width:18%;border:var(--ds-border-width) solid var(--ds-color-signal);background:var(--hatch)}
.ideas{overflow:hidden}
.idea{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:var(--ds-spacing-8);align-items:center;padding:var(--ds-spacing-6)}
.idea+.idea{border-top:var(--ds-border-width) solid var(--ds-color-border)}
.idea.bar{background:color-mix(in srgb,var(--c) 4%,var(--ds-color-card))}.idea.bar::before{left:0;top:0;bottom:0;border-radius:0}
.key{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--ds-spacing-4);font-size:var(--ds-font-size-sm)}
.key div{position:relative;padding-top:var(--ds-spacing-4)}
.key div::before{content:"";position:absolute;left:0;right:0;top:0;height:6px;background:var(--c);border-radius:var(--ds-radius-control)}
.key dt{font-weight:600}.key dd{color:var(--ds-color-muted-foreground);margin-top:var(--ds-spacing-1)}
.key .who{font-size:var(--ds-font-size-xs);color:var(--ds-color-foreground);margin-top:var(--ds-spacing-2)}
.tones{display:flex;flex-wrap:wrap;gap:var(--ds-spacing-2) var(--ds-spacing-6);margin-top:var(--ds-spacing-4);font-size:var(--ds-font-size-sm);color:var(--ds-color-muted-foreground)}
.tones span{display:inline-flex;align-items:center;gap:var(--ds-spacing-2)}
.idea-t{display:flex;gap:var(--ds-spacing-3);align-items:baseline}
.ref{font-size:var(--ds-font-size-xl);flex:none;min-width:2.2em}
.idea-t p{font-weight:600;overflow-wrap:anywhere}
.idea-m{margin:var(--ds-spacing-2) 0 0 calc(2.2em * 1.25 + var(--ds-spacing-3));font-size:var(--ds-font-size-sm);color:var(--ds-color-muted-foreground);overflow-wrap:anywhere}
.track{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--ds-spacing-1)}
.track li{position:relative;padding-top:var(--ds-spacing-4);font-size:var(--ds-font-size-xs);line-height:1.25;color:var(--ds-color-muted-foreground)}
.track li::before{content:"";position:absolute;left:0;right:0;top:2px;height:6px;border:var(--ds-border-width) solid var(--ds-color-border);border-radius:var(--ds-radius-control)}
.track li.past::before{background:var(--ds-color-primary);border-color:var(--ds-color-primary)}
.track.all li::before{background:var(--ds-color-success);border-color:var(--ds-color-success)}
.track li.now{color:var(--ds-color-foreground);font-weight:600}
.track li.now::before{top:0;height:10px;--c:var(--ds-color-primary);background:var(--c);border-color:var(--c)}
.t-wait li.now::before{--c:var(--ds-color-warning)}.t-ok li.now::before{--c:var(--ds-color-success)}.t-bad li.now::before{--c:var(--ds-color-destructive)}
.answers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ds-spacing-4)}
.ans{padding:var(--ds-spacing-6);display:flex;flex-direction:column;gap:var(--ds-spacing-3);overflow-wrap:anywhere;background:color-mix(in srgb,var(--c,var(--ds-color-card)) 5%,var(--ds-color-card))}
.ans-top{display:flex;justify-content:space-between;align-items:center;gap:var(--ds-spacing-3);flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:var(--ds-spacing-1);padding:2px var(--ds-spacing-3);border:var(--ds-border-width) solid color-mix(in srgb,var(--c,var(--ds-color-border)) 50%,var(--ds-color-border));border-radius:var(--ds-radius-full);font-size:var(--ds-font-size-sm);font-weight:600;background:color-mix(in srgb,var(--c,var(--ds-color-raised)) 10%,var(--ds-color-raised));color:var(--ct,var(--c,var(--ds-color-foreground)))}
.badge.c-idle{color:var(--ds-color-foreground)}
.vkey{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--ds-spacing-3) var(--ds-spacing-6);font-size:var(--ds-font-size-sm)}
.vkey dt{display:flex;align-items:center;gap:var(--ds-spacing-2);font-weight:600;color:var(--ct,var(--c))}.vkey .c-idle dt{color:var(--ds-color-foreground)}.vkey dd{padding-left:calc(.75em + var(--ds-spacing-2));color:var(--ds-color-muted-foreground)}
.badge.w{text-decoration:line-through;color:var(--ds-color-muted-foreground);background:var(--ds-color-raised);border-color:var(--ds-color-border)}
.chip{display:inline-flex;align-items:center;padding:2px var(--ds-spacing-2);border-radius:var(--ds-radius-full);background:var(--ds-color-highlight);font-size:var(--ds-font-size-xs);font-weight:600;white-space:nowrap}
.chip[class*=" c-"]{background:color-mix(in srgb,var(--c) 13%,var(--ds-color-card));color:var(--c)}
.q{font-size:var(--ds-font-size-lg);line-height:1.45}
.src{margin-top:auto;padding-top:var(--ds-spacing-3);border-top:var(--ds-border-width) solid var(--ds-color-border)}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--ds-spacing-12)}
.split h2{font-size:var(--ds-font-size-2xl);margin-bottom:var(--ds-spacing-4)}
.list li{display:flex;align-items:baseline;gap:var(--ds-spacing-3);flex-wrap:wrap;padding:var(--ds-spacing-3) 0;border-top:var(--ds-border-width) solid var(--ds-color-border);overflow-wrap:anywhere}
.list li:last-child{border-bottom:var(--ds-border-width) solid var(--ds-color-border)}
.list .name{font-weight:600;margin-right:auto}
.list .sw{align-self:center}
.pieces li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;column-gap:var(--ds-spacing-3);row-gap:var(--ds-spacing-1);align-items:baseline}
.pieces .d{grid-column:2/-1}.pieces .plain{grid-column:2/-1}
.state{font-size:var(--ds-font-size-sm);font-weight:600;color:var(--ds-color-success)}.state.muted{color:var(--ds-color-muted-foreground)}
.after{margin-top:var(--ds-spacing-4)}
.foot{border-top:var(--ds-border-width) solid var(--ds-color-border);padding-block:var(--ds-spacing-8) var(--ds-spacing-12);display:flex;justify-content:space-between;gap:var(--ds-spacing-6);flex-wrap:wrap;align-items:flex-start}
.foot nav{display:flex;gap:var(--ds-spacing-6);flex-wrap:wrap;font-weight:600}
.foot p{max-width:62ch}
@media (max-width:960px){.hero{grid-template-columns:minmax(0,1fr);gap:var(--ds-spacing-8)}.wrap.hero{padding-top:var(--ds-spacing-12)}
.hero::before{top:auto;left:min(0px,calc((100% - 100vw)/2));height:36%}.hero::after{display:none}
.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.spend{grid-column:1/-1;border-left:0;border-top:var(--ds-border-width) solid var(--ds-color-border)}
.steps{grid-template-columns:repeat(2,minmax(0,1fr))}.key{grid-template-columns:repeat(3,minmax(0,1fr))}.vkey{grid-template-columns:repeat(2,minmax(0,1fr))}
.idea{grid-template-columns:minmax(0,1fr);gap:var(--ds-spacing-4)}.split{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.wrap{padding:0 var(--ds-spacing-4)}.top .muted{display:none}.hero h1{font-size:var(--ds-font-size-4xl)}
.steps{grid-template-columns:minmax(0,1fr);gap:var(--ds-spacing-4)}.key{grid-template-columns:repeat(2,minmax(0,1fr))}.vkey{grid-template-columns:minmax(0,1fr)}
.kpis{grid-template-columns:minmax(0,1fr)}.kpi{display:grid;grid-template-columns:5.5ch minmax(0,1fr);column-gap:var(--ds-spacing-4);align-items:start;padding:var(--ds-spacing-6) var(--ds-spacing-4) var(--ds-spacing-4);border-left:0}.kpi+.kpi{border-top:var(--ds-border-width) solid var(--ds-color-border)}
.kpi>*{grid-column:2}.kpi .kpi-n{grid-column:1;grid-row:1/span 3;font-size:var(--ds-font-size-4xl);line-height:1;margin:0}.kpi-l{margin-top:0}
.spend{display:block}.spend .kpi-n{font-size:var(--ds-font-size-4xl);margin-top:var(--ds-spacing-2)}
.answers{grid-template-columns:minmax(0,1fr)}.idea,.ans{padding:var(--ds-spacing-4)}.idea-m{margin-left:0}
.track{padding-bottom:var(--ds-spacing-4)}.track li{padding-top:var(--ds-spacing-3)}.track li:not(.now) span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.track li.now span{position:absolute;left:0;white-space:nowrap}.track li.now:nth-child(n+4) span{left:auto;right:0}}
`;

/** Where an idea sits on the tracker people see (Noted → … → Signed off), and what its colour means:
 *  go = moving (blue), wait = waiting on someone (amber), ok = done (green), bad = a problem (red).
 *  Read from ideaStage's words, so the page and /status.json can never disagree. at = -1: unknown. */
export const TRACK = ['Noted', 'Approved', 'Building', 'Waiting for Kash', 'Done', 'Signed off'] as const;
export type StageTone = 'go' | 'wait' | 'ok' | 'bad';
export function stageStep(stage: string): { at: number; tone: StageTone } {
  const s = stage.toLowerCase();
  if (s === 'done · signed off') return { at: 5, tone: 'ok' };
  if (s.startsWith('done')) return { at: 4, tone: 'ok' };
  if (s === 'not done') return { at: 2, tone: 'bad' };
  if (s.includes('waiting for an ok')) return { at: 3, tone: 'wait' };
  if (s.startsWith('claude code')) return { at: 2, tone: s.includes('no result') ? 'wait' : 'go' };
  if (s.startsWith('approved')) return { at: 1, tone: s.includes('refused') ? 'bad' : s.includes('retrying') ? 'wait' : 'go' };
  if (s.startsWith('noted') || s === 'reopened') return { at: 0, tone: 'wait' };
  return { at: -1, tone: 'go' };
}

/** A posted label's colour, by what it means: settled in the record (green), clashes with the record
 *  (red), waits on a person (amber), set aside (the idle grey-blue), context nearby (teal), or a new
 *  entry it wrote down (blue). */
export function verdictTone(label: string): string {
  if (/in the record/i.test(label)) return 'c-green';
  if (/otherwise/i.test(label)) return 'c-red';
  if (/reopen|new idea/i.test(label)) return 'c-amber';
  if (/parked/i.test(label)) return 'c-idle';
  if (/related|preference|constraint/i.test(label)) return 'c-teal';
  if (/decision/i.test(label)) return 'c-blue';
  return '';
}
const TONE_CLASS: Record<StageTone, string> = { go: 'c-blue', wait: 'c-amber', ok: 'c-green', bad: 'c-red' };

/** The tracker's stages in plain words: what each means and who acts next. */
const STAGE_KEY: [stage: (typeof TRACK)[number], tone: StageTone, means: string, who: string][] = [
  ['Noted', 'wait', 'Someone suggested it. It waits for the owner to approve.', 'The owner'],
  ['Approved', 'go', 'The owner said yes. It is being handed to Claude Code.', 'The agent'],
  ['Building', 'go', 'Claude Code is building it in its own channel.', 'Claude Code'],
  ['Waiting for Kash', 'wait', 'Claude Code needs an OK before its next step.', 'Kash, the owner'],
  ['Done', 'ok', 'Built. The person who asked checks the result.', 'The person who asked'],
  ['Signed off', 'ok', 'The person who asked says it works. Finished.', 'Nobody'],
];

/** The answer labels in plain words (the legend under Latest answers). */
const VERDICT_KEY: [label: string, means: string][] = [
  ['In the record', 'Already decided. The reply links to where.'],
  ['The record says otherwise', 'What was said clashes with an earlier decision.'],
  ['Reopen request', 'Someone wants to change a decision. The owner decides.'],
  ['New idea', 'Something new. It goes to the owner to approve.'],
  ['Related', 'Not settled, but something close was discussed.'],
  ['Parked', 'Raised before and set aside for later.'],
  ['Decision', 'A new decision it has written into the record.'],
];

/** Each Switch piece in plain words, for someone who has never used Switch. */
const PIECE_PLAIN: Record<string, string> = {
  'Rooms and the agent event stream': 'Switch passes it every message in its rooms, so it can follow the whole conversation.',
  Bridges: 'The same agent in Slack and Discord at once, not a copy for each.',
  'Room documents and the Decision log': "Where the team's decisions are kept. Its answers link back here.",
  'Claude Code, by targeted message': 'How it hands an approved idea to Claude Code to build.',
  'Switch Trust': 'Rules on the server that limit what the agent may do. It cannot change them.',
};
const PLATFORM_CLASS: Record<string, string> = { Slack: 'c-slack', Discord: 'c-discord' };

const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect class="t" width="64" height="64" rx="15"/><rect class="b" x="14" y="17" width="36" height="7" rx="3.5"/><rect class="b" x="14" y="28.5" width="27" height="7" rx="3.5" fill-opacity=".72"/><rect class="b" x="14" y="40" width="18" height="7" rx="3.5" fill-opacity=".45"/></svg>';
const REPO = 'https://github.com/thekashifnazir/context-keeper';
const DISCORD = 'https://discord.gg/ygPnp7bj5';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const link = (url: string, text: string) => `<a href="${esc(url)}" rel="noopener noreferrer">${esc(text)}</a>`;

export function renderStatusHtml(s: StatusSnapshot): string {
  const day = new Date(`${s.today.day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const track = (stage: string) => {
    const { at, tone } = stageStep(stage);
    const all = at === TRACK.length - 1 && tone === 'ok';
    return `<ol class="track t-${tone}${all ? ' all' : ''}" aria-label="Stage">${TRACK.map((name, i) =>
      `<li${i < at ? ' class="past"' : i === at ? ' class="now" aria-current="step"' : ''}><span>${esc(name)}</span></li>`).join('')}</ol>`;
  };
  const idea = (i: StatusSnapshot['ideas'][number]) => {
    const { at, tone } = stageStep(i.stage);
    return `<li class="idea${at < 0 ? '' : ` bar ${TONE_CLASS[tone]}`}"><div><div class="idea-t"><span class="ref display num">${esc(i.ref)}</span><p>${esc(i.idea)}</p></div>` +
    `<p class="idea-m">${esc(i.raiser)}'s idea. ${esc(i.stage)}${i.changed_at ? `, since ${esc(when(i.changed_at))}` : ''}.` +
    `${i.issue_url ? ` ${link(i.issue_url, i.issue_url.replace(/^https:\/\/github\.com\//, ''))}` : ''}</p></div>${track(i.stage)}</li>`;
  };
  const stageKey = `<h3 class="sub">What the stages mean</h3><dl class="key">${STAGE_KEY.map(([name, tone, means, who]) =>
    `<div class="${TONE_CLASS[tone]}"><dt>${esc(name)}</dt><dd>${esc(means)}</dd><dd class="who">Who acts: ${esc(who)}</dd></div>`).join('')}</dl>` +
    `<p class="tones"><span><i class="sw c-blue"></i>Blue: moving</span><span><i class="sw c-amber"></i>Amber: waiting on a person</span>` +
    `<span><i class="sw c-green"></i>Green: done</span><span><i class="sw c-red"></i>Red: stuck, needs a look</span></p>`;
  const verdictKey = `<h3 class="sub">What the labels mean</h3><dl class="vkey">${VERDICT_KEY.map(([label, means]) =>
    `<div class="${verdictTone(label)}"><dt><i class="sw ${verdictTone(label)}" aria-hidden="true"></i>${esc(label)}</dt><dd>${esc(means)}</dd></div>`).join('')}</dl>`;

  const answer = (a: StatusSnapshot['recent'][number]) => {
    const src = a.source ? (a.source.url ? link(a.source.url, a.source.label) : esc(a.source.label)) : '';
    const tone = a.withdrawn ? '' : verdictTone(a.label);
    return `<li class="ans card bar${tone ? ` ${tone}` : ''}"><p class="ans-top"><span class="badge${a.withdrawn ? ' w' : tone ? ` ${tone}` : ''}">${esc(a.label)}</span>` +
      `${a.withdrawn ? '<span class="chip">withdrawn by the owner</span>' : `<span class="muted num">${esc(when(a.at))}</span>`}</p>` +
      `<p class="q">“${esc(a.question)}”</p><p class="muted">In ${esc(a.room)}${a.withdrawn ? `, ${esc(when(a.at))}` : ''}</p>` +
      `${src ? `<p class="muted src">Source: ${src}</p>` : ''}</li>`;
  };

  const room = (r: StatusSnapshot['rooms']['named'][number]) => {
    const tone = r.kind === 'build' ? 'c-blue' : r.bridge ? PLATFORM_CLASS[r.bridge] ?? '' : '';
    return `<li><i class="sw${tone ? ` ${tone}` : ''}" aria-hidden="true"></i><span class="name">${esc(r.name)}</span>` +
      `${r.bridge ? `<span class="chip ${PLATFORM_CLASS[r.bridge] ?? ''}">${esc(r.bridge)}</span>` : ''}${r.kind === 'build' ? '<span class="chip c-blue">build room, Claude Code</span>' : ''}</li>`;
  };
  const extra = [
    s.rooms.test_rooms ? plural(s.rooms.test_rooms, 'test room') : '',
    s.rooms.listening_only ? `${plural(s.rooms.listening_only, 'room')} it listens to without posting` : '',
  ].filter(Boolean).join(' and ');
  const piece = (p: StatusSnapshot['switch_pieces'][number]) =>
    `<li><span class="${p.in_use ? 'solid' : 'mark'}" aria-hidden="true"></span><span class="name">${esc(p.piece)}</span>` +
    `<span class="state${p.in_use ? '' : ' muted'}">${p.in_use ? 'In use' : 'Off'}</span>` +
    `${PIECE_PLAIN[p.piece] ? `<span class="plain">${esc(PIECE_PLAIN[p.piece])}</span>` : ''}<span class="muted d">${esc(p.detail)}</span></li>`;

  const sp = s.spend;
  const pct = sp.metered && sp.cap_usd ? Math.min(100, Math.round(((sp.usd ?? 0) / sp.cap_usd) * 100)) : null;
  const spend = !sp.metered
    ? '<p class="kpi-n display num">–</p><p class="kpi-d">What today\'s Claude calls cost. Not metered on this run (no daily cap set).</p>'
    : `<p class="kpi-n display num">$${(sp.usd ?? 0).toFixed(2)}<small>${sp.cap_usd !== null ? `of the $${sp.cap_usd.toFixed(2)} daily cap` : 'no cap set'}</small></p>` +
      `${pct !== null ? `<div class="meter" role="img" aria-label="${pct}% of the daily cap used"><i style="width:${pct}%"></i></div>` : ''}` +
      `<p class="kpi-d">What today's Claude calls cost. ${sp.capped ? 'Cap reached: it stays quiet until 00:00 UTC.' : 'A daily cap stops it overspending.'} ` +
      `${plural(sp.calls ?? 0, 'model call')}, priced high so this is an upper bound.</p>`;

  const lastAnswer = s.recent[0]?.at ?? null;
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><meta name="robots" content="noindex">
<meta name="description" content="The running Context Keeper agent: its rooms, today's replies, ideas in progress and latest answers.">
<title>Context Keeper · live</title><style>${CSS}</style></head>
<body>
<header class="wrap top"><span class="logo display">${LOGO}Context Keeper</span><span class="muted">Live status</span></header>
<main>
<div class="wrap hero">
<div><h1 class="display">From “didn’t we decide this?” to “it’s built”, right in your team chat.</h1>
<p class="lede">Context Keeper sits in a team's chat. It answers with the source when a question was already settled, and turns new ideas into work for Claude Code. This page is the running agent, read from its own state.</p>
<p class="actions"><a class="btn btn-p" href="${DISCORD}" rel="noopener noreferrer">Try it on Discord</a><a class="btn btn-s" href="${REPO}" rel="noopener noreferrer">View the code on GitHub</a></p></div>
<aside class="card live" aria-label="Agent status">
<p class="live-top"><span class="pulse"><i aria-hidden="true"></i>Live</span><span class="muted">Refreshes every minute</span></p>
<p class="live-num display num">${esc(ago(s.up_since, s.generated_at))}</p>
<p class="muted">running, up since ${esc(when(s.up_since))}</p>
<dl class="rows num"><div><dt>Rooms it posts in</dt><dd>${s.rooms.named.length}</dd></div><div><dt>Ideas on the list</dt><dd>${s.ideas.length}</dd></div>
<div><dt>Last public answer</dt><dd>${lastAnswer ? esc(when(lastAnswer)) : 'none yet'}</dd></div><div><dt>Figures as of</dt><dd>${esc(when(s.generated_at))}</dd></div></dl>
</aside>
</div>
<section class="band" aria-labelledby="h-how"><div class="wrap"><h2 id="h-how" class="display">How it works</h2><ol class="steps">
<li class="step"><span class="step-n display num">1</span><h3>It reads every message</h3><p>People talk in Slack or Discord. Through Switch it reads every message in the room, tagged or not.</p></li>
<li class="step c-blue"><span class="step-n display num">2</span><h3>It answers with the source, or stays quiet</h3><p>When someone raises something already decided, it replies with where it was decided. Otherwise it says nothing.</p></li>
<li class="step c-amber"><span class="step-n display num">3</span><h3>New ideas wait for a yes</h3><p>A new idea goes to the owner to approve. Then Claude Code builds it in a new channel.</p></li>
<li class="step c-green"><span class="step-n display num">4</span><h3>The person who asked signs it off</h3><p>They check the result in the room and say it works.</p></li>
</ol></div></section>
<section class="wrap" aria-labelledby="h-today"><div class="head"><h2 id="h-today" class="display">Today</h2><p class="muted">UTC day, ${esc(day)}</p></div>
<p class="intro">What it did in its rooms since midnight UTC. Staying quiet is most of the job, so a big quiet number is a good sign.</p>
<div class="card kpis">
<div class="kpi c-blue"><p class="kpi-l">Replies</p><p class="kpi-n display num">${s.today.replies}</p><p class="kpi-d">Times it spoke up in a room: an answer with its source, a decision written down or an idea logged.</p></div>
<div class="kpi c-teal"><p class="kpi-l">Catch-up briefs</p><p class="kpi-n display num">${s.today.briefs}</p><p class="kpi-d">Short summaries for someone coming back to a thread they missed.</p></div>
<div class="kpi c-idle"><p class="kpi-l"><span class="mark" aria-hidden="true"></span>Stayed quiet</p><p class="kpi-n display num">${s.today.silences}</p><p class="kpi-d">Times it read the chat and decided no reply was needed, like small talk and thanks.</p></div>
<div class="kpi spend${!sp.metered ? '' : sp.capped ? ' c-red' : ' c-amber'}"><p class="kpi-l">Model spend</p>${spend}</div>
</div></section>
<div class="wrap"><div class="rule" aria-hidden="true"></div></div>
<section class="wrap" aria-labelledby="h-ideas"><div class="head"><h2 id="h-ideas" class="display">Ideas in progress</h2><p class="muted">Newest change first</p></div>
<p class="intro">Ideas people suggested in a room, and how far each has got. Nothing moves to the next stage until a person says yes on an approval card in the room.</p>
${s.ideas.length ? `<ul class="card ideas">${s.ideas.map(idea).join('')}</ul>` : '<p class="card idea">No ideas on the list yet. When someone suggests one in a room, it shows here once it is noted.</p>'}
${stageKey}</section>
<section class="wrap" aria-labelledby="h-answers"><div class="head"><h2 id="h-answers" class="display">Latest answers</h2><p class="muted">Posted in public rooms, newest first</p></div>
<p class="intro">When someone asks about something the team already settled, it answers in the thread and links to where it was decided. The label says what kind of answer it was.</p>
${s.recent.length ? `<ul class="answers">${s.recent.map(answer).join('')}</ul>` : '<p class="muted">No answers posted in public rooms yet.</p>'}
${verdictKey}</section>
<div class="wrap"><div class="rule" aria-hidden="true"></div></div>
<section class="wrap split">
<div><h2 id="h-rooms" class="display">Rooms</h2><p class="intro">The team chats it is in. One agent covers Slack and Discord at the same time.</p>${s.rooms.named.length ? `<ul class="list">${s.rooms.named.map(room).join('')}</ul>` : '<p class="muted">Not in any public rooms yet.</p>'}${extra ? `<p class="muted after">Also ${esc(extra)}.</p>` : ''}</div>
<div><h2 id="h-switch" class="display">Switch pieces in use</h2><p class="intro">Switch is the platform the agent runs on. These are the parts it uses, in plain words.</p><ul class="list pieces">${s.switch_pieces.map(piece).join('')}</ul></div>
</section>
</main>
<footer class="wrap"><div class="foot">
<nav aria-label="Links"><a href="${REPO}" rel="noopener noreferrer">GitHub repo</a><a href="${DISCORD}" rel="noopener noreferrer">Try it on Discord</a><a href="/status.json">Raw data (JSON)</a></nav>
<p class="muted">Read-only, from the running agent's own state. Owner-desk notes, private rooms, ids and emails are never shown. Generated ${esc(when(s.generated_at))}, UK time.</p>
</div></footer>
</body></html>
`;
}

// ---- serving: cache and per-IP limit ------------------------------------------------------------

export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();
  constructor(private perMin = 30, private now: () => number = Date.now) {}
  allow(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (t - v.start >= 60_000) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || t - h.start >= 60_000) { this.hits.set(key, { start: t, n: 1 }); return true; }
    h.n++;
    return h.n <= this.perMin;
  }
}

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
/** The caller's IP: cf-connecting-ip when the request came through the local tunnel, else the socket. */
export function clientIp(req: IncomingMessage): string {
  const sock = req.socket?.remoteAddress ?? '';
  const cf = req.headers['cf-connecting-ip'];
  return LOOPBACK.test(sock) && typeof cf === 'string' && cf.trim() ? cf.trim() : sock || 'unknown';
}

const HEADERS = {
  'cache-control': 'public, max-age=30',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export class StatusPage {
  private cached: { at: number; snap: StatusSnapshot; html: string } | null = null;
  private limiter: RateLimiter;
  constructor(private src: StatusSource, private opts: { cacheMs?: number; perMin?: number; clock?: () => number; log?: (s: string) => void } = {}) {
    this.limiter = new RateLimiter(opts.perMin ?? 30, opts.clock ?? Date.now);
  }
  private clock() { return (this.opts.clock ?? Date.now)(); }

  /** The snapshot, rebuilt at most once per cacheMs (default 45 s). */
  snapshot(): { snap: StatusSnapshot; html: string } {
    const t = this.clock();
    if (!this.cached || t - this.cached.at >= (this.opts.cacheMs ?? 45_000)) {
      const snap = buildStatus(this.src);
      this.cached = { at: t, snap, html: renderStatusHtml(snap) };
    }
    return this.cached;
  }

  /** True when this request is the status page's (it has then been answered). */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const path = (req.url ?? '').split('?')[0];
    if (!(STATUS_PATHS as readonly string[]).includes(path)) return false;
    if (!this.limiter.allow(clientIp(req))) {
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60', ...HEADERS, 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : 'Too many requests: 30 a minute. Try again in a minute.\n');
      return true;
    }
    let out: { snap: StatusSnapshot; html: string };
    try { out = this.snapshot(); } catch (e) {
      (this.opts.log ?? (() => {}))(`status page failed: ${(e as Error).message}`);
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', ...HEADERS, 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : 'Status unavailable just now.\n');
      return true;
    }
    const json = path === '/status.json';
    res.writeHead(200, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', ...HEADERS });
    res.end(req.method === 'HEAD' ? undefined : json ? JSON.stringify(out.snap, null, 2) : out.html);
    return true;
  }
}
