// memory: the room's record, read from Switch. Context Keeper keeps no copy of a room on disk; what
// it cites is what the room holds:
//   - room documents: list_references names them (id, name, who created them), and
//     load_internal_documents fetches their text. The seeded project docs keep their file name in
//     the description ("... (seeded project document, product.md)"), so citations still read
//     "product.md §2"; any other room document gets a file name from its own name.
//   - the "Channel archive" document: the dated history from before the room moved here (chat apps
//     can't backdate messages), as YAML with message ids, so "led-011" still cites the same message.
//   - room history: read_context, for messages posted in the room itself before the agent started
//     (and again after a stream gap). Live messages are added as the stream delivers them.
//   - the agent's own "Decision log" document (src/agent/decision-log.ts), last among the docs.
// Loaded on the first message from a room, refreshed before each decision (one list_references call:
// a new or removed document is fetched or dropped; only the creating agent can edit a room
// document, so the only edits to existing ones are our own, which re-read the document at once).
// Fails soft: an error keeps the last record and is logged; a room with no documents has no record.
import { parse } from 'yaml';
import { DECISION_LOG, DECISION_LOG_FILE, parseLog, renderLog, upsertEntry, type LogEntry, type LoggedDecision } from './decision-log.ts';
import type { ArchiveMessage, RoomDoc, RoomRecord } from './room.ts';
import { toMs } from './room.ts';

export const ARCHIVE_DOC = 'Channel archive';

/** One operation call, in the room's session (null = no room), returning the op's result. */
export type Op = (roomId: string | null, name: string, args: Record<string, unknown>) => Promise<any>;

export interface DocMeta { id: string; name: string; description?: string | null; created_by_agent_id?: string | null }
interface LoadedDoc extends DocMeta { content: string }

interface ContextEntry { id: string; kind?: string; sender?: string; sender_name?: string; body?: string; timestamp?: number }

export interface MemoryOptions {
  op: Op;
  agentId: string;
  /** Our own name and sender ids: their posts (and Switch's notices made in our name) are not record. */
  selfNames: () => Set<string>;
  selfSenders: Set<string>;
  displayName?: (sender: string, handle: string) => Promise<string>;
  /** May this room be written to (the Decision log posts a visible notice)? Same rule as posting. */
  canWrite?: (roomId: string) => boolean;
  log?: (msg: string) => void;
}

interface RoomState {
  roomId: string;
  name: string;
  docs: LoadedDoc[]; // as Switch lists them, the archive excluded
  archive: ArchiveMessage[];
  archiveOrder: string[]; // the archive's own `docs:` list, by file name
  live: ArchiveMessage[]; // read_context history + stream messages, by time
  record: RoomRecord;
  logDocId: string | null; // our Decision log, once it exists
  logName: string;
  log: LogEntry[];
}

const SEEDED = /\(seeded project document, ([\w.-]+\.md)\)/;
const NOTICE = /^📄 (created|updated|deleted) room document “.*”\.?$/u;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';

/** The file name a document is cited by. */
export function fileNameOf(d: DocMeta, ours: boolean): string {
  if (ours && d.name.startsWith(DECISION_LOG)) return DECISION_LOG_FILE;
  const m = (d.description ?? '').match(SEEDED);
  return m ? m[1] : `${slug(d.name)}.md`;
}

/** The Channel archive's YAML → its messages and its doc order. Same mapping as room.ts loadDemoRoom. */
export function parseArchive(text: string): { messages: ArchiveMessage[]; order: string[] } {
  const hist = parse(text) ?? {};
  const messages = ((hist.messages ?? []) as any[]).map((m) => ({ id: m.id, at: String(m.at), author: m.author, text: m.text, thread: m.thread ?? null }));
  const order = ((hist.docs ?? []) as string[]).map((p) => String(p).split('/').pop()!);
  return { messages, order };
}

export class RoomMemory {
  private rooms = new Map<string, RoomState>();
  private loading = new Map<string, Promise<RoomState | null>>();
  constructor(private o: MemoryOptions) {}

  private log(m: string) { (this.o.log ?? console.log)(m); }
  private ours(d: DocMeta) { return d.created_by_agent_id === this.o.agentId; }

  /** The record for a room, loading it from Switch the first time. null = the room has no documents. */
  async record(roomId: string, roomName: string): Promise<RoomRecord | null> {
    const have = this.rooms.get(roomId);
    if (have) return have.record;
    let p = this.loading.get(roomId);
    if (!p) {
      p = this.load(roomId, roomName).catch((e) => { this.log(`memory: loading ${roomName} from Switch failed: ${(e as Error).message}`); return null; });
      this.loading.set(roomId, p);
      void p.finally(() => this.loading.delete(roomId));
    }
    return (await p)?.record ?? null;
  }

  /** The record as loaded so far, without calling Switch (null if not loaded). */
  cached(roomId: string): RoomRecord | null { return this.rooms.get(roomId)?.record ?? null; }

  private async listDocs(roomId: string): Promise<DocMeta[]> {
    const r = await this.o.op(roomId, 'list_references', {});
    return ((r?.documents ?? []) as DocMeta[]).filter((d) => d && d.id && d.name);
  }

  private async fetchDocs(roomId: string, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const r = await this.o.op(roomId, 'load_internal_documents', { ids });
    const list = (Array.isArray(r) ? r : (r?.documents ?? [])) as { id: string; content?: string }[];
    return new Map(list.map((d) => [d.id, d.content ?? '']));
  }

  private async history(roomId: string): Promise<ArchiveMessage[]> {
    const r = await this.o.op(roomId, 'read_context', { limit: 500 });
    const self = this.o.selfNames();
    const out: ArchiveMessage[] = [];
    const take = async (e: ContextEntry, thread: string | null) => {
      if (!e?.id || (e.kind && e.kind !== 'message') || !e.body?.trim()) return;
      if ((e.sender && this.o.selfSenders.has(e.sender)) || (e.sender_name && self.has(e.sender_name))) return;
      if (NOTICE.test(e.body.trim())) return; // Switch's own "created room document" notices
      const who = this.o.displayName && e.sender ? await this.o.displayName(e.sender, e.sender_name ?? e.sender) : (e.sender_name ?? e.sender ?? '');
      out.push({ id: e.id, at: new Date(e.timestamp ?? 0).toISOString(), author: who, text: e.body, thread });
    };
    for (const t of (r?.threads ?? []) as { root: ContextEntry; replies?: ContextEntry[] }[]) {
      await take(t.root, null);
      for (const rep of t.replies ?? []) await take(rep, t.root.id);
    }
    return out.sort((a, b) => toMs(a.at) - toMs(b.at));
  }

  private async load(roomId: string, roomName: string): Promise<RoomState | null> {
    const metas = await this.listDocs(roomId);
    if (!metas.length) return null;
    const texts = await this.fetchDocs(roomId, metas.map((d) => d.id));
    const st: RoomState = {
      roomId, name: roomName, docs: [], archive: [], archiveOrder: [], live: [], record: { name: roomName, docs: [], messages: [] },
      logDocId: null, logName: DECISION_LOG, log: [],
    };
    this.setDocs(st, metas.map((m) => ({ ...m, content: texts.get(m.id) ?? '' })));
    st.live = await this.history(roomId).catch((e) => { this.log(`memory: read_context for ${roomName} failed: ${(e as Error).message}`); return []; });
    this.rebuild(st);
    this.rooms.set(roomId, st);
    this.log(`memory: ${roomName} from Switch: ${st.record.docs.length} documents (${st.record.docs.map((d) => d.file).join(', ')}), ${st.archive.length} archive messages, ${st.live.length} from room history${st.logDocId ? `, Decision log ${st.log.length} entries` : ''}`);
    return st;
  }

  private setDocs(st: RoomState, docs: LoadedDoc[]) {
    const archive = docs.find((d) => d.name === ARCHIVE_DOC);
    if (archive) {
      try {
        const a = parseArchive(archive.content);
        st.archive = a.messages;
        st.archiveOrder = a.order;
      } catch (e) { this.log(`memory: ${st.name}: the Channel archive isn't readable YAML (${(e as Error).message}); left out`); st.archive = []; }
    } else st.archive = [];
    st.docs = docs.filter((d) => d !== archive);
    // Our own Decision log: the first doc of ours named "Decision log" or "Decision log (vN)".
    const mine = st.docs.find((d) => this.ours(d) && (d.name === DECISION_LOG || /^Decision log \(v\d+\)$/.test(d.name)));
    st.logDocId = mine?.id ?? null;
    st.log = mine ? parseLog(mine.content) : st.log;
    if (mine) st.logName = mine.name;
    else {
      // Someone else's "Decision log" (e.g. a re-registered agent's) can't be edited: ours gets a new name.
      const taken = new Set(st.docs.map((d) => d.name));
      let name = DECISION_LOG;
      for (let v = 2; taken.has(name); v++) name = `${DECISION_LOG} (v${v})`;
      st.logName = name;
    }
  }

  /** Docs in a stable order: the archive's own list first (the seeded docs, as the room had them),
   *  then any other document as Switch lists it, our Decision log last (it changes most). */
  private rebuild(st: RoomState) {
    // Our log is named first, so it is always "decision-log.md"; any clash gets "-2", "-3".
    const used = new Set<string>(st.logDocId ? [DECISION_LOG_FILE] : []);
    const named = st.docs.map((d) => {
      if (d.id === st.logDocId) return { d, file: DECISION_LOG_FILE };
      let file = fileNameOf(d, false);
      for (let i = 2; used.has(file); i++) file = file.replace(/(-\d+)?\.md$/, `-${i}.md`);
      used.add(file);
      return { d, file };
    });
    const rank = (x: { d: LoadedDoc; file: string }) => {
      if (x.d.id === st.logDocId) return 1e6;
      const i = st.archiveOrder.indexOf(x.file);
      return i >= 0 ? i : 1000 + named.indexOf(x);
    };
    const docs: RoomDoc[] = [...named].sort((a, b) => rank(a) - rank(b)).filter((x) => x.d.content.trim()).map((x) => ({ file: x.file, text: x.d.content }));
    const archiveIds = new Set(st.archive.map((m) => m.id));
    st.record.name = st.name;
    st.record.docs = docs;
    st.record.messages = [...st.archive, ...st.live.filter((m) => !archiveIds.has(m.id))];
  }

  /** A live message from the stream (already filtered by the caller). Ignored if already known. */
  addLive(roomId: string, m: ArchiveMessage): void {
    const st = this.rooms.get(roomId);
    if (!st || st.live.some((x) => x.id === m.id) || st.archive.some((x) => x.id === m.id)) return;
    st.live.push(m);
    st.record.messages.push(m);
  }

  /** Before a decision: pick up documents added or removed since the last look. */
  async refresh(roomId: string): Promise<void> {
    const st = this.rooms.get(roomId);
    if (!st) return;
    try {
      const metas = await this.listDocs(roomId);
      const known = new Map([...st.docs.map((d) => [d.id, d] as const)]);
      const archiveMeta = metas.find((m) => m.name === ARCHIVE_DOC);
      const hadArchive = st.archive.length > 0 || st.archiveOrder.length > 0;
      const fresh = metas.filter((m) => m.name !== ARCHIVE_DOC && !known.has(m.id));
      const gone = st.docs.filter((d) => !metas.some((m) => m.id === d.id));
      const archiveNew = !!archiveMeta && !hadArchive;
      if (!fresh.length && !gone.length && !archiveNew) return;
      const texts = await this.fetchDocs(roomId, [...fresh.map((m) => m.id), ...(archiveNew ? [archiveMeta!.id] : [])]);
      const keep = st.docs.filter((d) => !gone.includes(d));
      const docs: LoadedDoc[] = [
        ...(archiveMeta ? [{ ...archiveMeta, content: archiveNew ? texts.get(archiveMeta.id) ?? '' : '' }] : []),
        ...keep, ...fresh.map((m) => ({ ...m, content: texts.get(m.id) ?? '' })),
      ];
      if (archiveMeta && !archiveNew) {
        // Keep the parsed archive as it is (setDocs would re-parse an empty string).
        const { archive, archiveOrder } = st;
        this.setDocs(st, docs);
        st.archive = archive; st.archiveOrder = archiveOrder;
      } else this.setDocs(st, docs);
      this.rebuild(st);
      this.log(`memory: ${st.name}: documents changed in Switch (+${fresh.map((m) => m.name).join(', ') || '0'}${gone.length ? `, -${gone.map((d) => d.name).join(', ')}` : ''})`);
    } catch (e) { this.log(`memory: refreshing ${st.name} failed, keeping the last record: ${(e as Error).message}`); }
  }

  /** After a stream gap: re-read the room's history and add what we missed. */
  async rereadHistory(roomId: string): Promise<number> {
    const st = this.rooms.get(roomId);
    if (!st) return 0;
    try {
      const got = await this.history(roomId);
      const have = new Set([...st.live, ...st.archive].map((m) => m.id));
      const missed = got.filter((m) => !have.has(m.id));
      if (!missed.length) return 0;
      st.live = [...st.live, ...missed].sort((a, b) => toMs(a.at) - toMs(b.at));
      this.rebuild(st);
      return missed.length;
    } catch (e) { this.log(`memory: read_context after a gap failed for ${st.name}: ${(e as Error).message}`); return 0; }
  }

  roomIds(): string[] { return [...this.rooms.keys()]; }

  /** The room's Decision log entries as Switch holds them (empty before the first one). */
  decisionLog(roomId: string): LogEntry[] { return this.rooms.get(roomId)?.log ?? []; }

  /** Job B: add or update a logged decision in the room's Decision log document, then read the
   *  document back from Switch so the next decision cites what the room holds. Returns a short note
   *  for the trace; never throws. */
  async logDecision(d: LoggedDecision): Promise<string> {
    const st = this.rooms.get(d.roomId) ?? (await this.record(d.roomId, d.roomName), this.rooms.get(d.roomId));
    if (!st) return 'decision log: no record for this room; not written';
    const { entries, entry, changed, added } = upsertEntry(st.log, d);
    if (!changed) return `decision log: ${entry.id} already says this; not written`;
    const content = renderLog(st.name, entries, new Date());
    if (this.o.canWrite && !this.o.canWrite(d.roomId)) {
      this.log(`[dry-run: ${st.name} not writable] would ${added ? 'add' : 'update'} ${entry.id} in the Decision log:\n${content}`);
      return `decision log: dry-run, ${entry.id} not written`;
    }
    try {
      let how: string;
      if (st.logDocId) {
        await this.o.op(d.roomId, 'update_room_document', { document_id: st.logDocId, content });
        how = 'update_room_document';
      } else {
        try {
          const r = await this.o.op(d.roomId, 'create_room_document', {
            name: st.logName,
            description: `Decisions logged in this room by Context Keeper (${DECISION_LOG_FILE}). Only Context Keeper can edit it.`,
            instructions: 'The room\'s confirmed decisions, one row each (L1, L2, ...): what, why, who decided, who does it, by when, and what would reopen it. Cite a row by its id, quoting it word for word.',
            content,
          });
          st.logDocId = r?.document_id ?? r?.id ?? null;
          how = 'create_room_document';
        } catch (e) {
          // "already exists": a log of ours made by a run we lost track of. Find it and update it.
          const mine = (await this.listDocs(d.roomId)).find((m) => m.name === st.logName && this.ours(m));
          if (!mine) throw e;
          st.logDocId = mine.id;
          await this.o.op(d.roomId, 'update_room_document', { document_id: mine.id, content });
          how = 'update_room_document (found by name)';
        }
      }
      st.log = entries;
      // Read it back: the record holds what Switch has, not what we meant to write.
      const back = st.logDocId ? (await this.fetchDocs(d.roomId, [st.logDocId])).get(st.logDocId) : undefined;
      const meta: LoadedDoc = { id: st.logDocId!, name: st.logName, description: null, created_by_agent_id: this.o.agentId, content: back ?? content };
      st.docs = [...st.docs.filter((x) => x.id !== meta.id), meta];
      st.log = parseLog(meta.content);
      this.rebuild(st);
      return `decision log: ${entry.id} ${added ? 'added' : 'updated'} (${how})`;
    } catch (e) {
      this.log(`memory: Decision log write failed in ${st.name}: ${(e as Error).message}`);
      return `decision log: ${entry.id} not written: ${(e as Error).message.slice(0, 120)}`;
    }
  }
}
