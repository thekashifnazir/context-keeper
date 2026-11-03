// smoke: prove the audio post end to end on the internal Mattermost bridge, never a real room.
// Makes a fresh ck-smoke-voice-<stamp> room (Gateway, Mattermost bridge, our agent in it), posts the
// MP3 through Switch's media route as the agent, then reads it back from Mattermost as a throwaway
// persona ("ckvoice") and checks the file's name, type and size. No connect_to_room: that op moves a
// room's events to the caller's connection, and the live listener must keep its rooms.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway, serverEnv } from '../../eval/switchapi.ts';
import { postAudio, realSwitchMedia, audioCaption, audioFilename } from './post-audio.ts';
import { mp3Duration } from './tts.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mm<T>(url: string, token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T; token: string | null }> {
  const res = await fetch(`${url}/api/v4${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T, token: res.headers.get('token') };
}

export async function postSmoke(mp3File: string, person: string, outDir: string) {
  const srv = serverEnv(process.cwd());
  const api = process.env.SWITCH_API_URL || 'http://127.0.0.1:18000';
  const mmUrl = process.env.MATTERMOST_URL || `http://127.0.0.1:${srv.MATTERMOST_HOST_PORT || '8065'}`;
  const agentName = process.env.CK_AGENT_NAME || 'context-keeper';
  const agentId = process.env.SWITCH_AGENT_ID;
  const token = process.env.SWITCH_AGENT_API_KEY;
  if (!agentId || !token) throw new Error('SWITCH_AGENT_ID / SWITCH_AGENT_API_KEY missing from .env.local');
  if (!srv.GATEWAY_ADMIN_EMAIL || !srv.GATEWAY_ADMIN_PASSWORD) throw new Error('no Gateway admin in server/.env (set CK_SERVER_DIR)');

  const gw = await Gateway.login(api, srv.GATEWAY_ADMIN_EMAIL, srv.GATEWAY_ADMIN_PASSWORD);
  const bridges = (await gw.bridges()).filter((b) => b.bridge_type === 'mattermost' && b.status === 'active');
  const bridge = bridges.find((b) => /eval/i.test(b.display_name)) ?? bridges[0];
  if (!bridge) throw new Error('no active Mattermost bridge');
  if (!(await gw.agents()).some((a) => a.name === agentName)) throw new Error(`agent ${agentName} isn't registered`);

  // The reader persona: signs itself up once; its password lives in build/voice (gitignored).
  const credFile = join(outDir, 'mm-reader.json');
  const cred = existsSync(credFile) ? JSON.parse(readFileSync(credFile, 'utf8')) : { username: 'ckvoice', password: randomBytes(18).toString('base64url') };
  writeFileSync(credFile, JSON.stringify(cred), { mode: 0o600 });
  await mm(mmUrl, null, 'POST', '/users', { username: cred.username, password: cred.password, email: `${cred.username}@ck-eval.local`, first_name: 'Voice check' });
  const login = await mm<{ id: string }>(mmUrl, null, 'POST', '/users/login', { login_id: cred.username, password: cred.password });
  if (!login.token) throw new Error(`Mattermost sign-in for ${cred.username} failed (${login.status})`);
  const tk = login.token;
  const team = (await mm<{ id: string }>(mmUrl, tk, 'GET', `/teams/name/${srv.MATTERMOST_TEAM_NAME || 'switch'}`)).data;
  await mm(mmUrl, tk, 'POST', `/teams/${team.id}/members`, { team_id: team.id, user_id: login.data.id });

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const room = await gw.createRoom({
    name: `ck-smoke-voice-${stamp}`, description: 'Context Keeper voice lane: audio-brief posting smoke test (invented demo data)',
    bridge_id: bridge.bridge_id, channel_type: 'channel_public', agent_names: [agentName],
  });
  let channel = room.external_channel_id;
  for (let i = 0; !channel && i < 30; i++) {
    const r = await mm<{ id: string }>(mmUrl, tk, 'GET', `/teams/${team.id}/channels/name/${room.name}`);
    if (r.status === 200) channel = r.data.id;
    else await sleep(1000);
  }
  if (!channel) throw new Error(`no Mattermost channel for ${room.name}`);
  await mm(mmUrl, tk, 'POST', `/channels/${channel}/members`, { user_id: login.data.id });

  const bytes = readFileSync(mp3File);
  const seconds = mp3Duration(bytes);
  const t0 = Date.now();
  const post = await postAudio(realSwitchMedia({ endpoint: api, agentId, token }), { id: room.id, name: room.name },
    { mp3: bytes, filename: audioFilename(person), caption: audioCaption(person, seconds) });
  const uploadMs = Date.now() - t0;

  // Read back: the post with a file, as a channel member sees it.
  let found: { message: string; file?: { name: string; mime_type: string; size: number } } | null = null;
  for (let i = 0; !found && i < 20; i++) {
    await sleep(1500);
    const posts = (await mm<{ posts: Record<string, { message: string; file_ids?: string[]; user_id: string }> }>(mmUrl, tk, 'GET', `/channels/${channel}/posts?since=1`)).data;
    const withFile = Object.values(posts?.posts ?? {}).find((p) => p.file_ids?.length);
    if (withFile) {
      const info = (await mm<{ name: string; mime_type: string; size: number }>(mmUrl, tk, 'GET', `/files/${withFile.file_ids![0]}/info`)).data;
      found = { message: withFile.message, file: { name: info.name, mime_type: info.mime_type, size: info.size } };
    }
  }
  const evidence = {
    room: { id: room.id, name: room.name, bridge: bridge.display_name }, mattermost_channel: channel,
    upload: { event_id: post?.event_id ?? null, ms: uploadMs, bytes: bytes.length, seconds },
    read_back: found, same_size: found?.file?.size === bytes.length,
  };
  writeFileSync(join(outDir, `smoke-${stamp}.json`), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}
