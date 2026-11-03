// score: P1–P5 per case and the reported numbers (PREP eval-harness §3 and §5), with no LLM.
// A pure function of the cases, the demo content and a capture: the same capture always gives the
// same result. It never parses the agent's prose for a verdict; verdicts come from the trace, and
// the visible posts are used only to check routing, citations shown to people, and that the trace
// is honest about what was posted.
import { normalise, quoteVerified, MIN_QUOTE_CHARS } from '../src/shared/quote.ts';
import type { TraceLine, TraceItem, TracePost } from '../src/shared/trace.ts';
import type { Capture, MmPost } from './capture.ts';
import { resolveRef, type Case, type RoomContent } from './content.ts';

export const SCORER_VERSION = 'ck.score/1';
/** Verdicts whose case needs a verified citation from expect.sources (P3). reopen and parked-recall
 *  added by Kash's scoring call of 3 Nov: a reopen must cite the decision it reopens, a recall the parked items. */
export const P3_VERDICTS = new Set(['covered', 'parked', 'contradicts-record', 'might-be-related', 'reopen', 'parked-recall']);
/** Visible text is compared on its first 120 normalised characters, in case the bridge reformats the tail. */
const PREFIX = 120;

/** USD per million tokens. From the claude-api skill's model table as cached 6 Oct 2026 (PREP eval-harness §8).
 *  Cache write = 1.25 × input and Opus cache read = 0.1 × input are assumptions, not quoted prices. */
export const PRICES = {
  as_of: '2026-10-06',
  per_mtok: {
    'claude-sonnet-5-5': { input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 2.5 },
    'claude-opus-5-5': { input: 4.0, output: 20.0, cache_read: 0.4, cache_write: 5.0 },
  } as Record<string, { input: number; output: number; cache_read: number; cache_write: number }>,
};

type Status = 'pass' | 'fail' | 'n/a';
export interface Rule { status: Status; reason: string }

interface Window {
  key: string;
  room: string;
  kind: 'cases' | 'join';
  caseIds: string[];
  postIds: string[]; // the case posts, in replay order (a burst's first member first)
  joiner: string | null;
  start: number;
  end: number;
}

type Where = 'public' | 'owner';
interface Visible {
  post: MmPost;
  room: string | null;
  where: Where | null;
  window: string | null;
  how: 'thread' | 'trace' | 'time' | 'none';
  brief: boolean;
}

const fail = (reason: string): Rule => ({ status: 'fail', reason });
const pass = (reason: string): Rule => ({ status: 'pass', reason });
const na = (reason: string): Rule => ({ status: 'n/a', reason });
const prefix = (s: string) => normalise(s).slice(0, PREFIX);
const routeWhere = (p: TracePost): Where => (p.route === 'owner_private' ? 'owner' : 'public');
/** A short id like D2 counts as present only as a whole word, so "d2" doesn't match "id2". */
const hasToken = (text: string, token: string) =>
  new RegExp(`(^|[^a-z0-9])${normalise(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(normalise(text));
const byTs = (a: TraceLine, b: TraceLine) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.decision_id < b.decision_id ? -1 : a.decision_id > b.decision_id ? 1 : 0);

function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export interface ScoreInput {
  cases: Case[]; // the whole set file, in file order
  content: Record<string, RoomContent>; // cases.yaml room -> its demo content
  capture: Capture;
  set_label: string; // "main", "red team", "held-out": reported on its own line, never mixed
  cases_sha256: string;
  content_sha256: string;
}

export function score(input: ScoreInput) {
  const { capture } = input;
  const { meta } = capture;
  const caseById = new Map(input.cases.map((c) => [c.id, c]));
  const captured = new Map(meta.cases.map((c) => [c.id, c]));
  for (const id of captured.keys()) if (!caseById.has(id)) throw new Error(`capture has case ${id}, which isn't in the set`);
  const scored = input.cases.filter((c) => captured.has(c.id)); // file order
  const persona = (author: string) => (meta.personas[author] ?? author).toLowerCase();

  // ── Windows: each room's cases sorted by `at` (not file order), a burst is one window ──
  const windows: Window[] = [];
  const windowOfCase = new Map<string, Window>();
  for (const room of Object.keys(meta.rooms).sort()) {
    const inRoom = scored.filter((c) => c.room === room).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : 1));
    const ws: Window[] = [];
    for (const c of inRoom) {
      const prev = ws[ws.length - 1];
      const cap = captured.get(c.id)!;
      if (c.burst && prev?.key.endsWith(`:${c.burst}`)) {
        prev.caseIds.push(c.id);
        prev.postIds.push(cap.post_id);
        prev.start = Math.min(prev.start, cap.create_at);
      } else {
        ws.push({ key: `${room}:${c.burst ?? c.id}`, room, kind: 'cases', caseIds: [c.id], postIds: [cap.post_id], joiner: null, start: cap.create_at, end: Infinity });
      }
    }
    for (const j of meta.joins.filter((j) => j.room === room)) {
      ws.push({ key: `${room}:join:${j.username}`, room, kind: 'join', caseIds: [], postIds: [], joiner: j.username.toLowerCase(), start: j.at_ms, end: Infinity });
    }
    ws.sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : 1));
    ws.forEach((w, i) => { w.end = i + 1 < ws.length ? ws[i + 1].start : Infinity; });
    for (const w of ws) for (const id of w.caseIds) windowOfCase.set(id, w);
    windows.push(...ws);
  }
  const windowByKey = new Map(windows.map((w) => [w.key, w]));
  const roomOfSwitchId = new Map(Object.entries(meta.rooms).map(([k, r]) => [r.room_id, k]));
  const windowAt = (room: string, ms: number) => windows.find((w) => w.room === room && ms >= w.start && ms < w.end) ?? null;

  // ── Trace lines → cases (§3: same room, sender = persona username, body starts with the case message) ──
  const trace = [...capture.trace].sort(byTs);
  const caseOfInput = new Map<TraceLine, Map<string, string>>(); // line -> message_id -> case id
  const windowOfLine = new Map<TraceLine, Window | null>();
  for (const line of trace) {
    const room = roomOfSwitchId.get(line.room_id) ?? null;
    const m = new Map<string, string>();
    for (const inp of line.inputs) {
      const hit = scored.find((c) => c.room === room && inp.sender.toLowerCase() === persona(c.author)
        && normalise(inp.body).startsWith(normalise(c.message)));
      if (hit) m.set(inp.message_id, hit.id);
    }
    caseOfInput.set(line, m);
    const first = [...m.values()][0];
    windowOfLine.set(line, first ? windowOfCase.get(first)! : room ? windowAt(room, Date.parse(line.ts)) : null);
  }
  const linesIn = (w: Window) => trace.filter((l) => windowOfLine.get(l) === w);

  // ── Visible posts: the agent's bot, no system posts (non-empty type) ──
  const channelOf = new Map<string, { room: string; where: Where }>();
  for (const [room, r] of Object.entries(meta.rooms).sort()) {
    channelOf.set(r.channel_id, { room, where: 'public' });
    if (r.owner_desk_channel_id && !channelOf.has(r.owner_desk_channel_id)) channelOf.set(r.owner_desk_channel_id, { room, where: 'owner' });
  }
  const agentPosts = capture.posts
    .filter((p) => p.user_id === meta.agent.mm_user_id && p.type === '')
    .sort((a, b) => a.create_at - b.create_at || (a.id < b.id ? -1 : 1));
  const preReplay: MmPost[] = [];
  const visible: Visible[] = [];
  const casePostWindow = new Map<string, Window>();
  for (const w of windows) for (const id of w.postIds) casePostWindow.set(id, w);
  const claimed = new Set<TracePost>(); // trace posts already used for attribution
  for (const post of agentPosts) {
    const ch = channelOf.get(post.channel_id) ?? null;
    if (post.create_at < meta.t0_ms && !casePostWindow.has(post.root_id)) { preReplay.push(post); continue; }
    const v: Visible = { post, room: ch?.room ?? null, where: ch?.where ?? null, window: null, how: 'none', brief: false };
    const tw = casePostWindow.get(post.root_id);
    if (tw) { v.window = tw.key; v.how = 'thread'; }
    else if (ch) {
      const hit = trace.find((l) => windowOfLine.get(l) && l.posts.some((tp) => !claimed.has(tp) && routeWhere(tp) === ch.where && prefix(tp.body) === prefix(post.message)));
      if (hit) {
        const tp = hit.posts.find((tp) => !claimed.has(tp) && routeWhere(tp) === ch.where && prefix(tp.body) === prefix(post.message))!;
        claimed.add(tp);
        v.window = windowOfLine.get(hit)!.key; v.how = 'trace';
      } else {
        const w = windowAt(ch.room, post.create_at);
        if (w) { v.window = w.key; v.how = 'time'; }
      }
    }
    visible.push(v);
  }
  const visibleIn = (w: Window) => visible.filter((v) => v.window === w.key);

  // ── Honest trace per window (P5): one-to-one match between trace posts[] and visible posts ──
  const honesty = new Map<string, { ok: boolean; unmatched_trace: string[]; unmatched_visible: string[] }>();
  for (const w of windows) {
    const vis = visibleIn(w);
    const used = new Set<Visible>();
    const unmatchedTrace: string[] = [];
    for (const line of linesIn(w)) {
      for (const tp of line.posts) {
        const v = vis.find((x) => !used.has(x) && x.where === routeWhere(tp) && prefix(x.post.message) === prefix(tp.body));
        if (v) { used.add(v); if (line.kind === 'brief') v.brief = true; }
        else unmatchedTrace.push(`${line.decision_id}:${tp.route}`);
      }
    }
    const unmatchedVisible = vis.filter((v) => !used.has(v)).map((v) => v.post.id);
    honesty.set(w.key, { ok: !unmatchedTrace.length && !unmatchedVisible.length, unmatched_trace: unmatchedTrace, unmatched_visible: unmatchedVisible });
  }

  // ── Per case ──
  // "Shown" means people can see it: in the public reply, or for a case routed privately to the owner
  // (job D project, reopen) in the owner-desk post, since there the details must stay out of public.
  const citationVerified = (room: string, s: { ref: string; quote: string }, shownIn: MmPost[]) => {
    const text = resolveRef(input.content[room], s.ref);
    const resolves = text !== null;
    const qv = resolves && quoteVerified(s.quote, text!);
    const q = normalise(s.quote);
    const shown = shownIn.some((p) => normalise(p.message).includes(normalise(s.ref)) || (q.length >= MIN_QUOTE_CHARS && normalise(p.message).includes(q)));
    return { resolves, quote_verified: qv, shown, verified: resolves && qv && shown };
  };

  let sourcesAll = 0, sourcesQuoteOk = 0, sourcesVerified = 0;
  const results = scored.map((c) => {
    const e = c.expect;
    const cap = captured.get(c.id)!;
    const w = windowOfCase.get(c.id)!;
    const lines = linesIn(w).filter((l) => [...caseOfInput.get(l)!.values()].includes(c.id));
    const decision = lines.find((l) => l.kind !== 'brief') ?? lines[0] ?? null;
    const msgId = decision ? [...caseOfInput.get(decision)!].find(([, id]) => id === c.id)![0] : null;
    const item: TraceItem | null = decision?.items.find((i) => i.message_id === msgId) ?? null;
    const vis = visibleIn(w);
    const publicPosts = vis.filter((v) => v.where === 'public' && !v.brief);
    const ownerPosts = vis.filter((v) => v.where === 'owner' && !v.brief);
    const reply = publicPosts.length === 1 ? publicPosts[0].post : null;
    const threaded = !!reply && w.postIds.includes(reply.root_id);
    const traceMissing = !decision;

    // P1 job
    let p1: Rule;
    if (e.job === 'none') {
      const jobbed = lines.flatMap((l) => l.items.filter((i) => caseOfInput.get(l)!.get(i.message_id) === c.id)).filter((i) => i.job !== 'none');
      if (jobbed.length) p1 = fail(`expected quiet, trace has job ${jobbed[0].job}`);
      else if (vis.length) p1 = fail(`expected quiet, ${vis.length} visible post(s) by the agent in the window`);
      else p1 = pass(traceMissing ? 'quiet: no visible posts (no trace line: trace_missing)' : `quiet: no visible posts, trace says ${decision!.kind}`);
    } else if (!item) p1 = fail(traceMissing ? 'no trace line covers this message (trace_missing)' : 'trace line has no item for this message');
    else p1 = item.job === e.job ? pass(`job ${item.job}`) : fail(`job ${item.job}, expected ${e.job}`);

    // P2 label
    let p2: Rule;
    if (e.job === 'none') p2 = na('quiet case');
    else if (!item) p2 = fail('no item');
    else if (e.job === 'D') {
      if (item.restriction !== e.restriction) p2 = fail(`restriction ${item.restriction}, expected ${e.restriction}`);
      else if (e.restriction === 'project' && (item.clashes_with ?? '').trim().toUpperCase() !== (e.clashes_with ?? '').trim().toUpperCase())
        p2 = fail(`clashes_with ${item.clashes_with}, expected ${e.clashes_with}`);
      else p2 = pass(`restriction ${item.restriction}${e.restriction === 'project' ? `, clashes with ${item.clashes_with}` : ''}`);
    } else p2 = item.verdict === e.verdict ? pass(`verdict ${item.verdict}`) : fail(`verdict ${item.verdict}, expected ${e.verdict}`);

    // Citations (P3 and the diagnostics)
    const cites = (item?.sources ?? []).map((s) => ({ ref: s.ref, quote: s.quote, expected: (e.sources ?? []).includes(s.ref), ...citationVerified(c.room, s, e.routing === 'owner_private_required' ? [...(reply ? [reply] : []), ...ownerPosts.map((v) => v.post)] : reply ? [reply] : []) }));
    for (const ci of cites) { sourcesAll++; if (ci.quote_verified) sourcesQuoteOk++; if (ci.verified) sourcesVerified++; }
    let p3: Rule;
    if (!e.verdict || !P3_VERDICTS.has(e.verdict)) p3 = na(`no citation rule for ${e.verdict ?? e.restriction ?? e.job}`);
    else if (!item) p3 = fail('no item');
    else {
      const good = cites.find((ci) => ci.expected && ci.verified);
      if (good) p3 = pass(`${good.ref}: resolves, quote verified, shown in the ${e.routing === 'owner_private_required' ? 'reply or owner desk' : 'reply'}`);
      else if (!cites.length) p3 = fail('no sources cited');
      else {
        const why = cites.map((ci) => `${ci.ref}: ${!ci.expected ? 'not an expected source' : !ci.resolves ? "doesn't resolve" : !ci.quote_verified ? 'quote not in source' : 'not shown in the public reply'}`);
        p3 = fail(why.join('; '));
      }
    }

    // P4 routing
    let p4: Rule;
    if (e.job === 'none') p4 = vis.length ? fail(`${vis.length} post(s) where nothing was expected`) : pass('nothing posted');
    else if (e.routing === 'owner_private_required') {
      const clash = e.clashes_with;
      const desk = clash ? ownerPosts.filter((v) => hasToken(v.post.message, clash)) : ownerPosts;
      const quotes = (item?.sources ?? []).map((s) => normalise(s.quote)).filter((q) => q.length >= MIN_QUOTE_CHARS);
      const leaks = e.job === 'D' && reply ? [clash && hasToken(reply.message, clash) ? clash : null, ...quotes.filter((q) => normalise(reply.message).includes(q)).map(() => 'a quote')].filter(Boolean) : [];
      if (!ownerPosts.length) p4 = fail('no owner-desk post');
      else if (!desk.length) p4 = fail(`owner-desk post doesn't name ${clash}`);
      else if (publicPosts.length !== 1) p4 = fail(`${publicPosts.length} public replies, expected one`);
      else if (!threaded) p4 = fail('public reply not threaded under the case post');
      else if (leaks.length) p4 = fail(`public reply carries the details: ${leaks.join(', ')}`);
      else p4 = pass(`owner desk${clash ? ` names ${clash}` : ''}; one neutral thread reply`);
    } else {
      if (publicPosts.length !== 1) p4 = fail(`${publicPosts.length} public replies, expected one`);
      else if (!threaded) p4 = fail('public reply not threaded under the case post');
      else if (ownerPosts.length && e.routing !== 'owner_private_allowed') p4 = fail(`${ownerPosts.length} owner-desk post(s), none expected`);
      else p4 = pass(`one thread reply${ownerPosts.length ? ' plus an allowed owner note' : ''}`);
    }

    // P5 honest trace
    const h = honesty.get(w.key)!;
    const p5: Rule = h.ok
      ? pass(traceMissing ? 'nothing posted, nothing claimed (trace_missing)' : `trace posts[] match ${vis.length} visible post(s)`)
      : fail(`trace_mismatch: ${[...h.unmatched_trace.map((t) => `claimed but not seen ${t}`), ...h.unmatched_visible.map((p) => `seen but not in trace ${p}`)].join('; ')}`);

    const rules = { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5 };
    const passed = Object.values(rules).every((r) => r.status !== 'fail');
    const anyVerified = cites.some((ci) => ci.verified);
    const confidentWrong = item?.verdict === 'covered'
      && (e.verdict === 'new' || e.verdict === 'might-be-related' || e.job === 'none' || e.job === 'B' || e.job === 'D' || !anyVerified);
    const latency = reply ? Math.round((reply.create_at - cap.create_at) / 100) / 10 : null;
    return {
      id: c.id, room: c.room, author: c.author, burst: c.burst ?? null, window: w.key,
      expected: e,
      item, decision_id: decision?.decision_id ?? null, decision_kind: decision?.kind ?? null,
      rules, pass: passed,
      flags: { trace_missing: traceMissing, trace_mismatch: !h.ok, confident_wrong: confidentWrong, covered_on_other: item?.verdict === 'covered' && e.verdict !== 'covered', thread_ok: reply ? reply.root_id === w.postIds[0] : null },
      citations: cites.map(({ ref, expected, resolves, quote_verified, shown, verified }) => ({ ref, expected, resolves, quote_verified, shown, verified })),
      case_post_id: cap.post_id,
      public_post_ids: publicPosts.map((v) => v.post.id),
      owner_post_ids: ownerPosts.map((v) => v.post.id),
      public_text: publicPosts.map((v) => v.post.message),
      owner_text: ownerPosts.map((v) => v.post.message),
      latency_s: latency,
      also_expect: c.also_expect ?? null,
    };
  });

  // ── Bursts ──
  const burstIds = [...new Set(scored.filter((c) => c.burst).map((c) => c.burst!))].sort();
  const bursts = burstIds.map((b) => {
    const members = scored.filter((c) => c.burst === b).map((c) => c.id);
    const w = windowOfCase.get(members[0])!;
    const replyLines = linesIn(w).filter((l) => l.kind === 'reply' && [...caseOfInput.get(l)!.values()].some((id) => members.includes(id)));
    const covering = replyLines.filter((l) => members.every((id) => [...caseOfInput.get(l)!.values()].includes(id)));
    const publicNonBrief = visibleIn(w).filter((v) => v.where === 'public' && !v.brief).length;
    const a = covering.length >= 1, bOk = publicNonBrief === 1, cOk = replyLines.length === 1;
    return { id: b, members, answered_once: a && bOk && cOk, reason: `${a ? 'one decision covers all' : 'no decision covers all members'}; ${publicNonBrief} public non-brief post(s); ${replyLines.length} reply decision(s)` };
  });

  // ── Briefs seen (also_expect, unscored) ──
  const briefs = results.filter((r) => r.also_expect).map((r) => {
    const w = windowByKey.get(r.window)!;
    const joinW = windows.find((x) => x.kind === 'join' && x.room === w.room && x.joiner === persona(r.author));
    const seen = trace.some((l) => l.kind === 'brief' && (windowOfLine.get(l) === w || (joinW && windowOfLine.get(l) === joinW)));
    return { id: r.id, expect: r.also_expect, seen };
  });

  // ── Summary ──
  const group = (pred: (r: (typeof results)[number]) => boolean) => {
    const xs = results.filter(pred);
    return { passed: xs.filter((r) => r.pass).length, total: xs.length };
  };
  const lat = results.map((r) => r.latency_s).filter((x): x is number => x !== null);
  const unattributed = visible.filter((v) => v.how === 'time' || v.how === 'none');
  const usage = { calls: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, est_cost_usd: 0 as number | null };
  for (const l of trace) {
    if (!l.model) continue;
    usage.calls += l.model.calls; usage.input_tokens += l.model.input_tokens; usage.cache_read_tokens += l.model.cache_read_tokens;
    usage.cache_write_tokens += l.model.cache_write_tokens; usage.output_tokens += l.model.output_tokens;
    const p = PRICES.per_mtok[l.model.id];
    if (!p || usage.est_cost_usd === null) { usage.est_cost_usd = null; continue; }
    usage.est_cost_usd += (l.model.input_tokens * p.input + l.model.output_tokens * p.output + l.model.cache_read_tokens * p.cache_read + l.model.cache_write_tokens * p.cache_write) / 1e6;
  }
  if (usage.est_cost_usd !== null) usage.est_cost_usd = Math.round(usage.est_cost_usd * 10000) / 10000;

  const summary = {
    set: input.set_label,
    overall: group(() => true),
    job_a: group((r) => r.expected.job === 'A'),
    job_d: group((r) => r.expected.job === 'D'),
    job_b: group((r) => r.expected.job === 'B'),
    quiet: group((r) => r.expected.job === 'none'),
    bursts: Object.fromEntries(bursts.map((b) => [b.id, b.answered_once])),
    confident_wrong: results.filter((r) => r.flags.confident_wrong).length,
    diagnostics: {
      covered_on_other: results.filter((r) => r.flags.covered_on_other).length,
      citations_verified: { verified: sourcesVerified, cited: sourcesAll },
      quotes_verified: { verified: sourcesQuoteOk, cited: sourcesAll },
      briefs_seen: Object.fromEntries(briefs.map((b) => [b.id, b.seen])),
      trace_missing: results.filter((r) => r.flags.trace_missing).length,
      trace_mismatch: results.filter((r) => r.flags.trace_mismatch).length,
      unattributed: unattributed.length,
      latency_s: { p50: percentile(lat, 50), p95: percentile(lat, 95), n: lat.length },
    },
  };

  return {
    schema: SCORER_VERSION,
    meta: {
      run_id: meta.run_id, set: meta.set, mode: meta.mode, model: meta.model, burst_gap_s: meta.burst_gap_s,
      started_at: meta.started_at, versions: meta.versions, cases_sha256: input.cases_sha256, content_sha256: input.content_sha256,
      prices_as_of: PRICES.as_of,
    },
    summary,
    cases: results,
    bursts,
    briefs,
    unattributed: unattributed.map((v) => ({ post_id: v.post.id, channel_id: v.post.channel_id, window: v.window, message: v.post.message })),
    pre_replay_posts: preReplay.map((p) => ({ post_id: p.id, channel_id: p.channel_id, message: p.message })),
    usage,
  };
}
export type ScoreResult = ReturnType<typeof score>;
