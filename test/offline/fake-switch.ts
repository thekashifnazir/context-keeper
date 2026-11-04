// A fake Switch for the memory tests: room documents (create refuses a duplicate name, only the
// creator may update, each write posts Switch's visible "📄 ... room document" notice into the room
// history), list_references, load_internal_documents(ids), read_context (threads), as practice runs
// PR5b items 8-10 and the 4 Nov probe found them on the real 0.31.0 server.
import type { Op } from '../../src/agent/memory.ts';

interface Doc { id: string; name: string; description: string; instructions: string; content: string; created_by_agent_id: string }
interface Entry { id: string; kind: 'message' | 'room_join'; sender: string; sender_name: string; body: string; timestamp: number; thread?: string }

export class FakeSwitch {
  docs = new Map<string, Doc[]>(); // room -> docs
  history = new Map<string, Entry[]>();
  calls: { room: string | null; name: string; args: Record<string, unknown> }[] = [];
  failNext: string | null = null;
  private n = 0;
  constructor(readonly agentId: string, readonly agentName: string, readonly agentSender = '@switch-agent-fake:localhost') {}

  /** The op function the agent's memory calls, acting as `agentId`. */
  opFor(agentId = this.agentId, agentName = this.agentName): Op {
    return async (room, name, args) => this.call(agentId, agentName, room, name, args);
  }

  addDoc(room: string, d: { name: string; description?: string; content: string }, by = this.agentId): string {
    const id = `doc-${++this.n}`;
    (this.docs.get(room) ?? this.docs.set(room, []).get(room)!).push({ id, name: d.name, description: d.description ?? '', instructions: '', content: d.content, created_by_agent_id: by });
    return id;
  }

  post(room: string, e: Omit<Entry, 'id' | 'kind'> & { kind?: Entry['kind']; id?: string }): string {
    const id = e.id ?? `sw_${++this.n}`;
    (this.history.get(room) ?? this.history.set(room, []).get(room)!).push({ kind: 'message', ...e, id });
    return id;
  }

  private async call(agentId: string, agentName: string, room: string | null, name: string, args: Record<string, unknown>): Promise<any> {
    this.calls.push({ room, name, args });
    if (this.failNext === name) { this.failNext = null; throw new Error(`${name}: 500 fake failure`); }
    if (!room) throw new Error(`${name}: MCP session has no session id`);
    const docs = this.docs.get(room) ?? this.docs.set(room, []).get(room)!;
    const notice = (verb: string, doc: string) => this.post(room, { sender: this.agentSender, sender_name: agentName, body: `📄 ${verb} room document “${doc}”.`, timestamp: Date.now() });
    switch (name) {
      case 'list_references':
        return { reference_types: {}, references: [], documents: docs.map(({ content: _c, ...meta }) => ({ ...meta, scope: 'room' })), packages: [], linked_rooms: [] };
      case 'load_internal_documents': {
        if (!Array.isArray(args.ids)) throw new Error('load_internal_documents: 400 {"detail":"load_internal_documents requires: ids"}');
        return (args.ids as string[]).map((id) => docs.find((d) => d.id === id)).filter(Boolean).map((d) => ({ room_seq: 0, source_event_id: null, id: d!.id, name: d!.name, description: d!.description, content: d!.content }));
      }
      case 'create_room_document': {
        if (docs.some((d) => d.name === args.name)) throw new Error(`create_room_document: 400 {"detail":"A room-scoped document named '${args.name}' already exists in this room"}`);
        const id = this.addDoc(room, { name: String(args.name), description: String(args.description ?? ''), content: String(args.content ?? '') }, agentId);
        notice('created', String(args.name));
        return { document_id: id };
      }
      case 'update_room_document': {
        const d = docs.find((x) => x.id === args.document_id);
        if (!d) throw new Error('update_room_document: 404 not found');
        if (d.created_by_agent_id !== agentId) throw new Error('update_room_document: 403 only the creating agent can update this document');
        d.content = String(args.content ?? d.content);
        notice('updated', d.name);
        return { document_id: d.id, status: 'ok' };
      }
      case 'read_context': {
        const all = this.history.get(room) ?? [];
        const roots = all.filter((e) => !e.thread);
        return {
          threads: roots.map((r) => ({ root: strip(r), replies: all.filter((e) => e.thread === r.id).map(strip) })),
          truncated: false, oldest_timestamp: all[0]?.timestamp ?? null,
        };
      }
      default:
        throw new Error(`fake switch: no op ${name}`);
    }
  }
}

const strip = ({ thread: _t, ...e }: Entry) => ({ ...e, attachments: [] });
