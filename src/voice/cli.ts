// voice CLI: the audio brief and the "talk it through" agent, by hand.
//   npx tsx src/voice/cli.ts sample [--person Rowan] [--since 2026-09-14] [--brief <file>]
//       writes build/voice/catch-up-<person>.{mp3,script.txt,brief.txt} and prints the duration
//   npx tsx src/voice/cli.ts post-smoke [--mp3 <file>]      posts an MP3 into a fresh ck-smoke-* Mattermost room
//   npx tsx src/voice/cli.ts agent-setup                     creates or updates the ck- ElevenLabs agent (prompt from the room)
//   npx tsx src/voice/cli.ts agent-test [--repeat N]         ElevenLabs agent-testing: create the ck- tests once, run them
//   npx tsx src/voice/cli.ts talk-link [--name Rowan]        refreshes the prompt from the room, prints the talk link
//   npx tsx src/voice/cli.ts summary [--conversation <id>]   latest call's transcript → asked / didn't know / new ideas
//   npx tsx src/voice/cli.ts wipe                            deletes only the ck- resources this code made
// Spend goes to build/voice/spend.jsonl (one line per paid call). Keys are read from .env, never printed.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../agent/env.ts';
import { costUsd, realClaude, type Usage } from '../agent/model.ts';
import { loadDemoRoom } from '../agent/room.ts';
import { audioBrief } from './audio-brief.ts';
import { realEleven } from './eleven.ts';
import { postSmoke } from './smoke.ts';
import { standInBrief } from './stand-in.ts';
import { ensureTests, runTests } from './talk-tests.ts';
import { fetchCall, formatCallSummary, summariseCall } from './talk-summary.ts';
import { provisionTalkAgent, readIds, writeIds, refreshTalkAgent, snapshotStamp, talkConfigFromEnv, talkLink } from './talk-agent.ts';

loadEnv();
const OUT = 'build/voice';
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

export function logSpend(step: string, entry: { claude?: Usage[]; elevenCredits?: number; note?: string }) {
  const usd = (entry.claude ?? []).reduce((a, u) => a + costUsd(u), 0);
  appendFileSync(join(OUT, 'spend.jsonl'), JSON.stringify({ ts: new Date().toISOString(), step, claude_usd: Math.round(usd * 10000) / 10000, claude_calls: entry.claude?.length ?? 0, eleven_credits: entry.elevenCredits ?? 0, note: entry.note ?? '' }) + '\n');
  console.log(`spend ${step}: Claude $${usd.toFixed(4)} (${entry.claude?.length ?? 0} call(s)), ElevenLabs ~${entry.elevenCredits ?? 0} credits${entry.note ? ` (${entry.note})` : ''}`);
}

async function sample() {
  const person = flag('person', 'Rowan')!;
  const since = flag('since', '2026-09-14T00:00:00+01:00')!;
  const claude = realClaude();
  const slug = person.toLowerCase();
  let briefText: string;
  const briefFile = flag('brief');
  if (briefFile) {
    briefText = readFileSync(briefFile, 'utf8');
  } else {
    const room = loadDemoRoom(process.cwd(), 'ledgerly-pilot');
    const b = await standInBrief(claude, room, person, since);
    logSpend('stand-in written brief', { claude: [b.usage] });
    briefText = b.text;
  }
  writeFileSync(join(OUT, `catch-up-${slug}.brief.txt`), briefText + '\n');
  const res = await audioBrief({ briefText, person, room: 'the Ledgerly pilot room', awayFor: 'since the fourteenth of September' }, { claude, el: realEleven() });
  if (!res.ok) {
    logSpend('spoken script + TTS (failed)', { claude: res.usage });
    console.error(`audio brief failed: ${res.reason}`);
    process.exit(1);
  }
  logSpend('spoken script + TTS', { claude: res.usage, elevenCredits: res.ttsCharacters, note: `${res.script.length} chars on ${process.env.ELEVENLABS_TTS_MODEL || 'eleven_v4'}` });
  const mp3 = join(OUT, res.filename);
  writeFileSync(mp3, res.mp3);
  writeFileSync(join(OUT, `catch-up-${slug}.script.txt`), res.script + '\n');
  console.log(`\n${res.script}\n`);
  console.log(`wrote ${mp3}: ${res.durationS.toFixed(1)} s, ${res.words} words, ${(res.mp3.length / 1024).toFixed(0)} KB, TTS ${res.ttsMs} ms`);
  console.log(`caption: ${res.caption}`);
}

async function smoke() {
  const ev = await postSmoke(flag('mp3', join(OUT, 'catch-up-rowan.mp3'))!, flag('person', 'Rowan')!, OUT);
  console.log(JSON.stringify(ev, null, 2));
  if (!ev.read_back || !ev.same_size) process.exit(1);
}

const demoRoom = () => loadDemoRoom(process.cwd(), flag('room', 'ledgerly-pilot')!);

async function agentSetup() {
  const stamp = snapshotStamp();
  const r = await provisionTalkAgent(realEleven(), demoRoom(), stamp, talkConfigFromEnv());
  console.log(`${r.created ? 'created' : 'updated'} ${r.agentId} (snapshot ${stamp}); ids in state/voice-ids.json`);
}

async function link() {
  const { agent_id } = readIds();
  if (!agent_id) throw new Error('no agent yet: run agent-setup first');
  const stamp = snapshotStamp();
  const t0 = Date.now();
  await refreshTalkAgent(realEleven(), agent_id, demoRoom(), stamp, talkConfigFromEnv());
  console.log(`prompt refreshed from the room record (snapshot ${stamp}, ${Date.now() - t0} ms)`);
  console.log(talkLink(agent_id, flag('name', 'Rowan')!, stamp));
}

async function agentTest() {
  const el = realEleven();
  const ids = readIds();
  if (!ids.agent_id) throw new Error('no agent yet: run agent-setup first');
  const tests = await ensureTests(el, ids.tests ?? {});
  writeIds({ ...ids, tests });
  const repeat = Number(flag('repeat', '1'));
  const t0 = Date.now();
  const { invocationId, runs } = await runTests(el, ids.agent_id, Object.values(tests), repeat);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  writeFileSync(join(OUT, `agent-tests-${stamp}.json`), JSON.stringify({ invocationId, repeat, runs }, null, 2) + '\n');
  for (const r of runs) console.log(`${r.status.padEnd(8)} ${r.name}${r.status !== 'passed' ? `\n         why: ${r.rationale.slice(0, 220)}\n         reply: ${r.reply.slice(0, 220)}` : ''}`);
  const passed = runs.filter((r) => r.status === 'passed').length;
  console.log(`\n${passed}/${runs.length} passed (invocation ${invocationId}, ${Math.round((Date.now() - t0) / 1000)} s); saved build/voice/agent-tests-${stamp}.json`);
  if (passed !== runs.length) process.exitCode = 1;
}

async function summary() {
  const { agent_id } = readIds();
  if (!agent_id) throw new Error('no agent yet: run agent-setup first');
  const call = await fetchCall(realEleven(), agent_id, flag('conversation'));
  if (!call) { console.log('no finished calls yet for this agent'); return; }
  const caller = flag('name') ?? call.callerName ?? 'Someone';
  console.log(`call ${call.id}: ${call.transcript.length} turns, ${Math.round(call.durationS)} s, ${call.credits ?? '?'} ElevenLabs credits`);
  const { summary: s, usage } = await summariseCall(realClaude(), call, caller);
  logSpend('call summary', { claude: [usage] });
  const post = formatCallSummary(caller, call, s);
  writeFileSync(join(OUT, `call-summary-${call.id}.md`), post + '\n');
  console.log(`\n${post}\n\n(not posted: the live agent posts this through postPublic; saved build/voice/call-summary-${call.id}.md)`);
}

/** Deletes only what this code made: ids from state/voice-ids.json, each checked for the ck- prefix first. */
async function wipe() {
  const el = realEleven();
  const ids = readIds();
  if (ids.agent_id) {
    const a = (await el.request('GET', `/v1/convai/agents/${ids.agent_id}`)).json();
    if (String(a.name).startsWith('ck-')) { await el.request('DELETE', `/v1/convai/agents/${ids.agent_id}`); console.log(`deleted agent ${a.name} ${ids.agent_id}`); }
    else console.log(`skipped ${ids.agent_id}: name "${a.name}" isn't ck-`);
  }
  for (const [name, id] of Object.entries(ids.tests ?? {})) {
    if (!name.startsWith('ck-')) { console.log(`skipped test ${id}`); continue; }
    await el.request('DELETE', `/v1/convai/agent-testing/${id}`).then(() => console.log(`deleted test ${name}`), (e) => console.log(`test ${id}: ${e.message}`));
  }
  writeIds({});
}

const commands: Record<string, () => Promise<void>> = { sample, 'post-smoke': smoke, 'agent-setup': agentSetup, 'agent-test': agentTest, 'talk-link': link, summary, wipe };

const run = commands[cmd ?? ''];
if (!run) {
  console.error(`usage: npx tsx src/voice/cli.ts <${Object.keys(commands).join('|')}> [options]`);
  process.exit(2);
}
await run();
