'use strict';
/**
 * Pure stress-placement logic. No DOM, no chrome.* — so it runs under node:test.
 * Loaded as a plain content script (exposes globalThis.BgAccent) and as a CommonJS
 * module in tests; MV3 content scripts cannot be ES modules, hence the dual export.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BgAccent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Combining acute accent. Rendered over the preceding letter: а + U+0301 = а́ */
  const ACCENT = '́';
  /** Marker used by the dictionary, placed directly after the stressed vowel. */
  const MARK = '`';

  const VOWELS = new Set('аеиоуъюя');

  /** Cyrillic runs, with U+0301 folded in so an already-accented word stays one token. */
  const WORD_RE = /[\p{Script=Cyrillic}́]+/gu;
  const HAS_CYRILLIC_RE = /\p{Script=Cyrillic}/u;

  function isVowel(ch) {
    return VOWELS.has(ch.toLowerCase());
  }

  function countVowels(word) {
    let n = 0;
    for (const ch of word) if (isVowel(ch)) n++;
    return n;
  }

  /**
   * Dictionary entry -> offsets into the *unmarked* word at which to insert an accent.
   * "вя`тър" -> [2], i.e. insert after index 1 ("вя" + accent + "тър").
   *
   * A mark that does not follow a vowel is invalid and dropped: the accent would
   * otherwise render on a consonant ("ц́"). The generator now filters these out, but
   * a stale or hand-edited dictionary must not be able to produce broken glyphs.
   */
  function stressOffsets(entry) {
    const offsets = [];
    let plainIndex = 0;
    for (let i = 0; i < entry.length; i++) {
      const ch = entry[i];
      if (ch !== MARK) {
        plainIndex++;
        continue;
      }
      const prev = entry[i - 1];
      if (plainIndex > 0 && prev && prev !== MARK && isVowel(prev) && !offsets.includes(plainIndex)) {
        offsets.push(plainIndex);
      }
    }
    return offsets;
  }

  /**
   * Accent a single word, preserving its original capitalisation.
   * Returns null when the word should be left exactly as it is.
   *
   * Capitalisation survives because we only take *offsets* from the dictionary and
   * splice the accent into the original token; toLowerCase() is length-preserving
   * for Cyrillic, so the offsets line up.
   */
  function accentWord(token, dict) {
    if (token.includes(ACCENT)) return null; // already processed — keep idempotent
    const lower = token.toLowerCase();
    if (lower.length !== token.length) return null; // paranoia: offsets would desync
    const entry = dict[lower];
    if (entry === undefined) return null; // not in the dictionary — never guess
    if (countVowels(lower) < 2) return null; // monosyllable: the only syllable is the stressed one

    const offsets = stressOffsets(entry);
    if (offsets.length === 0) return null;
    if (offsets[offsets.length - 1] > token.length) return null; // entry/key mismatch

    let out = '';
    let prev = 0;
    for (const off of offsets) {
      out += token.slice(prev, off) + ACCENT;
      prev = off;
    }
    return out + token.slice(prev);
  }

  /** Accent every known word in a run of text. Returns null if nothing changed. */
  function accentText(text, dict) {
    if (!HAS_CYRILLIC_RE.test(text)) return null;
    let changed = false;
    const out = text.replace(WORD_RE, (token) => {
      const accented = accentWord(token, dict);
      if (accented === null) return token;
      changed = true;
      return accented;
    });
    return changed ? out : null;
  }

  function removeAccents(text) {
    return text.split(ACCENT).join('');
  }

  function hasCyrillic(text) {
    return HAS_CYRILLIC_RE.test(text);
  }

  return {
    ACCENT,
    MARK,
    isVowel,
    countVowels,
    stressOffsets,
    accentWord,
    accentText,
    removeAccents,
    hasCyrillic,
  };
});
