// handoff/switch: the few Switch operations job E needs, behind a small port so the offline tests
// can use a fake Switch. liveHandoffSwitch() adapts the running agent's own op() call (same stream
// connection, same per-room session ids), so nothing here opens a second connection: a
// connect_to_room from another process would take the room away from the live listener.
// Op shapes as used by the seed and proven live on 3 Nov: create_room with a list for
// join_event_listeners; send_targeted_message(target_names) returns target_statuses.

export interface RoomRef { id: string; name: string }

export interface CreateRoomSpec {
  name: string;
  description: string;
  instructions: string;
  agentNames: string[];
  userNames: string[];
  bridgeOf: string; // a room on the bridge to use (the idea's own room): "same bridge"
  joinListeners: string[];
}

export interface HandoffSwitch {
  /** A live (not archived) room with this name, if any. */
  findRoom(name: string): Promise<RoomRef | null>;
  createRoom(spec: CreateRoomSpec): Promise<RoomRef>;
  /** Make sure these people are in the room (best effort; reuse path). */
  addUsers?(roomId: string, userNames: string[]): Promise<void>;
  /** post_message; returns the event id. */
  post(roomId: string, threadId: string | null, body: string): Promise<string | null>;
  /** send_targeted_message; Switch prefixes "@<name>". A refused target is a status, not an error. */
  sendTargeted(roomId: string, targetNames: string[], body: string): Promise<{ eventId: string | null; statuses: Record<string, string> }>;
  /** A post in the private owner desk; null when there's no desk. */
  owner(body: string): Promise<string | null>;
  /** The listener's CK_POST_ROOMS guard. A build room it can't post in stops the chain at the room
   *  step (nothing is handed off, so the original thread is never told it's being built). */
  canPost?(roomId: string): boolean;
}

export type OpFn = (roomId: string | null, name: string, args: Record<string, unknown>) => Promise<any>;

const unwrap = (r: any) => (r && typeof r === 'object' && 'result' in r ? r.result : r);
const eventIdOf = (r: any): string | null => {
  const x = unwrap(r);
  return x?.message_id ?? x?.event_id ?? r?.message_id ?? r?.event_id ?? null;
};

export interface LiveOpts {
  /** The live agent's CK_POST_ROOMS guard: false → log the draft, send nothing. */
  canPost(roomId: string): boolean;
  /** The guard for creating a room by name (a real Slack channel). */
  canCreate(name: string): boolean;
  /** Tell the listener about a new room, so it is joined, named and declared on restart. */
  onRoom(room: RoomRef): void;
  /** The owner desk post (the listener's own, with its CK_POST_OWNER guard). */
  owner(body: string): Promise<string | null>;
  log?: (s: string) => void;
}

export function liveHandoffSwitch(op: OpFn, o: LiveOpts): HandoffSwitch {
  const log = o.log ?? ((s: string) => console.log(s));
  return {
    async findRoom(name) {
      const rooms = unwrap(await op(null, 'list_rooms', {})) as { room_id: string; name: string; archived?: boolean }[];
      const hit = rooms.find((r) => !r.archived && (r.name === name || r.name.endsWith(`: ${name}`)));
      return hit ? { id: hit.room_id, name: hit.name } : null;
    },
    async createRoom(s) {
      if (!o.canCreate(s.name)) {
        log(`[dry-run: ${s.name} not in CK_POST_ROOMS] would create_room ${JSON.stringify({ ...s, instructions: `${s.instructions.length} chars` })}`);
        return { id: `dry-run:${s.name}`, name: s.name };
      }
      const origin = unwrap(await op(null, 'get_room_detail', { room_id: s.bridgeOf })) as { bridge_id?: string | null; channel_type?: string | null };
      const where = origin?.bridge_id ? { bridge_id: origin.bridge_id, channel_type: 'channel_public' } : { internal_only: true };
      const base = { name: s.name, description: s.description, agent_names: s.agentNames, instructions: s.instructions, join_event_listeners: s.joinListeners, ...where };
      let created: any;
      try {
        created = unwrap(await op(null, 'create_room', { ...base, user_names: s.userNames }));
      } catch (e) {
        // A teammate who never linked an account may not be addable; the owner alone still works.
        if (s.userNames.length < 2) throw e;
        log(`create_room with ${s.userNames.join(', ')} failed (${(e as Error).message}); retrying with the owner only`);
        created = unwrap(await op(null, 'create_room', { ...base, user_names: s.userNames.slice(0, 1) }));
      }
      const id = created?.room_id ?? created?.id;
      if (!id) throw new Error(`create_room returned no room id: ${JSON.stringify(created).slice(0, 200)}`);
      const room = { id, name: created?.name ?? s.name };
      o.onRoom(room);
      return room;
    },
    async addUsers(roomId, userNames) {
      if (!o.canPost(roomId) || !userNames.length) return;
      try { await op(null, 'add_users_to_room', { room_id: roomId, user_names: userNames }); } catch (e) { log(`add_users_to_room failed (ignored): ${(e as Error).message}`); }
    },
    async post(roomId, threadId, body) {
      if (!o.canPost(roomId)) { log(`[dry-run: ${roomId} not in CK_POST_ROOMS] would post${threadId ? ` in thread ${threadId}` : ''}:\n${body}`); return null; }
      await op(roomId, 'connect_to_room', { room_id: roomId });
      return eventIdOf(await op(roomId, 'post_message', { body, ...(threadId ? { thread_id: threadId } : {}) }));
    },
    async sendTargeted(roomId, targetNames, body) {
      if (!o.canPost(roomId)) { log(`[dry-run: ${roomId} not in CK_POST_ROOMS] would send_targeted_message to ${targetNames.join(', ')}:\n${body}`); return { eventId: null, statuses: {} }; }
      await op(roomId, 'connect_to_room', { room_id: roomId });
      const r = await op(roomId, 'send_targeted_message', { target_names: targetNames, body });
      const x = unwrap(r);
      return { eventId: eventIdOf(r), statuses: (x?.target_statuses ?? r?.target_statuses ?? {}) as Record<string, string> };
    },
    owner: (body) => o.owner(body),
    canPost: (roomId) => o.canPost(roomId),
  };
}
