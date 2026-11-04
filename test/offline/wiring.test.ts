// Wiring offline: what src/agent/main.ts now calls, end to end with fakes and no network.
//   job E   through the live adapter (liveHandoffSwitch over a fake Switch op()), driven the way the
//           listener drives it: noteNewIdeas after a job A decision, toHandoffMsg for every event, a
//           fake Claude Code reporting in the build room. Op arguments are checked against the live
//           server's ops listing (GET /agents/{id}/ops, read on 5 Nov).
//   voice   runBrief with VoiceLive's closing line and after-hook: talk link in the brief, the audio
//           clip in its thread on the same trace line, then the call summary on the next tick.
//   flags   on by default for the demo runner; the eval runner sets them off.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { featuresFromEnv, FEATURE_FLAGS } from '../../src/agent/features.ts';
import { HandleMemo, isAgentSender, noteNewIdeas, toHandoffMsg } from '../../src/agent/handoff/dispatch.ts';
import { handoffFromEnv } from '../../src/agent/handoff/wire.ts';
import { runBrief } from '../../src/agent/jobs/brief.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { handoffStep, readTrace, type TraceLine } from '../../src/shared/trace.ts';
import { resetAudio } from '../../src/voice/audio-brief.ts';
import type { Eleven, ElevenResponse } from '../../src/voice/eleven.ts';
import { VoiceLive } from '../../src/voice/live.ts';
import type { MediaUpload, SwitchMedia } from '../../src/voice/post-audio.ts';
import { FakeClaude, item, message, reviewerMessage, verdictMessage } from '../fake-claude.ts';
import { briefMessage, ctx, FakePoster, HAIKU, msg, OPUS, room, setup } from './jobs-fixture.ts';

// ---- the live op schemas (input_schema.properties / required, from GET /agents/{id}/ops) ----------
const OPS: Record<string, { props: string[]; required: string[] }> = {
  send_targeted_message: { props: ['body', 'target_names', 'target_roles', 'thread_id'], required: ['body'] },
  post_message: { props: ['body', 'thread_id'], required: ['body'] },
  connect_to_room: { props: ['room_id'], required: ['room_id'] },
  list_rooms: { props: ['include_archived'], required: [] },
  get_room_detail: { props: ['room_id'], required: ['room_id'] },
  add_users_to_room: { props: ['room_id', 'user_names'], required: ['room_id', 'user_names'] },
  create_room: {
    props: ['name', 'description', 'agent_names', 'user_names', 'channel_type', 'bridge_id', 'internal_only', 'admin_mode', 'security_config', 'instructions',
      'reference_ids', 'package_ids', 'linked_rooms', 'read_visibility', 'write_visibility', 'group_name', 'roles', 'include_subagents_for', 'join_event_listeners', 'aliases'],
    required: ['name', 'description', 'agent_names'],
  },
};

const OWNER = '@switch-slack-0b5e1c2a-1111-4222-8333-944445555666-owner_demo:localhost';
const ROWAN = '@switch-slack-0b5e1c2a-1111-4222-8333-944445555666-rowan_demo:localhost';
const SAM = '@switch-slack-0b5e1c2a-1111-4222-8333-944445555666-sam_demo:localhost';
const SELF = '@switch-agent-ck000001:localhost';
const CC = '@switch-agent-cc000002:localhost';
const PILOT = { id: 'room-pilot', name: 'ck-smoke-e-1105' };
const DESK = { id: 'room-desk', name: 'ck-owner-desk' };

/** A fake Switch behind op(): validates every call against the live schema, keeps rooms and posts. */
class FakeSwitchOps {
  calls: { room: string | null; name: string; args: Record<string, unknown> }[] = [];
  rooms = [{ room_id: PILOT.id, name: PILOT.name, archived: false }, { room_id: DESK.id, name: DESK.name, archived: false }];
  private n = 0;
  op = async (room: string | null, name: string, args: Record<string, unknown>): Promise<any> => {
    const s = OPS[name];
    if (!s) throw new Error(`${name}: 404 unknown op`);
    const extra = Object.keys(args).filter((k) => !s.props.includes(k));
    const missing = s.required.filter((k) => !(k in args));
    if (extra.length || missing.length) throw new Error(`${name}: 422 extra ${extra.join(',')} missing ${missing.join(',')}`);
    this.calls.push({ room, name, args });
    const id = () => `$ev${++this.n}`;
    switch (name) {
      case 'list_rooms': return { result: this.rooms };
      case 'get_room_detail': return { result: { id: args.room_id, bridge_id: 'bridge-slack', channel_type: 'channel_public' } };
      case 'create_room': { const r = { room_id: `room-build-${++this.n}`, name: String(args.name), archived: false }; this.rooms.push(r); return { result: { id: r.room_id, name: r.name, matrix_room_id: '!x', failed_attachments: [] } }; }
      case 'send_targeted_message': return { result: { event_id: id(), target_statuses: { 'claude-code': 'live' } } };
      case 'post_message': return { result: { event_id: id() } };
      default: return { result: {} };
    }
  };
  named(name: string) { return this.calls.filter((c) => c.name === name); }
}

let dir: string;
let traceFile: string;
const traces = (): TraceLine[] => (existsSync(traceFile) ? readTrace(readFileSync(traceFile, 'utf8')) : []);
const ENV_KEYS = ['CK_BUILD_ROOM', 'CK_HANDOFF_TIMEOUT_MIN', 'CK_HANDOFF_NUDGE_MIN', 'CK_HANDOFF_PROGRESS_MIN', 'CK_POST_ROOMS', 'CK_JOB_E', 'CK_AUDIO_BRIEF', 'CK_TALK_LINK', 'CK_FAULT', 'ELEVENLABS_AUDIO', 'CK_TALK_ROOM_LABEL'];
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ck-wiring-'));
  traceFile = join(dir, 'trace.jsonl');
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  resetAudio();
});
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

/** The listener's own setup, as in main.ts (allowed = CK_POST_ROOMS prefixes on the room's name). */
function listener(sw: FakeSwitchOps, prefixes = ['ck-smoke-']) {
  const names = new Map(sw.rooms.map((r) => [r.room_id, r.name]));
  const ownerPosts: string[] = [];
  const joined: string[] = [];
  const chain = handoffFromEnv({
    op: sw.op, selfSenders: new Set([SELF]),
    canPost: (id) => prefixes.some((p) => (names.get(id) ?? '').startsWith(p)),
    canCreate: (name) => prefixes.some((p) => name.startsWith(p)),
    onRoom: (r) => { names.set(r.id, r.name); joined.push(r.name); },
    owner: async (body) => { ownerPosts.push(body); return `$desk${ownerPosts.length}`; },
    ownerSender: OWNER, ownerUsername: 'owner_demo', ownerDeskRoom: DESK.id,
    file: join(dir, 'handoff.json'), traceFile,
  });
  // What onEvent does with each Switch message event.
  const handles = new HandleMemo();
  const event = async (roomId: string, m: { message_id: string; sender: string; sender_name: string; body: string; thread_id?: string | null }, who: string) => {
    handles.set(m.message_id, m.sender_name);
    const handled = await chain.onMessage(toHandoffMsg(roomId, names.get(roomId) ?? roomId, m, who, '2026-11-05T10:00:00Z'));
    return handled ? 'job E' : isAgentSender(m.sender) ? 'skipped (agent)' : 'jobs A-D';
  };
  return { chain, names, ownerPosts, joined, handles, event };
}

const newIdeaTrace = (messageId: string): TraceLine => ({
  schema: 'ck.trace/1', ts: '2026-11-05T09:59:00Z', decision_id: 'd-1', room_id: PILOT.id, room_name: PILOT.name, kind: 'reply', trigger: 'message',
  inputs: [], burst: null, posts: [], model: null, error: null,
  items: [{ message_id: messageId, job: 'A', verdict: 'new', restriction: null, clashes_with: null, sources: [{ ref: 'roadmap.md §2', quote: 'GoCardless goes live for pilot customers on 17 Nov.' }], decision_record: null, brief_for: null }],
});

describe('job E wired: the listener path over the live op() adapter', () => {
  it('new idea → approve → build room → one send_targeted_message {target_names, body} → Done → raiser signs off', async () => {
    process.env.CK_BUILD_ROOM = 'ck-smoke-build-1105';
    const sw = new FakeSwitchOps();
    const l = listener(sw);
    const idea = { message_id: '$idea', sender: ROWAN, sender_name: 'rowan_demo', body: 'What if the overdue reminder emails had a pay-now link?', thread_id: null };

    // 1. Rowan's message isn't job E's; job A decides "new"; run() then notes it for the owner.
    expect(await l.event(PILOT.id, idea, 'Rowan')).toBe('jobs A-D');
    const input = msg('$idea', idea.body, ROWAN, 'Rowan', { received_at: '2026-11-05T09:58:00Z' });
    expect(await noteNewIdeas(l.chain, PILOT.id, PILOT.name, [input], [{ trace: newIdeaTrace('$idea') }], l.handles)).toEqual(['I1']);
    expect(await noteNewIdeas(l.chain, PILOT.id, PILOT.name, [input], [{ trace: newIdeaTrace('$idea') }], l.handles)).toEqual(['I1']); // a retried decision doesn't add it twice
    expect(l.ownerPosts[0]).toMatch(/approve I1/);

    // 2. Desk chat that isn't an approval falls through to jobs B and D; the owner's approval is job E's.
    expect(await l.event(DESK.id, { message_id: '$d0', sender: OWNER, sender_name: 'owner_demo', body: 'yes, confirm that one' }, 'Kash')).toBe('jobs A-D');
    expect(await l.event(DESK.id, { message_id: '$d1', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1' }, 'Kash')).toBe('job E');

    // 3. The build room: created on the idea room's bridge with the owner and the raiser (handle from the event).
    const created = sw.named('create_room');
    expect(created).toHaveLength(1);
    expect(created[0].args).toMatchObject({ name: 'ck-smoke-build-1105', agent_names: ['context-keeper', 'claude-code'], user_names: ['owner_demo', 'rowan_demo'], bridge_id: 'bridge-slack', channel_type: 'channel_public', join_event_listeners: ['context-keeper'] });
    expect(l.joined).toEqual(['ck-smoke-build-1105']); // main.ts names, declares and connects it
    const build = sw.rooms.find((r) => r.name === 'ck-smoke-build-1105')!;

    // 4. Exactly one hand-off, with the live server's argument names; Switch adds the @claude-code.
    const t = sw.named('send_targeted_message');
    expect(t).toHaveLength(1);
    expect(Object.keys(t[0].args).sort()).toEqual(['body', 'target_names']);
    expect(t[0].args.target_names).toEqual(['claude-code']);
    expect(t[0].args.body).toMatch(/^\*\*Hand-off I1\*\*/);
    expect(t[0].args.body).not.toMatch(/@claude-code/);
    expect(t[0].room).toBe(build.room_id);
    const announce = sw.named('post_message').find((c) => c.room === PILOT.id)!;
    expect(announce.args).toEqual({ thread_id: '$idea', body: "✅ **Approved** by Kash · waiting for Claude Code to start building it in #ck-smoke-build-1105. I'll post each step here for Rowan." });

    // 4b. Claude Code's "On it" (what reached the agent live on 4 Nov) → the raiser sees it start, once.
    for (const id of ['$on', '$on2']) expect(await l.event(build.room_id, { message_id: id, sender: CC, sender_name: 'claude-code', body: 'On it: I1 (pay-now link). This will be an issue.' }, 'claude-code')).toBe('job E');
    const building = sw.named('post_message').filter((c) => c.room === PILOT.id && String(c.args.body).startsWith('🔨'));
    expect(building.map((c) => c.args)).toEqual([{ thread_id: '$idea', body: '🔨 **Building** · Claude Code has started on it in #ck-smoke-build-1105.' }]);

    // 5. Claude Code reports in the build room; people chatting there are job E's too (never job A).
    expect(await l.event(build.room_id, { message_id: '$cc1', sender: CC, sender_name: 'claude-code', body: 'Done I1: https://github.com/thekashifnazir/ledgerly-demo/issues/7' }, 'claude-code')).toBe('job E');
    expect(await l.event(build.room_id, { message_id: '$p1', sender: SAM, sender_name: 'sam_demo', body: 'nice' }, 'Sam')).toBe('job E');
    const ask = sw.named('post_message').filter((c) => c.room === PILOT.id).at(-1)!;
    expect(ask.args.body).toMatch(/issues\/7/);
    expect(ask.args.thread_id).toBe('$idea');

    // 6. Sam can't sign it off: he's told who can, once, in the thread (job E's); his other chat goes on to job A. Rowan can.
    expect(await l.event(PILOT.id, { message_id: '$s0', sender: SAM, sender_name: 'sam_demo', body: 'nice work', thread_id: '$idea' }, 'Sam')).toBe('jobs A-D');
    expect(await l.event(PILOT.id, { message_id: '$s1', sender: SAM, sender_name: 'sam_demo', body: 'looks right', thread_id: '$idea' }, 'Sam')).toBe('job E');
    const told = sw.named('post_message').filter((c) => c.room === PILOT.id).at(-1)!;
    expect(told.args).toEqual({ thread_id: '$idea', body: 'Thanks, Sam. Only Rowan, who raised it, or Kash can sign this off.' });
    expect(await l.event(PILOT.id, { message_id: '$r1', sender: ROWAN, sender_name: 'rowan_demo', body: 'looks right', thread_id: '$idea' }, 'Rowan')).toBe('job E');
    expect(l.chain.store.byRef('I1')!.status).toBe('signed_off');

    // 7. Another agent's post outside a build room never reaches job A.
    expect(await l.event(PILOT.id, { message_id: '$x', sender: CC, sender_name: 'claude-code', body: 'What if we added a dark mode?' }, 'claude-code')).toBe('skipped (agent)');

    const ts = traces().filter((x) => x.handoff);
    expect(ts.map((x) => handoffStep(x))).toEqual(['noted', 'approved', 'build_room_created', 'context_posted', 'handed_off', 'announced', 'building', 'progress', 'signoff_requested', 'build_room_chat', 'signoff_ignored', 'signoff_not_theirs', 'signed_off']);
    expect(ts.find((x) => x.handoff!.step === 'handed_off')!.handoff).toMatchObject({ ref: 'I1', status: 'handed_off', target_status: 'live', build_room: { id: build.room_id, name: 'ck-smoke-build-1105' } });
    for (const x of ts) for (const it of x.items) expect(it.job).toBe('E');
  });

  it('a build room outside CK_POST_ROOMS stops the chain: nothing created, handed off or announced; fixed + restart picks it up', async () => {
    const sw = new FakeSwitchOps();
    const l = listener(sw); // CK_BUILD_ROOM unset: ledgerly-build, not in CK_POST_ROOMS
    await l.chain.noteIdea(toHandoffMsg(PILOT.id, PILOT.name, { message_id: '$i', sender: ROWAN, sender_name: 'rowan_demo', body: 'An idea' }, 'Rowan', '2026-11-05T09:00:00Z'));
    await l.event(DESK.id, { message_id: '$d', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1' }, 'Kash');
    expect(sw.named('create_room')).toHaveLength(0);
    expect(sw.named('send_targeted_message')).toHaveLength(0);
    expect(sw.named('post_message')).toHaveLength(0); // the original thread is never told it's being built
    expect(l.chain.store.byRef('I1')!.status).toBe('stalled');
    expect(l.ownerPosts.at(-1)).toMatch(/isn't in CK_POST_ROOMS.*CK_BUILD_ROOM/);
    await l.chain.tick(); // not retried on a timer
    expect(sw.named('create_room')).toHaveLength(0);

    // An existing room by that name that we can't post in (a real #ledgerly-build) is dry-run too.
    sw.rooms.push({ room_id: 'room-real-build', name: 'ledgerly-build', archived: false });
    await l.event(DESK.id, { message_id: '$d2', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1 again' }, 'Kash');
    expect(sw.named('send_targeted_message')).toHaveLength(0);
    expect(sw.named('post_message')).toHaveLength(0);

    process.env.CK_BUILD_ROOM = 'ck-smoke-build-1105';
    const after = listener(sw);
    await after.chain.resume();
    expect(sw.named('create_room')).toHaveLength(1);
    expect(sw.named('send_targeted_message')).toHaveLength(1);
    expect(after.chain.store.byRef('I1')!.status).toBe('handed_off');
  });

  it('CK_HANDOFF_NUDGE_MIN backstop: one owner nudge from tick(); no timer line for the raiser (CK_HANDOFF_PROGRESS_MIN is gone)', async () => {
    process.env.CK_BUILD_ROOM = 'ck-smoke-build-1105';
    process.env.CK_HANDOFF_NUDGE_MIN = '0.00001';
    process.env.CK_HANDOFF_PROGRESS_MIN = '0.00002'; // left in an old .env: ignored
    const sw = new FakeSwitchOps();
    const l = listener(sw);
    await l.chain.noteIdea(toHandoffMsg(PILOT.id, PILOT.name, { message_id: '$i', sender: ROWAN, sender_name: 'rowan_demo', body: 'An idea' }, 'Rowan', '2026-11-05T09:00:00Z'));
    await l.event(DESK.id, { message_id: '$d', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1' }, 'Kash');
    await new Promise((r) => setTimeout(r, 10));
    await l.chain.tick();
    await l.chain.tick();
    expect(l.ownerPosts.filter((b) => b.includes('your OK'))).toEqual(['**I1 · May need your OK** · no result from Claude Code after 1 min. If a card is waiting, open its thread under the hand-off in #ck-smoke-build-1105 and click Allow once.']);
    const thread = sw.named('post_message').filter((c) => c.room === PILOT.id).map((c) => String(c.args.body));
    expect(thread).toEqual(["✅ **Approved** by Kash · waiting for Claude Code to start building it in #ck-smoke-build-1105. I'll post each step here for Rowan."]);
  });

  it('a restart (a second chain on the same state file) resumes without a second hand-off', async () => {
    process.env.CK_BUILD_ROOM = 'ck-smoke-build-1105';
    const sw = new FakeSwitchOps();
    const a = listener(sw);
    await a.chain.noteIdea(toHandoffMsg(PILOT.id, PILOT.name, { message_id: '$i', sender: ROWAN, sender_name: 'rowan_demo', body: 'An idea' }, 'Rowan', '2026-11-05T09:00:00Z'));
    await a.event(DESK.id, { message_id: '$d', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1' }, 'Kash');
    const b = listener(sw);
    await b.chain.resume();
    await b.event(DESK.id, { message_id: '$d', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1' }, 'Kash'); // the same event replayed after the restart
    expect(sw.named('send_targeted_message')).toHaveLength(1);
  });
});

// ---- job A → job E: which ideas reach the owner's list ------------------------------------------------

describe('job A → job E: a related idea with a new part is noted too (Kash, 4 Nov)', () => {
  const idea = msg('m-oh', 'What if pilot support had a weekly office hour?', ROWAN, 'Rowan');
  /** Job A decides one message with a cited might-be-related (or other) verdict; run() then calls noteNewIdeas. */
  async function decideAndNote(over: Record<string, unknown>, cite = [{ blockId: 'pilot-plan.md §3.1' }], extraCalls: { model: string; respond: any }[] = []) {
    process.env.CK_BUILD_ROOM = 'ck-smoke-build-1105';
    const t = setup('ck-wiring-a2e-'); // fresh agent state each time (a processed message is never decided again)
    const sw = new FakeSwitchOps();
    const l = listener(sw);
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [item('m-oh', over)], cite) }, ...extraCalls]);
    const poster = new FakePoster();
    const r = await decide(t.deps(claude, poster), PILOT.id, PILOT.name, ctx, [idea]);
    claude.done();
    const refs = await noteNewIdeas(l.chain, PILOT.id, PILOT.name, [idea], [r], l.handles);
    return { sw, l, r, refs, poster };
  }
  const related = "Priya runs onboarding calls and pilot support. Nothing in the record says whether there's a weekly office hour, so that part is still open.";

  it('might-be-related + new_part + a verified source → on the desk list, "builds on <ref>: <new part>"; the reply says it\'s logged; the hand-off quotes the part and the cited context', async () => {
    const { l, r, refs, poster, sw } = await decideAndNote({ verdict: 'might-be-related', reply: related, new_part: 'a weekly office hour for pilot support.' });
    expect(r.trace!.items[0].new_part).toBe('a weekly office hour for pilot support');
    // a bold label, the reply, the quote with its source, then code's own line for the new part (said once)
    const lines = poster.pub()[0].body.split('\n');
    expect(lines[0]).toBe(`🔎 **Related** · ${related}`);
    expect(lines[1]).toMatch(/^> .+ — pilot-plan\.md §3/);
    expect(lines.at(-1)).toBe('💡 **Logged as a new idea** · a weekly office hour for pilot support');
    expect(poster.pub()[0].body.match(/weekly office hour/g)).toHaveLength(2); // the reply's "whether" sentence + the line
    expect(refs).toEqual(['I1']);
    expect(l.ownerPosts[0].split('\n')[0]).toBe('**I1 · New idea from Rowan** · #ck-smoke-e-1105, 4 Nov');
    expect(l.ownerPosts[0].split('\n')[2]).toBe('Builds on pilot-plan.md §3. New part: a weekly office hour for pilot support');
    expect(l.chain.store.byRef('I1')!.builds_on).toEqual(['pilot-plan.md §3']);
    expect(l.chain.store.byRef('I1')!.new_part).toBe('a weekly office hour for pilot support');
    await l.event(DESK.id, { message_id: '$d', sender: OWNER, sender_name: 'owner_demo', body: 'approve I1' }, 'Kash');
    const body = String(sw.named('send_targeted_message')[0].args.body);
    expect(body).toContain('**New part** (the record already has pilot-plan.md §3):\n> a weekly office hour for pilot support');
    expect(body).toContain('**Context from the record:**\npilot-plan.md §3:\n> Priya: onboarding calls and pilot support.');
  });

  it('the live pay-now reply (says the part is open, no "logged" wording) is noted once job A names the new part', async () => {
    const { refs } = await decideAndNote({ verdict: 'might-be-related', reply: 'Nothing in the record says whether the reminder emails carry a pay-now link, so that part is still open.', new_part: 'a pay-now link in the reminder emails' });
    expect(refs).toEqual(['I1']);
  });

  it('might-be-related without a new part ("" or "none") stays off the list, and its reply is left alone', async () => {
    for (const new_part of ['', 'none']) {
      const { refs, l, r, poster } = await decideAndNote({ verdict: 'might-be-related', reply: related, new_part });
      expect(r.trace!.items[0].new_part).toBeNull();
      expect(poster.pub()[0].body.split('\n')[0]).toBe(`🔎 **Related** · ${related}`);
      expect(poster.pub()[0].body).not.toContain('Logged as a new idea');
      expect(refs).toEqual([]);
      expect(l.ownerPosts).toEqual([]);
    }
  });

  it('a new part with no source that passes the quote gate: silence, not noted', async () => {
    const { refs, r } = await decideAndNote({ verdict: 'might-be-related', reply: related, new_part: 'a weekly office hour' }, [{ blockId: 'pilot-plan.md §3.1', text: 'words that are not in the record' }]);
    expect(r.trace!.items[0].verdict).toBeNull();
    expect(refs).toEqual([]);
  });

  it("a covered verdict the reviewer drops to might-be-related isn't job A's own call: not noted, even with a new part", async () => {
    const { refs, r, poster } = await decideAndNote(
      { verdict: 'covered', reply: 'Priya runs pilot support.', new_part: 'a weekly office hour' },
      [{ blockId: 'pilot-plan.md §3.1' }],
      [{ model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'm-oh', supports: false, issue: 'different thing' }]) }],
    );
    expect(r.trace!.items[0].verdict).toBe('might-be-related');
    expect(r.trace!.items[0].new_part).toBeNull();
    expect(poster.pub()[0].body).not.toContain('logged');
    expect(refs).toEqual([]);
  });

  it('a new idea is noted as before, with no "builds on" (a stray new_part is ignored)', async () => {
    const { refs, l, r } = await decideAndNote({ verdict: 'new', reply: "Thanks, Rowan: I've logged it as a new idea.", new_part: 'office hours' }, []);
    expect(r.trace!.items[0].new_part).toBeNull();
    expect(refs).toEqual(['I1']);
    expect(l.ownerPosts[0].split('\n')[0]).toBe('**I1 · New idea from Rowan** · #ck-smoke-e-1105, 4 Nov');
    expect(l.ownerPosts[0]).not.toContain('Builds on');
    expect(l.chain.store.byRef('I1')!.builds_on).toBeUndefined();
  });

  it('CK_ANNOUNCE_NEW=0: no "logged" line in the reply, but the idea still reaches the desk', async () => {
    process.env.CK_ANNOUNCE_NEW = '0';
    try {
      const { refs, poster } = await decideAndNote({ verdict: 'might-be-related', reply: related, new_part: 'a weekly office hour' });
      expect(poster.pub()[0].body.split('\n')[0]).toBe(`🔎 **Related** · ${related}`);
      expect(poster.pub()[0].body).not.toContain('Logged as a new idea');
      expect(refs).toEqual(['I1']);
    } finally { delete process.env.CK_ANNOUNCE_NEW; }
  });
});

// ---- voice ---------------------------------------------------------------------------------------

function fakeMp3(frames: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}
const json = (v: unknown): ElevenResponse => ({ status: 200, headers: new Headers(), bytes: Buffer.from(JSON.stringify(v)), json: () => v });

class FakeEleven implements Eleven {
  calls: { method: string; path: string; body: any }[] = [];
  callStart = 0; // unix seconds of the finished call the conversations list returns (0 = none)
  ttsFails = false;
  async request(method: string, path: string, body?: unknown): Promise<ElevenResponse> {
    this.calls.push({ method, path, body });
    if (method === 'PATCH' && path.startsWith('/v1/convai/agents/')) return json({});
    if (path.startsWith('/v1/text-to-speech/')) {
      if (this.ttsFails) throw new Error('ElevenLabs POST /v1/text-to-speech: 500 boom');
      return { status: 200, headers: new Headers({ 'character-cost': '700' }), bytes: fakeMp3(2000), json: () => null };
    }
    if (path.startsWith('/v1/convai/conversations?')) return json({ conversations: this.callStart ? [{ conversation_id: 'conv_1', status: 'done', start_time_unix_secs: this.callStart }] : [] });
    if (path === '/v1/convai/conversations/conv_1') return json({
      transcript: [{ role: 'agent', message: 'Hi Alex.', time_in_call_secs: 0 }, { role: 'user', message: 'What did I miss on the pilot size?', time_in_call_secs: 4 }, { role: 'agent', message: 'Three agencies, Kash decided.', time_in_call_secs: 9 }],
      metadata: { start_time_unix_secs: this.callStart, call_duration_secs: 95, cost: 300 },
      conversation_initiation_client_data: { dynamic_variables: { caller_name: 'Alex' } },
    });
    throw new Error(`FakeEleven: unexpected ${method} ${path}`);
  }
}
class FakeMedia implements SwitchMedia {
  uploads: MediaUpload[] = [];
  async postMedia(up: MediaUpload) { this.uploads.push(up); return `$audio${this.uploads.length}`; }
}

const ALEX = '@switch-slack-conn-alex:localhost';
const goodLines = [
  { kind: 'decided', text: 'The pilot runs with three agencies, 25 clients each (Kash decided: support is Priya plus Kash).', block: 'pilot-plan.md §2 D2', quote: 'Three agencies, max 25 clients each' },
  { kind: 'talk_to', text: 'Priya runs onboarding calls and pilot support.', block: 'pilot-plan.md §3.1', quote: 'Priya: onboarding calls and pilot support.' },
];
const words = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? 'Alex' : 'word')).join(' ') + '.';
const summaryMessage = () => message(OPUS, [{ type: 'text', text: JSON.stringify({ asked_about: ['The pilot size.'], didnt_know: [], new_ideas: [] }) }]);

describe('voice wired: talk link in the brief, audio clip on its trace line, call summary afterwards', () => {
  const ROOM = 'ck-smoke-c';
  const clock = new Date('2026-11-05T10:00:00Z');

  function voiceSetup(over: { audio?: boolean; talk?: boolean; agentId?: string | null } = {}) {
    const t = setup('ck-wiring-voice-');
    const idsFile = join(t.dir, 'voice-ids.json');
    if (over.agentId !== null) writeFileSync(idsFile, JSON.stringify({ agent_id: over.agentId ?? 'agent_test' }));
    const el = new FakeEleven();
    const media = new FakeMedia();
    const poster = new FakePoster();
    return { t, el, media, poster, idsFile, make: (claude: FakeClaude) => {
      const deps = t.deps(claude, poster);
      const v = new VoiceLive({ claude, el, media: () => media, poster, state: deps.state, audio: over.audio ?? true, talk: over.talk ?? true, idsFile, callsFile: join(t.dir, 'voice-calls.json'), traceFile: t.traceFile, now: () => clock });
      return { deps, v };
    } };
  }

  /** What main.ts does for a joiner's first message. */
  async function brief(v: VoiceLive, deps: ReturnType<ReturnType<typeof setup>['deps']>, input = msg('a1', 'Hi all! Why not run the pilot with five agencies?', ALEX, 'Alex', { received_at: '2026-11-04T10:00:00Z' })) {
    const talk = await v.talkClosing(room, ROOM, 'Alex');
    return runBrief(deps, 'room1', ROOM, ctx, input, { kind: 'joiner', since: null }, {
      ...(talk ? { closing: talk.closing } : {}),
      after: ({ threadId, briefText }) => v.afterBrief({ roomId: 'room1', roomName: ROOM, threadId, messageId: input.message_id, person: 'Alex', since: null, briefText, talk: talk?.talk ?? null }),
    });
  }

  it('posts the brief with a per-person talk link, then the clip in the same thread; one trace line carries both', async () => {
    const s = voiceSetup();
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage(goodLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
      { model: OPUS, respond: message(OPUS, [{ type: 'text', text: words(140) }]) }, // the spoken script
    ]);
    const { deps, v } = s.make(claude);
    const line = await brief(v, deps);
    claude.done();

    // the agent's prompt was refreshed from the room's record before the link went out
    const patch = s.el.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/v1/convai/agents/agent_test');
    expect(patch.body.conversation_config.agent.prompt.prompt).toContain('Three agencies, max 25 clients each');

    const text = s.poster.pub()[0];
    expect(text.thread).toBe('a1');
    const link = new URL(text.body.match(/https:\/\/elevenlabs\.io\/\S+/)![0]);
    expect(link.searchParams.get('agent_id')).toBe('agent_test');
    expect(link.searchParams.get('var_caller_name')).toBe('Alex');
    expect(text.body).toMatch(/Want to talk it through\?/);
    expect(text.body).not.toMatch(/will be offered here soon/);

    expect(s.media.uploads).toHaveLength(1);
    expect(s.media.uploads[0]).toMatchObject({ roomId: 'room1', threadId: 'a1', filename: 'catch-up-alex.mp3' });
    expect(line.kind).toBe('brief');
    expect(line.posts.map((p) => [p.route, p.thread_id])).toEqual([['public_thread', 'a1'], ['public_thread', 'a1']]);
    expect(line.posts[1].body).toMatch(/^\[audio catch-up-alex\.mp3\]/);
    expect(line.model!.calls).toBe(3); // brief, reviewer, spoken script
    expect(s.t.traces()).toHaveLength(1);
    expect(v.watches).toHaveLength(1);
  });

  it('after the call: the next tick posts its summary in the brief thread, once, with its own trace line', async () => {
    const s = voiceSetup({ audio: false });
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage(goodLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
      { model: OPUS, respond: summaryMessage() },
    ]);
    const { deps, v } = s.make(claude);
    await brief(v, deps);
    expect(await v.tick()).toEqual([]); // no call yet
    s.el.callStart = clock.getTime() / 1000 + 120;
    const [line] = await v.tick();
    claude.done();
    const post = s.poster.pub().at(-1)!;
    expect(post.thread).toBe('a1');
    expect(post.body).toMatch(/Alex talked it through \(2 min call\)/);
    expect(post.body).toMatch(/The pilot size\./);
    expect(line).toMatchObject({ kind: 'reply', room_name: ROOM });
    expect(line.items[0]).toMatchObject({ message_id: 'a1', job: 'none', brief_for: 'Alex' });
    expect(line.error).toMatch(/talk_call conv_1/);
    expect(await v.tick()).toEqual([]); // summarised once; the watch is closed
    expect(s.media.uploads).toHaveLength(0); // CK_AUDIO_BRIEF off: no clip
  });

  it('fails quiet: a TTS error leaves the text brief as it was; no talk agent id means the usual closing', async () => {
    const s = voiceSetup({ agentId: null });
    s.el.ttsFails = true;
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage(goodLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
      { model: OPUS, respond: message(OPUS, [{ type: 'text', text: words(140) }]) },
    ]);
    const { deps, v } = s.make(claude);
    const line = await brief(v, deps);
    expect(s.el.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(s.poster.pub()).toHaveLength(1);
    expect(s.poster.pub()[0].body).toMatch(/will be offered here soon/);
    expect(line.posts).toHaveLength(1);
    expect(line.error).toMatch(/audio_failed: .*500/);
    expect(v.watches).toHaveLength(0);
  });

  it('a room outside CK_POST_ROOMS gets no clip upload (made, not posted, and said so on the line)', async () => {
    process.env.CK_POST_ROOMS = 'ck-eval-';
    const s = voiceSetup({ talk: false });
    const claude = new FakeClaude([
      { model: OPUS, respond: briefMessage(goodLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
      { model: OPUS, respond: message(OPUS, [{ type: 'text', text: words(140) }]) },
    ]);
    const { deps, v } = s.make(claude);
    const line = await brief(v, deps);
    expect(s.media.uploads).toHaveLength(0);
    expect(line.error).toMatch(/audio not posted/);
  });
});

describe('flags', () => {
  it('on by default for the demo runner; 0/off turns each off', () => {
    expect(featuresFromEnv()).toEqual({ jobE: true, audioBrief: true, talkLink: true });
    process.env.CK_JOB_E = '0'; process.env.CK_AUDIO_BRIEF = 'off'; process.env.CK_TALK_LINK = 'false';
    expect(featuresFromEnv()).toEqual({ jobE: false, audioBrief: false, talkLink: false });
  });
  it('the eval runner starts the agent with each flag "0" unless the eval sets it', () => {
    const src = readFileSync(join(import.meta.dirname, '../../eval/replay.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('CK_JOB_E'))!;
    for (const k of Object.values(FEATURE_FLAGS)) expect(line).toContain(`'${k}'`);
    expect(line).toContain("process.env[k] || '0'");
    expect(src).toMatch(/env: \{ \.\.\.process\.env, \.\.\.features, \.\.\.extra/);
  });
});
