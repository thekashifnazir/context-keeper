// robustness: the pass/fail checks of PREP eval-harness §10b (R1–R8), judged from what a scripted live
// run captured: the agent's ck.trace/1 lines, every Mattermost post in the room and its owner desk, the
// harness's own marks (when it killed, stopped or restarted the agent) and the agent's log. Pure: the
// live driver is eval/robustness-live.ts; eval/robustness.test.ts runs these on hand-made captures.
// Separate from the accuracy score. Every run is written, failures included.
import { normalise } from '../src/shared/quote.ts';
import type { TraceLine } from '../src/shared/trace.ts';
import type { MmRawPost } from './mattermost.ts';
import { priceOf } from './score.ts';

export type RStatus = 'pass' | 'fail' | 'error';
export interface RResult {
  id: string; // R1 … R8, R7a / R7b
  title: string;
  how: string; // what the harness did
  pass_when: string; // the bar, as checked (adapted where the design changed)
  adapted: string | null; // why the check differs from the plan's table, if it does
  status: RStatus;
  evidence: string[];
}

/** One scenario's capture. `cases` are the harness's own posts, keyed by a label (T05, L1, …). */
export interface RCapture {
  bot: string; // the agent's Mattermost user id
  agentName: string;
  channel: string;
  desk: string | null;
  trace: TraceLine[];
  posts: MmRawPost[]; // the room's channel and its owner desk, threads included
  cases: Record<string, { post_id: string; create_at: number; body: string; channel?: string }>;
  marks: Record<string, number>; // ms timestamps the harness noted (killed_at, started_at, …)
  agentLog: string;
}

const iso = (ms: number | undefined) => (ms === undefined || !Number.isFinite(ms) ? '?' : new Date(ms).toISOString().slice(11, 19));
const short = (s: string, n = 90) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export const agentPosts = (c: RCapture) => c.posts.filter((p) => p.user_id === c.bot && !p.delete_at && !p.type);
export const inThread = (c: RCapture, label: string) => agentPosts(c).filter((p) => p.root_id === c.cases[label]?.post_id);
const deskPosts = (c: RCapture) => agentPosts(c).filter((p) => c.desk && p.channel_id === c.desk);
const isBrief = (p: { message: string }) => /^👋/u.test(p.message.trim());
const publicPosts = (l: TraceLine) => l.posts.filter((p) => p.route !== 'owner_private');
/** Trace lines whose inputs include this case's message (inputs carry the full body as posted). */
export function linesFor(c: RCapture, label: string, opts: { briefs?: boolean } = {}): TraceLine[] {
  const body = c.cases[label]?.body;
  if (!body) return [];
  const n = normalise(body);
  return c.trace.filter((l) => (opts.briefs || l.kind !== 'brief') && l.inputs.some((i) => normalise(i.body).startsWith(n)));
}
const verdictOf = (l: TraceLine) => l.items.map((i) => `${i.job}/${i.verdict ?? '-'}`).join(',');

function result(base: Omit<RResult, 'status' | 'evidence'>, checks: [boolean, string][], extra: string[] = []): RResult {
  const failed = checks.filter(([ok]) => !ok);
  return { ...base, status: failed.length ? 'fail' : 'pass', evidence: [...checks.map(([ok, s]) => `${ok ? 'ok' : 'FAIL'}: ${s}`), ...extra] };
}

/** R2 restart mid-burst: burst B1 (labels), the agent killed after the first message was queued. */
export function checkR2(c: RCapture, labels: string[]): RResult {
  const decided = [...new Set(labels.flatMap((l) => linesFor(c, l)))];
  const replying = decided.filter((l) => publicPosts(l).length);
  const combined = replying.length === 1 && labels.every((lb) => linesFor(c, lb).includes(replying[0]));
  const threads = new Set(labels.map((l) => c.cases[l]?.post_id));
  const replies = agentPosts(c).filter((p) => p.channel_id === c.channel && threads.has(p.root_id) && !isBrief(p));
  const bodies = agentPosts(c).map((p) => normalise(p.message));
  const dups = bodies.filter((b, i) => bodies.indexOf(b) !== i);
  const briefs = agentPosts(c).filter((p) => p.channel_id === c.channel && isBrief(p));
  const briefLines = c.trace.filter((l) => l.kind === 'brief' && publicPosts(l).length);
  const where = replies[0] ? labels.find((l) => c.cases[l]?.post_id === replies[0].root_id) ?? 'another thread' : 'none';
  return result({
    id: 'R2', title: 'Restart mid-burst',
    how: `post burst B1 (${labels.join(', ')}); SIGKILL the agent once ${labels[0]} is in its saved burst queue; restart it at once; the rest of B1 is posted on schedule`,
    pass_when: 'exactly one combined reply; no duplicate posts; the returner brief appears once',
    adapted: null,
  }, [
    [combined, `${replying.length} decision line(s) with a public post for B1; ${combined ? `one covering all ${labels.length} (${verdictOf(replying[0])})` : decided.map((l) => `${l.kind} on ${l.inputs.length} input(s)`).join('; ') || 'none'}`],
    [replies.length === 1, `${replies.length} agent reply post(s) in B1's threads (landed in ${where}'s thread)`],
    [dups.length === 0, dups.length ? `duplicate agent posts: ${dups.map((d) => `"${short(d, 50)}"`).join(', ')}` : `no duplicate agent posts (${bodies.length} in all)`],
    [briefs.length === 1 && briefLines.length === 1, `returner brief: ${briefs.length} post(s) in the channel, ${briefLines.length} brief trace line(s)`],
  ], [`queued ${iso(c.marks.queued_at)}, killed ${iso(c.marks.killed_at)}, restarted ${iso(c.marks.started_at)}, connected ${iso(c.marks.connected_at)}`,
    ...(/re-queued \d+ message/.test(c.agentLog) ? [`agent log: "${c.agentLog.match(/re-queued \d+ message\(s\)[^\n]*/)![0]}"`] : ['agent log: no "re-queued" line'])]);
}

/** R3 own posts ignored: no trace input is one of the agent's own posts (by event id, body or sender). */
export function checkR3(c: RCapture): RResult {
  const ownIds = new Set(c.trace.flatMap((l) => l.posts.map((p) => p.event_id)).filter((x): x is string => !!x));
  const ownBodies = new Set(agentPosts(c).map((p) => normalise(p.message)).filter(Boolean));
  const inputs = c.trace.flatMap((l) => l.inputs);
  const bad = inputs.filter((i) => ownIds.has(i.message_id) || ownBodies.has(normalise(i.body)) || i.sender.toLowerCase() === c.agentName.toLowerCase());
  return result({
    id: 'R3', title: 'Own posts ignored',
    how: 'the R4–R8 room: T05, T08 and T12 replayed, with owner-desk notes, replies and restarts in between; every trace input checked',
    pass_when: "no trace input is one of the agent's own posts (by Switch event id, body or sender)",
    adapted: null,
  }, [
    [agentPosts(c).length > 0 && inputs.length > 0, `${agentPosts(c).length} agent post(s) to ignore, ${inputs.length} trace input(s) in ${c.trace.length} line(s)`],
    [bad.length === 0, bad.length ? `own post(s) taken as input: ${bad.map((i) => `${i.message_id} "${short(i.body, 50)}"`).join('; ')}` : 'no trace input is an agent post'],
  ]);
}

/** R4 fail quiet: CK_FAULT=model_500 on the first model call, then T05. */
export function checkR4(c: RCapture, label: string, expectVerdict: string): RResult {
  const lines = linesFor(c, label).sort((a, b) => a.ts.localeCompare(b.ts));
  const first = lines[0];
  const retry = lines.find((l) => l !== first && l.kind === 'reply');
  const notes = deskPosts(c).filter((p) => /^Couldn't check this one/.test(p.message));
  const pub = inThread(c, label).filter((p) => p.channel_id === c.channel);
  const firstPub = pub[0];
  const gotVerdict = retry?.items.find((i) => i.job !== 'none')?.verdict ?? null;
  return result({
    id: 'R4', title: 'Fail quiet',
    how: `agent started with CK_FAULT=model_500 (CK_FAULT_TIMES=1: the first model call fails with a 500), then ${label} posted`,
    pass_when: `no public post until the retry; one owner-desk "couldn't check this one" note; the retry after 60 s posts the right reply (${expectVerdict})`,
    adapted: null,
  }, [
    [!!first && first.kind === 'owner_note' && /model_500/.test(first.error ?? '') && !publicPosts(first).length, first ? `first decision: ${first.kind}, error "${short(first.error ?? '', 70)}"` : 'no decision line'],
    [notes.length === 1, `${notes.length} "Couldn't check this one" note(s) in the owner desk`],
    [!!firstPub && notes.length > 0 && firstPub.create_at - notes[0].create_at >= 55_000, firstPub ? `first public post ${((firstPub.create_at - (notes[0]?.create_at ?? firstPub.create_at)) / 1000).toFixed(0)} s after the desk note` : 'no public post'],
    [!!retry && gotVerdict === expectVerdict, retry ? `retry: ${retry.kind}, verdict ${gotVerdict} (expected ${expectVerdict}), sources ${retry.items.flatMap((i) => i.sources.map((s) => s.ref)).join(', ') || 'none'}` : 'no retry reply'],
  ]);
}

/** R5 retract: the owner replies "wrong" in the thread of the agent's reply. */
export function checkR5(c: RCapture, label: string, missesBefore: number, missesAfter: number): RResult {
  const at = c.marks.wrong_at ?? Infinity;
  const after = inThread(c, label).filter((p) => p.create_at > at);
  const wrongLines = linesFor(c, 'WRONG');
  const retracted = c.trace.some((l) => /retract/i.test(`${l.kind} ${l.error ?? ''} ${JSON.stringify(l.items)}`));
  return result({
    id: 'R5', title: 'Retract',
    how: `after ${label}'s reply, the owner (kash) replies "${c.cases.WRONG?.body ?? 'wrong'}" in that thread`,
    pass_when: 'a correction appears in that thread; the trace item is retracted; testset/misses.yaml gains an entry',
    adapted: null,
  }, [
    [after.length > 0, after.length ? `agent posted in the thread after "wrong": "${short(after[0].message, 80)}"` : 'no agent post in the thread after "wrong"'],
    [retracted, retracted ? 'a trace line records a retraction' : `no trace line records a retraction (the owner's message: ${wrongLines.map((l) => `${l.kind} ${verdictOf(l)}`).join('; ') || 'no decision line'})`],
    [missesAfter > missesBefore, `testset/misses.yaml entries: ${missesBefore} before, ${missesAfter} after`],
  ]);
}

/** R6 pending items survive: T12's clash note, a restart, then the owner's ruling in the desk. */
export function checkR6(c: RCapture, label: string): RResult {
  const restart = c.marks.restarted_at ?? 0;
  const answer = c.marks.answer_at ?? Infinity;
  const note = deskPosts(c).find((p) => /Clash to rule on/.test(p.message) && p.create_at > (c.cases[label]?.create_at ?? 0));
  const before = inThread(c, label).filter((p) => p.create_at < restart);
  const ruling = inThread(c, label).filter((p) => p.create_at > answer);
  return result({
    id: 'R6', title: 'Pending items survive',
    how: `${label} posted (a clash: owner-desk note + neutral thread line); the agent restarted (SIGTERM, start) before the owner answers; the owner then replies "${c.cases.ANSWER?.body ?? ''}" in the desk note's thread`,
    pass_when: "the owner's answer is posted back in T12's thread after the restart",
    adapted: null,
  }, [
    [!!note && note.create_at < restart, note ? `desk note ${iso(note.create_at)}, before the restart at ${iso(restart)}` : 'no clash note in the owner desk'],
    [before.length > 0, `${before.length} agent post(s) in ${label}'s thread before the restart${before[0] ? `: "${short(before[0].message, 60)}"` : ''}`],
    [ruling.length === 1 && /Update from/.test(ruling[0].message), ruling.length ? `after the answer (${iso(answer)}): "${short(ruling[0].message, 80)}"${ruling.length > 1 ? ` and ${ruling.length - 1} more` : ''}` : 'nothing posted in the thread after the answer'],
  ]);
}

/** R7 (adapted) demo limits: one person, CK_DEMO_PER_PERSON_HOUR=limit, messages one at a time. */
export function checkR7a(c: RCapture, labels: string[], limit: number, limitLine: string): RResult {
  let replied = 0;
  const checks: [boolean, string][] = [];
  let gated = 0;
  for (const lb of labels) {
    const posts = inThread(c, lb);
    const decided = linesFor(c, lb);
    if (replied < limit) {
      checks.push([decided.length > 0 && !posts.some((p) => p.message === limitLine), `${lb}: decided (${decided.map((l) => `${l.kind} ${verdictOf(l)}`).join('; ') || 'no decision line'}), ${posts.length} reply post(s)`]);
      if (posts.length) replied += 1;
    } else {
      gated += 1;
      const want = gated === 1 ? [limitLine] : [];
      checks.push([decided.length === 0 && JSON.stringify(posts.map((p) => p.message)) === JSON.stringify(want), `${lb}: ${decided.length} decision line(s); thread ${posts.length ? posts.map((p) => `"${short(p.message, 60)}"`).join(', ') : 'silent'} (want ${gated === 1 ? 'the limit line once' : 'silence'})`]);
    }
  }
  const told = (c.agentLog.match(/demo_limit: [^\n]*\(told once\)/g) ?? []).length;
  const silent = (c.agentLog.match(/demo_limit: [^\n]*\(silent\)/g) ?? []).length;
  checks.push([gated > 0, `${gated} message(s) arrived over the limit`]);
  checks.push([told === Math.min(1, gated) && silent === Math.max(0, gated - 1), `agent log: ${told} "told once" and ${silent} "silent" demo_limit line(s): every gated message was seen and kept in the room's record, none dropped unseen`]);
  return result({
    id: 'R7a', title: 'Caps → per-person demo limit',
    how: `the room is a demo room (CK_DEMO_ROOMS), CK_DEMO_PER_PERSON_HOUR=${limit}; one person posts ${labels.length} eligible cases one at a time`,
    pass_when: `the first ${limit} replied messages are answered; the next gets the limit line once; later ones get silence; each gated message is still seen`,
    adapted: 'CK_CAPS (3 posts per room, a batched owner-desk note for the rest) no longer exists. The current design caps per person in public demo rooms (src/agent/demo.ts): one limit line, then silence, no owner note; so this checks that instead.',
  }, checks);
}

/** R7 (adapted) daily spend cap: a tiny CK_DAILY_SPEND_CAP_USD, three messages. */
export function checkR7b(c: RCapture, labels: string[], pausedLine: string): RResult {
  const desk = deskPosts(c);
  const warn = desk.filter((p) => /Spend at 80%/.test(p.message));
  const capped = desk.filter((p) => /Daily spend cap reached/.test(p.message));
  const capAt = capped[0]?.create_at ?? Infinity;
  const [q1, q2, ...rest] = labels;
  const replies = (lb: string) => inThread(c, lb).filter((p) => p.channel_id === c.channel);
  const later = c.trace.filter((l) => l.model && Date.parse(l.ts) > capAt);
  return result({
    id: 'R7b', title: 'Caps → daily spend cap',
    how: `the room is a demo room; CK_DAILY_SPEND_CAP_USD=${c.marks.cap_usd ?? '?'} (below one decision's cost); ${labels.length} messages from one person`,
    pass_when: 'the owner desk gets the 80% note and the cap note once each; nothing public for the message whose call crossed the cap; the room gets the paused line once; later messages get silence and no model call',
    adapted: 'CK_CAPS no longer exists; the spend cap (src/agent/spend.ts) is the current global limit, so this checks it alongside R7a.',
  }, [
    [warn.length === 1 && capped.length === 1, `owner desk: ${warn.length} "Spend at 80%" and ${capped.length} "Daily spend cap reached" note(s)`],
    [replies(q1).length === 0, `${q1}: ${replies(q1).length} public post(s)`],
    [JSON.stringify(replies(q2).map((p) => p.message)) === JSON.stringify([pausedLine]), `${q2}: ${replies(q2).map((p) => `"${short(p.message, 50)}"`).join(', ') || 'silent'} (want the paused line once)`],
    [rest.every((lb) => replies(lb).length === 0), `${rest.join(', ')}: ${rest.map((lb) => replies(lb).length).join(', ')} public post(s)`],
    [later.length === 0, `${later.length} trace line(s) with a model call after the cap note`],
  ]);
}

/** R8 missed while down: the agent stopped, T08 posted, the agent started again. */
export function checkR8(c: RCapture, label: string): RResult {
  const posted = c.cases[label]?.create_at ?? 0;
  const stopped = c.marks.stopped_at ?? Infinity;
  const started = c.marks.started_at ?? 0;
  const replies = inThread(c, label).filter((p) => p.channel_id === c.channel);
  const lines = linesFor(c, label);
  const late = replies.some((p) => /\b(late|missed|while I was (down|away|offline))\b/i.test(p.message));
  return result({
    id: 'R8', title: 'Missed while down',
    how: `agent stopped (SIGTERM), ${label} posted, agent started again ~10 s later`,
    pass_when: `${label} gets its reply after the restart (resumed from the saved stream position), once`,
    adapted: 'The plan also says "marked late". The agent has no late marker (nothing in src/agent labels a resumed reply), so that part is reported, not scored.',
  }, [
    [posted > stopped && posted < started, `${label} posted ${iso(posted)}, while the agent was down (${iso(stopped)}–${iso(started)})`],
    [replies.length === 1 && replies[0].create_at > started, replies.length ? `${replies.length} reply post(s), first at ${iso(replies[0].create_at)} (${((replies[0].create_at - posted) / 1000).toFixed(0)} s after the post)` : 'no reply'],
    [lines.length === 1 && lines[0].kind === 'reply', `${lines.length} decision line(s): ${lines.map((l) => `${l.kind} ${verdictOf(l)}`).join('; ') || 'none'}`],
  ], [`marked late: ${late ? 'yes' : 'no (not built)'}`]);
}

/** Model spend from trace lines (upper bound per line, as the scorer prices it). Calls that never reached
 *  a trace line (killed mid-flight, replaced prefetches, cap-refused decisions) aren't in it. */
export function traceCost(trace: TraceLine[]): { calls: number; usd: number | null } {
  let calls = 0;
  let usd: number | null = 0;
  for (const l of trace) {
    if (!l.model) continue;
    calls += l.model.calls;
    const p = priceOf(l.model.id);
    if (!p || usd === null) { usd = null; continue; }
    usd += (l.model.input_tokens * p.input + l.model.output_tokens * p.output + l.model.cache_read_tokens * p.cache_read + l.model.cache_write_tokens * p.cache_write) / 1e6;
  }
  return { calls, usd: usd === null ? null : Math.round(usd * 10000) / 10000 };
}

export interface RobustnessReport {
  schema: 'ck.robustness/1';
  run_id: string;
  model: string | null;
  reviewer_model: string | null;
  started_at: string;
  ended_at: string;
  results: RResult[];
  cost: { trace_usd: number | null; trace_calls: number; metered_usd: number | null; metered_calls: number; note: string };
  incidents: string[];
  versions: { sha: string | null; switch: string | null; mattermost: string | null };
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function robustnessMarkdown(r: RobustnessReport, jsonRel: string): string {
  const passed = r.results.filter((x) => x.status === 'pass').length;
  const lines = [
    `### Robustness checks (eval-harness §10b): ${passed}/${r.results.length} pass`,
    '',
    `Run \`${r.run_id}\`, ${r.model ?? 'unknown model'} (reviewer ${r.reviewer_model ?? 'default'}), ${r.started_at.slice(0, 16).replace('T', ' ')} UTC. Full evidence: \`${jsonRel}\`.`,
    '',
    '| # | Check | Result | Evidence |',
    '|---|---|---|---|',
    ...r.results.map((x) => `| ${x.id} | ${cell(x.title)}${x.adapted ? ' (adapted)' : ''} | ${x.status === 'pass' ? '✅ pass' : x.status === 'fail' ? '❌ fail' : '⚠️ error'} | ${cell(x.evidence.filter((e) => e.startsWith('FAIL')).slice(0, 2).join('; ') || x.evidence[x.evidence.length - 1] || '')} |`),
    '',
    `Model spend: ${r.cost.metered_usd !== null ? `$${r.cost.metered_usd.toFixed(4)} metered (${r.cost.metered_calls} calls)` : 'not metered'}; $${r.cost.trace_usd?.toFixed(4) ?? '?'} from trace lines (${r.cost.trace_calls} calls). ${r.cost.note}`,
    '',
  ];
  for (const x of r.results.filter((y) => y.adapted)) lines.push(`- **${x.id} adapted:** ${x.adapted}`);
  if (r.incidents.length) lines.push('', '**Incidents:**', ...r.incidents.map((i) => `- ${i}`));
  return lines.join('\n') + '\n';
}

export function robustnessFactRows(r: RobustnessReport, command: string, commit: string | null, rel: string): string[] {
  const ts = new Date().toISOString();
  const passed = r.results.filter((x) => x.status === 'pass').length;
  const rows: [string, string][] = [
    [`Robustness checks passed, ${r.run_id} (${rel})`, `${passed}/${r.results.length}`],
    ...r.results.map((x): [string, string] => [`Robustness ${x.id} ${x.title}, ${r.run_id}`, x.status]),
    [`Robustness model spend in USD (est., metered), ${r.run_id}`, r.cost.metered_usd === null ? 'n/a' : r.cost.metered_usd.toFixed(4)],
  ];
  return rows.map(([claim, value]) => `| ${cell(claim)} | ${cell(value)} | \`${cell(command)}\` | ${commit ? commit.slice(0, 7) + (commit.endsWith('+changes') ? '+changes' : '') : 'unknown'} | ${ts} |`);
}
