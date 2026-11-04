// The live "talk it through" tool (whats_new, practice run PR20c's hybrid): the tunnel URL and secret,
// provisioning in place, the spoken answer, the local server over real HTTP on 127.0.0.1, and
// VoiceLive switching between the live tool and the refresh-on-change fallback. Fake ElevenLabs,
// no tunnel, no cost.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RoomRecord } from '../../src/agent/room.ts';
import { ElevenError, type Eleven, type ElevenResponse } from '../../src/voice/eleven.ts';
import { VoiceLive } from '../../src/voice/live.ts';
import { readIds, talkLink, talkPrompt, writeIds } from '../../src/voice/talk-agent.ts';
import { attachTool, detachTool, secretFingerprint, startToolServer, toolSecret, tunnelUrl, whatsNew, whatsNewToolConfig, TOOL_PATH } from '../../src/voice/talk-tool.ts';

const ok = (data: unknown): ElevenResponse => ({ status: 200, headers: new Headers(), bytes: Buffer.from(JSON.stringify(data)), json: () => data });
class FakeEleven implements Eleven {
  calls: { method: string; path: string; body: any }[] = [];
  constructor(private route: (method: string, path: string, body: any) => unknown = () => ({})) {}
  async request(method: string, path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    const r = this.route(method, path, body);
    if (r instanceof Error) throw r;
    return ok(r);
  }
}
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const elRoute = (m: string, path: string) =>
  m === 'POST' && path === '/v1/convai/secrets' ? { secret_id: 'sec_1' }
  : m === 'POST' && path === '/v1/convai/tools' ? { id: 'tool_1' }
  : m === 'GET' && path.includes('?agent_id=') ? { conversations: [] } : {};

const room: RoomRecord = {
  name: 'ck-smoke',
  docs: [{ file: 'pilot-plan.md', text: '# Pilot\n- Rowan: partner comms.' }],
  messages: [
    { id: 'led-1', at: '2026-11-04T11:00:00+00:00', author: 'Kash', text: 'Pilot dates locked.', thread: null },
    { id: 'm2', at: '2026-11-04T12:20:00Z', author: 'Sam', text: 'Approved the **pay-now** idea, see https://example.com/x and pilot-plan.md §2', thread: null },
    { id: 'm3', at: '2026-11-04T12:31:00Z', author: 'Rowan', text: 'looks right', thread: 'm2' },
  ],
};

describe('tunnel URL and secret', () => {
  it('CK_TALK_TOOL_URL wins; else the last trycloudflare URL in the tunnel log; else none', () => {
    const d = tmp('ck-tunnel-');
    const log = join(d, 'tunnel.log');
    expect(tunnelUrl({}, log)).toBeNull();
    writeFileSync(log, 'INF |  https://old-one.trycloudflare.com  |\nINF | https://fresh-two-words.trycloudflare.com |\n');
    expect(tunnelUrl({}, log)).toBe('https://fresh-two-words.trycloudflare.com');
    expect(tunnelUrl({ CK_TALK_TOOL_URL: 'https://mine.example/' }, log)).toBe('https://mine.example');
  });
  it('CK_TALK_TOOL_SECRET wins; else one is made once, owner-only, and reused', () => {
    const f = join(tmp('ck-secret-'), 'talk-tool-secret');
    expect(toolSecret({ CK_TALK_TOOL_SECRET: 's3' }, f)).toBe('s3');
    const a = toolSecret({}, f);
    expect(a.length).toBeGreaterThan(20);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(toolSecret({}, f)).toBe(a);
  });
});

describe('provisioning (greatagent setup_agent.py pattern)', () => {
  it('the tool sends the workspace secret as a header and reads the room and snapshot from the link', () => {
    const t = whatsNewToolConfig('https://x.trycloudflare.com/', 'sec_1');
    expect(t).toMatchObject({ type: 'webhook', name: 'whats_new', response_timeout_secs: 5, pre_tool_speech: 'auto' });
    expect(t.api_schema.url).toBe(`https://x.trycloudflare.com${TOOL_PATH}`);
    expect(t.api_schema.request_headers).toEqual({ 'X-CK-Tool-Secret': { secret_id: 'sec_1' } });
    expect(t.api_schema.request_body_schema.properties).toMatchObject({
      conversation_id: { dynamic_variable: 'system__conversation_id' }, room_id: { dynamic_variable: 'room_id' }, since: { dynamic_variable: 'since' },
    });
    expect(JSON.stringify(t)).not.toMatch(/s3cret/);
  });
  it('makes the secret and tool once, PATCHes the tool in place for a new URL, attaches it to the one agent; never creates an agent', async () => {
    const f = join(tmp('ck-ids-'), 'voice-ids.json');
    writeIds({ agent_id: 'agent_1' }, f);
    const el = new FakeEleven(elRoute);
    expect(await attachTool(el, 'agent_1', 'https://a.trycloudflare.com', 's3cret', f)).toEqual({ toolId: 'tool_1', created: ['secret sec_1', 'tool tool_1'] });
    expect(readIds(f)).toMatchObject({ agent_id: 'agent_1', whats_new_tool_id: 'tool_1', tool_secret_id: 'sec_1', tool_secret_fp: secretFingerprint('s3cret') });
    expect(readFileSync(f, 'utf8')).not.toContain('s3cret');
    expect(el.calls.at(-1)).toEqual({ method: 'PATCH', path: '/v1/convai/agents/agent_1', body: { conversation_config: { agent: { prompt: { tool_ids: ['tool_1'] } } } } });
    el.calls = [];
    await attachTool(el, 'agent_1', 'https://b.trycloudflare.com', 's3cret', f);
    expect(el.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /v1/convai/tools/tool_1', 'PATCH /v1/convai/agents/agent_1']);
    expect(el.calls[0].body.tool_config.api_schema.url).toBe(`https://b.trycloudflare.com${TOOL_PATH}`);
    expect(el.calls.some((c) => c.path.includes('/agents/create'))).toBe(false);
  });
  it('a stored tool this key cannot see is recreated; a changed secret gets a new workspace secret', async () => {
    const f = join(tmp('ck-ids-'), 'voice-ids.json');
    writeIds({ agent_id: 'agent_1', whats_new_tool_id: 'tool_gone', tool_secret_id: 'sec_old', tool_secret_fp: secretFingerprint('old') }, f);
    const el = new FakeEleven((m, p) => (m === 'PATCH' && p.endsWith('/tool_gone') ? new ElevenError(404, 'nf', 'gone', null) : elRoute(m, p)));
    const r = await attachTool(el, 'agent_1', 'https://a.trycloudflare.com', 'new', f);
    expect(r.created).toEqual(['secret sec_1', 'tool tool_1']);
    expect(readIds(f)).toMatchObject({ whats_new_tool_id: 'tool_1', tool_secret_id: 'sec_1' });
  });
  it('detach leaves the agent with no webhook tool', async () => {
    const el = new FakeEleven();
    await detachTool(el, 'agent_1');
    expect(el.calls[0].body).toEqual({ conversation_config: { agent: { prompt: { tool_ids: [] } } } });
  });
});

describe('the whats_new answer (PR20b: nothing raw read aloud)', () => {
  const since = Date.parse('2026-11-04T12:05:00Z');
  const now = Date.parse('2026-11-04T13:52:00Z');
  it('messages after the snapshot as plain sentences: no links, markdown, file names or § numbers', () => {
    const a = whatsNew(room, [{ ref: 'I1', idea: 'A pay-now link in reminder emails', raiser: 'Rowan', status: 'being built by Claude Code', changed: 'Wednesday 4 November, 12:20' }], since, now);
    expect(a).toMatchObject({ notes_ran_to: '12:05', now: '13:52', new_messages: 2 });
    expect(a.news).toMatch(/^2 new messages since 12:05\. At 12:20 Sam said: Approved the pay-now idea/);
    expect(a.news).toMatch(/At 12:31 Rowan, replying in a thread, said: looks right\.$/);
    expect(a.news).not.toMatch(/https?:|\*\*|§|\.md/);
    expect(a.ideas).toBe("I1, Rowan's idea, A pay-now link in reminder emails: being built by Claude Code, since 12:20.");
  });
  it('says so when nothing is new, or the room cannot be seen; no ideas section when job E is off', () => {
    expect(whatsNew(room, [], now, now).news).toBe('Nothing new in the room since 13:52.');
    expect(whatsNew(null, null, since, now)).toMatchObject({ news: "I can't see the room's messages just now.", ideas: '' });
    expect(whatsNew(room, [], since, now).ideas).toBe('No ideas from this room are in progress.');
  });
});

describe('the tool server, over real HTTP on 127.0.0.1', () => {
  const asked: unknown[] = [];
  const started = startToolServer({ port: 0, secret: 's3cret', answer: (req) => { asked.push(req); return whatsNew(room, [], Date.parse('2026-11-04T12:05:00Z'), Date.parse('2026-11-04T13:52:00Z')); } });
  afterAll(async () => (await started).server.close());
  const base = async () => `http://127.0.0.1:${(await started).port}`;
  it('health needs no secret and says nothing about the room', async () => {
    const r = await fetch(`${await base()}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, service: 'ck-talk-tool' });
  });
  it('whats_new refuses a missing or wrong secret, answers the right one', async () => {
    const body = JSON.stringify({ conversation_id: 'conv_1', room_id: 'room1', since: '2026-11-04T12:05:00Z' });
    expect((await fetch(`${await base()}${TOOL_PATH}`, { method: 'POST', body })).status).toBe(401);
    expect((await fetch(`${await base()}${TOOL_PATH}`, { method: 'POST', body, headers: { 'X-CK-Tool-Secret': 'nope' } })).status).toBe(401);
    const r = await fetch(`${await base()}${TOOL_PATH}`, { method: 'POST', body, headers: { 'X-CK-Tool-Secret': 's3cret', 'content-type': 'application/json' } });
    expect(r.status).toBe(200);
    expect((await r.json()).new_messages).toBe(2);
    expect(asked).toEqual([{ conversation_id: 'conv_1', room_id: 'room1', since: '2026-11-04T12:05:00Z' }]);
    expect((await fetch(`${await base()}/voice/other`, { method: 'POST', body })).status).toBe(404);
  });
});

describe('VoiceLive: the live tool when the tunnel answers, refresh-on-change when it does not', () => {
  function make(tunnel: { url: string | null; up: boolean }) {
    const d = tmp('ck-voice-tool-');
    const idsFile = join(d, 'voice-ids.json');
    writeIds({ agent_id: 'agent_1' }, idsFile);
    let clock = new Date('2026-11-04T12:05:00Z');
    const rec: RoomRecord = { ...room, messages: room.messages.slice(0, 1) };
    const el = new FakeEleven(elRoute);
    const v = new VoiceLive({
      claude: {} as never, el, media: () => ({}) as never, poster: {} as never, state: {} as never, audio: false, talk: true,
      idsFile, callsFile: null, now: () => clock, recordOf: (id) => (id === 'room1' ? rec : null), ideasOf: () => [],
      tool: { url: () => tunnel.url, secret: 's3cret', probe: async () => tunnel.up },
    });
    const patches = () => el.calls.filter((c) => c.method === 'PATCH' && c.path === '/v1/convai/agents/agent_1' && c.body.conversation_config.agent.prompt.prompt);
    return { v, el, rec, patches, at: (iso: string) => { clock = new Date(iso); } };
  }
  const post = async (v: VoiceLive) => {
    const t = await v.talkClosing(room, 'ck-smoke', 'Rowan', 'room1');
    await v.afterBrief({ roomId: 'room1', roomName: 'ck-smoke', threadId: 'm1', messageId: 'm1', person: 'Rowan', since: null, briefText: 'b', talk: t!.talk });
    return t!;
  };

  it('tunnel up: tool attached, the prompt says to check live, the link carries room and snapshot, and a new message does not re-PATCH the prompt', async () => {
    const tunnel = { url: 'https://a.trycloudflare.com', up: true };
    const s = make(tunnel);
    await s.v.syncTool();
    expect(s.v.live).toBe(true);
    expect(s.el.calls.find((c) => c.body?.conversation_config?.agent?.prompt?.tool_ids)?.body.conversation_config.agent.prompt.tool_ids).toEqual(['tool_1']);
    const t = await post(s.v);
    const link = new URL(t.closing.match(/https:\/\/elevenlabs\.io\/[^\s)]+/)![0]);
    expect(link.searchParams.get('var_room_id')).toBe('room1');
    expect(link.searchParams.get('var_since')).toBe('2026-11-04T12:05:00.000Z');
    const p = s.patches()[0].body.conversation_config.agent.prompt.prompt;
    expect(p).toContain('# Checking the room live');
    expect(p).toMatch(/say one short line at most, such as "Let me check the room\." Never add a second filler, and never say "Acknowledged"/);
    expect(p).toMatch(/Never say you can't check the room or the channel: you can\./);
    expect(p).not.toContain('a quick call back will have it');
    s.rec.messages.push(room.messages[1]);
    s.at('2026-11-04T12:21:00Z');
    await s.v.tick();
    expect(s.patches()).toHaveLength(1); // whats_new covers it: no prompt refresh
    expect(s.v.answerWhatsNew({ room_id: 'room1', since: '2026-11-04T12:05:00.000Z' }).new_messages).toBe(1);
    expect(s.v.answerWhatsNew({ room_id: 'none', since: 'none' }).new_messages).toBe(1); // old link: the newest open link's room and time
  });

  it('tunnel goes away: tool detached, the prompt switches to the fallback, and refresh-on-change resumes', async () => {
    const tunnel = { url: 'https://a.trycloudflare.com', up: true };
    const s = make(tunnel);
    await s.v.syncTool();
    await post(s.v);
    tunnel.up = false;
    s.at('2026-11-04T12:30:00Z');
    await s.v.tick();
    expect(s.v.live).toBe(false);
    expect(s.el.calls.some((c) => JSON.stringify(c.body) === JSON.stringify({ conversation_config: { agent: { prompt: { tool_ids: [] } } } }))).toBe(true);
    expect(s.patches()).toHaveLength(2);
    expect(s.patches()[1].body.conversation_config.agent.prompt.prompt).not.toContain('# Checking the room live');
    s.rec.messages.push(room.messages[1]);
    s.at('2026-11-04T12:31:00Z');
    await s.v.tick();
    expect(s.patches()).toHaveLength(3);
  });

  it('no tunnel URL at start: detaches once (a previous run may have left the tool on), then no tool calls', async () => {
    const s = make({ url: null, up: false });
    await s.v.syncTool();
    await s.v.syncTool();
    expect(s.el.calls.map((c) => c.method + ' ' + c.path)).toEqual(['PATCH /v1/convai/agents/agent_1']);
    expect(s.v.live).toBe(false);
  });
});

describe('the link and prompt without the tool', () => {
  it('the link only adds room and snapshot when given; the fallback prompt has no live section', () => {
    expect(new URL(talkLink('a', 'Rowan', 'x')).searchParams.has('var_room_id')).toBe(false);
    expect(talkPrompt(room, 'Wednesday 4 November, 13:51', 'Test')).not.toContain('whats_new');
  });
});
