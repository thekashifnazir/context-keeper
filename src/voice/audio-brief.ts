// audio-brief: the whole audio half of job C. Written brief in → spoken script (Claude) → MP3
// (ElevenLabs) → optionally posted into the room under the text brief. Fail quiet: any error returns
// { ok: false, reason } and nothing reaches the room; the text brief has already gone out.
// A 401/402/403 from ElevenLabs turns audio off for the rest of the process (no retry storm).
// CK_FAULT=tts_500 injects a TTS failure (the D3-3 fault check). ELEVENLABS_AUDIO=off is the kill switch.
import type { TracePost } from '../shared/trace.ts';
import { costUsd, type Claude, type Usage } from '../agent/model.ts';
import { ElevenError, fatalEleven, type Eleven } from './eleven.ts';
import { audioCaption, audioFilename, postAudio, type SwitchMedia } from './post-audio.ts';
import { writeSpokenScript, type ScriptInput } from './script.ts';
import { textToMp3, ttsConfigFromEnv, type TtsConfig } from './tts.ts';

export interface AudioDeps {
  claude: Claude;
  el: Eleven | null; // null = no key: audio off
  media?: SwitchMedia; // absent = generate only, don't post
  tts?: TtsConfig;
  aliases?: Record<string, string>;
}
export interface AudioOk {
  ok: true; script: string; words: number; mp3: Buffer; durationS: number; filename: string; caption: string;
  ttsCharacters: number; ttsMs: number; usage: Usage[]; claudeUsd: number; post: TracePost | null;
}
export interface AudioFail { ok: false; reason: string; usage: Usage[] }

let audioDisabled: string | null = null;
export const resetAudio = () => { audioDisabled = null; };

/** Pronunciation fixes for the demo rooms, applied to the audio text only (listen first, add sparingly). */
export const DEFAULT_ALIASES: Record<string, string> = {};

export async function audioBrief(inp: ScriptInput, deps: AudioDeps, post?: { room: { id: string; name: string }; threadId?: string | null }): Promise<AudioOk | AudioFail> {
  const usage: Usage[] = [];
  if (process.env.ELEVENLABS_AUDIO === 'off') return { ok: false, reason: 'audio off (ELEVENLABS_AUDIO=off)', usage };
  if (!deps.el) return { ok: false, reason: 'audio off (no ELEVENLABS_API_KEY)', usage };
  if (audioDisabled) return { ok: false, reason: `audio off for this run: ${audioDisabled}`, usage };
  try {
    const s = await writeSpokenScript(deps.claude, inp, deps.aliases ?? DEFAULT_ALIASES, usage);
    if (process.env.CK_FAULT === 'tts_500') throw new ElevenError(500, 'injected', 'injected fault: tts_500 (CK_FAULT)', null);
    const tts = await textToMp3(deps.el, s.script, deps.tts ?? ttsConfigFromEnv());
    const filename = audioFilename(inp.person);
    const caption = audioCaption(inp.person, tts.durationS);
    let posted: TracePost | null = null;
    if (post && deps.media) posted = await postAudio(deps.media, post.room, { mp3: tts.mp3, filename, caption, threadId: post.threadId ?? null });
    return {
      ok: true, script: s.script, words: s.words, mp3: tts.mp3, durationS: tts.durationS, filename, caption,
      ttsCharacters: tts.characters, ttsMs: tts.ms, usage, claudeUsd: usage.reduce((a, u) => a + costUsd(u), 0), post: posted,
    };
  } catch (e) {
    if (fatalEleven(e)) audioDisabled = `ElevenLabs ${(e as ElevenError).status} ${(e as ElevenError).code}`;
    return { ok: false, reason: String((e as Error)?.message ?? e).slice(0, 300), usage };
  }
}
