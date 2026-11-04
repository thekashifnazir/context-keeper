// live: the voice half of job C inside the live listener (src/agent/main.ts).
//   talkClosing()  just before the text brief: refresh the "talk it through" agent's prompt from the
//                  room's record (refreshTalkAgent) and return the brief's closing line with a
//                  per-person talk link (talkLink). Null → the brief keeps its usual closing.
//   afterBrief()   once the text brief has posted: the ~60 s audio clip (audioBrief) in the same
//                  thread. Its post goes on the brief's own ck.trace/1 line. If the brief carried a
//                  talk link, the call is watched for.
//   syncTool()     at start and each tick: with a cloudflared tunnel answering, the whats_new webhook
//                  tool (talk-tool.ts) is attached to the talk agent and the prompt tells it to check
//                  the room live (PR20c's hybrid); no tunnel → the tool is detached and the fallback
//                  below keeps the prompt fresh instead. answerWhatsNew() serves the tool server.
//   tick()         about once a minute while a link is open (fallback mode): first, if the room's live record (recordOf:
//                  RoomMemory, so Switch documents + Channel archive + room history + stream messages)
//                  or job E's ideas for that room (ideasOf: the hand-off store, read-only) changed
//                  since the last refresh, or that refresh is over refreshEveryMin old,
//                  re-PATCH the talk agent's prompt, so a call started at any time is at most about a
//                  minute stale (4 Nov live test: a call 1 h 45 min after the brief got the 12:05
//                  snapshot). No Claude call; the PATCH is free. Then a finished call by that person →
//                  transcript summary (talk-summary.ts) posted in the brief's thread through
//                  sendPublic (post.ts: idempotent, CK_POST_ROOMS guard, owner desk on failure),
//                  one ck.trace/1 line per call.
// Flags (src/agent/features.ts): CK_AUDIO_BRIEF, CK_TALK_LINK. No ELEVENLABS_API_KEY, no talk agent id
// in state/voice-ids.json, or any ElevenLabs error → text only, never a crash (fail quiet).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson, type AgentState } from '../agent/state.ts';
import type { Claude, Usage } from '../agent/model.ts';
import { sendPublic, type Poster } from '../agent/post.ts';
import type { RoomRecord } from '../agent/room.ts';
import { writeTrace, type TraceLine, type TracePost } from '../shared/trace.ts';
import { audioBrief } from './audio-brief.ts';
import type { Eleven } from './eleven.ts';
import type { SwitchMedia } from './post-audio.ts';
import { fetchCall, formatCallSummary, summariseCall } from './talk-summary.ts';
import { attachTool, detachTool, probeTunnel, whatsNew, type ToolRequest, type WhatsNewAnswer } from './talk-tool.ts';
import { IDS_FILE, ideasText, readIds, recordSignature, refreshTalkAgent, snapshotStamp, talkConfigFromEnv, talkLink } from './talk-agent.ts';
import type { TalkIdea } from './talk-ideas.ts';

/** What the prompt is built from: the record's fingerprint plus job E's ideas as the prompt shows them
 *  (so a hand-off step that changes nothing a caller would hear doesn't cause a refresh). */
const signature = (record: RoomRecord, ideas: TalkIdea[] | null) => `${recordSignature(record)}#${ideas ? ideasText(ideas) : '-'}`;

export interface VoiceLiveConfig {
  claude: Claude;
  el: Eleven | null; // null = no ELEVENLABS_API_KEY: voice off, text brief unchanged
  media: (roomId: string) => SwitchMedia; // Switch's media route, with the room's session
  poster: Poster;
  state: AgentState;
  audio: boolean; // CK_AUDIO_BRIEF
  talk: boolean; // CK_TALK_LINK
  idsFile?: string; // the talk agent's id (state/voice-ids.json)
  callsFile?: string | null; // watched calls; null = in memory
  traceFile?: string;
  saveDir?: string | null; // keep a local copy of each clip here (main.ts: build/voice/live, gitignored)
  watchHours?: number; // how long a posted link is watched for a call (default 3)
  refreshTimeoutMs?: number; // the prompt refresh must not hold up the text brief (default 10 s)
  /** The room's current record, without calling Switch (main.ts: memory.cached). Absent = the prompt
   *  is refreshed only when a link is posted. */
  recordOf?: (roomId: string) => RoomRecord | null;
  refreshEveryMin?: number; // re-stamp an unchanged record this often while a link is open (default 15)
  /** Job E's ideas from this room, in plain words, for the prompt's "Ideas in progress" (main.ts:
   *  readTalkIdeas on state/handoff.json, read-only). Absent or null = job E off: no section. */
  ideasOf?: (roomId: string) => TalkIdea[] | null;
  /** The live whats_new tool (talk-tool.ts). url(): the tunnel's public URL or null; secret: the
   *  shared header value; probe: does the URL reach our server (default GET /health). Absent = no
   *  tool, refresh-on-change only. */
  tool?: { url: () => string | null; secret: string; probe?: (url: string) => Promise<boolean> };
  now?: () => Date;
  log?: (s: string) => void;
}

export interface Watch {
  room_id: string; room_name: string; thread_id: string; message_id: string;
  person: string; caller: string; agent_id: string; link_at: string;
}
interface CallsFile { watches: Watch[]; done: string[] }

export interface BriefHookInput {
  roomId: string; roomName: string; threadId: string; messageId: string;
  person: string; // display name of the joiner or returner
  since: string | null; // a returner's last message, ISO
  briefText: string; // the text brief as posted
  talk: { agentId: string; caller: string; at: string } | null; // what talkClosing() put in the brief
}

export interface VoiceResult { posts: TracePost[]; events: string[]; usage: Usage[] }

export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Ledgerly pilot" / "Riverside build night", for the talk agent's first line (CK_TALK_ROOM_LABEL wins). */
export function roomLabel(roomName: string): string {
  if (process.env.CK_TALK_ROOM_LABEL) return process.env.CK_TALK_ROOM_LABEL;
  return /riverside/i.test(roomName) ? 'Riverside build night' : 'Ledgerly pilot';
}

/** The brief's closing line when it carries a talk link. */
export const talkLine = (link: string) =>
  `Want to talk it through? A voice catch-up on this room with Context Keeper, up to 10 minutes: ${link}\nI'll post a short summary of the call here afterwards.`;

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}: timed out after ${ms} ms`)), ms).unref?.())]);

export class VoiceLive {
  private calls: CallsFile = { watches: [], done: [] };
  /** What the talk agent's prompt was last built from (in memory: after a restart the first tick refreshes). */
  private lastRefresh: { agentId: string; room: string; sig: string; at: number; live: boolean } | null = null;
  private toolMode: 'unknown' | 'live' | 'off' = 'unknown';
  private toolUrl: string | null = null;
  constructor(private c: VoiceLiveConfig) {
    if (c.callsFile && existsSync(c.callsFile)) {
      try { this.calls = { ...this.calls, ...(JSON.parse(readFileSync(c.callsFile, 'utf8')) as CallsFile) }; } catch { /* unreadable: start clean */ }
    }
  }
  private now() { return (this.c.now ?? (() => new Date()))(); }
  private ideas(roomId: string): TalkIdea[] | null {
    if (!this.c.ideasOf) return null;
    try { return this.c.ideasOf(roomId); } catch (e) { this.log(`ideas left out: ${(e as Error).message}`); return null; }
  }
  private log(s: string) { (this.c.log ?? (() => {}))(`[voice] ${s}`); }
  private save() { if (this.c.callsFile) atomicWriteJson(this.c.callsFile, this.calls); }
  get watches(): readonly Watch[] { return this.calls.watches; }

  /** The agent id the talk link points at, or null (voice off, or no agent made yet: `npx tsx src/voice/cli.ts agent-setup`). */
  talkAgentId(): string | null {
    if (!this.c.talk || !this.c.el) return null;
    try { return readIds(this.c.idsFile ?? IDS_FILE).agent_id ?? null; } catch { return null; }
  }

  /** Refresh the talk agent from the room's record, then the closing line with the person's link.
   *  Null (and the brief keeps its usual closing) when the link is off or the refresh failed. */
  async talkClosing(record: RoomRecord, roomName: string, person: string, roomId?: string): Promise<{ closing: string; talk: NonNullable<BriefHookInput['talk']> } | null> {
    const agentId = this.talkAgentId();
    if (!agentId || !this.c.el) return null;
    const at = snapshotStamp(this.now());
    const ideas = roomId ? this.ideas(roomId) : null;
    const live = this.live;
    try {
      await withTimeout(refreshTalkAgent(this.c.el, agentId, record, at, talkConfigFromEnv(roomLabel(roomName)), ideas, live), this.c.refreshTimeoutMs ?? 10_000, 'talk agent refresh');
    } catch (e) {
      this.log(`talk link left out: ${(e as Error).message}`);
      return null;
    }
    this.lastRefresh = { agentId, room: roomName, sig: signature(record, ideas), at: this.now().getTime(), live };
    const caller = firstOf(person);
    // room_id and since ride in the link (dynamic variables) for whats_new, whichever mode is on now:
    // a tunnel that comes up later still serves this link.
    const link = talkLink(agentId, caller, at, roomId ? { roomId, since: this.now().toISOString() } : undefined);
    return { closing: talkLine(link), talk: { agentId, caller, at: this.now().toISOString() } };
  }

  /** After the text brief posted: the audio clip in its thread; start watching for a call. */
  async afterBrief(b: BriefHookInput): Promise<VoiceResult> {
    const out: VoiceResult = { posts: [], events: [], usage: [] };
    if (b.talk) {
      this.calls.watches.push({ room_id: b.roomId, room_name: b.roomName, thread_id: b.threadId, message_id: b.messageId, person: b.person, caller: b.talk.caller, agent_id: b.talk.agentId, link_at: b.talk.at });
      this.save();
      out.events.push(`talk link for ${b.talk.caller}`);
    }
    if (!this.c.audio) return out;
    const since = b.since ? new Date(b.since) : null;
    const res = await audioBrief(
      {
        briefText: b.briefText, person: firstOf(b.person), room: `the ${roomLabel(b.roomName)} room`,
        ...(since && !Number.isNaN(since.getTime()) ? { awayFor: `since ${since.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' })}` } : {}),
      },
      { claude: this.c.claude, el: this.c.el, media: this.c.media(b.roomId) },
      { room: { id: b.roomId, name: b.roomName }, threadId: b.threadId },
    );
    out.usage.push(...res.usage);
    if (!res.ok) { out.events.push(`audio_failed: ${res.reason}`); return out; }
    if (this.c.saveDir) {
      try {
        mkdirSync(this.c.saveDir, { recursive: true });
        const f = join(this.c.saveDir, `${this.now().toISOString().replace(/[-:]/g, '').slice(0, 13)}-${res.filename}`);
        writeFileSync(f, res.mp3);
        this.log(`clip saved: ${f}`);
      } catch (e) { this.log(`clip not saved: ${(e as Error).message}`); }
    }
    if (res.post) out.posts.push(res.post);
    else out.events.push(`audio not posted: ${b.roomName} not in CK_POST_ROOMS (${Math.round(res.durationS)} s clip made)`);
    this.log(`audio brief for ${firstOf(b.person)}: ${res.durationS.toFixed(1)} s, ${res.words} words${res.post ? '' : ' (not posted)'}`);
    return out;
  }

  /** About once a minute. With a tool configured, first checks the tunnel (syncTool); otherwise does
   *  nothing (no network) while no link is open. */
  async tick(): Promise<TraceLine[]> {
    await this.syncTool();
    const now = this.now().getTime();
    const ttl = (this.c.watchHours ?? 3) * 3_600_000;
    const open = this.calls.watches.filter((w) => now - Date.parse(w.link_at) < ttl);
    if (open.length !== this.calls.watches.length) { this.calls.watches = open; this.save(); }
    if (!open.length || !this.c.el) return [];
    await this.refreshOpen(open);
    const lines: TraceLine[] = [];
    for (const agentId of [...new Set(open.map((w) => w.agent_id))]) {
      let call;
      try { call = await fetchCall(this.c.el, agentId); } catch (e) { this.log(`call check failed: ${(e as Error).message}`); continue; }
      if (!call || this.calls.done.includes(call.id)) continue;
      const startMs = call.startUnix * 1000;
      const w = open.filter((x) => x.agent_id === agentId && startMs >= Date.parse(x.link_at) - 60_000
        && (!call.callerName || call.callerName.toLowerCase() === x.caller.toLowerCase()))
        .sort((a, b) => b.link_at.localeCompare(a.link_at))[0];
      if (!w) continue;
      // One attempt per call: marked before the model call, so an error never becomes a retry storm.
      this.calls.done = [...this.calls.done, call.id].slice(-500);
      this.calls.watches = this.calls.watches.filter((x) => x !== w);
      this.save();
      lines.push(await this.postSummary(w, call));
    }
    return lines;
  }

  /** While a link is open, keep the talk agent's prompt on the room's current record: re-PATCH when
   *  the record changed (message count, last message, documents) or the last refresh is over
   *  refreshEveryMin old (so "my notes run to" stays close to now). There is one agent, so the
   *  newest link's room wins, as it does when a link is posted. A failure is retried next tick. */
  private async refreshOpen(open: Watch[]): Promise<boolean> {
    if (!this.c.recordOf || !this.c.el) return false;
    const w = [...open].sort((a, b) => b.link_at.localeCompare(a.link_at))[0];
    let record: RoomRecord | null;
    try { record = this.c.recordOf(w.room_id); } catch { record = null; }
    if (!record) return false;
    const ideas = this.ideas(w.room_id);
    const sig = signature(record, ideas);
    const now = this.now();
    const last = this.lastRefresh;
    const live = this.live;
    // Live (the tool is up): whats_new covers anything after the snapshot, so the prompt is only
    // rebuilt when the mode or the room changes. Fallback: on every change, and every refreshEveryMin.
    const due = !last || last.agentId !== w.agent_id || last.room !== w.room_name || last.live !== live
      || (!live && (last.sig !== sig || now.getTime() - last.at >= (this.c.refreshEveryMin ?? 15) * 60_000));
    if (!due) return false;
    try {
      await withTimeout(refreshTalkAgent(this.c.el, w.agent_id, record, snapshotStamp(now), talkConfigFromEnv(roomLabel(w.room_name)), ideas, live), this.c.refreshTimeoutMs ?? 10_000, 'talk agent refresh');
    } catch (e) {
      this.log(`talk agent refresh failed (next tick retries): ${(e as Error).message}`);
      return false;
    }
    this.lastRefresh = { agentId: w.agent_id, room: w.room_name, sig, at: now.getTime(), live };
    this.log(`talk agent refreshed from ${w.room_name}: ${record.messages.length} messages, notes run to ${snapshotStamp(now)}${live ? ' (live tool on)' : ''}`);
    return true;
  }

  /** True while the whats_new tool is attached and its tunnel answers. */
  get live(): boolean { return this.toolMode === 'live'; }

  /** Attach whats_new when the tunnel answers (or its URL changed), detach it when it doesn't, so a
   *  call never waits on a dead URL. The first call always settles the agent one way or the other
   *  (a previous run may have left the tool attached). Never throws. */
  async syncTool(): Promise<void> {
    const t = this.c.tool;
    const agentId = this.talkAgentId();
    if (!t || !agentId || !this.c.el) return;
    let url: string | null = null;
    try { url = t.url(); } catch { url = null; }
    const up = url ? await (t.probe ?? probeTunnel)(url) : false;
    try {
      if (up && (this.toolMode !== 'live' || this.toolUrl !== url)) {
        const r = await attachTool(this.c.el, agentId, url!, t.secret, this.c.idsFile ?? IDS_FILE);
        this.toolMode = 'live';
        this.toolUrl = url;
        this.log(`live tool on: whats_new → ${url}${r.created.length ? ` (made ${r.created.join(', ')})` : ''}`);
      } else if (!up && this.toolMode !== 'off') {
        await detachTool(this.c.el, agentId);
        if (this.toolMode === 'live') this.log(`live tool off: ${url ? `the tunnel at ${url} isn't answering` : 'no tunnel URL'}; back to refreshing the prompt on each change`);
        else this.log(`live tool off (${url ? `the tunnel at ${url} isn't answering` : 'no tunnel URL: CK_TALK_TOOL_URL or tunnel.log'}); refreshing the prompt on each change instead`);
        this.toolMode = 'off';
        this.toolUrl = null;
      }
    } catch (e) { this.log(`live tool sync failed (next tick retries): ${(e as Error).message}`); }
  }

  /** The whats_new answer: the call's room (var_room_id, else the newest open link's), anything after
   *  its link's snapshot (var_since, else that link's time). */
  answerWhatsNew(req: ToolRequest): WhatsNewAnswer {
    const nowMs = this.now().getTime();
    const given = (s?: string) => (s && s !== 'none' ? s : null);
    const newest = [...this.calls.watches].sort((a, b) => b.link_at.localeCompare(a.link_at));
    const roomId = given(req.room_id) ?? newest[0]?.room_id ?? null;
    const w = newest.find((x) => x.room_id === roomId);
    let sinceMs = Date.parse(given(req.since) ?? '');
    if (Number.isNaN(sinceMs)) sinceMs = w ? Date.parse(w.link_at) : nowMs - 3 * 3_600_000;
    let record: RoomRecord | null = null;
    try { record = roomId && this.c.recordOf ? this.c.recordOf(roomId) : null; } catch { record = null; }
    return whatsNew(record, roomId ? this.ideas(roomId) : null, sinceMs, nowMs);
  }

  private async postSummary(w: Watch, call: NonNullable<Awaited<ReturnType<typeof fetchCall>>>): Promise<TraceLine> {
    const events: string[] = [];
    let posts: TracePost[] = [];
    let error: string | null = null;
    let usage: Usage | null = null;
    try {
      const s = await summariseCall(this.c.claude, call, w.caller);
      usage = s.usage;
      const r = await sendPublic({ poster: this.c.poster, state: this.c.state }, w.room_id, w.room_name, w.thread_id, formatCallSummary(w.caller, call, s.summary), events);
      posts = r.posts;
      error = r.error;
    } catch (e) {
      error = `call_summary_failed: ${(e as Error).message}`;
    }
    const line: TraceLine = {
      schema: 'ck.trace/1', ts: this.now().toISOString(), decision_id: randomUUID(), room_id: w.room_id, room_name: w.room_name,
      kind: posts.some((p) => p.route !== 'owner_private') ? 'reply' : posts.length ? 'owner_note' : 'silence',
      trigger: 'message', inputs: [], burst: null,
      items: [{ message_id: w.message_id, job: 'none', verdict: null, restriction: null, clashes_with: null, sources: [], decision_record: null, brief_for: w.person }],
      posts,
      model: usage ? { id: usage.model, calls: 1, input_tokens: usage.input, cache_read_tokens: usage.cacheRead, cache_write_tokens: usage.cacheWrite, output_tokens: usage.output, latency_ms: usage.ms } : null,
      error: [error, `talk_call ${call.id} (${Math.round(call.durationS)} s)`, ...events].filter(Boolean).join('; '),
    };
    writeTrace(line, this.c.traceFile);
    this.log(`call ${call.id} by ${w.caller}: summary ${posts.length ? 'posted' : 'not posted'}${error ? ` (${error})` : ''}`);
    return line;
  }
}
