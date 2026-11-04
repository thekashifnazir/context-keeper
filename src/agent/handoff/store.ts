// handoff/store: job E's memory on disk (state/handoff.json, atomic writes), so a pending hand-off
// or sign-off survives a restart. One record per idea, keyed by an idempotency key
// (E:<origin room>:<idea message id>). Each outbound step keeps its own status:
//   pending → sending → done, and a step found at "sending" after a restart becomes "unknown":
// we may or may not have sent it, so it is never sent again (at most once: a duplicate hand-off
// would mean a duplicate GitHub issue, and there's no loop guard between agents).
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJson } from '../state.ts';

export type StepState = 'pending' | 'sending' | 'done' | 'unknown';
export const STEPS = ['room', 'context', 'handoff', 'announce'] as const;
export type StepName = (typeof STEPS)[number];

export type Status =
  | 'noted' // on the idea list, waiting for the owner
  | 'approved' // the owner said go; chain steps running
  | 'stalled' // a step failed; retried on tick/restart
  | 'not_permitted' // Switch refused the targeted message (target_statuses)
  | 'handed_off' // Claude Code has it; waiting for its report
  | 'timed_out' // no report in time; said so in the thread (a late report still counts)
  | 'not_done' // Claude Code reported it couldn't (declined at the approval card, error)
  | 'awaiting_signoff' // result posted in the original thread; waiting for the raiser
  | 'signed_off'
  | 'reopened';

export interface Source { ref: string; quote: string }

export type BuildStage = 'waiting' | 'building' | 'blocked';
export type StageEvent = 'building' | 'blocked' | 'unblocked';

export interface IdeaRecord {
  ref: string; // short id the owner types: "I3"
  key: string; // idempotency key
  attempt: number; // 1, or more only after an explicit "approve I3 again"
  room_id: string;
  room_name: string;
  thread_id: string; // the original thread (the idea's own message id when it was top-level)
  message_id: string;
  sender: string; // Switch sender id of the person who raised it (only they, or the owner, sign off)
  sender_name: string; // display name
  sender_handle: string | null; // chat handle, for create_room user_names
  text: string;
  at: string;
  sources: Source[]; // cited context (already through job A's quote gate)
  /** Job A said `might-be-related` and named a new part: the record blocks it builds on, and that part. */
  builds_on?: string[];
  new_part?: string;
  status: Status;
  noted_event: string | null; // the owner-desk note
  approved: { by: string; message_id: string; at: string } | null;
  build_room: { id: string; name: string } | null;
  steps: Record<StepName, StepState>;
  /** Event ids of what we posted, per attempt. building / blocked / unblocked are the raiser's stage
   *  lines (each at most once per attempt; 'sending' before the post, so a restart never repeats one). */
  events: Partial<Record<StepName | 'signoff_request' | 'closing' | 'timeout' | 'nudge' | 'progress' | StageEvent, string | null>>;
  /** Where the build is while handed off: waiting to start, building, or blocked on the owner's OK. */
  stage?: BuildStage;
  failures: number;
  last_error: string | null;
  target_status: string | null;
  handed_at: string | null;
  report: { message_id: string; body: string; links: string[]; outcome: 'done' | 'not_done'; at: string } | null;
  /** note: the feedback in a "signed off, with a note" reply (Kash, 4 Nov: "it might give feedback as well"). */
  signoff: { by: string; by_name: string; message_id: string; verdict: 'signed_off' | 'reopened'; text: string; at: string; note?: string } | null;
  /** The raiser (or owner) got "is that a sign-off?" once for this idea: never asked again. */
  signoff_asked?: boolean;
  /** Sender ids already told "only <raiser> or <owner> can sign this off" (once per person per idea). */
  signoff_refused?: string[];
  /** Sender ids already given the "Thanks, Sam, noted. Rowan signs this one off." line (chain.heard;
   *  shares the one-line-per-person budget with signoff_refused). */
  heard?: string[];
}

interface FileShape {
  next: number;
  ideas: Record<string, IdeaRecord>;
  build_rooms: Record<string, { id: string; name: string }>; // by room name
  seen: string[]; // message ids this module already acted on
}

export const ideaKey = (roomId: string, messageId: string) => `E:${roomId}:${messageId}`;
export const freshSteps = (): Record<StepName, StepState> => ({ room: 'pending', context: 'pending', handoff: 'pending', announce: 'pending' });

export class HandoffStore {
  private data: FileShape = { next: 1, ideas: {}, build_rooms: {}, seen: [] };
  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try { this.data = { ...this.data, ...(JSON.parse(readFileSync(file, 'utf8')) as FileShape) }; } catch { /* unreadable: start clean, never crash */ }
    }
  }
  save(): void { if (this.file) atomicWriteJson(this.file, this.data); }

  nextRef(): string { return `I${this.data.next++}`; }
  get(key: string): IdeaRecord | undefined { return this.data.ideas[key]; }
  byRef(ref: string): IdeaRecord | undefined {
    const r = ref.trim().toUpperCase();
    return Object.values(this.data.ideas).find((i) => i.ref.toUpperCase() === r || i.message_id === ref.trim());
  }
  all(): IdeaRecord[] { return Object.values(this.data.ideas); }
  put(rec: IdeaRecord): void { this.data.ideas[rec.key] = rec; this.save(); }

  buildRoom(name: string) { return this.data.build_rooms[name]; }
  setBuildRoom(name: string, room: { id: string; name: string }) { this.data.build_rooms[name] = room; this.save(); }
  isBuildRoom(roomId: string) { return Object.values(this.data.build_rooms).some((r) => r.id === roomId); }

  seen(messageId: string) { return this.data.seen.includes(messageId); }
  markSeen(messageId: string) { this.data.seen = [...this.data.seen, messageId].slice(-2000); this.save(); }
}
