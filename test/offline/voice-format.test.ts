// Kash's notes after the 4 Nov cloud voice call, offline: the short "talk it through" link and its
// redirect, the brief's scannable layout, a calmer voice, "just finished a call" before the summary,
// and the people named in "needs confirming" tagged. Fake ElevenLabs, fake Claude, a real HTTP server
// on 127.0.0.1 for the redirect. No network beyond loopback, no cost.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { briefOpening, runBrief, TALK_IT_THROUGH } from '../../src/agent/jobs/brief.ts';
import type { Eleven, ElevenResponse } from '../../src/voice/eleven.ts';
import { VoiceLive, talkLine, TALK_LABEL } from '../../src/voice/live.ts';
import { SPOKEN_SYSTEM, spokenClean } from '../../src/voice/script.ts';
import { agentBody, refreshBody, soundRules, talkConfigFromEnv, talkPrompt, VOICE } from '../../src/voice/talk-agent.ts';
import { callEndedLine, formatCallSummary, mentionable, tagPeople, type Call } from '../../src/voice/talk-summary.ts';
import { startToolServer, TOOL_PATH, whatsNew } from '../../src/voice/talk-tool.ts';
import { FakeClaude, message, reviewerMessage } from '../fake-claude.ts';
import { briefMessage, ctx, FakePoster, HAIKU, msg, OPUS, room, setup } from './jobs-fixture.ts';

const json = (v: unknown): ElevenResponse => ({ status: 200, headers: new Headers(), bytes: Buffer.from(JSON.stringify(v)), json: () => v });

/** ElevenLabs with one call whose status the test moves along: in-progress → processing → done. */
class FakeEleven implements Eleven {
  calls: { method: string; path: string; body: any }[] = [];
  status: string | null = null; // null = no call yet
  callStart = 0;
  caller = 'Rowan';
  async request(method: string, path: string, body?: unknown): Promise<ElevenResponse> {
    this.calls.push({ method, path, body });
    if (method === 'PATCH' && path.startsWith('/v1/convai/agents/')) return json({});
    if (path.startsWith('/v1/convai/conversations?')) return json({ conversations: this.status ? [{ conversation_id: 'conv_9', status: this.status, start_time_unix_secs: this.callStart }] : [] });
    if (path === '/v1/convai/conversations/conv_9') return json({
      status: this.status,
      transcript: this.status === 'done' ? [{ role: 'agent', message: 'Hi Rowan.', time_in_call_secs: 0 }, { role: 'user', message: 'Can I take the waiting-list agencies?', time_in_call_secs: 6 }] : [],
      metadata: { start_time_unix_secs: this.callStart, call_duration_secs: 180 },
      conversation_initiation_client_data: { dynamic_variables: { caller_name: this.caller } },
    });
    throw new Error(`FakeEleven: unexpected ${method} ${path}`);
  }
  lists() { return this.calls.filter((c) => c.path.startsWith('/v1/convai/conversations?')).length; }
}

const BASE = 'https://ck.example.test';
const goodLines = [
  { kind: 'decided', text: 'The pilot runs with three agencies, 25 clients each.', block: 'pilot-plan.md §2 D2', quote: 'Three agencies, max 25 clients each' },
  { kind: 'talk_to', text: 'Priya runs onboarding calls and pilot support.', block: 'pilot-plan.md §3.1', quote: 'Priya: onboarding calls and pilot support.' },
];
const summaryOf = (s: { asked_about?: string[]; didnt_know?: string[]; new_ideas?: string[] }) =>
  message(OPUS, [{ type: 'text', text: JSON.stringify({ asked_about: [], didnt_know: [], new_ideas: [], ...s }) }]);

function voice(over: { base?: string | null; named?: boolean; claude?: FakeClaude; people?: { name: string; handle: string }[] } = {}) {
  const t = setup('ck-voicefmt-');
  const idsFile = join(t.dir, 'voice-ids.json');
  writeFileSync(idsFile, JSON.stringify({ agent_id: 'agent_test' }));
  let clock = new Date('2026-11-05T10:00:00Z');
  const el = new FakeEleven();
  const poster = new FakePoster();
  const claude = over.claude ?? new FakeClaude([]);
  const deps = t.deps(claude, poster);
  const callsFile = join(t.dir, 'voice-calls.json');
  const v = new VoiceLive({
    claude, el, media: () => ({}) as never, poster, state: deps.state, audio: false, talk: true, idsFile, callsFile, traceFile: t.traceFile,
    now: () => clock, publicBaseUrl: () => (over.base === undefined ? BASE : over.base), ...(over.named === false ? { namedLink: false } : {}),
    peopleOf: () => over.people ?? [],
  });
  return { t, el, poster, claude, deps, v, callsFile, at: (iso: string) => { clock = new Date(iso); }, now: () => clock };
}

/** What main.ts does for Rowan's first message back: talk link, brief, then afterBrief. */
async function brief(s: ReturnType<typeof voice>, kind: 'joiner' | 'returner' = 'returner') {
  const input = msg('r1', 'Morning all, back today', '@switch-slack-x-rowan_demo:localhost', 'Rowan', { received_at: s.now().toISOString() });
  const talk = await s.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1');
  return runBrief(s.deps, 'room1', 'ck-smoke-c', ctx, input, { kind, since: kind === 'returner' ? '2026-10-07T09:00:00+01:00' : null }, {
    ...(talk ? { closing: talk.closing } : {}),
    after: ({ threadId, briefText }) => s.v.afterBrief({ roomId: 'room1', roomName: 'ck-smoke-c', threadId, messageId: 'r1', person: 'Rowan', handle: 'rowan_demo', since: null, briefText, talk: talk?.talk ?? null }),
  });
}
const briefClaude = () => new FakeClaude([
  { model: OPUS, respond: briefMessage(goodLines) },
  { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
]);

/** A small stand-in for Switch 0.31.0's Slack adapter (switch_core/bridges/collaboration/slack/
 *  adapter.py, _render_outbound): "@name" → <@U…> for known Slack users (the name must be followed by
 *  something outside [A-Za-z0-9._-]), then Markdown → mrkdwn: **bold** → *bold*, [label](url) →
 *  <url|label>. Same rules, re-stated here so the tests show what Slack receives. */
function slackRender(md: string, users: Record<string, string> = {}): string {
  const mentions = md.replace(/@([A-Za-z0-9][A-Za-z0-9._-]*)/g, (m, name: string) => (users[name.toLowerCase()] ? `<@${users[name.toLowerCase()]}>` : m));
  return mentions.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
}

describe('the brief: a short, named talk link and a scannable layout (Kash: "shouldn\'t be a massive URL")', () => {
  it('bold first line, short bullets with the source at the end, and a 🎧 line with the short link; no raw ElevenLabs URL', async () => {
    const s = voice({ claude: briefClaude() });
    await brief(s);
    s.claude.done();
    const body = s.poster.pub()[0].body;
    const lines = body.split('\n');
    expect(lines[0]).toBe("👋 **Welcome back, Rowan** · here's what changed while you were away");
    expect(lines.slice(1, -1)).toEqual([
      '• **Decided** · The pilot runs with three agencies, 25 clients each. — Ledgerly pilot plan › Decisions (Kash, 6 Oct)',
      '• **Talk to** · Priya runs onboarding calls and pilot support. — Ledgerly pilot plan › Who does what (30 Oct)',
    ]);
    const id = lines.at(-1)!.match(/^🎧 \*\*Talk it through\*\* · \[Start a voice catch-up\]\(https:\/\/ck\.example\.test\/talk\/([A-Za-z0-9_-]{12})\) \(up to 10 min\)\. I'll post a summary here after\.$/)![1];
    expect(body).not.toMatch(/elevenlabs\.io|var_|agent_id/);
    // the short id is stored with the watch and resolves to the person's full link
    expect(s.v.watches[0]).toMatchObject({ caller: 'Rowan', handle: 'rowan_demo', short_id: id });
    const target = new URL(s.v.talkTarget(id)!);
    expect(target.origin + target.pathname).toBe('https://elevenlabs.io/app/talk-to');
    expect(target.searchParams.get('var_caller_name')).toBe('Rowan');
    expect(JSON.parse(readFileSync(s.callsFile, 'utf8')).links).toEqual([{ id, url: target.toString(), at: '2026-11-05T10:00:00.000Z' }]);
    // what Slack gets through Switch: bold, and a link that shows its label
    expect(slackRender(lines[0])).toBe("👋 *Welcome back, Rowan* · here's what changed while you were away");
    expect(slackRender(lines.at(-1)!)).toBe(`🎧 *Talk it through* · <${BASE}/talk/${id}|${TALK_LABEL}> (up to 10 min). I'll post a summary here after.`);
  });

  it('a joiner gets the same layout; ids are random per link', async () => {
    expect(briefOpening('joiner', 'Alex')).toBe('👋 **Welcome, Alex** · a quick catch-up on where things stand');
    const s = voice();
    const a = await s.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1');
    const b = await s.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1');
    expect(a!.talk.shortId).not.toBe(b!.talk.shortId);
  });

  it('CK_TALK_LINK_STYLE=bare: the short URL itself; no base URL: the long link, still behind a label', async () => {
    const bare = voice({ named: false });
    expect((await bare.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1'))!.closing).toMatch(/^🎧 \*\*Talk it through\*\* · https:\/\/ck\.example\.test\/talk\/[A-Za-z0-9_-]{12} \(up to 10 min\)/);
    const long = voice({ base: null });
    const t = (await long.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1'))!;
    expect(t.talk.shortId).toBeNull();
    expect(t.closing).toMatch(/^🎧 \*\*Talk it through\*\* · \[Start a voice catch-up\]\(https:\/\/elevenlabs\.io\/app\/talk-to\?agent_id=agent_test&/);
    expect(existsJson(long.callsFile)?.links ?? []).toEqual([]);
  });

  it('with voice off the placeholder keeps the same shape', () => {
    expect(TALK_IT_THROUGH).toMatch(/^🎧 \*\*Talk it through\*\* · /);
    expect(talkLine('https://x.test/talk/abc', false)).toBe("🎧 **Talk it through** · https://x.test/talk/abc (up to 10 min). I'll post a summary here after.");
  });
});

const existsJson = (f: string) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

describe('GET /talk/<id> on the tool server (through the same tunnel)', () => {
  const s = voice();
  const SECRET = 'tool-s3cret-value';
  const started = startToolServer({ port: 0, secret: SECRET, answer: () => whatsNew(null, null, 0, 0), talkTarget: (id) => s.v.talkTarget(id) });
  afterAll(async () => (await started).server.close());
  const url = async (p: string) => `http://127.0.0.1:${(await started).port}${p}`;
  const get = async (p: string, method = 'GET') => fetch(await url(p), { method, redirect: 'manual' });

  it('a live id → 302 to the full talk URL, no caching, no referrer; HEAD too', async () => {
    const t = (await s.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1'))!;
    const r = await get(`/talk/${t.talk.shortId}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(s.v.talkTarget(t.talk.shortId!));
    expect(r.headers.get('location')).toMatch(/^https:\/\/elevenlabs\.io\/app\/talk-to\?agent_id=agent_test&var_caller_name=Rowan/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await get(`/talk/${t.talk.shortId}`, 'HEAD')).status).toBe(302);
    // nothing secret anywhere in the response: not the tool's header secret, not its header name
    const all = JSON.stringify([...r.headers.entries()]) + (await r.text());
    expect(all).not.toContain(SECRET);
    expect(all.toLowerCase()).not.toContain('x-ck-tool-secret');
  });

  it('unknown, malformed or expired ids → a bare 404 that says nothing; other methods and paths unchanged', async () => {
    const t = (await s.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1'))!;
    for (const p of ['/talk/AAAAAAAAAAAA', '/talk/short', '/talk/%2e%2e%2fhealth', '/talk/', `/talk/${t.talk.shortId}/x`]) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      const text = await r.text();
      expect(text).toBe('{"error":"not found"}');
    }
    expect((await fetch(await url(`/talk/${t.talk.shortId}`), { method: 'POST', redirect: 'manual' })).status).toBe(404);
    expect((await get('/health')).status).toBe(200);
    expect((await fetch(await url(TOOL_PATH), { method: 'POST', body: '{}' })).status).toBe(401); // whats_new still needs its secret
    // 3 hours later (the watch's lifetime) the link is gone
    s.at('2026-11-05T13:00:01Z');
    expect((await get(`/talk/${t.talk.shortId}`)).status).toBe(404);
    expect(s.v.talkTarget(t.talk.shortId!)).toBeNull();
  });

  it('no talkTarget given: /talk is just another unknown path', async () => {
    const plain = await startToolServer({ port: 0, secret: SECRET, answer: () => whatsNew(null, null, 0, 0) });
    try { expect((await fetch(`http://127.0.0.1:${plain.port}/talk/AAAAAAAAAAAA`, { redirect: 'manual' })).status).toBe(404); } finally { plain.server.close(); }
  });

  it('expired links are pruned from the calls file on the next tick', async () => {
    const u = voice();
    await u.v.talkClosing(room, 'ck-smoke-c', 'Rowan', 'room1');
    u.at('2026-11-05T13:00:01Z');
    await u.v.tick();
    expect(existsJson(u.callsFile).links).toEqual([]);
  });
});

describe('a calmer voice (Kash: "super excited… went from normal to really loud in places")', () => {
  const cfg = talkConfigFromEnv('Test');
  const p = talkPrompt(room, 'Thursday 5 November, 10:00', 'Test');
  it('the prompt asks for calm, even and a steady volume, pleased not excited', () => {
    expect(p).toMatch(/Sound calm, warm and friendly from your first word/);
    expect(p).toMatch(/even pace and a steady, moderate volume for the whole call/);
    expect(p).toMatch(/pleased, never excited/);
  });
  it('keeps gentle tags, rules out excitable ones, capitals and stacked exclamation marks', () => {
    expect(p).toMatch(/Audio tags and little sounds are welcome[^\n]*gentle: a soft laugh, \[warm\], \[friendly\], \[calm\]/);
    expect(p).toMatch(/Never excitable or loud: no \[excited\], \[shouting\], \[ecstatic\], \[enthusiastic\] or \[cheerful\]/);
    expect(p).toMatch(/no words in capitals for emphasis, no exclamation marks in a row/);
    // the warm-tag lines no longer invite [cheerful] or "upbeat"
    expect(soundRules('10:00')).not.toMatch(/upbeat|warm or light: a soft laugh, \[warm\], \[cheerful\]/);
    // the weary-sigh rule (4 Nov "Huhhh") is still there
    expect(p).toMatch(/no "huhhh", no heavy sigh, no \[sighs\]/);
  });
  it('steadier TTS: stability up from 0.6 (still natural, not 1), gentle suggested tags only', () => {
    expect(VOICE.stability).toBeGreaterThanOrEqual(0.75);
    expect(VOICE.stability).toBeLessThan(1);
    const tags = VOICE.suggested_audio_tags.map((t) => t.tag);
    expect(tags).toEqual(expect.arrayContaining(['warm', 'calm']));
    for (const loud of ['excited', 'shouting', 'ecstatic', 'cheerful', 'enthusiastic']) expect(tags).not.toContain(loud);
    const body = agentBody(room, 'Thursday 5 November, 10:00', cfg);
    expect(body.conversation_config.tts).toMatchObject({ model_id: 'eleven_v4_turbo', stability: VOICE.stability, expressive_mode: true });
    // every refresh carries them, so the live agent is steadied without a fresh agent-setup
    expect(refreshBody(room, 'Thursday 5 November, 10:00', cfg).conversation_config.tts).toEqual({ ...VOICE });
  });
  it('the audio clip script: calm and even, no stacked exclamation marks', () => {
    expect(SPOKEN_SYSTEM).toMatch(/calm and even/);
    expect(SPOKEN_SYSTEM).toMatch(/full stops rather than exclamation marks, and no words in capitals/);
    expect(spokenClean('Great news!!! It shipped!')).toBe('Great news! It shipped!');
  });
});

describe('"just finished a call" before the summary (Kash: "about 2 minutes or so waiting")', () => {
  it('in progress → follows quickly; ended (processing) → the line, once; done → the summary, after it', async () => {
    const s = voice({ claude: new FakeClaude([
      { model: OPUS, respond: briefMessage(goodLines) },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
      { model: OPUS, respond: summaryOf({ asked_about: ['Which open asks he could take.'] }) },
    ]) });
    await brief(s);
    const posts = () => s.poster.pub().map((p) => p.body);
    expect(await s.v.tick()).toEqual([]); // link open, no call yet
    const lists = s.el.lists();
    expect(await s.v.quickTick()).toEqual([]); // nothing in progress: no network at all
    expect(s.el.lists()).toBe(lists);

    s.el.status = 'in-progress';
    s.el.callStart = s.now().getTime() / 1000 + 60;
    expect(await s.v.tick()).toEqual([]);
    expect(posts()).toHaveLength(1); // only the brief
    s.el.status = 'processing'; // the caller hung up; ElevenLabs is finalising the transcript
    const [ended] = await s.v.quickTick();
    expect(ended.error).toMatch(/talk_call_ended conv_9/);
    expect(posts().at(-1)).toBe("📞 **Rowan just finished a call with Context Keeper** · I'll post the summary here in a minute or two.");
    expect(s.poster.pub().at(-1)!.thread).toBe('r1');
    expect(await s.v.quickTick()).toEqual([]); // still processing: said once, no summary yet
    expect(await s.v.tick()).toEqual([]);
    expect(posts().filter((b) => b.startsWith('📞'))).toHaveLength(1);

    s.el.status = 'done';
    const [summary] = await s.v.quickTick();
    s.claude.done();
    expect(summary.error).toMatch(/talk_call conv_9 \(180 s\)/);
    expect(posts().map((b) => b.split('\n')[0].slice(0, 2))).toEqual(['👋', '📞', '📝']);
    expect(posts().filter((b) => b.startsWith('📞'))).toHaveLength(1);
    expect(await s.v.quickTick()).toEqual([]); // done: back to no polling
    expect(await s.v.tick()).toEqual([]);
    expect(existsJson(s.callsFile)).toMatchObject({ ended: ['conv_9'], done: ['conv_9'], watches: [] });
  });

  it('once per call across a restart; someone else\'s call gets nothing', async () => {
    const s = voice({ claude: briefClaude() });
    await brief(s);
    s.el.status = 'processing';
    s.el.callStart = s.now().getTime() / 1000 + 60;
    await s.v.tick();
    expect(s.poster.pub().filter((p) => p.body.startsWith('📞'))).toHaveLength(1);
    // a restart reads the calls file: no second line
    const again = new VoiceLive({ claude: new FakeClaude([]), el: s.el, media: () => ({}) as never, poster: s.poster, state: s.deps.state, audio: false, talk: true, idsFile: join(s.t.dir, 'voice-ids.json'), callsFile: s.callsFile, now: s.now });
    expect(await again.quickTick()).toEqual([]);
    expect(s.poster.pub().filter((p) => p.body.startsWith('📞'))).toHaveLength(1);

    const o = voice({ claude: briefClaude() });
    await brief(o);
    o.el.status = 'processing';
    o.el.callStart = o.now().getTime() / 1000 + 60;
    o.el.caller = 'Sam'; // the agent is shared; Sam's call isn't Rowan's
    expect(await o.v.tick()).toEqual([]);
    expect(o.poster.pub()).toHaveLength(1);
    const details = o.el.calls.filter((c) => c.path === '/v1/convai/conversations/conv_9').length;
    await o.v.tick();
    expect(o.el.calls.filter((c) => c.path === '/v1/convai/conversations/conv_9').length).toBe(details); // fetched once, not every tick
  });

  it('the line itself', () => {
    expect(callEndedLine('Priya')).toBe("📞 **Priya just finished a call with Context Keeper** · I'll post the summary here in a minute or two.");
  });
});

describe('people named in "needs confirming" are tagged (Kash: "get me on there as well")', () => {
  const people = [{ name: 'Kash', handle: 'owner_demo' }, { name: 'Rowan', handle: 'rowan_demo' }, { name: 'Sam', handle: 'sam_demo' }];
  const call: Call = { id: 'c', startUnix: 0, durationS: 180, credits: null, callerName: 'Rowan', transcript: [] };

  it('the first mention of each named person becomes @handle, once per person, only in that section', () => {
    const post = formatCallSummary('Rowan', call, {
      asked_about: ['Rowan asked what Kash decided about pricing.'],
      didnt_know: ["Whether Sam's form is ready."],
      new_ideas: ["Rowan would like to find the two waiting-list agencies; this needs Kash's confirmation.", 'Kash to brief Sam on it too, says Rowan.'],
    }, people);
    // what needs someone to act comes first: needs confirming, then to follow up, then asked about
    const [head, ideas, didnt, asked] = post.split('\n\n');
    expect(head).toBe('📝 **Call summary** · Rowan talked it through (3 min call) · 2 to confirm, 1 to follow up');
    expect(asked).toBe('**Asked about**\n• Rowan asked what Kash decided about pricing.');
    expect(didnt).toBe("**To follow up (the record didn't say)**\n• Whether Sam's form is ready.");
    expect(ideas).toBe("**Needs confirming**\n• @rowan_demo would like to find the two waiting-list agencies; this needs @owner_demo's confirmation.\n• Kash to brief @sam_demo on it too, says Rowan.");
    expect(post.match(/@owner_demo/g)).toHaveLength(1);
    // through Switch's Slack adapter: real mentions for known users (Slack shows "@Kash's confirmation")
    expect(slackRender(ideas, { owner_demo: 'U0KASH', rowan_demo: 'U0ROWAN', sam_demo: 'U0SAM' })).toContain("<@U0ROWAN> would like to find the two waiting-list agencies; this needs <@U0KASH>'s confirmation.");
  });

  it('a name right before "." can\'t carry the handle (Switch would read "owner_demo." as the name), so it goes on one cc line', () => {
    const t = tagPeople(['This needs confirming by Kash.', 'Rowan offered.'], people);
    expect(t.items).toEqual(['This needs confirming by Kash.', '@rowan_demo offered.']);
    expect(t.cc).toEqual(['owner_demo']);
    const post = formatCallSummary('Rowan', call, { asked_about: [], didnt_know: [], new_ideas: ['This needs confirming by Kash.'] }, people);
    expect(post).toContain('• This needs confirming by Kash.\ncc @owner_demo');
    expect(slackRender('cc @owner_demo', { owner_demo: 'U0KASH' })).toBe('cc <@U0KASH>');
    expect(slackRender('by @owner_demo.', { owner_demo: 'U0KASH' })).toBe('by @owner_demo.'); // why: the dot joins the name
  });

  it('whole words, longer names first, never a raw Switch sender id or an unknown person', () => {
    const t = tagPeople(['Samantha and Rowan Price agreed; Rowan Price leads.'], [{ name: 'Sam', handle: 'sam_demo' }, { name: 'Rowan', handle: 'rowan_demo' }, { name: 'Rowan Price', handle: 'rowan_demo' }]);
    expect(t.items).toEqual(['Samantha and @rowan_demo agreed; Rowan Price leads.']);
    expect(t.tagged).toEqual(['rowan_demo']);
    expect(mentionable('@switch-slack-x-rowan:localhost')).toBe(false);
    expect(mentionable('rowan demo')).toBe(false);
    expect(mentionable('rowan_demo')).toBe(true);
    expect(tagPeople(['Priya will check.'], people).items).toEqual(['Priya will check.']);
  });

  it('end to end: the caller (from the brief) and the owner (peopleOf) are tagged in the posted summary', async () => {
    const s = voice({
      people: [{ name: 'Kash', handle: 'owner_demo' }],
      claude: new FakeClaude([
        { model: OPUS, respond: briefMessage(goodLines) },
        { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'line1', supports: true }, { id: 'line2', supports: true }]) },
        { model: OPUS, respond: summaryOf({ new_ideas: ["Rowan would like to take on the waiting-list agencies; this needs Kash's confirmation."] }) },
      ]),
    });
    await brief(s);
    s.el.status = 'done';
    s.el.callStart = s.now().getTime() / 1000 + 60;
    await s.v.tick();
    s.claude.done();
    const summary = s.poster.pub().at(-1)!.body;
    expect(summary).toMatch(/^📝 \*\*Call summary\*\* · Rowan talked it through \(3 min call\)/);
    expect(summary).toContain("• @rowan_demo would like to take on the waiting-list agencies; this needs @owner_demo's confirmation.");
    expect(summary.split('\n')[0]).not.toMatch(/@/); // the header names Rowan without tagging
  });
});
