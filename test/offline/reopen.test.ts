// Reopen route offline checks (D4-2): new information against a recorded decision goes to the owner
// desk, quoting the decision and its "Reopen if"; the room gets code's "asked the owner, plan stands"
// line; the reviewer reads the new message for a reopen claim only; every failure tightens.
import { beforeEach, describe, expect, it } from 'vitest';
import { handleOwnerDesk } from '../../src/agent/owner-desk.ts';
import { decide } from '../../src/agent/pipeline.ts';
import { FakeClaude, reviewerMessage, verdictMessage } from '../fake-claude.ts';
import { ctx, FakePoster, HAIKU, jobItem, KASH, msg, OPUS, setup } from './jobs-fixture.ts';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup('ck-reopen-'); });

const TEXT = "Can we reopen the three-agency limit? We've hired a second support person, starting Monday.";
const claim = 'Reopen: D2 (three agencies, max 25 clients each) is to be reopened if support capacity changes, and Rowan reports a second support hire.';
const reopen = (cite = [{ blockId: 'pilot-plan.md §2 D2' }, { blockId: 'led-012' }]) =>
  verdictMessage(OPUS, ctx, [jobItem('m1', { verdict: 'reopen', claim, reply: "It's reopened." })], cite);

describe('reopen route', () => {
  it('a passed reopen goes to the owner desk with the decision and its Reopen if; the room gets one neutral line', async () => {
    let reviewed: any = null;
    const claude = new FakeClaude([
      { model: OPUS, respond: reopen() },
      { model: HAIKU, respond: (params) => { reviewed = JSON.parse(params.messages[0].content); return reviewerMessage(HAIKU, [{ id: 'c1', supports: true }]); } },
    ]);
    const poster = new FakePoster();
    const d = t.deps(claude, poster);
    await decide(d, 'room1', 'ck-test', ctx, [msg('m1', TEXT)]);
    claude.done();

    // the reviewer saw the claim, the decision row labelled by column, and the new message
    const check = reviewed.checks[0];
    expect(check.claim).toBe(claim);
    expect(check.new_message).toMatchObject({ from: 'Rowan', text: TEXT });
    expect(check.quotes[0]).toContain('The same row by column:');
    expect(check.quotes[0]).toContain('Reopen if: Support capacity changes');

    expect(poster.desk()).toHaveLength(1);
    const note = poster.desk()[0].body;
    expect(note).toMatch(/^#1 · Reopen request in ck-test/);
    expect(note).toContain(`Rowan said (m1): "${TEXT}"`);
    expect(note).toContain("It's about D2 (pilot-plan.md §2):");
    expect(note).toContain('Three agencies, max 25 clients each');
    expect(note).toContain('Reopen if: Support capacity changes');
    expect(note).toContain('Should D2 be reopened?');

    expect(poster.pub()).toHaveLength(1);
    const pub = poster.pub()[0];
    expect(pub.thread).toBe('m1');
    expect(pub.body.split('\n')[0]).toBe("Thanks, Rowan. That's new information on a recorded decision, so I've asked the owner whether to reopen it. Until they decide, the plan stays as it is. Reopen if: Support capacity changes.");
    expect(pub.body).toContain('> **Three agencies, max 25 clients each**');
    expect(pub.body).not.toContain("It's reopened."); // the model's own words are never the public line

    const [line] = t.traces();
    expect(line.kind).toBe('reply');
    expect(line.items[0]).toMatchObject({ job: 'A', verdict: 'reopen' });
    expect(line.items[0].sources[0].ref).toBe('pilot-plan.md §2');
    expect(line.posts.map((p) => p.route)).toEqual(['owner_private', 'public_thread']);
    expect(d.pending!.open()).toMatchObject([{ kind: 'D', route: 'reopen', clashes_with: 'D2', thread_id: 'm1' }]);
  });

  it('a covered check never carries the new message', async () => {
    let reviewed: any = null;
    const claude = new FakeClaude([
      { model: OPUS, respond: verdictMessage(OPUS, ctx, [jobItem('m1', { verdict: 'covered', claim: 'Covered: three agencies.', reply: 'Three agencies.' })], [{ blockId: 'pilot-plan.md §2 D2' }]) },
      { model: HAIKU, respond: (params) => { reviewed = JSON.parse(params.messages[0].content); return reviewerMessage(HAIKU, [{ id: 'c1', supports: true }]); } },
    ]);
    await decide(t.deps(claude), 'room1', 'ck-test', ctx, [msg('m1', 'How many agencies are in the pilot?')]);
    expect(reviewed.checks[0].new_message).toBeUndefined();
  });

  it('a reviewer block drops it to might-be-related, and nothing goes to the owner', async () => {
    const claude = new FakeClaude([
      { model: OPUS, respond: reopen() },
      { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'c1', supports: false, issue: 'a staff absence is not a capacity change' }]) },
    ]);
    const poster = new FakePoster();
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', TEXT)]);
    expect(poster.desk()).toEqual([]);
    expect(poster.pub()[0].body).toMatch(/^This might be related/);
    expect(t.traces()[0].items[0].verdict).toBe('might-be-related');
  });

  it('a reopen that quotes no decision row is not a reopen (code checks, before any review)', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: reopen([{ blockId: 'led-012' }]) }]); // no reviewer call: no strong verdict left
    const poster = new FakePoster();
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', TEXT)]);
    claude.done();
    expect(poster.desk()).toEqual([]);
    expect(t.traces()[0].items[0].verdict).toBe('might-be-related');
    expect(t.traces()[0].error).toMatch(/no decision row quoted/);
  });

  it('when the desk note fails, the room is never told the owner was asked', async () => {
    const claude = new FakeClaude([{ model: OPUS, respond: reopen() }, { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'c1', supports: true }]) }]);
    const poster = new FakePoster();
    poster.failOwner = true;
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', TEXT)]);
    expect(poster.pub()).toHaveLength(1);
    expect(poster.pub()[0].body).not.toMatch(/asked the owner/);
    expect(t.traces()[0].items[0].verdict).toBe('might-be-related');
  });

  it("the owner's ruling comes back in the original thread", async () => {
    const poster = new FakePoster();
    const claude = new FakeClaude([{ model: OPUS, respond: reopen() }, { model: HAIKU, respond: reviewerMessage(HAIKU, [{ id: 'c1', supports: true }]) }]);
    await decide(t.deps(claude, poster), 'room1', 'ck-test', ctx, [msg('m1', TEXT)]);
    const d = t.deps(new FakeClaude([]), poster);
    const ruled = await handleOwnerDesk(d, 'desk', 'ck-owner-desk', msg('o1', 'Plan stands.', KASH, 'Kash', { thread_id: 'ev1' }));
    expect(ruled?.kind).toBe('reply');
    expect(poster.pub().at(-1)).toMatchObject({ room: 'room1', thread: 'm1', body: 'Update from Kash: The plan stands.' });
    expect(d.pending!.open()).toEqual([]);
  });
});
