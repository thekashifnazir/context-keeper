# Build log (raw material for the Best Blog post)

The blog is judged on **"clarity, accuracy, and how much it helps a first-time Switch user"**. This log collects facts as they happen, so the post is written from evidence, not memory.

**Rules for this file**
- Every session appends dated entries. Never rewrite old ones.
- Each entry gets a tag: **[gotcha]** (it surprised us, and a first-timer will hit it), **[how]** (a step that worked), **[decision]** (a choice and why), **[number]** (a measurement), **[shot]** (a screenshot to take or taken, with its file name).
- Facts only, with the source (file:line, URL or a command's output). Kash's own reactions go in `source.md`, in his words.
- Nothing from the real chats behind the idea; only the abstracted problem.

---

## Tue 3 Nov (build starts 18:31)
- [number] Self-hosted Switch 0.31.0 (Docker Compose with the Gateway) healthy **9.8 s** after `scripts/server-up.sh` with images cached. The first try failed: the Compose file needs `DB_USER`, `DB_NAME` and `DB_OWNER_USER`, and leaves them blank with only a warning, so Postgres comes up unhealthy.
- [how] Console connects to a self-hosted server with Add server → Connect to an existing server → `http://127.0.0.1:18000` (the core API port, not the Gateway's).
- [gotcha] Switch's Slack welcome post shows `**To add an agent**` with the asterisks: Slack doesn't render `**`. Shot: blog/shots/slack-channel-linked.png.
- [gotcha] An agent's event stream opens covering **no rooms**, even after `!invite-agent`. It has to ask (`list_rooms`) and claim each one (`connect_to_room`); only then do the room's messages arrive.
- [how] First untagged message heard: Rowan asked a "why don't we" question without tagging anyone; it arrived with `addressed: false` and the agent replied in the thread. Shot: blog/shots/first-untagged-reply.png.
- [gotcha] `sender_name` from Slack is the **Slack handle** (`cosmicboard`), not the display name (`Rowan`). Replies that greet people by name need a lookup.
- [how] Switch Trust on Rooms without clicking through Console: `PUT /gateway/trust-settings {endpoint, policy_id, api_key, enabled: true}` with a Gateway admin session → 200, and `GET` then shows `enabled: true`. The policy (Settings → Guardrail policies → Add policy) is Jailbreak on User messages; **the action defaults to Block**, so it has to be switched to Alert by hand.
