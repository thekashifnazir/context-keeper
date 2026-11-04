// state: what must survive a restart, keyed by room id: processed message ids, post idempotency
// keys, the idea list, and who joined or was briefed (job C). Written atomically (temp file, then
// rename), so a crash mid-write leaves the old file intact. JSONL readers skip a torn last line.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalise } from '../shared/quote.ts';
import type { Input } from './pipeline.ts';

export function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

/** Parse JSONL, skipping a torn (half-written) last line; a bad line elsewhere is an error. */
export function readJsonl<T>(text: string): T[] {
  const lines = text.split('\n').filter((l) => l.trim());
  const out: T[] = [];
  lines.forEach((l, i) => {
    try { out.push(JSON.parse(l) as T); } catch (e) { if (i !== lines.length - 1) throw e; }
  });
  return out;
}

/** Idempotency key for a post: room + thread + hash of the normalised text. */
export const postKey = (roomId: string, threadId: string | null, body: string) =>
  `${roomId}:${threadId ?? '-'}:${createHash('sha256').update(normalise(body)).digest('hex').slice(0, 24)}`;

export interface Idea { message_id: string; by: string; text: string; at: string }

/** Job C: a brief started but whose text hasn't posted yet, with what's needed to run it again after a
 *  restart (the message, the trigger, the chat handle for the voice clip) and the attempts so far. */
export interface PendingBrief { input: Input; trigger: { kind: 'joiner' | 'returner'; since: string | null }; handle: string | null; attempts: number }

interface RoomState { processed: string[]; posted: Record<string, string | null>; ideas: Idea[]; briefed?: string[]; joined?: string[]; pending_briefs?: Record<string, PendingBrief> }
interface StateFile { rooms: Record<string, RoomState> }

export class AgentState {
  private data: StateFile;
  constructor(private file: string | null) {
    this.data = { rooms: {} };
    if (file && existsSync(file)) {
      try { this.data = JSON.parse(readFileSync(file, 'utf8')) as StateFile; } catch { /* unreadable: start clean, never crash */ }
    }
  }
  private room(id: string): RoomState {
    return (this.data.rooms[id] ??= { processed: [], posted: {}, ideas: [] });
  }
  private save(): void { if (this.file) atomicWriteJson(this.file, this.data); }

  isProcessed(roomId: string, messageId: string) { return this.room(roomId).processed.includes(messageId); }
  markProcessed(roomId: string, ids: string[]) {
    const r = this.room(roomId);
    r.processed = [...r.processed, ...ids.filter((i) => !r.processed.includes(i))].slice(-5000);
    this.save();
  }
  postedEvent(key: string, roomId: string): string | null | undefined { return this.room(roomId).posted[key]; }
  recordPost(roomId: string, key: string, eventId: string | null) { this.room(roomId).posted[key] = eventId; this.save(); }
  addIdea(roomId: string, idea: Idea) {
    const r = this.room(roomId);
    if (!r.ideas.some((i) => i.message_id === idea.message_id)) r.ideas.push(idea);
    this.save();
  }
  ideas(roomId: string) { return [...this.room(roomId).ideas]; }
  /** Job C: a room_join seen for this sender (Switch sends it just before their first message). */
  markJoined(roomId: string, sender: string) {
    const r = this.room(roomId);
    r.joined ??= [];
    if (!r.joined.includes(sender)) { r.joined.push(sender); this.save(); }
  }
  hasJoined(roomId: string, sender: string) { return (this.room(roomId).joined ?? []).includes(sender); }
  /** Job C: briefed once per person per room. Marked once the text brief has posted (or the attempt
   *  ended with nothing to post), which also clears the pending brief. */
  isBriefed(roomId: string, sender: string) { return (this.room(roomId).briefed ?? []).includes(sender); }
  markBriefed(roomId: string, sender: string) {
    const r = this.room(roomId);
    r.briefed ??= [];
    const pending = !!r.pending_briefs?.[sender];
    if (!pending && r.briefed.includes(sender)) return;
    if (pending) delete r.pending_briefs![sender];
    if (!r.briefed.includes(sender)) r.briefed.push(sender);
    this.save();
  }
  /** Job C: an attempt starts. Saved before the brief runs, so a restart before its text posts runs it
   *  again (see pendingBriefs); returns the attempt number. */
  beginBrief(roomId: string, input: Input, trigger: PendingBrief['trigger'], handle: string | null): number {
    const r = this.room(roomId);
    r.pending_briefs ??= {};
    const p = (r.pending_briefs[input.sender] ??= { input, trigger, handle, attempts: 0 });
    p.attempts += 1;
    this.save();
    return p.attempts;
  }
  hasPendingBrief(roomId: string, sender: string) { return !!this.room(roomId).pending_briefs?.[sender]; }
  pendingBriefs(): { roomId: string; brief: PendingBrief }[] {
    return Object.entries(this.data.rooms).flatMap(([roomId, r]) => Object.values(r.pending_briefs ?? {}).map((brief) => ({ roomId, brief })));
  }
}
