'use strict';
/**
 * The dictionary's on-disk format, and its decoder.
 *
 * The obvious format — `{"вятър": "вя`тър"}` — spends most of its bytes twice: once on the
 * key, once on a near-copy of the key. That was tolerable at 94k entries (3.9 MB). With the
 * derived forms it is 597k entries and 28.8 MB, which is no longer a file you want to ship,
 * fetch and parse inside a content script.
 *
 * So the shipped file is front-coded instead. Keys are sorted, and each line stores only what
 * its key does *not* share with the previous one, plus the stress offsets:
 *
 *     0аванпост:3          -> аванпост      offsets [3]   ("ава`нпост")
 *     8а:3                 -> аванпоста     offsets [3]
 *     8ове:3               -> аванпостове   offsets [3]
 *
 * Bulgarian inflections sort next to each other and share long stems, which is exactly the
 * case front-coding is for: 428k entries fit in 3.1 MB — *smaller* than the old 94k-entry
 * file. The first byte is the shared-prefix length as an ASCII char (48 + n, capped at 60).
 *
 * The separator carries the entry's provenance, for free, in a byte we were spending anyway:
 *
 *     ':'  attested   — a stress mark that a source actually recorded
 *     ';'  derived    — inferred by propagating a stress across an inflection paradigm
 *
 * `decode(text, false)` therefore reconstructs the attested-only dictionary exactly, with no
 * extra memory and no second file. See README for what "derived" is and is not allowed to be.
 *
 * decode() hands back the same shape the runtime has always consumed — key -> "вя`тър" —
 * so accent.js keeps re-validating every mark against the word (a mark that does not follow
 * a vowel is dropped), and a corrupt dictionary still cannot render an accent on a consonant.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BgDict = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MARK = '`';
  const ATTESTED = ':';
  const DERIVED = ';';
  /** Shared-prefix length is one char; longer overlaps are simply not exploited. */
  const MAX_SHARED = 60;

  const COLON = 58; // ':'
  const SEMI = 59; // ';'
  const COMMA = 44; // ','
  const ZERO = 48; // '0'
  const NINE = 57; // '9'

  /**
   * entries: [key, offsets[], derived] — offsets ascending, into the *unmarked* key.
   * Must be sorted by key; encode does not sort, so the caller's order is the file's order
   * and a caller that forgets simply gets a bigger file, never a wrong one.
   */
  function encode(entries) {
    const lines = [];
    let prev = '';
    for (const [key, offsets, derived] of entries) {
      let shared = 0;
      while (shared < prev.length && shared < key.length && prev[shared] === key[shared]) shared++;
      if (shared > MAX_SHARED) shared = MAX_SHARED;
      lines.push(
        String.fromCharCode(ZERO + shared) +
          key.slice(shared) +
          (derived ? DERIVED : ATTESTED) +
          offsets.join(',')
      );
      prev = key;
    }
    return lines.join('\n');
  }

  const now =
    typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();

  /**
   * Lines to decode between clock checks — a power of two, so the check is a mask, not a modulo.
   * performance.now() costs more than a line does, so checking every line would dominate; but
   * checking too rarely overshoots the caller's budget. 256 keeps the overshoot under a
   * millisecond, which leaves the residual jitter to GC rather than to us.
   */
  const CLOCK_EVERY = 256;

  /**
   * A resumable decoder over the front-coded text.
   *
   * Decoding 422k entries takes ~240 ms, which is far too long to sit on the main thread in one
   * go: the whole point of this extension is that a page never visibly janks. So the decode is
   * sliced the same way content.js already slices its DOM work — `step(budgetMs)` decodes until
   * the budget runs out and returns false if there is more to do.
   *
   * Written as one linear scan with charCodeAt rather than split()/parseInt: at this size the
   * allocations, not the arithmetic, are what cost you.
   */
  function createDecoder(text, includeDerived = true) {
    const dict = Object.create(null);
    const n = text.length;
    let prev = '';
    let i = 0;

    function decodeLine() {
      let end = text.indexOf('\n', i);
      if (end === -1) end = n;

      // key: <shared><suffix>, terminated by the separator
      let sep = i + 1;
      while (sep < end) {
        const c = text.charCodeAt(sep);
        if (c === COLON || c === SEMI) break;
        sep++;
      }
      if (sep >= end) {
        i = end + 1; // malformed line — no separator. Skip it without touching `prev`.
        return;
      }

      const key = prev.slice(0, text.charCodeAt(i) - ZERO) + text.slice(i + 1, sep);
      prev = key; // front-coding is sequential: `prev` advances even for entries we skip

      if (includeDerived || text.charCodeAt(sep) !== SEMI) {
        // splice a MARK into the key at each offset, without materialising the offset list
        let out = '';
        let cut = 0;
        let num = -1;
        for (let k = sep + 1; k <= end; k++) {
          const c = k < end ? text.charCodeAt(k) : COMMA; // virtual trailing comma
          if (c >= ZERO && c <= NINE) {
            num = (num < 0 ? 0 : num * 10) + (c - ZERO);
          } else if (num >= 0) {
            out += key.slice(cut, num) + MARK;
            cut = num;
            num = -1;
          }
        }
        dict[key] = out + key.slice(cut);
      }

      i = end + 1;
    }

    return {
      dict,
      /** Decode for at most `budgetMs`. Returns true once the whole file is in. */
      step(budgetMs) {
        const deadline = now() + budgetMs;
        let guard = 0;
        while (i < n) {
          decodeLine();
          if ((++guard & (CLOCK_EVERY - 1)) === 0 && now() >= deadline) return false;
        }
        return true;
      },
    };
  }

  /** Decode the whole file in one go. Fine off the main thread (the generator, the tests). */
  function decode(text, includeDerived = true) {
    const d = createDecoder(text, includeDerived);
    d.step(Infinity);
    return d.dict;
  }

  return { encode, decode, createDecoder, MARK, ATTESTED, DERIVED, MAX_SHARED };
});
