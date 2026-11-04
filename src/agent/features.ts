// features: the live listener's optional parts, each behind an env flag. On by default for the demo
// runner (`npm run agent`); the eval runner (eval/replay.ts, startAgent) sets each one to "0" unless the
// eval's own environment sets it, so a scored run only changes when it says so.
//   CK_JOB_E=1        job E: idea → owner's "approve I<n>" → Claude Code in the build room → sign-off
//   CK_AUDIO_BRIEF=1  job C's ~60 s audio clip under the text brief (needs ELEVENLABS_API_KEY)
//   CK_TALK_LINK=1    job C's "talk it through" link and the call summary afterwards (needs
//                     ELEVENLABS_API_KEY and the talk agent's id in state/voice-ids.json)
// 0 / off / false / no turns one off.
import { envFlag } from './env.ts';

export const FEATURE_FLAGS = { jobE: 'CK_JOB_E', audioBrief: 'CK_AUDIO_BRIEF', talkLink: 'CK_TALK_LINK' } as const;
export type Features = Record<keyof typeof FEATURE_FLAGS, boolean>;

export function featuresFromEnv(): Features {
  return { jobE: envFlag(FEATURE_FLAGS.jobE, true), audioBrief: envFlag(FEATURE_FLAGS.audioBrief, true), talkLink: envFlag(FEATURE_FLAGS.talkLink, true) };
}

