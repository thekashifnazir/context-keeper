// state: what must survive a restart, keyed by room id: processed message ids, post idempotency
// keys and the idea list. Written atomically (temp file, then rename), so a crash mid-write
// leaves the old file intact. JSONL readers skip a torn last line.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalise } from '../shared/quote.ts';

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

interface RoomState { processed: string[]; posted: Record<string, string | null>; ideas: Idea[] }
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
}
