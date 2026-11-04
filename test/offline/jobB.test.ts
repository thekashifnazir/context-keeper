// Job B offline checks: a decision from the chat goes to the owner desk with a suggested owner and
// date; only the owner's text reply confirms it (a non-owner "confirm" is ignored); the team then
// sees one short line in the thread; pending confirms survive a restart (R6). Who decided is kept
// apart from who does the work: a suggestion is not an assignment, the work never defaults to the
// owner, and an owner-stated decision posts at once, asking the desk only for a missing owner/date.
import { beforeEach, describe, expect, it } from 'vitest';
import { handleOwnerDesk } from '../../src/agent/owner-desk.ts';
import { PendingStore } from '../../src/agent/pending.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { AgentState } from '../../src/agent/state.ts';
import { FakeClaude, verdictMessage } from '../fake-claude.ts';
import { ctx, details, FakePoster, jobItem, KASH, msg, OPUS, ownerReadingMessage, PRIYA, SAM, SELF, setup } from './jobs-fixture.ts';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup('ck-jobB-'); });

const decision = (id = 'm1') => verdictMessage(OPUS, ctx, [jobItem(id, {
  job: 'B', verdict: 'decision',
  details: details({ summary: 'Fieldnote goes first for onboarding.', why: 'They signed first.', date: '2026-11-24', suggested_owner: 'Priya', owner_basis: 'Priya: onboarding calls and pilot support.' }),
})], [{ blockId: 'pilot-plan.md §3.1' }]);

async function proposeFromPriya(poster: FakePoster) {
  const claude = new FakeClaude([{ model: OPUS, respond: decision() }]);
  await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Ok, Fieldnote goes first for onboarding, Tue 24th.', PRIYA, 'Priya')]);
  claude.done();
}

describe('job B: the note in the owner desk', () => {
  it('a decision agreed by a teammate goes to the owner desk with what, why, source, date and a suggested owner; nothing public yet', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    expect(poster.pub()).toEqual([]);
    expect(poster.desk()).toHaveLength(1);
    const note = poster.desk()[0].body;
    expect(note).toContain('🗳️ **#1 · Decision to confirm** · #ck-test');
    expect(note).toContain('**Agreed:** Fieldnote goes first for onboarding.');
    expect(note).toContain('**Why:** They signed first.');
    expect(note).toContain('**Priya said:** _“Ok, Fieldnote goes first for onboarding, Tue 24th.”_');
    expect(note).not.toContain('m1'); // never a message id in a desk note
    expect(note).toContain('**Date:** Tue 24 Nov');
    expect(note).toMatch(/1\. Suggested owner: Priya \(Priya: onboarding calls and pilot support\.\)/);
    expect(note).toMatch(/2\. Or tell me/);
    expect(note).toContain('**Reopen if:** not said. What would make this worth revisiting?');
    const [line] = t.traces();
    expect(line.kind).toBe('owner_note');
    // A suggestion is not an assignment; nobody has decided until the approver confirms.
    expect(line.items[0]).toMatchObject({ job: 'B', verdict: 'decision', decision_record: { summary: 'Fieldnote goes first for onboarding.', decided_by: '', action_owner: null, due: '2026-11-24', reopen_if: null, date: '2026-11-04' } });
    expect(new PendingStore(t.pendingFile).open()).toHaveLength(1);
  });

  it('with no owner in the record, the note says so instead of guessing', async () => {
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'B', verdict: 'decision', details: details({ summary: 'Weekly demo on Fridays.' }) })], []) }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Agreed, weekly demo on Fridays then.', SAM, 'Sam')]);
    expect(poster.desk()[0].body).toContain('No owner suggested');
    expect(poster.desk()[0].body).toContain('**Date:** none given');
  });
});

describe('job B: the confirm (owner only, text reply)', () => {
  it("a non-owner's 'confirm' in the desk is ignored: nothing posted, the item stays open", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const d = t.deps(new FakeClaude([]), poster);
    const line = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', SAM, 'Sam', { thread_id: 'ev1' }));
    expect(line?.kind).toBe('silence');
    expect(line?.error).toMatch(/not the owner/);
    expect(poster.pub()).toEqual([]);
    expect(d.pending!.open()).toHaveLength(1);
  });

  it("our own post in the desk is never read as a reply", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    expect(await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', 'confirm', SELF, 'Context Keeper'))).toBeNull();
  });

  it("the owner's 'confirm' posts one short line in the original thread, with the suggested owner and date", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const d = t.deps(new FakeClaude([]), poster); // a plain confirm needs no model call
    const line = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toHaveLength(1);
    expect(poster.pub()[0]).toMatchObject({ room: 'room1', thread: 'm1' });
    expect(poster.pub()[0].body).toBe("Logged as decided: Fieldnote goes first for onboarding. Owner: Priya. Date: Tue 24 Nov. (Kash's call.)");
    expect(line?.kind).toBe('reply');
    expect(line?.items[0].decision_record).toEqual({ summary: 'Fieldnote goes first for onboarding.', decided_by: 'Kash', action_owner: 'Priya', due: '2026-11-24', reopen_if: null, date: '2026-11-04' });
    expect(d.pending!.open()).toEqual([]);
    expect(d.pending!.decisions('room1')).toHaveLength(1);
    // The same reply seen again (a redelivery) does nothing.
    expect(await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: 'ev1' }))).toBeNull();
    expect(poster.pub()).toHaveLength(1);
  });

  it("'owner Sam' confirms with a different owner, read by code", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', '#1 owner Sam', KASH, 'Kash'));
    expect(poster.pub()[0].body).toContain('Owner: Sam.');
  });

  it("a free-text correction is read by one model call; the public line is built from its fields, not the owner's words", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const reading = ownerReadingMessage({ action: 'confirm', summary: 'Harbour & Pine goes first for onboarding.', owner: 'Priya', date: '2026-11-25' });
    const claude = new FakeClaude([{ model: OPUS, respond: reading }]);
    const ownerText = 'hmm no, actually H&P first, wed - fieldnote asked to slip (keep this between us)';
    await handleOwnerDesk(t.deps(claude, poster), 'desk', 'ck-owner-desk', msg('o1', ownerText, KASH, 'Kash', { thread_id: 'ev1' }));
    claude.done();
    expect(poster.pub()[0].body).toBe("Logged as decided: Harbour & Pine goes first for onboarding. Owner: Priya. Date: Wed 25 Nov. (Kash's call.)");
    expect(poster.pub()[0].body).not.toContain('between us');
  });

  it("'drop' closes the item with nothing posted", async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const d = t.deps(new FakeClaude([]), poster);
    await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'drop', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toEqual([]);
    expect(d.pending!.all()[0].status).toBe('dropped');
  });

  it('with two open items and no number, it asks which one, privately', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const claude = new FakeClaude([{ model: OPUS, respond: decision('m2') }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m2', 'Agreed: weekly demo on Fridays.', SAM, 'Sam')]);
    await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash'));
    expect(poster.pub()).toEqual([]);
    expect(poster.desk().at(-1)!.body).toMatch(/^Which one\? Open: #1 .*#2 /);
  });
});

describe('job B: the line', () => {
  it("doesn't repeat a date the summary already gives", async () => {
    const { loggedLine } = await import('../../src/agent/jobs/decision.ts');
    expect(loggedLine({ summary: 'Fieldnote goes first, on Tue 24 Nov 2026', owner: '', date: '2026-11-24', confirmedBy: 'Kash' }))
      .toBe("Logged as decided: Fieldnote goes first, on Tue 24 Nov 2026. (Kash's call.)");
  });
});

describe('job B: the owner states it himself (T14)', () => {
  const ownerSays = 'Ok, Fieldnote goes first for onboarding, Tue 24th.';
  const stated = (over: Record<string, unknown> = {}) => verdictMessage(OPUS, ctx, [jobItem('m1', {
    job: 'B', verdict: 'decision',
    details: details({ summary: 'Fieldnote goes first for onboarding.', why: 'They signed first.', date: '2026-11-24', suggested_owner: 'Priya', owner_basis: 'Priya: onboarding calls and pilot support.', ...over }),
  })], [{ blockId: 'pilot-plan.md §3.1' }]);
  async function ownerStates(poster: FakePoster, over: Record<string, unknown> = {}) {
    const claude = new FakeClaude([{ model: OPUS, respond: stated(over) }]);
    const d = t.deps(claude, poster);
    await decide(d, 'room1', 'ck-test', ctx, [msg('m1', ownerSays, KASH, 'Kash')]);
    claude.done();
    return d;
  }

  it('no confirm request: the line posts at once; with no action owner named, the desk is asked, suggesting one from the roles', async () => {
    const poster = new FakePoster();
    const d = await ownerStates(poster);
    expect(poster.pub()).toHaveLength(1);
    expect(poster.pub()[0]).toMatchObject({ thread: 'm1', body: "Logged as decided: Fieldnote goes first for onboarding. Date: Tue 24 Nov. (Kash's call.)" });
    expect(poster.desk()).toHaveLength(1);
    const note = poster.desk()[0].body;
    expect(note).toContain('🗳️ **#1 · Decision logged, no owner yet** · #ck-test');
    expect(note).toContain('1. Suggested owner: Priya (Priya: onboarding calls and pilot support.). Reply "confirm" to take it.');
    expect(note).toContain('**Date:** Tue 24 Nov');
    expect(note).toContain('**Reopen if:** not said.');
    expect(note).not.toMatch(/Nothing is posted|until you confirm/);
    const [line] = t.traces();
    expect(line.kind).toBe('reply');
    // Decided by the owner; the work stays unassigned, never quietly the owner.
    expect(line.items[0].decision_record).toEqual({ summary: 'Fieldnote goes first for onboarding.', decided_by: 'Kash', action_owner: null, due: '2026-11-24', reopen_if: null, date: '2026-11-04' });
    expect(d.pending!.decisions()).toHaveLength(1); // logged already
    expect(d.pending!.open()).toHaveLength(1); // the owner ask is still open
  });

  it('with no owner in the record either, the desk note asks instead of suggesting', async () => {
    const poster = new FakePoster();
    await ownerStates(poster, { suggested_owner: '', owner_basis: '', date: '' });
    const note = poster.desk()[0].body;
    expect(note).toContain('no owner or due date yet');
    expect(note).toContain('No owner suggested: nothing in the record says who fits best. Who should do it?');
    expect(note).toContain('**Due:** none given. When is it due?');
    expect(note).not.toContain('"confirm"');
    expect(t.traces()[0].items[0].decision_record).toMatchObject({ decided_by: 'Kash', action_owner: null, due: null });
  });

  it('with an action owner and a date named, nothing goes to the desk', async () => {
    const poster = new FakePoster();
    const d = await ownerStates(poster, { action_owner: 'Priya', reopen_if: 'Fieldnote asks to slip' });
    expect(poster.desk()).toEqual([]);
    expect(poster.pub()[0].body).toBe("Logged as decided: Fieldnote goes first for onboarding. Owner: Priya. Date: Tue 24 Nov. Reopen if: Fieldnote asks to slip. (Kash's call.)");
    expect(t.traces()[0].items[0].decision_record).toEqual({ summary: 'Fieldnote goes first for onboarding.', decided_by: 'Kash', action_owner: 'Priya', due: '2026-11-24', reopen_if: 'Fieldnote asks to slip', date: '2026-11-04' });
    expect(d.pending!.open()).toEqual([]);
    expect(d.pending!.decisions()).toHaveLength(1);
  });

  it("'confirm' on the desk note takes the suggested owner and posts only what's new in the thread", async () => {
    const poster = new FakePoster();
    await ownerStates(poster);
    const d = t.deps(new FakeClaude([]), poster);
    const line = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: 'ev1', received_at: '2026-11-05T09:00:00Z' }));
    expect(poster.pub()).toHaveLength(2);
    expect(poster.pub()[1]).toMatchObject({ thread: 'm1', body: `Update on "Fieldnote goes first for onboarding": Owner: Priya. (Kash's call.)` });
    expect(line?.items[0].decision_record).toEqual({ summary: 'Fieldnote goes first for onboarding.', decided_by: 'Kash', action_owner: 'Priya', due: '2026-11-24', reopen_if: null, date: '2026-11-04' });
    expect(d.pending!.open()).toEqual([]);
    expect(d.pending!.decisions()).toHaveLength(1);
  });

  it('a free-text answer can add a reopen-if, read by one model call', async () => {
    const poster = new FakePoster();
    await ownerStates(poster);
    const claude = new FakeClaude([{ model: OPUS, respond: ownerReadingMessage({ action: 'confirm', owner: 'Sam', reopen_if: 'Fieldnote asks to slip' }) }]);
    await handleOwnerDesk(t.deps(claude, poster), 'desk', 'ck-owner-desk', msg('o1', 'sam does it; revisit if fieldnote wants to slip', KASH, 'Kash', { thread_id: 'ev1' }));
    claude.done();
    expect(poster.pub()[1].body).toBe(`Update on "Fieldnote goes first for onboarding": Owner: Sam. Reopen if: Fieldnote asks to slip. (Kash's call.)`);
  });

  it("'leave it' closes the ask: nothing posted, the decision stays logged, the work stays unassigned", async () => {
    const poster = new FakePoster();
    await ownerStates(poster);
    const d = t.deps(new FakeClaude([]), poster);
    const line = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'leave it', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toHaveLength(1);
    expect(line?.kind).toBe('silence');
    expect(line?.items[0].decision_record).toMatchObject({ decided_by: 'Kash', action_owner: null });
    expect(d.pending!.decisions()).toHaveLength(1);
    expect(d.pending!.all()[0].status).toBe('confirmed');
  });
});

describe('job B: the work never defaults to the owner', () => {
  it("a teammate's decision confirmed with no owner suggested or named stays unassigned", async () => {
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'B', verdict: 'decision', details: details({ summary: 'Weekly demo on Fridays.' }) })], []) }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Agreed, weekly demo on Fridays then.', SAM, 'Sam')]);
    const line = await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', 'confirm', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()[0].body).toBe("Logged as decided: Weekly demo on Fridays. (Kash's call.)");
    expect(line?.items[0].decision_record).toMatchObject({ decided_by: 'Kash', action_owner: null, due: null });
  });

  it('an action owner named in the chat is kept, and the note says so rather than suggesting', async () => {
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { job: 'B', verdict: 'decision', details: details({ summary: 'Weekly demo on Fridays.', action_owner: 'Sam', reopen_if: 'the partners stop coming' }) })], []) }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', 'Agreed, weekly demo on Fridays, I will run it.', SAM, 'Sam')]);
    const note = poster.desk()[0].body;
    expect(note).toContain('**Action owner:** Sam (named in the chat).');
    expect(note).toContain('**Reopen if:** the partners stop coming');
    await handleOwnerDesk(t.deps(new FakeClaude([]), poster), 'desk', 'ck-owner-desk', msg('o1', 'yes', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()[0].body).toBe("Logged as decided: Weekly demo on Fridays. Owner: Sam. Reopen if: the partners stop coming. (Kash's call.)");
  });
});

describe('ck.trace/1: decision records written before 3 Nov', () => {
  it('a legacy { summary, owner, date } record reads back in the new shape', async () => {
    const { readTrace } = await import('../../src/shared/trace.ts');
    const legacy = {
      schema: 'ck.trace/1', ts: '2026-11-03T10:00:00Z', decision_id: 'x', room_id: 'r', room_name: 'r', kind: 'reply', trigger: 'message', inputs: [], burst: null,
      items: [{ message_id: 'm1', job: 'B', verdict: 'decision', restriction: null, clashes_with: null, sources: [], decision_record: { summary: 'S', owner: 'Priya', date: '2026-11-24' }, brief_for: null }],
      posts: [], model: null, error: null,
    };
    const [line] = readTrace(JSON.stringify(legacy) + '\n');
    expect(line.items[0].decision_record).toEqual({ summary: 'S', decided_by: '', action_owner: 'Priya', due: '2026-11-24', reopen_if: null, date: '' });
  });
});

describe('R6 restart safety for pending confirms', () => {
  it('a pending confirm survives a restart: new state objects from the same files still find it, and the confirm posts once', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    // "Restart": nothing in memory carries over; only the files in state/ do.
    const pending = new PendingStore(t.pendingFile);
    expect(pending.open()).toHaveLength(1);
    expect(pending.open()[0]).toMatchObject({ n: 1, kind: 'B', thread_id: 'm1', note_event_id: 'ev1', raised_by: 'Priya' });
    const after = t.deps(new FakeClaude([]), poster, { pending, state: new AgentState(t.stateFile) });
    await handleOwnerDesk(after, 'desk', 'ck-owner-desk', msg('o1', 'yes', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(poster.pub()).toHaveLength(1);
    expect(new PendingStore(t.pendingFile).open()).toEqual([]);
    // A second restart doesn't bring it back or post again.
    const again = t.deps(new FakeClaude([]), poster);
    expect(await handleOwnerDesk(again, 'desk', 'ck-owner-desk', msg('o1', 'yes', KASH, 'Kash', { thread_id: 'ev1' }))).toBeNull();
    expect(poster.pub()).toHaveLength(1);
  });

  it('a retried decision never doubles the pending item or the desk note', async () => {
    const poster = new FakePoster();
    await proposeFromPriya(poster);
    const claude = new FakeClaude([{ model: OPUS, respond: decision() }]);
    // Same message again, as if the first attempt's processed mark was lost.
    await decide(t.deps(claude, poster, { state: new AgentState(null) }), 'room1', 'ck-test', ctx, [msg('m1', 'Ok, Fieldnote goes first for onboarding, Tue 24th.', PRIYA, 'Priya')]);
    expect(new PendingStore(t.pendingFile).all()).toHaveLength(1);
    expect(poster.desk()).toHaveLength(1);
  });
});
