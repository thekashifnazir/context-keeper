# Job E live test: idea → done (morning runbook)

The chain is built and tested offline (`npx vitest run test/offline/handoff.test.ts`). It has not
run live yet: that needs Kash's "Allow once" clicks. This page is the first live run, in a fresh
smoke room, so no demo channel gets a test post. About 20 minutes.

## 0. Wire it into the listener (once, before the test)

`src/agent/main.ts` doesn't call job E yet; the jobs B/C/D lane was editing it overnight. Add the
hook after that lane merges. Job E goes **before** the owner-desk handler and before job A:

```ts
import { handoffFromEnv, handleFromSender } from './handoff/wire.ts';

const ownerInfo = readJson<{ owner_sender?: string; owner_handle?: string; owner_desk_room?: string }>('state/owner.json', {});
const handoff = handoffFromEnv({
  op, selfSenders,
  canPost: allowed,                                               // the same CK_POST_ROOMS guard
  canCreate: (name) => postPrefixes.some((p) => name.startsWith(p)),
  onRoom: (r) => { roomNames.set(r.id, r.name); },                // so the new room is named and allowed
  owner: (body) => poster.owner(body),                            // the same CK_POST_OWNER guard
  ownerSender: process.env.CK_OWNER_SENDER || ownerInfo.owner_sender || null,
  ownerUsername: ownerInfo.owner_handle ?? null,
  ownerDeskRoom: process.env.CK_OWNER_DESK_ROOM || ownerInfo.owner_desk_room || null,
});
setInterval(() => { handoff.tick().catch((e) => console.error('job E tick:', e.message)); }, 60_000);
// in onConnected, after joinRooms() resolves:   await handoff.resume();

// in onEvent, right after `const at = …`, before the owner-desk branch and before enqueue():
const hm = { room_id: ev.room_id, room_name: roomNames.get(ev.room_id) ?? ev.room_id, message_id: m.message_id,
  sender: m.sender, sender_name: who, sender_handle: m.sender_name, body: m.body, thread_id: m.thread_id ?? null, received_at: at };
if (await handoff.onMessage(hm)) return;
if (m.sender.startsWith('@switch-agent-')) return;   // another agent's post is never a proposal (PR11)

// in run(), after decideWithRetry(): each genuinely new idea goes on the list
for (const r of results) for (const it of r.trace?.items ?? []) {
  if (it.job !== 'A' || it.verdict !== 'new') continue;
  const x = inputs.find((i) => i.message_id === it.message_id);
  if (x) await handoff.noteIdea({ room_id: roomId, room_name: roomNames.get(roomId) ?? roomId, message_id: x.message_id,
    sender: x.sender, sender_name: x.sender_name, sender_handle: handleFromSender(x.sender), body: x.body,
    thread_id: x.thread_id ?? null, received_at: x.received_at }, it.sources);
}
```

`onMessage` returns true when job E owns the message: an "approve I<n>" in the owner desk (other
desk text falls through to jobs B and D), anything in a build room, and the raiser's or the owner's
sign-off reply. Then `npx vitest run` must still be green.

## 1. Before you start

- Switch Console 0.40.1 open and staying open (risk row 7: a closed Console leaves Claude Code
  looking "live" while it answers nothing).
- `claude-code` in Console: Auto mode **off**, "Me and my agents", working directory the
  ledgerly-demo repo (as on 3 Nov).
- Three Chrome profiles signed in to Slack: yours, **Rowan** and **Sam**.
- A fresh smoke room, seeded like the demo room (never reuse or delete one; Switch #1202):
  `npm run seed -- --bridge slack --room-name ck-smoke-e-1105 --owner-desk-room <your desk id from state/owner.json>`
- Start the agent with the smoke guards:
  ```bash
  CK_POST_ROOMS=ck-smoke- CK_POST_OWNER=1 CK_BUILD_ROOM=ck-smoke-build-1105 CK_HANDOFF_TIMEOUT_MIN=10 npm run agent
  ```
  `CK_BUILD_ROOM` starts with `ck-smoke-`, so the agent may create it and post there. The real
  `#ledgerly-pilot` and `#ledgerly-build` stay dry-run (their drafts are only logged).

## 2. The run (Slack)

| # | Who, where | Do | Expect |
|---|---|---|---|
| 1 | **Rowan**, `#ck-smoke-e-1105` | Post a new idea, e.g. "What if the overdue reminder emails had a pay-now link?" | Context Keeper replies in the thread that it's recorded (job A `new`). |
| 2 | **You**, owner desk | Read the note "New idea I1 from Rowan … Reply "approve I1"". Type `approve I1` | Desk: "Handing I1 (Rowan's idea) to Claude Code in #ck-smoke-build-1105." |
| 3 | Slack sidebar | A new channel `#ck-smoke-build-1105` appears with you in it (Rowan too, if Switch could add him) | Top-level post: the idea, "raised by Rowan", the cited context. Then "@claude-code Hand-off I1 …". Rowan's thread gets "Approved by Kash: Claude Code is building this…" |
| 4 | **Restart check** | Before clicking anything: Ctrl-C the agent, start it again with the same command | Log says it's resuming. **No second "@claude-code Hand-off I1"** in the build room. |
| 5 | **You**, build room thread under the hand-off | Claude Code shows permission cards. Click **Allow once** each time (about 3; never "Allow for this session") | Claude Code posts "Done I1: https://github.com/thekashifnazir/ledgerly-demo/issues/N" (top-level). |
| 6 | Rowan's original thread | — | "Claude Code has done this: <issue link>. Rowan, you raised it, so it's yours to sign off…" |
| 7 | **Sam**, same thread | Reply `looks right` | Nothing happens (only the raiser or you count). |
| 8 | **Rowan**, same thread | Reply `looks right` | "Signed off by Rowan. Closed." Desk: "I1 signed off by Rowan." |

Optional extras, once the main run passes: a second idea where you click **Decline** on the card
(expect "Claude Code couldn't finish I2: …" in Rowan's thread and "approve I2 again" in the desk);
and one where you click nothing for 10 min (expect "No result from Claude Code on this after 10
min…" in Rowan's thread; a late "Done" still asks for sign-off).

## 3. Check the trace

```bash
grep '"decision_id":"E:' state/trace.ck.jsonl | node -e 'require("readline").createInterface({input:process.stdin}).on("line",l=>{const t=JSON.parse(l);console.log(t.decision_id.split(":").slice(1,3).join(" "),t.kind,t.error??"")})'
```

Expected order for I1: `noted`, `approved`, `build_room_created`, `context_posted`, `handed_off`,
`announced`, `resumed` (only if a step was mid-flight at the restart), `progress` (any heard),
`signoff_requested`, `signoff_ignored` (Sam), `signed_off`. Exactly **one** `handed_off` line.

## 4. Not yet proven live (watch for these)

1. `send_targeted_message` is called with `{ target_names, body }`. PR5c/PR11 proved the op and
   `target_names`; the `body` key is assumed to match `post_message`. If it errors, the trace
   shows `E:stalled:I1` with the 422 text: fix the key in `src/agent/handoff/switch.ts`.
2. A room made by `create_room(agent_names: [context-keeper, claude-code])` should start a Claude
   Code session on the hand-off (PR11 showed this for a room it was invited to by `!invite-agent`).
   If nothing happens in 2 minutes, type `!invite-agent @claude-code` in the build room, wait for
   the 10-minute timeout line, then `approve I1 again` in the desk.
3. Adding Rowan by handle (`user_names`) may fail for an account Switch hasn't seen. The code
   retries with you alone; the chain doesn't need Rowan in the build room.
4. Claude Code is asked to start its report "Done I1:". If it words it differently, the report is
   matched to the oldest open hand-off in that room, so one idea at a time is safest for a take.
5. The report is recognised as any `@switch-agent-` sender in the build room. Once its sender id
   shows in the log, pin it with `CK_CLAUDE_CODE_SENDER=<id>`.

For the demo take, the same run with `CK_BUILD_ROOM=ledgerly-build` and the real rooms added to
`CK_POST_ROOMS` is your call; nothing in code posts there by default.
