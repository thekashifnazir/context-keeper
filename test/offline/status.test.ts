// The public status page (src/agent/status.ts) served by the voice tool server: what it shows, what it
// must never show (owner desk, ids, emails, handles), the JSON shape, the 45 s cache and the per-IP
// limit. Real HTTP on 127.0.0.1, fixture files in a temp dir, no Switch, no cost.
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildStatus, ideaStage, postLabel, RateLimiter, scrub, sourceOf, StatusPage, type StatusSource } from '../../src/agent/status.ts';
import type { TraceLine } from '../../src/shared/trace.ts';
import { startToolServer, whatsNew } from '../../src/voice/talk-tool.ts';

const NOW = new Date('2026-11-05T14:00:00Z');
const DESK = 'room-desk-0001';
const SMOKE_DESK = 'room-smoke-desk';
const TEAM = 'room-led-0001';
const DEMO = 'room-demo-0001';
const BUILD = 'room-build-0001';

const line = (o: Partial<TraceLine> & Pick<TraceLine, 'room_id' | 'room_name' | 'kind'>): TraceLine => ({
  schema: 'ck.trace/1', ts: '2026-11-05T10:00:00.000Z', decision_id: `d-${Math.random().toString(36).slice(2)}`, trigger: 'message',
  inputs: [], burst: null, items: [], posts: [], model: null, error: null, ...o,
});
const answer = (o: { room_id: string; room_name: string; ts: string; q: string; body: string; verdict: string; source?: string; id?: string; route?: 'public_thread' | 'owner_private' }) => line({
  room_id: o.room_id, room_name: o.room_name, kind: 'reply', ts: o.ts, ...(o.id ? { decision_id: o.id } : {}),
  inputs: [{ message_id: 'sw_0123456789abcdef0123456789abcdef', sender: 'U07SECRETID', body: o.q, received_at: o.ts }],
  items: [{ message_id: 'sw_0123456789abcdef0123456789abcdef', job: 'A', verdict: o.verdict as any, restriction: null, clashes_with: null, sources: o.source ? [{ ref: 'pilot-plan.md §2', quote: 'weekdays only', source: o.source }] : [], decision_record: null, brief_for: null }],
  posts: [{ route: o.route ?? 'public_thread', room_id: o.room_id, room_name: o.room_name, thread_id: 'sw_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', event_id: 'sw_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', body: o.body }],
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ck-status-'));
  const trace = join(dir, 'trace.jsonl');
  const lines: (TraceLine | Record<string, unknown>)[] = [
    { kind: 'listen', room: 'x', t: 1, payload: {} }, // another listener's line: skipped
    answer({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', ts: '2026-11-04T18:00:00Z', q: 'Old question from yesterday', body: '📌 **In the record** · old', verdict: 'covered' }),
    answer({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', ts: '2026-11-05T09:00:00Z', q: 'Why don\'t we run onboarding on Saturdays? ping rowan.p@example.com or @kashif_nazir_uk, see https://evil.example/x', body: '📌 **In the record** · Onboarding is weekdays only.\n_“Partner finance staff work weekdays only”_ — [Ledgerly pilot plan › Decisions](https://github.com/o/context-keeper/blob/main/demo/ledgerly/docs/pilot-plan.md#2-decisions) (Kash, 6 Oct)', verdict: 'covered', source: '[Ledgerly pilot plan › Decisions](https://github.com/o/context-keeper/blob/main/demo/ledgerly/docs/pilot-plan.md#2-decisions) (Kash, 6 Oct)' }),
    answer({ room_id: DEMO, room_name: 'Riverside Events: try-context-keeper', ts: '2026-11-05T09:30:00Z', q: 'Can we add a QuickBooks integration?', body: '🗂️ **Parked for later** · Not in the pilot.', verdict: 'parked-recall', source: 'Sam, 2 Oct', id: 'd-retracted' }),
    line({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', kind: 'retract', ts: '2026-11-05T09:40:00Z', retract: { answer_decision_id: 'd-retracted', answer_event_id: null, thread_id: 't', messages: [], refs: [], reason: '', read_by: 'words', misses_file: null } }),
    line({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', kind: 'silence', ts: '2026-11-05T09:10:00Z' }),
    line({ room_id: DEMO, room_name: 'Riverside Events: try-context-keeper', kind: 'silence', ts: '2026-11-05T09:20:00Z' }),
    line({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', kind: 'brief', ts: '2026-11-05T09:05:00Z', posts: [{ route: 'public_thread', room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', thread_id: 't', event_id: 'e', body: '👋 **Welcome back, Rowan** · …' }] }),
    // The owner desk: none of this may appear, not even as a count.
    answer({ room_id: DESK, room_name: 'ck-owner-desk', ts: '2026-11-05T11:00:00Z', q: 'DESK-SECRET question', body: '🗳️ **#3 · Decision to confirm** · DESK-SECRET', verdict: 'covered' }),
    line({ room_id: DESK, room_name: 'ck-owner-desk', kind: 'silence', ts: '2026-11-05T11:05:00Z' }),
    answer({ room_id: SMOKE_DESK, room_name: 'ck-smoke-2127-desk', ts: '2026-11-05T11:10:00Z', q: 'SMOKE-DESK-SECRET', body: '📌 **In the record** · SMOKE-DESK-SECRET', verdict: 'covered' }),
    // An owner_private post from a team room: never shown either.
    answer({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', ts: '2026-11-05T11:20:00Z', q: 'PRIVATE-NOTE question', body: '⚖️ **Clash to rule on** · PRIVATE-NOTE', verdict: 'covered', route: 'owner_private' }),
    // Job E stage lines are not "answers".
    line({ room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', kind: 'reply', ts: '2026-11-05T11:30:00Z', handoff: { step: 'building', ref: 'I4', key: 'k', attempt: 1, status: 'handed_off', build_room: null, target_status: null }, items: [{ message_id: 'm', job: 'E', verdict: null, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: null }], posts: [{ route: 'public_thread', room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', thread_id: 't', event_id: 'e', body: '🔨 **Building** · I4' }] }),
  ];
  writeFileSync(trace, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const handoff = join(dir, 'handoff.json');
  const idea = (ref: string, status: string, extra: Record<string, unknown> = {}) => ({
    ref, key: `E:${TEAM}:${ref}`, attempt: 1, room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', thread_id: 't', message_id: `sw_${ref}aaaaaaaaaaaa`, sender: 'U07SECRETID', sender_name: 'Rowan Hale', sender_handle: 'rowan_secret_handle',
    text: `Idea ${ref}: a pay-now button on invoices, email me at rowan.p@example.com`, at: '2026-11-04T16:00:00Z', sources: [], status, noted_event: 'sw_desk_event_secret', approved: null, build_room: { id: BUILD, name: 'ck-smoke-build-1104' },
    steps: { room: 'done', context: 'done', handoff: 'done', announce: 'done' }, events: {}, failures: 0, last_error: null, target_status: null, handed_at: null, report: null, signoff: null, ...extra,
  });
  writeFileSync(handoff, JSON.stringify({ next: 4, build_rooms: {}, seen: [], ideas: {
    a: idea('I1', 'signed_off', { report: { message_id: 'm', body: 'done', links: ['https://github.com/o/ledgerly-demo/issues/12'], outcome: 'done', at: '2026-11-04T17:00:00Z' }, signoff: { by: 'U07SECRETID', by_name: 'Rowan Hale', message_id: 'm', verdict: 'signed_off', text: 'looks right', at: '2026-11-04T17:30:00Z' }, handed_at: '2026-11-04T16:30:00Z' }),
    b: idea('I2', 'handed_off', { stage: 'blocked', handed_at: '2026-11-05T08:00:00Z' }),
    c: idea('I3', 'noted'),
    d: { ...idea('I9', 'noted'), room_id: DESK, room_name: 'ck-owner-desk', text: 'DESK-IDEA-SECRET' },
  } }));

  const seed = join(dir, 'seed');
  mkdirSync(seed);
  writeFileSync(join(seed, 'a.json'), JSON.stringify({ room_id: TEAM, owner_desk_room: DESK, bridge: { id: 'b1', type: 'slack' } }));
  writeFileSync(join(seed, 'b.json'), JSON.stringify({ room_id: DEMO, owner_desk_room: 'room-demo-desk', bridge: { id: 'b2', type: 'discord' } }));
  writeFileSync(join(seed, 'last.json'), JSON.stringify({ room_id: 'ignored', bridge: { type: 'teams' } }));

  const src: StatusSource = {
    startedAt: new Date('2026-11-05T12:30:00Z'),
    rooms: () => [
      { id: TEAM, name: 'Ledgerly: ledgerly-pilot', posting: true },
      { id: DEMO, name: 'Riverside Events: try-context-keeper', posting: true },
      { id: BUILD, name: 'ck-smoke-build-1104', posting: true },
      { id: 'room-smoke-1', name: 'ck-smoke-voice-11041714', posting: true },
      { id: SMOKE_DESK, name: 'ck-smoke-2127-desk', posting: true },
      { id: 'room-rs', name: 'Riverside Events: event-planning', posting: false },
      { id: DESK, name: 'ck-owner-desk', posting: false },
    ],
    privateRoomIds: () => [DESK],
    traceFile: trace,
    handoffFile: handoff,
    seedDir: seed,
    spend: () => ({ usd: 1.234, cap: 6, calls: 41 }),
    features: { jobE: true, voice: true },
    now: () => NOW,
  };
  return { dir, trace, src };
}

const FORBIDDEN = [
  'DESK-SECRET', 'SMOKE-DESK-SECRET', 'PRIVATE-NOTE', 'DESK-IDEA-SECRET', 'ck-owner-desk', 'ck-smoke-2127-desk',
  'U07SECRETID', 'rowan_secret_handle', 'kashif_nazir_uk', 'rowan.p@example.com', 'evil.example', 'sw_', 'Hale',
  'room-led-0001', 'room-desk', 'Trust gateway', 'Jailbreak', 'Alert',
];

describe('the status snapshot', () => {
  it('rooms: named team and demo rooms with their bridge, the build room labelled, test and listen-only rooms counted, desks never', () => {
    const s = buildStatus(fixture().src);
    expect(s.rooms.named).toEqual([
      { name: 'Ledgerly: ledgerly-pilot', bridge: 'Slack', kind: 'team' },
      { name: 'Riverside Events: try-context-keeper', bridge: 'Discord', kind: 'team' },
      { name: 'ck-smoke-build-1104', bridge: null, kind: 'build' },
    ]);
    expect(s.rooms.test_rooms).toBe(1);
    expect(s.rooms.listening_only).toBe(1);
  });
  it('today: public replies, briefs and silences from the trace (UTC day), nothing from a desk, other listeners\' lines skipped', () => {
    const s = buildStatus(fixture().src);
    // two job A answers + the job E stage line are public replies today; the owner_private one is not
    expect(s.today).toEqual({ day: '2026-11-05', replies: 3, briefs: 1, silences: 2 });
  });
  it('recent answers: newest first, label as posted, scrubbed question, source label and link, a retracted one marked', () => {
    const s = buildStatus(fixture().src);
    expect(s.recent.map((r) => r.label)).toEqual(['🗂️ Parked for later', '📌 In the record', '📌 In the record']);
    expect(s.recent[0]).toMatchObject({ room: 'Riverside Events: try-context-keeper', withdrawn: true, source: { label: 'Sam, 2 Oct', url: null } });
    expect(s.recent[1].source).toEqual({ label: 'Ledgerly pilot plan › Decisions (Kash, 6 Oct)', url: 'https://github.com/o/context-keeper/blob/main/demo/ledgerly/docs/pilot-plan.md#2-decisions' });
    expect(s.recent[1].question).toContain("Why don't we run onboarding on Saturdays?");
    expect(s.recent[1].question).toContain('[email]');
    expect(s.recent[1].question).not.toMatch(/example\.com|kashif|https?:/);
  });
  it('ideas: newest change first, first name only, stage, issue link when done, desk ideas left out', () => {
    const s = buildStatus(fixture().src);
    expect(s.ideas.map((i) => [i.ref, i.stage, i.raiser])).toEqual([
      ['I2', 'Claude Code · waiting for an OK', 'Rowan'],
      ['I1', 'Done · signed off', 'Rowan'],
      ['I3', 'Noted · waiting for approval', 'Rowan'],
    ]);
    expect(s.ideas[1].issue_url).toBe('https://github.com/o/ledgerly-demo/issues/12');
    expect(s.ideas[0].issue_url).toBeNull();
    expect(s.ideas[0].idea).not.toContain('@example.com');
  });
  it('spend and Switch pieces', () => {
    const s = buildStatus(fixture().src);
    expect(s.spend).toEqual({ metered: true, usd: 1.23, cap_usd: 6, calls: 41, capped: false });
    expect(s.switch_pieces.map((p) => p.piece)).toEqual(['Rooms and the agent event stream', 'Bridges', 'Room documents and the Decision log', 'Claude Code, by targeted message', 'Switch Trust']);
    expect(s.switch_pieces[1].detail).toContain('Discord, Slack');
    expect(s.switch_pieces[3].detail).toContain('2 ideas handed off');
    const off = buildStatus({ ...fixture().src, spend: () => null, handoffFile: null, features: { jobE: false, voice: true } });
    expect(off.spend.metered).toBe(false);
    expect(off.ideas).toEqual([]);
    expect(off.switch_pieces[3]).toMatchObject({ in_use: false, detail: 'job E off' });
  });
  it('no trace or store yet: an empty page, not a crash', () => {
    const s = buildStatus({ ...fixture().src, traceFile: '/nonexistent/trace.jsonl', handoffFile: '/nonexistent/handoff.json', seedDir: '/nonexistent' });
    expect(s.today).toMatchObject({ replies: 0, silences: 0 });
    expect(s.recent).toEqual([]);
    expect(s.ideas).toEqual([]);
  });
});

describe('helpers', () => {
  it('scrub drops emails, links, handles, Slack tokens and raw ids, and clips', () => {
    expect(scrub('ask <@U123ABC> or @sam.k at sam@x.co: https://a.b/c sw_0123456789abcdef **now**')).toBe('ask or @someone at [email]: [link] now');
    expect(scrub('a '.repeat(200), 20).length).toBeLessThanOrEqual(20);
  });
  it('postLabel reads the bold label people saw; a desk-style "#3 · …" label is refused', () => {
    expect(postLabel('📌 **In the record** · yes')).toBe('📌 In the record');
    expect(postLabel('⚠️ **The record says otherwise** · no')).toBe('⚠️ The record says otherwise');
    expect(postLabel('🗳️ **#3 · Decision to confirm** · x')).toBeNull();
    expect(postLabel('Logged as decided: x')).toBeNull();
  });
  it('sourceOf keeps https links only', () => {
    expect(sourceOf('[Doc › Part](https://x.y/z#a) (6 Oct)')).toEqual({ label: 'Doc › Part (6 Oct)', url: 'https://x.y/z#a' });
    expect(sourceOf('[Doc](javascript:alert(1))')).toEqual({ label: 'Doc', url: null });
    expect(sourceOf(undefined)).toBeNull();
  });
  it('ideaStage covers every status', () => {
    expect(ideaStage({ status: 'handed_off', stage: 'building' })).toBe('Claude Code · building');
    expect(ideaStage({ status: 'awaiting_signoff' })).toBe('Done · waiting for sign-off');
    expect(ideaStage({ status: 'some_new_status' as any })).toBe('some new status');
  });
  it('the rate limiter allows 30 a minute per key, then resets', () => {
    let t = 0;
    const r = new RateLimiter(30, () => t);
    for (let i = 0; i < 30; i++) expect(r.allow('a')).toBe(true);
    expect(r.allow('a')).toBe(false);
    expect(r.allow('b')).toBe(true);
    t = 60_000;
    expect(r.allow('a')).toBe(true);
  });
});

describe('served by the tool server, over real HTTP on 127.0.0.1', () => {
  const f = fixture();
  let t = NOW.getTime();
  const page = new StatusPage(f.src, { clock: () => t });
  const started = startToolServer({ port: 0, secret: 's3cret', answer: () => whatsNew(null, null, 0, 0), status: page });
  afterAll(async () => (await started).server.close());
  const base = async () => `http://127.0.0.1:${(await started).port}`;
  const get = async (p: string, ip = '203.0.113.7') => fetch(`${await base()}${p}`, { headers: { 'cf-connecting-ip': ip } });

  it('GET /, /status: one static HTML page with the content, no scripts, refreshing every 60 s', async () => {
    for (const p of ['/', '/status', '/status?x=1']) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
      expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await r.text();
      expect(html).toContain('<title>Context Keeper · live</title>');
      expect(html).toContain('<meta http-equiv="refresh" content="60">');
      expect(html).not.toMatch(/<script/i);
      for (const s of ['Ledgerly: ledgerly-pilot', 'Riverside Events: try-context-keeper', 'Slack', 'Discord', 'I2', 'Claude Code · waiting for an OK', 'ledgerly-demo/issues/12', '📌 In the record', 'Ledgerly pilot plan › Decisions (Kash, 6 Oct)', '$1.23', '$6.00 daily cap', 'Switch Trust', 'withdrawn by the owner', 'prefers-color-scheme:dark']) expect(html).toContain(s);
    }
  });
  it('never shows desk content, private notes, ids, handles or emails, in the HTML or the JSON', async () => {
    const html = await (await get('/status')).text();
    const json = await (await get('/status.json')).text();
    for (const bad of FORBIDDEN) {
      expect(html, bad).not.toContain(bad);
      expect(json, bad).not.toContain(bad);
    }
  });
  it('GET /status.json: the snapshot shape', async () => {
    const r = await get('/status.json');
    expect(r.headers.get('content-type')).toContain('application/json');
    const j = await r.json();
    expect(Object.keys(j).sort()).toEqual(['generated_at', 'ideas', 'recent', 'rooms', 'schema', 'spend', 'switch_pieces', 'today', 'up_since']);
    expect(j.schema).toBe('ck.status/1');
    expect(j.up_since).toBe('2026-11-05T12:30:00.000Z');
    expect(Object.keys(j.rooms).sort()).toEqual(['listening_only', 'named', 'test_rooms']);
    expect(Object.keys(j.today).sort()).toEqual(['briefs', 'day', 'replies', 'silences']);
    expect(Object.keys(j.ideas[0]).sort()).toEqual(['changed_at', 'idea', 'issue_url', 'raiser', 'ref', 'stage']);
    expect(Object.keys(j.recent[0]).sort()).toEqual(['at', 'label', 'question', 'room', 'source', 'withdrawn']);
    expect(Object.keys(j.spend).sort()).toEqual(['calls', 'cap_usd', 'capped', 'metered', 'usd']);
    expect(j.recent.length).toBeLessThanOrEqual(8);
  });
  it('cached: a new trace line shows only after the cache window (45 s)', async () => {
    const before = (await (await get('/status.json', '198.51.100.1')).json()).today.silences;
    appendFileSync(f.trace, JSON.stringify({ schema: 'ck.trace/1', ts: '2026-11-05T13:00:00.000Z', decision_id: 'd-new', room_id: TEAM, room_name: 'Ledgerly: ledgerly-pilot', kind: 'silence', trigger: 'message', inputs: [], burst: null, items: [], posts: [], model: null, error: null }) + '\n');
    expect((await (await get('/status.json', '198.51.100.1')).json()).today.silences).toBe(before);
    t += 46_000;
    expect((await (await get('/status.json', '198.51.100.1')).json()).today.silences).toBe(before + 1);
  });
  it('30 requests a minute per IP (cf-connecting-ip through the tunnel), then 429; another IP is unaffected', async () => {
    t += 120_000;
    for (let i = 0; i < 30; i++) expect((await get('/status', '192.0.2.50')).status).toBe(200);
    const r = await get('/status', '192.0.2.50');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect((await get('/status', '192.0.2.51')).status).toBe(200);
    t += 60_000;
    expect((await get('/status', '192.0.2.50')).status).toBe(200);
  });
  it('the other routes are unchanged: health, whats_new needs its secret, unknown paths 404, POST / is not the page', async () => {
    expect((await fetch(`${await base()}/health`)).status).toBe(200);
    expect((await fetch(`${await base()}/voice/whats_new`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${await base()}/status/secret`)).status).toBe(404);
    expect((await fetch(`${await base()}/`, { method: 'POST', body: '{}' })).status).toBe(404);
  });
  it('without a status page the paths stay 404s', async () => {
    const s = await startToolServer({ port: 0, secret: 'x', answer: () => whatsNew(null, null, 0, 0) });
    try {
      expect((await fetch(`http://127.0.0.1:${s.port}/status`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${s.port}/`)).status).toBe(404);
    } finally { s.server.close(); }
  });
});
