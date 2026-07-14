'use strict';
/**
 * The front-coded dictionary format: round-trip, provenance, and the properties the
 * shipped file is required to have.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const D = require('../src/dict.js');
const A = require('../src/accent.js');

const SAMPLE = [
  ['аванпост', [3], false],
  ['аванпоста', [3], true],
  ['аванпостовете', [3], true],
  ['вятър', [2], false],
  ['духове', [2, 6], false], // flattened ambiguity survives the format
  ['учиха', [1, 3], true],
];

test('encode/decode round-trips to the marked-string form the runtime expects', () => {
  const dict = D.decode(D.encode(SAMPLE));
  assert.equal(dict['аванпост'], 'ава`нпост');
  assert.equal(dict['аванпостовете'], 'ава`нпостовете');
  assert.equal(dict['вятър'], 'вя`тър');
  assert.equal(dict['духове'], 'ду`хове`');
  assert.equal(dict['учиха'], 'у`чи`ха');
  assert.equal(Object.keys(dict).length, SAMPLE.length);
});

test('front-coding actually shares prefixes with the previous key', () => {
  const lines = D.encode(SAMPLE).split('\n');
  // "аванпоста" shares all 8 chars of "аванпост", so it stores only the "а"
  assert.equal(lines[1], String.fromCharCode(48 + 8) + 'а;3');
  // and the first key shares nothing
  assert.equal(lines[0][0], '0');
});

test('decode(text, false) reconstructs the attested-only dictionary', () => {
  const attested = D.decode(D.encode(SAMPLE), false);
  assert.deepEqual(Object.keys(attested).sort(), ['аванпост', 'вятър', 'духове']);
  // skipping a derived entry must not desync the front-coding of the entries after it:
  // "вятър" follows two derived keys, and "духове" follows it
  assert.equal(attested['вятър'], 'вя`тър');
  assert.equal(attested['духове'], 'ду`хове`');
});

test('createDecoder: stepping in slices yields exactly what decoding in one go does', () => {
  const text = D.encode(SAMPLE);
  const decoder = D.createDecoder(text);
  // a zero-millisecond budget still makes progress, and never loses an entry at a slice boundary
  let slices = 0;
  while (!decoder.step(0)) {
    if (++slices > 10000) throw new Error('decoder failed to terminate');
  }
  assert.deepEqual(decoder.dict, D.decode(text));
});

test('decode survives a malformed line without desyncing the rest', () => {
  const text = D.encode(SAMPLE).split('\n');
  text.splice(2, 0, '0garbage-no-separator');
  const dict = D.decode(text.join('\n'));
  assert.equal(dict['вятър'], 'вя`тър');
  assert.equal(dict['учиха'], 'у`чи`ха');
});

// --- guards on the shipped dictionary ---------------------------------------
// The dictionary is a *generated* file and is not committed: it is built from a public dump by
// `npm run dict:all` (see CONTRIBUTING.md). Everything above this line tests the format itself and
// runs on a bare clone; everything below re-validates all 422k real entries and needs the build.
// A contributor fixing a typo in content.js should not have to download 70 MB to run the tests —
// but CI always has the file, so these guards never silently stop running where it matters.
const DICT_PATH = join(__dirname, '..', 'data', 'stress-dict.txt');
const SHIPPED = existsSync(DICT_PATH) ? readFileSync(DICT_PATH, 'utf8') : null;
const needsDict = {
  skip: SHIPPED ? false : 'data/stress-dict.txt not built — run `npm run dict:all`',
};

test('shipped dictionary: size and composition', needsDict, () => {
  const all = D.decode(SHIPPED);
  const attested = D.decode(SHIPPED, false);
  const total = Object.keys(all).length;
  const att = Object.keys(attested).length;

  assert.ok(total > 400000, `expected >400k entries, got ${total}`);
  assert.ok(att > 90000 && att < 100000, `expected ~94.6k attested entries, got ${att}`);
  assert.ok(total - att > 300000, `expected >300k derived entries, got ${total - att}`);

  // Attested is a strict subset, and pass 2 never overrules a recorded stress.
  for (const key of Object.keys(attested)) {
    assert.equal(all[key], attested[key], `${key}: derived pass overruled an attested stress`);
  }
});

test('shipped dictionary: every entry is well-formed', needsDict, () => {
  const dict = D.decode(SHIPPED);
  const broken = [];
  for (const [key, value] of Object.entries(dict)) {
    if (value.replace(/`/g, '') !== key) broken.push(`${key}: value does not strip back to key (${value})`);
    if (A.countVowels(key) < 2) broken.push(`${key}: monosyllable should have been dropped`);
    // A form with a space in it could never match a word token on a page — it is dead weight.
    if (!/^[Ѐ-ӿ]+$/.test(key)) broken.push(`${key}: not a single Cyrillic token`);
    const offsets = A.stressOffsets(value);
    if (offsets.length === 0) broken.push(`${key}: no valid stress mark (${value})`);
    if (offsets.some((o) => o > key.length)) broken.push(`${key}: offset out of range (${value})`);
  }
  assert.deepEqual(broken.slice(0, 10), [], `${broken.length} malformed entries`);
});

test('shipped dictionary: every entry accents without corrupting the word', needsDict, () => {
  const dict = D.decode(SHIPPED);
  for (const key of Object.keys(dict)) {
    const accented = A.accentWord(key, dict);
    assert.notEqual(accented, null, `${key}: expected an accent`);
    assert.equal(A.removeAccents(accented), key, `${key}: accenting corrupted the word`);
    for (let i = 0; i < accented.length; i++) {
      if (accented[i] === A.ACCENT) {
        assert.ok(A.isVowel(accented[i - 1]), `${key}: accent landed on "${accented[i - 1]}"`);
      }
    }
  }
});

test('shipped dictionary: the paradigm forms the second pass exists to supply', needsDict, () => {
  const dict = D.decode(SHIPPED);
  const attested = D.decode(SHIPPED, false);

  // уча: the aorist 3pl the sources never spell out. Both readings survive, because the
  // sources record both у`чих and учи`х — flattened ambiguity propagates through derivation.
  assert.equal(dict['учиха'], 'у`чи`ха');
  assert.equal(attested['учиха'], undefined, 'учиха must be derived, not attested');

  // аванпост: the definite/plural forms, none of which v1 had.
  assert.equal(dict['аванпостът'], 'ава`нпостът');
  assert.equal(dict['аванпостовете'], 'ава`нпостовете');

  // бикът keeps the stressed article the sources actually recorded — the derivation must not
  // have overwritten it with би`кът off the plural би`кове.
  assert.equal(dict['бикът'], 'бикъ`т');

  // The blocked cells hold: an -ост noun's definite form is never guessed off its lemma.
  // Whatever the dictionary says for it, it is not the (wrong) stem-stressed reading.
  assert.notEqual(dict['безкрайността'], 'безкра`йността');
});
