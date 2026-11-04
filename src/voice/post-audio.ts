// post-audio: post the MP3 into a Switch room as an attachment, through Switch's outbound media route
// (POST /agents/{id}/rooms/{room}/media, multipart `file` as audio/mpeg plus `caption`, optional
// `thread_id`). Proven on Slack: it plays inline in Slack's own player, posted by the Switch bot with
// "context-keeper:" in front of the caption.
// Safety while other lanes are live: like src/agent/main.ts, it only posts into rooms whose name starts
// with one of CK_POST_ROOMS (default "ck-smoke-,ck-eval-"); anywhere else it refuses and returns null.
import type { TracePost } from '../shared/trace.ts';

export interface MediaUpload { roomId: string; mp3: Buffer; filename: string; caption: string; threadId?: string | null }

export interface SwitchMedia {
  /** Upload one file; returns the new event id (or null if Switch didn't say). Throws on a non-2xx. */
  postMedia(up: MediaUpload): Promise<string | null>;
}

export function realSwitchMedia(opts: { endpoint: string; agentId: string; token: string; connectionId?: string; sessionId?: string }): SwitchMedia {
  return {
    async postMedia(up) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(up.mp3)], { type: 'audio/mpeg' }), up.filename);
      form.append('caption', up.caption);
      if (up.threadId) form.append('thread_id', up.threadId);
      const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
      if (opts.connectionId) headers['X-Switch-Connection-Id'] = opts.connectionId;
      if (opts.sessionId) headers['X-Switch-Session-Id'] = opts.sessionId;
      const res = await fetch(`${opts.endpoint}/agents/${opts.agentId}/rooms/${encodeURIComponent(up.roomId)}/media`, {
        method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`media upload: ${res.status} ${text.slice(0, 200)}`);
      try {
        const d = JSON.parse(text);
        return d?.event_id ?? d?.message_id ?? d?.result?.event_id ?? d?.result?.message_id ?? null;
      } catch {
        return null;
      }
    },
  };
}

export const postPrefixes = () => (process.env.CK_POST_ROOMS ?? 'ck-smoke-,ck-eval-').split(',').map((s) => s.trim()).filter(Boolean);

/** Caption for the clip: the D3-3 wording, with who it's for and its length. No "Context Keeper ·" in
 *  front: Switch's media route already posts it as "context-keeper: …" (4 Nov cloud call shot). */
export const audioCaption = (person: string, seconds: number) =>
  `🎧 60-second audio brief for ${person} (${Math.round(seconds)} s). The written brief above is the record.`;

/** A safe file name, e.g. "catch-up-rowan.mp3" (Slack needs the .mp3 extension to play it). */
export const audioFilename = (person: string) => `catch-up-${person.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief'}.mp3`;

/** Post the clip if the room is allowed. Returns the trace post (for the brief's ck.trace/1 line), or
 *  null when the room isn't allowed. Throws on an upload error: the caller fails quiet (text only). */
export async function postAudio(sw: SwitchMedia, room: { id: string; name: string }, up: Omit<MediaUpload, 'roomId'>, prefixes = postPrefixes()): Promise<TracePost | null> {
  if (!prefixes.some((p) => room.name.startsWith(p))) return null;
  const eventId = await sw.postMedia({ ...up, roomId: room.id });
  return {
    route: up.threadId ? 'public_thread' : 'public_top',
    room_id: room.id,
    room_name: room.name,
    thread_id: up.threadId ?? null,
    event_id: eventId,
    body: `[audio ${up.filename}] ${up.caption}`,
  };
}
