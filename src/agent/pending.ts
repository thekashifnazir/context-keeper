// pending: the owner's open items (job B confirms, job D clashes), saved in state/ so they survive a
// restart (R6). Each item has a short number (#1, #2, ...) the owner can name in the desk. Written
// atomically, like state.ts; an unreadable file starts clean and never crashes the agent.
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJson } from './state.ts';

export interface Details {
  summary: string;
  why: string;
  date: string; // YYYY-MM-DD, or ""
  action_owner: string; // job B: who the chat named to do the work, else "" (unassigned)
  suggested_owner: string; // only when the record supports it, else ""
  owner_basis: string; // the record line behind the suggestion, else ""
  reopen_if: string; // job B: what would make it worth revisiting (record or chat), else ""
  options: string[];
}

export interface PendingItem {
  n: number;
  kind: 'B' | 'D';
  /** Job B: 'confirm' = a teammate's decision waiting for the approver; 'assign' = the owner stated it
   *  (already logged in the thread) and the desk is asked only for the missing owner, due date or
   *  reopen-if. Absent in files written before 3 Nov: read as 'confirm'. */
  stage?: 'confirm' | 'assign';
  status: 'open' | 'confirmed' | 'dropped';
  room_id: string;
  room_name: string;
  thread_id: string; // the public thread the loop-back line goes into
  message_id: string; // the message that raised it
  raised_by: string; // display name
  raised_by_sender: string;
  text: string; // what they said
  details: Details;
  clashes_with: string | null; // job D
  note_event_id: string | null; // the owner-desk note, so a thread reply finds its item
  created_at: string;
  resolved_at: string | null;
  /** owner = the action owner ("" = unassigned), date = the due date. */
  resolution: { by: string; message_id: string; summary: string; owner: string; date: string; reopen_if?: string; line: string } | null;
}

interface PendingFile { next: number; items: PendingItem[] }

export class PendingStore {
  private data: PendingFile = { next: 1, items: [] };
  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try { this.data = JSON.parse(readFileSync(file, 'utf8')) as PendingFile; } catch { /* start clean */ }
    }
  }
  private save(): void { if (this.file) atomicWriteJson(this.file, this.data); }

  /** Adds an item, or returns the existing one for the same message (a retry never doubles it). */
  add(item: Omit<PendingItem, 'n' | 'resolved_at' | 'resolution' | 'note_event_id'> & { note_event_id?: string | null }): PendingItem {
    const prior = this.data.items.find((i) => i.room_id === item.room_id && i.message_id === item.message_id && i.kind === item.kind);
    if (prior) return prior;
    const full: PendingItem = { note_event_id: null, resolved_at: null, resolution: null, ...item, n: this.data.next++ };
    this.data.items.push(full);
    this.save();
    return full;
  }
  setNoteEvent(n: number, eventId: string | null): void {
    const it = this.get(n);
    if (it) { it.note_event_id = eventId; this.save(); }
  }
  resolve(n: number, status: 'confirmed' | 'dropped', resolution: PendingItem['resolution']): void {
    const it = this.get(n);
    if (!it) return;
    it.status = status;
    it.resolution = resolution;
    it.resolved_at = new Date().toISOString();
    this.save();
  }
  get(n: number): PendingItem | undefined { return this.data.items.find((i) => i.n === n); }
  open(): PendingItem[] { return this.data.items.filter((i) => i.status === 'open'); }
  all(): PendingItem[] { return [...this.data.items]; }
  /** Logged decisions (job B), oldest first: the Decision log's content. An owner-stated decision
   *  whose owner or date is still being asked for is already logged, so it counts. */
  decisions(roomId?: string): PendingItem[] {
    return this.data.items.filter((i) => i.kind === 'B' && (i.status === 'confirmed' || (i.status === 'open' && i.stage === 'assign')) && (!roomId || i.room_id === roomId));
  }
}
