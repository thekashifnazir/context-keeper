// command: what a typed command looks like once chat formatting is taken off it. Kash, 4 Nov (I7):
// "issue with copying text type approve I7 and nothing happened but then i typed in and came up
// straight away". The desk note showed `approve I7` as inline code; Slack pasted the copy as code, so
// Switch delivered "`approve I7`" and the exact-match parser missed it. Every plain-words parser
// (approve, sign-off, the owner's confirm/drop) reads the text through this first.
//
// Taken off, outside in, until nothing changes: code fences (```approve I7```), backticks, bold /
// italic / strike markers (*, _, ~), quotes (straight and smart), Slack's <@U123> and leading
// @mentions, zero-width characters, non-breaking spaces, and trailing punctuation the parsers allow
// anyway. Case is left alone (the parsers are case-insensitive). The words inside are never changed.
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const FENCE = /^```(?:[a-z0-9_+-]*\n)?\s*([\s\S]*?)\s*```$/i; // a language tag only before a newline
const WRAP = /^[`*_~"'“”‘’«»]+|[`*_~"'“”‘’«»]+$/g;
const LEAD_MENTION = /^(?:<@[^>]+>|@[\w.-]+)[:,]?\s+/;

export function plainCommand(text: string): string {
  let t = text.replace(ZERO_WIDTH, '').replace(/ /g, ' ').trim();
  for (let i = 0; i < 6; i++) {
    const before = t;
    const fence = t.match(FENCE);
    if (fence) t = fence[1];
    t = t.replace(LEAD_MENTION, '').replace(WRAP, '').replace(/^[\s([{]+|[\s)\]}]+$/g, '').trim();
    if (t === before) break;
  }
  return t.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}
