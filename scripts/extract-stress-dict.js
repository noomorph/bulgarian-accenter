#!/usr/bin/env node
/**
 * extract-stress-dict.js
 *
 * Builds data/stress-dict.txt from the raw rechnik.info MySQL dump, in two passes.
 *
 * PASS 1 — ATTESTED (what v1 shipped, unchanged)
 *   Every backtick-marked Cyrillic token in the `word` table's `name_stressed` and `meaning`
 *   columns. Both columns feed one pool, deliberately; words with more than one observed
 *   stress position are flattened onto one form ("ду`хове`"). ~94.6k entries.
 *
 * PASS 2 — DERIVED (new)
 *   The dump also carries `derivative_form`: 4,013,667 fully-enumerated inflected forms, each
 *   linked to its lemma and labelled with what it is ("ед.ч. пълен член", "мин.св.вр., 3л., мн.ч.").
 *   Its own `name_stressed` column is NULL in 100% of rows — the paradigm is known, the stress
 *   is not. Pass 2 fills that in by propagating a lemma's attested stress across its paradigm:
 *   у`чих + а -> у`чиха. It adds ~334k forms and roughly quadruples the dictionary.
 *
 *   Four constraints keep it honest. Each was measured, and dropping any one of them
 *   visibly degrades the result (numbers are held-out, see README):
 *
 *   1. WITNESSES ARE BOUND TO THEIR LEXEME. A stress is only usable as evidence for lemma L if
 *      the marked token is itself a form of L. Pooling by string instead lets пи`та (the
 *      flatbread) supply the stress for питах (a form of питам), and scores весели`я (plural of
 *      весели`е) against the adjective ве`селия. Most of the naive rule's apparent error was
 *      this, and it is not a real disagreement about Bulgarian — just two words spelled alike.
 *
 *   2. ANCHOR ON THE STEM, NOT THE SUFFIX. Appending to a known form only reaches 213k forms,
 *      because уча -> учиш is not an append. Requiring instead that the witness and the target
 *      share a prefix *containing the witness's stressed vowel* reaches 700k.
 *
 *   3. VERBS HAVE TWO STEMS, AND STRESS MAY DIFFER BETWEEN THEM. Forms built on the aorist stem
 *      (мин.св., мин.деят.св.прич., and the compound tenses built on that participle) can be
 *      stressed differently from forms built on the present stem — which is precisely why a
 *      dictionary prints "мин. св." and "мин. прич." as separate principal parts. Propagating
 *      across that boundary invents бу`чал for a verb whose aorist is буча`л. So we don't.
 *
 *   4. BLOCK BY EVIDENCE, NOT BY PERMISSION. A whitelist of (class, slot) pairs known to be safe
 *      sounds right and is useless: the witnesses are far too sparse to cover 399 inflection
 *      classes, so almost every cell is simply *unseen*, and rejecting the unseen collapses the
 *      yield to 5,792 forms. Assume instead that stress is fixed on the stem — which is the
 *      common case — and subtract the cells where the data shows it isn't.
 *
 *      That blacklist needs one non-obvious feature: whether the lemma is MONOSYLLABIC. Every
 *      failure on the masculine definite article was one — бикъ`т, видъ`т, дъбъ`т, трудъ`т — because
 *      a monosyllabic masculine stresses its article, while ава`нпостът does not. Keyed on
 *      (class, slot) alone, those few words poison the slot for every polysyllabic noun in
 *      their class; keyed on (class, slot, monosyllabic?) they are contained.
 *
 *      The blocked cells are written to data/derivation-blocked.json so they can be read and
 *      argued with, in the same spirit as data/sql-corrections.json.
 *
 * An attested stress ALWAYS wins over a derived one; pass 2 can only fill gaps, never overrule.
 *
 * Usage:
 *   node --max-old-space-size=8192 scripts/extract-stress-dict.js [--in PATH] [--out PATH]
 *
 * Defaults:
 *   --in   $RECHNIK_SQL || <root>/.cache/rechnik.db.sql   (put there by `npm run dump`)
 *   --out  <root>/data/stress-dict.txt
 */

const { createReadStream, writeFileSync } = require('fs');
const { dirname, join } = require('path');

const { encode } = require('../src/dict.js');

const root = dirname(__dirname);

function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') args.in = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  args.in = args.in || process.env.RECHNIK_SQL || join(root, '.cache', 'rechnik.db.sql');
  args.out = args.out || join(root, 'data', 'stress-dict.txt');
  return args;
}

// ---------------------------------------------------------------------------
// VALUES row parser (single-quoted MySQL strings, NULL, numbers)
// ---------------------------------------------------------------------------
function parseValues(valuesStr) {
  const rows = [];
  let i = 0;
  const len = valuesStr.length;

  function skipWhitespace() {
    while (
      i < len &&
      (valuesStr[i] === ' ' || valuesStr[i] === '\n' || valuesStr[i] === '\r' || valuesStr[i] === '\t')
    )
      i++;
  }

  function parseString() {
    i++; // skip opening '
    let buf = '';
    while (i < len) {
      const ch = valuesStr[i];
      if (ch === '\\') {
        const next = valuesStr[i + 1] ?? '';
        switch (next) {
          case '\\':
            buf += '\\';
            i += 2;
            break;
          case "'":
            buf += "'";
            i += 2;
            break;
          case '"':
            buf += '"';
            i += 2;
            break;
          case '0':
            buf += '\0';
            i += 2;
            break;
          case 'n':
            buf += '\n';
            i += 2;
            break;
          case 'r':
            buf += '\r';
            i += 2;
            break;
          case 't':
            buf += '\t';
            i += 2;
            break;
          default:
            buf += next;
            i += 2;
            break;
        }
      } else if (ch === "'") {
        i++; // closing '
        break;
      } else {
        buf += ch;
        i++;
      }
    }
    return buf;
  }

  function parseAtom() {
    skipWhitespace();
    if (i >= len) return undefined;
    const ch = valuesStr[i];
    if (ch === "'") return parseString();
    let atom = '';
    while (
      i < len &&
      valuesStr[i] !== ',' &&
      valuesStr[i] !== ')' &&
      valuesStr[i] !== '\n' &&
      valuesStr[i] !== '\r'
    ) {
      atom += valuesStr[i++];
    }
    atom = atom.trim();
    if (atom === 'NULL') return null;
    const n = Number(atom);
    return isNaN(n) ? atom : n;
  }

  function parseRow() {
    skipWhitespace();
    if (i >= len || valuesStr[i] !== '(') return null;
    i++; // skip (
    const row = [];
    while (i < len) {
      skipWhitespace();
      if (valuesStr[i] === ')') {
        i++;
        break;
      }
      if (valuesStr[i] === ',') {
        i++;
        continue;
      }
      row.push(parseAtom());
    }
    return row;
  }

  while (i < len) {
    skipWhitespace();
    if (i >= len) break;
    if (valuesStr[i] === ',') {
      i++;
      continue;
    }
    if (valuesStr[i] === '(') {
      const row = parseRow();
      if (row) rows.push(row);
    } else {
      i++;
    }
  }
  return rows;
}

// word:            id(0) name(1) name_stressed(2) name_broken(3) name_condensed(4) meaning(5) ... type_id(8)
const W_ID = 0,
  W_NAME = 1,
  W_STRESSED = 2,
  W_MEANING = 5,
  W_TYPE = 8;
// derivative_form: id(0) name(1) ... description(5) is_infinitive(6) base_word_id(7)
const D_NAME = 1,
  D_DESC = 5,
  D_INF = 6,
  D_BASE = 7;
// word_type:       id(0) name(1) idi_number(2) speech_part(3)
const T_ID = 0,
  T_NAME = 1,
  T_SPEECH = 3;

// ---------------------------------------------------------------------------
// Backtick-token extraction
// ---------------------------------------------------------------------------
const TOKEN_RE = /[Ѐ-ӿ`]+/g;
/** A form with a space in it (учи`л съм) can never match a single word token on a page. */
const SINGLE_TOKEN_RE = /^[Ѐ-ӿ]+$/;

const VOWELS = new Set('аеиоуъюя');

function countVowels(word) {
  let n = 0;
  for (const ch of word) if (VOWELS.has(ch)) n++;
  return n;
}

// A stress mark is only meaningful directly after a vowel; anywhere else it would put an accent
// on a consonant ("ц́"). Drop such marks, and drop the token with them if none survive.
//
// This is a safety net, not a repair. The dump used to carry 25 misplaced marks in its
// `name_stressed` cells; those are corrected at source now (see scripts/fix-stress-sql.js and
// data/sql-corrections.json), leaving 3 that are genuinely ambiguous — the mark is followed by a
// consonant or by nothing, so a candidate vowel sits on either side of a syllable boundary and
// nothing in the data chooses between them. Their marks are dropped and the words go unaccented.
//
// Do not be tempted to "fix" a stray mark by shifting it onto the neighbouring vowel. That was
// tried: it is right most of the time and confidently wrong the rest, inventing защитно́ where
// the dictionary's own prose plainly says защи́тно. Corrections belong in the corrections file,
// where a human can read them, not in a heuristic that guesses in the dark.
function sanitize(tok) {
  let out = '';
  for (const ch of tok) {
    if (ch !== '`') {
      out += ch;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && VOWELS.has(prev)) out += ch;
  }
  return out;
}

function extractTokens(text, sink) {
  if (!text) return;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const tok = m[0].toLowerCase();
    if (!tok.includes('`')) continue;
    if (!/[Ѐ-ӿ]/.test(tok)) continue;
    const key = tok.replace(/`/g, '');
    if (!key) continue;
    // Monosyllables need no mark: the only syllable is the stressed one.
    if (countVowels(key) < 2) continue;
    const variant = sanitize(tok);
    if (!variant.includes('`')) continue;
    sink(key, variant);
  }
}

/** Offsets into the unmarked key at which a mark sits. "вя`тър" -> [2] */
function stressPositions(variant) {
  const positions = [];
  let k = 0;
  for (const ch of variant) {
    if (ch === '`') positions.push(k);
    else k++;
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Pass 2: paradigm shape
// ---------------------------------------------------------------------------

/**
 * Bulgarian verbs build one set of forms on the present stem and another on the aorist stem,
 * and the two can carry different stress (у`чих *and* учи`х are both recorded for уча). Stress
 * may be propagated freely within a group and never across one.
 */
const AORIST_STEM =
  /мин\.св\.вр|мин\.деят\.св\.прич|мин\.неопр\.вр|мин\.предв\.вр|бъд\.пред\.вр|мин\.страд\.прич/;
const IMPERFECT_STEM = /мин\.несв\.вр|мин\.деят\.несв\.прич/;

function stemGroup(desc, isVerb) {
  if (!isVerb) return 0; // nominals inflect off one stem
  if (AORIST_STEM.test(desc)) return 1;
  if (IMPERFECT_STEM.test(desc)) return 2;
  return 3;
}

/** Pronouns are suppletive and tiny; "other" is prefixes, abbreviations, phrases. Not worth guessing. */
const DERIVABLE_SPEECH = /^(noun|verb|adject|numeral|name)/;

function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(`extract-stress-dict: reading ${args.in}\n`);

  // ---- pass 1 pool: string-keyed, both columns, deliberately -------------------------------
  //
  // It is tempting to rank the columns — to treat `name_stressed` as curated truth and `meaning`
  // as hand-written noise, and let the former veto the latter. That was tried and it is wrong on
  // both counts. Every one of the 24 malformed marks in this dump lives in `name_stressed`;
  // `meaning` contains none. And `name_stressed` is NULL for roughly half the word rows, so prose
  // is the *only* witness for most inflections and for variants the lexicographer noted by hand
  // ("и [[абза`ц]]"). Vetoing it silently destroyed ~227 genuine readings, including homographs
  // such as ни`ва (a field) vs нива` (plural of ниво) — two different words that happen to share a
  // spelling. Surfacing both is the entire point; see TZ.md.
  const attestedVariants = new Map(); // key -> Set<variant>
  function attest(key, variant) {
    let set = attestedVariants.get(key);
    if (!set) attestedVariants.set(key, (set = new Set()));
    set.add(variant);
  }

  // ---- per-lexeme state, for pass 2 --------------------------------------------------------
  const words = new Map(); // word id -> { name, type, own: [variant] }  (own = marks in THIS row)
  const paradigms = new Map(); // word id -> { names: [], descs: [], lemma: idx }
  const typeSpeech = new Map(); // type id -> speech_part
  const typeName = new Map(); // type id -> human label ("176ti")
  const descs = []; // interned description strings
  const descIds = new Map();
  function descId(d) {
    const k = d ?? '';
    let v = descIds.get(k);
    if (v === undefined) descIds.set(k, (v = descs.push(k) - 1));
    return v;
  }

  let wordRows = 0;
  let formRows = 0;

  function processStatement(sql) {
    const match = sql.match(/^INSERT INTO `([^`]+)` VALUES\s*/s);
    if (!match) return;
    const table = match[1];
    if (table !== 'word' && table !== 'derivative_form' && table !== 'word_type') return;

    let valuesStr = sql.slice(match[0].length);
    if (valuesStr.endsWith(';')) valuesStr = valuesStr.slice(0, -1);

    for (const row of parseValues(valuesStr)) {
      if (table === 'word') {
        wordRows++;
        // Marks found in THIS row are evidence about THIS lexeme (constraint 1). The same tokens
        // also go into the global attested pool, which is string-keyed by design.
        const own = [];
        const collect = (key, variant) => {
          own.push(variant);
          attest(key, variant);
        };
        extractTokens(row[W_STRESSED], collect);
        extractTokens(row[W_MEANING], collect);
        words.set(row[W_ID], { name: row[W_NAME], type: row[W_TYPE], own });
      } else if (table === 'derivative_form') {
        const base = row[D_BASE];
        const name = row[D_NAME];
        if (base == null || !name) continue;
        formRows++;
        let p = paradigms.get(base);
        if (!p) paradigms.set(base, (p = { names: [], descs: [], lemma: -1 }));
        if (row[D_INF] === 1 && p.lemma < 0) p.lemma = p.names.length;
        p.names.push(name);
        p.descs.push(descId(row[D_DESC]));
      } else {
        typeSpeech.set(row[T_ID], row[T_SPEECH] ?? '');
        typeName.set(row[T_ID], String(row[T_NAME] ?? row[T_ID]));
      }
    }
  }

  let inString = false;
  let buf = '';

  function feedChunk(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inString) {
        buf += ch;
        if (ch === '\\') {
          i++;
          if (i < chunk.length) buf += chunk[i];
        } else if (ch === "'") {
          inString = false;
        }
      } else {
        if (ch === "'") {
          inString = true;
          buf += ch;
        } else if (ch === ';') {
          const stmt = buf.trim();
          buf = '';
          if (stmt.startsWith('INSERT INTO `')) processStatement(stmt + ';');
        } else {
          buf += ch;
        }
      }
    }
  }

  const stream = createReadStream(args.in, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  await new Promise((resolve, reject) => {
    stream.on('data', feedChunk);
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  if (buf.trim().startsWith('INSERT INTO `')) processStatement(buf.trim());

  process.stderr.write(
    `extract-stress-dict: word rows=${wordRows}, derivative forms=${formRows}, ` +
      `types=${typeSpeech.size}, attested keys=${attestedVariants.size}\n`
  );

  // -------------------------------------------------------------------------
  // A lexeme, as pass 2 sees it.
  // -------------------------------------------------------------------------
  /** Deduped (name, desc) slots, plus the stresses we can prove belong to *this* lexeme. */
  function lexemeView(id) {
    const w = words.get(id);
    const p = paradigms.get(id);
    if (!w || !p) return null;
    const speech = typeSpeech.get(w.type) ?? '';
    if (!DERIVABLE_SPEECH.test(speech)) return null;

    const isVerb = speech.startsWith('verb');
    const inParadigm = new Set(p.names);

    // Constraint 1: a mark in this row is a witness only if it names a form of this lexeme.
    // That drops the cross-references a definition makes to *other* words ("и [[абза`ц]]").
    const bound = new Map(); // form name -> sorted offsets
    for (const variant of w.own) {
      const key = variant.replace(/`/g, '');
      if (!inParadigm.has(key)) continue;
      let set = bound.get(key);
      if (!set) bound.set(key, (set = new Set()));
      for (const off of stressPositions(variant)) set.add(off);
    }
    if (bound.size === 0) return null; // nothing to propagate from
    for (const [k, set] of bound)
      bound.set(
        k,
        [...set].sort((a, b) => a - b)
      );

    const slots = [];
    const seen = new Set();
    for (let i = 0; i < p.names.length; i++) {
      const k = p.names[i] + ' ' + p.descs[i];
      if (seen.has(k)) continue;
      seen.add(k);
      slots.push({ name: p.names[i], desc: p.descs[i], group: stemGroup(descs[p.descs[i]], isVerb) });
    }

    const lemma = p.lemma >= 0 ? p.names[p.lemma] : w.name || '';
    return { id, type: w.type, lemma, mono: countVowels(lemma) < 2, slots, bound };
  }

  /**
   * The witness to derive `slot` from: the form of the same lexeme, in the same stem group,
   * that shares the longest prefix with it — provided that prefix still contains the witness's
   * own stressed vowel (constraint 2). If it doesn't, the stress sits in a part of the word the
   * two forms do not share, and carrying it over would be arithmetic, not evidence.
   */
  function bestWitness(lx, slot) {
    let best = null;
    for (const cand of lx.slots) {
      if (cand.name === slot.name) continue;
      if (cand.group !== slot.group) continue; // constraint 3
      const offsets = lx.bound.get(cand.name);
      if (!offsets) continue;
      const shared = commonPrefixLen(cand.name, slot.name);
      if (shared === 0) continue;
      if (!offsets.every((o) => o <= shared)) continue;
      if (!best || shared > best.shared) best = { shared, offsets, from: cand.name };
    }
    return best;
  }

  const lexemes = [];
  for (const id of paradigms.keys()) {
    const lx = lexemeView(id);
    if (lx) lexemes.push(lx);
  }

  // ---- constraint 4: learn which (class, slot, monosyllabic?) cells move the stress ----------
  const cellKey = (lx, slot) => `${lx.type} ${slot.desc} ${lx.mono ? 'M' : 'P'}`;
  const cellStats = new Map();

  for (const lx of lexemes) {
    for (const slot of lx.slots) {
      const truth = lx.bound.get(slot.name); // a form whose stress we already know
      if (!truth || countVowels(slot.name) < 2) continue;
      const w = bestWitness(lx, slot);
      if (!w) continue;
      const k = cellKey(lx, slot);
      let c = cellStats.get(k);
      if (!c)
        cellStats.set(k, (c = { n: 0, bad: 0, type: lx.type, desc: slot.desc, mono: lx.mono, examples: [] }));
      c.n++;
      // "Wrong" means every mark we would place is wrong — not merely that we also place an
      // extra one. Marking a superset is the same compromise the flattened-ambiguous entries
      // already make; marking the wrong vowel outright is the thing that must not ship.
      const hit = w.offsets.some((o) => truth.includes(o));
      if (!hit) {
        c.bad++;
        if (c.examples.length < 3) {
          c.examples.push({
            lemma: lx.lemma,
            form: slot.name,
            from: w.from,
            wouldBe: w.offsets,
            actually: truth,
          });
        }
      }
    }
  }

  const blocked = new Set();
  for (const [k, c] of cellStats) if (c.bad >= 1) blocked.add(k);

  // ---- derive ------------------------------------------------------------------------------
  const derived = new Map(); // key -> Set<offset>
  for (const lx of lexemes) {
    for (const slot of lx.slots) {
      if (lx.bound.has(slot.name)) continue; // already attested for this lexeme
      if (countVowels(slot.name) < 2) continue; // monosyllable: nothing to mark
      if (!SINGLE_TOKEN_RE.test(slot.name)) continue; // "учи`л съм" can never match a token
      if (blocked.has(cellKey(lx, slot))) continue;
      const w = bestWitness(lx, slot);
      if (!w) continue;
      let set = derived.get(slot.name);
      if (!set) derived.set(slot.name, (set = new Set()));
      // Two lexemes may spell a form alike (a homograph) and stress it differently. Union their
      // readings, exactly as pass 1 does for attested ambiguity: showing both is the point.
      for (const o of w.offsets) set.add(o);
    }
  }

  // ---- merge: attested always wins ---------------------------------------------------------
  const entries = [];
  for (const [key, variants] of attestedVariants) {
    const set = new Set();
    for (const v of variants) for (const o of stressPositions(v)) set.add(o);
    entries.push([key, [...set].sort((a, b) => a - b), false]);
  }
  let addedCount = 0;
  for (const [key, set] of derived) {
    if (attestedVariants.has(key)) continue; // never overrule a recorded stress
    entries.push([key, [...set].sort((a, b) => a - b), true]);
    addedCount++;
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  writeFileSync(args.out, encode(entries));

  // ---- the blocked cells, as something a human can read and argue with ----------------------
  const blockedReport = [...cellStats]
    .filter(([k]) => blocked.has(k))
    .map(([, c]) => ({
      inflection_class: typeName.get(c.type) ?? String(c.type),
      speech_part: typeSpeech.get(c.type) ?? '',
      slot: descs[c.desc],
      lemma_is_monosyllabic: c.mono,
      observed: c.n,
      would_have_been_wrong: c.bad,
      examples: c.examples.map((e) => ({
        lemma: e.lemma,
        form: e.form,
        derived_from: e.from,
        we_would_say: mark(e.form, e.wouldBe),
        sources_say: mark(e.form, e.actually),
      })),
    }))
    .sort((a, b) => b.would_have_been_wrong - a.would_have_been_wrong);
  writeFileSync(join(root, 'data', 'derivation-blocked.json'), JSON.stringify(blockedReport, null, 2) + '\n');

  const attestedCount = attestedVariants.size;
  const bytes = Buffer.byteLength(encode(entries), 'utf8');
  process.stderr.write(
    `extract-stress-dict: ${entries.length} entries ` +
      `(${attestedCount} attested + ${addedCount} derived), ` +
      `${blocked.size} blocked cells, ${(bytes / 1e6).toFixed(1)} MB -> ${args.out}\n`
  );
}

function mark(key, offsets) {
  let out = key;
  for (const o of [...offsets].sort((a, b) => b - a)) out = out.slice(0, o) + '`' + out.slice(o);
  return out;
}

main().catch((err) => {
  process.stderr.write(`extract-stress-dict: ERROR ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
