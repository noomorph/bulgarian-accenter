'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const A = require('../src/accent.js');
const { ACCENT } = A;

/** Small hand-written dictionary so the unit tests don't depend on the real data. */
const DICT = {
  вятър: 'вя`тър',
  ветрове: 'ветрове`',
  духове: 'ду`хове`', // genuine two-stress entry (flattened ambiguity)
  здравей: 'здраве`й',
  българия: 'бълга`рия',
  бар: 'ба`р', // monosyllable — must be ignored even if a stale dict lists it
  врабците: 'врабц`ите', // malformed: mark sits on a consonant
  борци: 'борц`и`', // malformed mark + a valid one
};

test('stressOffsets: mark maps to the slot after the stressed vowel', () => {
  assert.deepEqual(A.stressOffsets('вя`тър'), [2]);
  assert.deepEqual(A.stressOffsets('ветрове`'), [7]);
  assert.deepEqual(A.stressOffsets('ду`хове`'), [2, 6]);
});

test('stressOffsets: drops marks that do not follow a vowel', () => {
  assert.deepEqual(A.stressOffsets('врабц`ите'), []); // accent would land on "ц"
  assert.deepEqual(A.stressOffsets('борц`и`'), [5]); // keeps only the valid mark
});

test('accentWord: inserts a combining grave after the stressed vowel', () => {
  assert.equal(A.accentWord('вятър', DICT), 'вя' + ACCENT + 'тър');
  assert.equal(A.accentWord('ветрове', DICT), 'ветрове' + ACCENT);
});

test('accentWord: marks every stress of a flattened-ambiguous entry', () => {
  assert.equal(A.accentWord('духове', DICT), 'ду' + ACCENT + 'хове' + ACCENT);
});

test('accentWord: preserves the original capitalisation', () => {
  assert.equal(A.accentWord('Вятър', DICT), 'Вя' + ACCENT + 'тър');
  assert.equal(A.accentWord('ВЯТЪР', DICT), 'ВЯ' + ACCENT + 'ТЪР');
  assert.equal(A.accentWord('България', DICT), 'Бълга' + ACCENT + 'рия');
});

test('accentWord: leaves unknown words alone rather than guessing', () => {
  assert.equal(A.accentWord('несъществуващо', DICT), null);
});

test('accentWord: skips monosyllables — the only syllable is the stressed one', () => {
  assert.equal(A.accentWord('бар', DICT), null);
});

test('accentWord: skips words whose every mark was invalid', () => {
  assert.equal(A.accentWord('врабците', DICT), null);
});

test('accentWord: is idempotent — never double-accents', () => {
  const once = A.accentWord('вятър', DICT);
  assert.equal(A.accentWord(once, DICT), null);
});

test('accentWord: leaves a word alone if it already carries the other accent convention', () => {
  // Plenty of Bulgarian text in the wild (Wiktionary among it) marks stress with the acute
  // (U+0301) rather than our own grave (U+0300). Either one means "already answered".
  const alreadyAcute = 'вя' + '́' + 'тър';
  assert.equal(A.accentWord(alreadyAcute, DICT), null);
});

test('accentText: does not fragment a word already marked with the other convention', () => {
  // Regression: WORD_RE used to fold in only our own mark, so a word already carrying the
  // *other* one split into pieces at the mark and each piece got independently — and wrongly —
  // re-looked-up and re-marked, producing a word wearing two or three accents at once
  // (e.g. "по́мни́̀л" from a source page's "помнѝл").
  const input = 'Духът на вя' + '́' + 'тър, ветрове';
  const out = A.accentText(input, DICT);
  assert.equal(out, 'Духът на вя' + '́' + 'тър, ветрове' + ACCENT);
});

test('accentText: rewrites known words and leaves everything else untouched', () => {
  const input = 'Духът на вятър, ветрове и HTML 2024!';
  const out = A.accentText(input, DICT);
  assert.equal(out, 'Духът на вя' + ACCENT + 'тър, ветрове' + ACCENT + ' и HTML 2024!');
});

test('accentText: returns null when nothing matched', () => {
  assert.equal(A.accentText('Hello, world!', DICT), null);
  assert.equal(A.accentText('Съвсем непознати думи', DICT), null);
});

test('accentText: a second pass over its own output is a no-op', () => {
  const once = A.accentText('вятър и ветрове', DICT);
  assert.equal(A.accentText(once, DICT), null);
});

test('removeAccents: round-trips back to the original text', () => {
  const input = 'Вятър и ветрове, 100% !';
  assert.equal(A.removeAccents(A.accentText(input, DICT)), input);
});

// The shipped dictionary is guarded in test/dict.test.js, where the format lives.
