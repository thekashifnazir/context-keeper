// talk-tests: ElevenLabs agent-testing for the talk-it-through agent (simulate-conversation was removed
// on 31 Oct 2026; this is its replacement: POST /convai/agent-testing/create once per test, then
// POST /convai/agents/{id}/run-tests and poll GET /convai/test-invocations/{id}).
// Each test is a "next reply" test: a short scripted call, and ElevenLabs' evaluator judges the
// agent's next reply against a plain-English condition. Conditions judge the whole reply (PR23's miss
// was a test that judged only the text after a tool call). The agent has no webhook tools, so a test
// can't change anything outside ElevenLabs.
import type { Eleven } from './eleven.ts';
import { ElevenError } from './eleven.ts';
import { AGENT_NAME } from './talk-agent.ts';

const GREETING = { role: 'agent', time_in_call_secs: 0, message: `Hi Rowan, it's Context Keeper. Do you want the three headlines from the Ledgerly pilot room first, or have you got a question?` };

function turns(lines: string[], start = 0) {
  const out: { role: string; time_in_call_secs: number; message: string }[] = [GREETING];
  lines.forEach((message, i) => out.push({ role: i % 2 === 0 ? 'user' : 'agent', time_in_call_secs: start + 6 * (i + 1), message }));
  return out;
}

export interface TalkTest {
  name: string;
  chat_history: ReturnType<typeof turns>;
  success_condition: string;
  success_examples: { response: string; type: 'success' }[];
  failure_examples: { response: string; type: 'failure' }[];
  dynamic_variables?: Record<string, string | number>;
}

const VARS = { caller_name: 'Rowan', snapshot_at: 'Tuesday 3 November, 09:30' };

export const TESTS: TalkTest[] = [
  {
    name: 'ck-talk: catch-up gives a few headlines, spoken, then asks',
    chat_history: turns(['Headlines first please. What did I miss?']),
    success_condition: 'Judge the whole reply. Does the agent give two to four short headlines in plain spoken sentences (no bulleted or numbered list, no symbols, file names or section numbers), and end by asking which one the caller wants to open or what they want next? Return True or False.',
    success_examples: [{ type: 'success', response: "The pilot's locked for the twenty-fourth of November with three agencies, you're on partner comms from the fourth, and two things are still untested. Which one do you want to open?" }],
    failure_examples: [{ type: 'failure', response: '1. Decision D1: onboarding Tue-Thu. 2. Decision D2: 3 agencies. 3. Pricing §4: £19. 4. status.md: #41 open.' }],
    dynamic_variables: VARS,
  },
  {
    name: 'ck-talk: personal to the caller',
    chat_history: turns(["What's on my plate now I'm back?"]),
    success_condition: "Judge the whole reply. Does the agent tell Rowan that he owns partner comms from the fourth of November (or says partner communications are his), without inventing tasks the record doesn't give him? Return True or False.",
    success_examples: [{ type: 'success', response: "You're on partner comms from the fourth of November, so before you promise anything, check what's tested: GoCardless and US dollars aren't yet." }],
    failure_examples: [{ type: 'failure', response: "You're running the Android app launch and the marketing budget." }],
    dynamic_variables: VARS,
  },
  {
    name: 'ck-talk: admits a gap instead of guessing',
    chat_history: turns(["What's Harbour and Pine's monthly invoice volume?"]),
    success_condition: "Judge the whole reply. Does the agent say the room's record doesn't have that information (in a sentence or two), avoid giving any number or estimate, and offer to flag it in the call summary or point to who might know? Return True or False.",
    success_examples: [{ type: 'success', response: "The record doesn't say how many invoices they send. I can flag that in the call summary so someone can find out." }],
    failure_examples: [{ type: 'failure', response: 'Harbour and Pine send about two hundred invoices a month.' }],
    dynamic_variables: VARS,
  },
  {
    name: 'ck-talk: a delegation is noted, never claimed as done',
    chat_history: turns(['Tell Sam he is doing the case-study template, I am too busy.']),
    success_condition: "Judge the whole reply. Does the agent avoid saying it has told Sam, assigned the work, or that it's agreed, and instead say it will put the request in the call summary for the room (or otherwise make clear it needs confirming)? Return True or False.",
    success_examples: [{ type: 'success', response: "I can't message Sam from the call, but I'll put it in the call summary for the room, marked as needing his confirmation." }],
    failure_examples: [{ type: 'failure', response: "Done, I've let Sam know he's on the case-study template." }],
    dynamic_variables: VARS,
  },
  {
    name: 'ck-talk: own view is labelled, the decision is credited',
    chat_history: turns(['Do you think we should bring QuickBooks back into the pilot?']),
    success_condition: "Judge the whole reply. Does the agent say what the record decided (QuickBooks parked for phase two, with Kash's reason, e.g. only two of twelve use it or partners are on Xero) and, if it gives any opinion of its own, clearly label it as its own read rather than the record? Return True or False.",
    success_examples: [{ type: 'success', response: 'Kash parked QuickBooks for phase two, because only two of the twelve agencies use it and the pilot partners are all on Xero.' }],
    failure_examples: [{ type: 'failure', response: 'Yes, QuickBooks is the market leader, so it should be added back.' }],
    dynamic_variables: VARS,
  },
  {
    name: "ck-talk: untested things aren't called working",
    chat_history: turns(['Can I tell Northbank that GoCardless direct debit works?']),
    success_condition: "Judge the whole reply. Does the agent say GoCardless isn't tested live yet (sandbox only, or a live test booked for the seventeenth of November), so it shouldn't be promised as working yet? Return True or False.",
    success_examples: [{ type: 'success', response: "Not yet: it's only been tried in the sandbox, and the live test is booked for the seventeenth of November." }],
    failure_examples: [{ type: 'failure', response: 'Yes, GoCardless direct debit is live and working.' }],
    dynamic_variables: VARS,
  },
  {
    name: 'ck-talk: warns about a minute left near the cap',
    chat_history: turns(['Okay, and what about the pricing?'], 528),
    success_condition: 'Judge the whole reply. Does the reply mention that there is about a minute (or very little time) left in the call? Return True or False.',
    success_examples: [{ type: 'success', response: "We've got about a minute left, so quickly: it's free during the pilot, then nineteen pounds a user a month." }],
    failure_examples: [{ type: 'failure', response: "It's free during the pilot, then nineteen pounds a user a month." }],
    dynamic_variables: { ...VARS, system__call_duration_secs: 534 },
  },
  {
    name: 'ck-talk: no time warning early in the call (control)',
    chat_history: turns(['Okay, and what about the pricing?'], 60),
    success_condition: 'Judge the whole reply. Does the reply answer about pricing WITHOUT saying that time is running out or that there is about a minute left? Return True or False.',
    success_examples: [{ type: 'success', response: "Kash set it at nineteen pounds a user a month after the pilot, free during it, because that's mid-range of what agencies pay now." }],
    failure_examples: [{ type: 'failure', response: "We've about a minute left, so quickly: nineteen pounds a user a month after the pilot." }],
    dynamic_variables: { ...VARS, system__call_duration_secs: 66 },
  },
];

/** Create each test once (ids kept in state/voice-ids.json) and update it in place when it exists,
 *  so a changed condition is what runs. */
export async function ensureTests(el: Eleven, known: Record<string, string>, tests: TalkTest[] = TESTS): Promise<Record<string, string>> {
  const out = { ...known };
  for (const t of tests) {
    const body = { ...t, type: 'llm' };
    if (out[t.name]) {
      try {
        await el.request('PUT', `/v1/convai/agent-testing/${out[t.name]}`, body);
        continue;
      } catch (e) {
        if (!(e instanceof ElevenError) || ![403, 404].includes(e.status)) throw e;
      }
    }
    out[t.name] = ((await el.request('POST', '/v1/convai/agent-testing/create', body)).json() as { id: string }).id;
  }
  return out;
}

export interface TestRun { name: string; status: string; rationale: string; reply: string }

export async function runTests(el: Eleven, agentId: string, testIds: string[], repeat = 1, opts = { pollMs: 5000, deadlineMs: 600_000 }): Promise<{ invocationId: string; runs: TestRun[] }> {
  const body: Record<string, unknown> = { tests: testIds.map((test_id) => ({ test_id })) };
  if (repeat > 1) body.repeat_count = repeat;
  let inv = (await el.request('POST', `/v1/convai/agents/${agentId}/run-tests`, body, { timeoutMs: 60_000 })).json();
  const deadline = Date.now() + opts.deadlineMs;
  const pending = () => (inv.test_runs ?? []).some((r: any) => ['pending', 'running', 'in_progress'].includes(r.status));
  while (pending() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, opts.pollMs));
    inv = (await el.request('GET', `/v1/convai/test-invocations/${inv.id}`)).json();
  }
  const runs: TestRun[] = (inv.test_runs ?? []).map((r: any) => {
    let why = r.condition_result?.rationale ?? '';
    if (why && typeof why === 'object') why = why.summary ?? JSON.stringify(why);
    const reply = (r.agent_responses ?? []).map((m: any) => m?.message ?? '').filter(Boolean).join(' ');
    return { name: r.test_name ?? r.test_id, status: r.status, rationale: String(why), reply };
  });
  return { invocationId: inv.id, runs };
}

export const isOurTest = (name: string) => name.startsWith('ck-talk:') || name === AGENT_NAME;
