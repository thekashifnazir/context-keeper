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

const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e4e4df;--accent:#2f6f4f;--warn:#a15c00;--bar:#e9e9e4}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--muted:#a3a29b;--line:#33332f;--accent:#7fc4a0;--warn:#e0a24a;--bar:#2c2c29}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1rem;margin:0 0 10px;letter-spacing:.01em}
.sub{color:var(--muted);margin:0 0 20px;font-size:.92rem}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:middle}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat b{display:block;font-size:1.6rem;line-height:1.2}.stat span{color:var(--muted);font-size:.85rem}
ul{list-style:none;margin:0;padding:0}li{padding:8px 0;border-top:1px solid var(--line)}li:first-child{border-top:0;padding-top:0}
.muted{color:var(--muted);font-size:.88rem}.tag{display:inline-block;font-size:.8rem;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted);margin-left:6px}
.label{font-weight:600}.q{display:block}.w{text-decoration:line-through;color:var(--muted)}
.bar{height:10px;background:var(--bar);border-radius:99px;overflow:hidden;margin:8px 0 4px}.bar i{display:block;height:100%;background:var(--accent)}
.bar.hot i{background:var(--warn)}a{color:var(--accent)}
footer{color:var(--muted);font-size:.82rem;margin-top:18px}
@media (max-width:480px){.stat b{font-size:1.3rem}.stat span{font-size:.8rem}}
li{overflow-wrap:anywhere}
`;

export function renderStatusHtml(s: StatusSnapshot): string {
  const room = (r: StatusSnapshot['rooms']['named'][number]) =>
    `<li>${esc(r.name)}${r.bridge ? `<span class="tag">${esc(r.bridge)}</span>` : ''}${r.kind === 'build' ? '<span class="tag">build room, Claude Code</span>' : ''}</li>`;
  const extra = [
    s.rooms.test_rooms ? `${s.rooms.test_rooms} test room${s.rooms.test_rooms === 1 ? '' : 's'}` : '',
    s.rooms.listening_only ? `${s.rooms.listening_only} room${s.rooms.listening_only === 1 ? '' : 's'} it listens to without posting` : '',
  ].filter(Boolean).join(' · ');
  const idea = (i: StatusSnapshot['ideas'][number]) =>
    `<li><span class="label">${esc(i.ref)}</span> · ${esc(i.idea)}<br><span class="muted">${esc(i.raiser)}'s idea · <b>${esc(i.stage)}</b>${i.changed_at ? ` · since ${esc(when(i.changed_at))}` : ''}${i.issue_url ? ` · <a href="${esc(i.issue_url)}" rel="noopener noreferrer">${esc(i.issue_url.replace(/^https:\/\/github\.com\//, ''))}</a>` : ''}</span></li>`;
  const answer = (a: StatusSnapshot['recent'][number]) => {
    const src = a.source ? (a.source.url ? `<a href="${esc(a.source.url)}" rel="noopener noreferrer">${esc(a.source.label)}</a>` : esc(a.source.label)) : '';
    return `<li><span class="label${a.withdrawn ? ' w' : ''}">${esc(a.label)}</span>${a.withdrawn ? ' <span class="tag">withdrawn by the owner</span>' : ''}<span class="q">“${esc(a.question)}”</span><span class="muted">${esc(a.room)} · ${esc(when(a.at))}${src ? ` · source: ${src}` : ''}</span></li>`;
  };
  const sp = s.spend;
  const pct = sp.metered && sp.cap_usd ? Math.min(100, Math.round(((sp.usd ?? 0) / sp.cap_usd) * 100)) : null;
  const spend = !sp.metered
    ? '<p class="muted">Not metered on this run (no daily cap set).</p>'
    : `<p><b>$${(sp.usd ?? 0).toFixed(2)}</b>${sp.cap_usd !== null ? ` of the $${sp.cap_usd.toFixed(2)} daily cap` : ' (no cap)'} · ${sp.calls} model call${sp.calls === 1 ? '' : 's'}</p>${pct !== null ? `<div class="bar${pct >= 80 ? ' hot' : ''}"><i style="width:${pct}%"></i></div>` : ''}<p class="muted">${sp.capped ? 'Cap reached: no model calls until 00:00 UTC. ' : ''}An estimate from the model price table (an upper bound), per UTC day.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><meta name="robots" content="noindex">
<title>Context Keeper · live</title><style>${CSS}</style></head>
<body><main>
<h1><span class="dot"></span>Context Keeper · live</h1>
<p class="sub">Up since ${esc(when(s.up_since))} (${esc(ago(s.up_since, s.generated_at))}). Refreshes every minute; figures are at most a minute old.</p>
<section><h2>Today (UTC)</h2><div class="grid">
<div class="stat"><b>${s.today.replies}</b><span>replies</span></div>
<div class="stat"><b>${s.today.briefs}</b><span>catch-up briefs</span></div>
<div class="stat"><b>${s.today.silences}</b><span>stayed quiet</span></div>
</div></section>
<section><h2>Rooms it's in</h2>${s.rooms.named.length ? `<ul>${s.rooms.named.map(room).join('')}</ul>` : '<p class="muted">None yet.</p>'}${extra ? `<p class="muted">Plus ${esc(extra)}.</p>` : ''}</section>
<section><h2>Ideas in progress (job E)</h2>${s.ideas.length ? `<ul>${s.ideas.map(idea).join('')}</ul>` : '<p class="muted">No ideas on the list.</p>'}</section>
<section><h2>Latest answers in public rooms</h2>${s.recent.length ? `<ul>${s.recent.map(answer).join('')}</ul>` : '<p class="muted">None yet.</p>'}</section>
<section><h2>Model spend today</h2>${spend}</section>
<section><h2>Switch pieces in use</h2><ul>${s.switch_pieces.map((p) => `<li><span class="label">${p.in_use ? '●' : '○'} ${esc(p.piece)}</span><br><span class="muted">${esc(p.detail)}</span></li>`).join('')}</ul></section>
<footer>Read-only, from the running agent's own state. Owner-desk notes, private rooms, ids and emails are never shown. Generated ${esc(when(s.generated_at))}. JSON: <a href="/status.json">/status.json</a></footer>
</main></body></html>
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
