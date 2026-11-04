// handoff/wire: builds job E for the live listener (src/agent/main.ts) from env and state/, using the
// listener's own op() call and guards. The dispatcher hook is described in docs/handoff-live-test.md.
//   CK_BUILD_ROOM            build room name (default ledgerly-build)
//   CK_CLAUDE_CODE_AGENT     Claude Code's agent name (default claude-code)
//   CK_CLAUDE_CODE_SENDER    its sender id(s), comma-separated (default: any @switch-agent- sender in the build room)
//   CK_HANDOFF_REPO          what Claude Code works on (default github.com/thekashifnazir/ledgerly-demo)
//   CK_HANDOFF_TIMEOUT_MIN   minutes before "no result yet" is said in the thread (default 30)
//   CK_HANDOFF_NUDGE_MIN     backstop: minutes with no report before the owner desk is told a card may be
//                            waiting (default 2; 0 = off). A "Waiting for OK" post from Claude Code tells it at once.
//   CK_AGENT_NAME            our own agent name (default context-keeper)
import { HandoffChain } from './chain.ts';
import { HandoffStore } from './store.ts';
import { liveHandoffSwitch, type OpFn, type RoomRef } from './switch.ts';

export interface WireOpts {
  op: OpFn;
  canPost(roomId: string): boolean;
  canCreate(name: string): boolean;
  onRoom(room: RoomRef): void;
  owner(body: string): Promise<string | null>;
  selfSenders: Set<string>;
  ownerSender: string | null;
  ownerUsername: string | null;
  ownerDeskRoom: string | null;
  ownerName?: string;
  file?: string;
  traceFile?: string;
}

export function handoffFromEnv(o: WireOpts): HandoffChain {
  const env = process.env;
  const cc = (env.CK_CLAUDE_CODE_SENDER ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return new HandoffChain({
    sw: liveHandoffSwitch(o.op, { canPost: o.canPost, canCreate: o.canCreate, onRoom: o.onRoom, owner: o.owner }),
    store: new HandoffStore(o.file ?? 'state/handoff.json'),
    ownerSender: o.ownerSender,
    ownerName: o.ownerName ?? env.CK_OWNER_NAME ?? 'Kash',
    ownerUsername: o.ownerUsername,
    ownerDeskRoom: o.ownerDeskRoom,
    selfName: env.CK_AGENT_NAME || 'context-keeper',
    selfSenders: o.selfSenders,
    claudeCodeName: env.CK_CLAUDE_CODE_AGENT || 'claude-code',
    claudeCodeSenders: cc.length ? new Set(cc) : undefined,
    buildRoomName: env.CK_BUILD_ROOM || 'ledgerly-build',
    repo: env.CK_HANDOFF_REPO || 'github.com/thekashifnazir/ledgerly-demo',
    timeoutMs: Number(env.CK_HANDOFF_TIMEOUT_MIN ?? 30) * 60_000,
    nudgeMs: Number(env.CK_HANDOFF_NUDGE_MIN ?? 2) * 60_000,
    traceFile: o.traceFile,
    log: (s) => console.log(`[job E] ${s}`),
  });
}

/** The chat handle inside a bridged sender id: "@switch-slack-<bridge uuid>-<handle>:localhost". */
export function handleFromSender(sender: string): string | null {
  const m = sender.match(/^@switch-[a-z]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+):[^:]+$/i);
  return m ? m[1] : null;
}
