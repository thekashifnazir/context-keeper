// quote: the one rule for "this quote really is in the source". The agent's gate (before posting)
// and the scorer (after) import this same file, so they can never disagree.
// Normalise: NFKC, lowercase, strip * _ ` and straight or curly quotes, collapse whitespace.

export const MIN_QUOTE_CHARS = 12;

export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[*_`"'‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the quote is long enough and appears, after normalising both, inside the source text. */
export function quoteVerified(quote: string, sourceText: string): boolean {
  const q = normalise(quote);
  return q.length >= MIN_QUOTE_CHARS && normalise(sourceText).includes(q);
}
