// refs: how a cited source is named in text people read. A record ref ("product.md §2", "led-011")
// is something a person can look up; a Switch message id ("sw_" + 32 hex) is not, so posts name that
// message by who said it and when instead (Kash, 4 Nov: an "Also:" line ended in a raw sw_ id).

/** A Switch message event id as the record carries it: never shown to people. */
export const isRawMessageId = (ref: string) => /^sw_[0-9a-z]{6,}$/i.test(ref.trim());

/** Every raw message id in a text (a test helper and a last check on user-facing lines). */
export const rawIdsIn = (text: string) => text.match(/\bsw_[0-9a-z]{6,}\b/gi) ?? [];
