// tts: the spoken script → an MP3 via ElevenLabs text-to-speech (one whole-file request; Slack plays a
// finished file, so streaming adds nothing). Settings from PREP elevenlabs.md: eleven_v4, voice
// Finley, mp3_44100_128, stability 0.7, a fixed seed so re-renders sound the same.
import type { Eleven } from './eleven.ts';

export interface TtsConfig { voiceId: string; modelId: string; outputFormat: string; stability: number; similarity: number; seed: number }

export const FINLEY = 'fnYMz3F5gMEDGMWcH1ex';

export function ttsConfigFromEnv(): TtsConfig {
  return {
    voiceId: process.env.ELEVENLABS_VOICE_ID || FINLEY,
    modelId: process.env.ELEVENLABS_TTS_MODEL || 'eleven_v4',
    outputFormat: process.env.ELEVENLABS_FORMAT || 'mp3_44100_128',
    stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.7),
    similarity: Number(process.env.ELEVENLABS_SIMILARITY ?? 0.75),
    seed: Number(process.env.ELEVENLABS_SEED ?? 4242),
  };
}

export interface TtsResult { mp3: Buffer; durationS: number; characters: number; requestId: string | null; ms: number }

/** One TTS call, 60 s timeout, no retries here (the caller decides: a failure means text only). */
export async function textToMp3(el: Eleven, text: string, cfg: TtsConfig = ttsConfigFromEnv()): Promise<TtsResult> {
  const t0 = Date.now();
  const res = await el.request('POST', `/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=${encodeURIComponent(cfg.outputFormat)}`, {
    text,
    model_id: cfg.modelId,
    voice_settings: { stability: cfg.stability, similarity_boost: cfg.similarity },
    seed: cfg.seed,
  }, { timeoutMs: 60_000 });
  const mp3 = res.bytes;
  const durationS = mp3Duration(mp3);
  if (!durationS) throw new Error('TTS returned no playable MP3 frames');
  const cost = Number(res.headers.get('character-cost') ?? res.headers.get('x-character-count') ?? NaN);
  return { mp3, durationS, characters: Number.isFinite(cost) ? cost : text.length, requestId: res.headers.get('request-id'), ms: Date.now() - t0 };
}

// ---- MP3 duration by walking the frame headers (works for CBR and VBR, MPEG 1/2/2.5 layer III) ----

const BITRATES: Record<string, number[]> = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Seconds of audio in an MP3 buffer, or 0 if no frames were found. */
export function mp3Duration(buf: Buffer): number {
  let i = 0;
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const version = (buf[i + 1] >> 3) & 0x3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 0x3; // 1 = layer III
    const brIdx = (buf[i + 2] >> 4) & 0xf;
    const srIdx = (buf[i + 2] >> 2) & 0x3;
    const pad = (buf[i + 2] >> 1) & 0x1;
    if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const kbps = BITRATES[version === 3 ? 'v1' : 'v2'][brIdx];
    const sr = RATES[version][srIdx];
    const samples = version === 3 ? 1152 : 576;
    const len = Math.floor(((samples / 8) * kbps * 1000) / sr) + pad;
    if (len < 4) { i++; continue; }
    seconds += samples / sr;
    frames++;
    i += len;
  }
  return frames ? Math.round(seconds * 100) / 100 : 0;
}
