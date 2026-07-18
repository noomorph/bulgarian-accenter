'use strict';
/**
 * Exercises src/content.js against a real DOM: lang inheritance, the skip list,
 * capitalisation, idempotency, the MutationObserver and the on/off toggle.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const D = require('../src/dict.js');

const SRC = join(__dirname, '..', 'src');
const DICT_JS = readFileSync(join(SRC, 'dict.js'), 'utf8');
const ACCENT_JS = readFileSync(join(SRC, 'accent.js'), 'utf8');
const CONTENT_JS = readFileSync(join(SRC, 'content.js'), 'utf8');
const ACCENT = '̀';

const DICT = {
  вятър: 'вя`тър',
  ветрове: 'ветрове`',
  българия: 'бълга`рия',
  здравей: 'здраве`й',
  добре: 'добре`',
  дошли: 'дошли`',
};

/** The content script now fetches the front-coded file, so serve it exactly that. */
const DICT_TEXT = D.encode(
  Object.keys(DICT)
    .sort()
    .map((key) => {
      const offsets = [];
      let plain = 0;
      for (const ch of DICT[key]) {
        if (ch === '`') offsets.push(plain);
        else plain++;
      }
      return [key, offsets, false];
    })
);

/** Boots the content script over `html` and returns the jsdom window. */
async function load(html, { suspendFrames = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  // A page that is not being rendered does not get rAF callbacks at all — it is not throttled,
  // it is stopped (background tab, occluded window; Safari is stricter here than Chrome). Nothing
  // that must merely *finish* may be scheduled on it.
  if (suspendFrames) w.requestAnimationFrame = () => 0;

  const sent = [];
  const listeners = [];
  w.chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: (msg) => {
        sent.push(msg);
        return Promise.resolve();
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
  };
  w.fetch = () => Promise.resolve({ text: () => Promise.resolve(DICT_TEXT) });

  w.eval(DICT_JS);

  // The real dictionary needs ~33 slices to decode; the six-entry one here finishes in the first,
  // synchronous slice, which would never exercise the pump's scheduler at all. Force it to yield.
  if (suspendFrames) {
    const createDecoder = w.BgDict.createDecoder;
    w.BgDict.createDecoder = (text, includeDerived) => {
      const real = createDecoder(text, includeDerived);
      let slicesLeft = 3;
      return {
        get dict() {
          return real.dict;
        },
        step(budgetMs) {
          real.step(budgetMs);
          return --slicesLeft <= 0;
        },
      };
    };
  }

  w.eval(ACCENT_JS);
  w.eval(CONTENT_JS);

  w.__sent = sent;
  w.__toggle = () =>
    new Promise((resolve) => {
      for (const fn of listeners) fn({ type: 'BG_ACCENT_TOGGLE' }, {}, resolve);
    });

  await settle(w);
  return w;
}

/** Let the fetch microtask, the 200ms debounce and the rAF-chunked work all drain. */
function settle(w, ms = 400) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const textOf = (w, sel) => w.document.querySelector(sel).textContent;

test('accents text under lang="bg"', async () => {
  const w = await load('<p id="a" lang="bg">Духът на вятър</p>');
  assert.equal(textOf(w, '#a'), `Духът на вя${ACCENT}тър`);
});

test('boots even when the frame loop never runs', async () => {
  // Regression: the dictionary decode was pumped on requestAnimationFrame. Where rAF does not
  // fire, `dict` stayed null forever and the extension silently did *nothing* — no accents, no
  // badge, a dead toggle, no error. The decode touches no DOM, so it must not depend on painting.
  const w = await load('<p id="a" lang="bg">Духът на вятър</p>', { suspendFrames: true });
  assert.equal(textOf(w, '#a'), `Духът на вя${ACCENT}тър`);
  assert.ok(
    w.__sent.some((m) => m.type === 'BG_ACCENT_STATE' && m.hasBulgarian),
    'must still report state for the badge'
  );
});

test('inherits lang from an ancestor', async () => {
  const w = await load('<div lang="bg"><section><p id="a">вятър</p></section></div>');
  assert.equal(textOf(w, '#a'), `вя${ACCENT}тър`);
});

test('accepts regional tags like bg-BG', async () => {
  const w = await load('<p id="a" lang="bg-BG">вятър</p>');
  assert.equal(textOf(w, '#a'), `вя${ACCENT}тър`);
});

test('stops at a subtree that switches language', async () => {
  const w = await load('<div lang="bg"><p id="a">вятър</p><p id="b" lang="ru">вятър</p></div>');
  assert.equal(textOf(w, '#a'), `вя${ACCENT}тър`);
  assert.equal(textOf(w, '#b'), 'вятър', 'russian subtree must be left alone');
});

test('resumes inside a Bulgarian island nested in a foreign subtree', async () => {
  const w = await load(
    '<div lang="bg"><div lang="en"><p id="a">вятър</p><p id="b" lang="bg">вятър</p></div></div>'
  );
  assert.equal(textOf(w, '#a'), 'вятър', 'english region stays untouched');
  assert.equal(textOf(w, '#b'), `вя${ACCENT}тър`, 'bg island inside it is accented');
});

test('ignores pages with no Bulgarian markup', async () => {
  const w = await load('<p id="a">вятър</p>');
  assert.equal(textOf(w, '#a'), 'вятър');
});

test('does not touch script, style, textarea or inputs', async () => {
  const w = await load(`
    <div lang="bg">
      <script id="s" type="text/plain">вятър</script>
      <style id="c">/* вятър */</style>
      <textarea id="t">вятър</textarea>
      <p id="e" contenteditable="true">вятър</p>
      <p id="p">вятър</p>
    </div>`);
  assert.equal(textOf(w, '#s'), 'вятър');
  assert.equal(textOf(w, '#c'), '/* вятър */');
  assert.equal(textOf(w, '#t'), 'вятър');
  assert.equal(textOf(w, '#e'), 'вятър', 'contenteditable must stay editable-safe');
  assert.equal(textOf(w, '#p'), `вя${ACCENT}тър`, 'ordinary text alongside them still works');
});

test('contenteditable="false" is still accented', async () => {
  const w = await load('<div lang="bg"><p id="a" contenteditable="false">вятър</p></div>');
  assert.equal(textOf(w, '#a'), `вя${ACCENT}тър`);
});

test('preserves capitalisation', async () => {
  const w = await load('<p id="a" lang="bg">Вятър и България</p>');
  assert.equal(textOf(w, '#a'), `Вя${ACCENT}тър и Бълга${ACCENT}рия`);
});

test('accents content added later (MutationObserver)', async () => {
  const w = await load('<div id="root" lang="bg"><p>вятър</p></div>');
  const p = w.document.createElement('p');
  p.id = 'late';
  p.textContent = 'ветрове';
  w.document.getElementById('root').appendChild(p);
  await settle(w);
  assert.equal(textOf(w, '#late'), `ветрове${ACCENT}`);
});

test('does not double-accent on repeated passes', async () => {
  const w = await load('<div id="root" lang="bg"><p id="a">вятър</p></div>');
  // Force another pass by mutating a sibling; the existing node must not gain a second accent.
  w.document.getElementById('root').appendChild(w.document.createElement('span'));
  await settle(w);
  const text = textOf(w, '#a');
  assert.equal(text, `вя${ACCENT}тър`);
  assert.equal(text.split(ACCENT).length - 1, 1, 'exactly one accent');
});

test('leaves a word alone if the page already marked it with the other accent convention', async () => {
  // Regression: a source page marking stress with acute (U+0301) instead of our own grave
  // (U+0300) used to get torn apart at the mark and re-accented in pieces.
  const w = await load('<p id="a" lang="bg">Духът на вя́тър, ветрове</p>');
  assert.equal(textOf(w, '#a'), `Духът на вя́тър, ветрове${ACCENT}`);
});

test('boots when Bulgarian appears only after load (SPA route)', async () => {
  const w = await load('<div id="root"><p>hello</p></div>');
  assert.equal(w.document.querySelector('#root p').textContent, 'hello');
  const p = w.document.createElement('p');
  p.id = 'late';
  p.lang = 'bg';
  p.textContent = 'вятър';
  w.document.getElementById('root').appendChild(p);
  await settle(w, 900); // probe debounce + boot + apply
  assert.equal(textOf(w, '#late'), `вя${ACCENT}тър`);
});

test('toggle off restores the original text, toggle on re-applies', async () => {
  const w = await load('<p id="a" lang="bg">Добре дошли на вятър</p>');
  const original = 'Добре дошли на вятър';
  assert.equal(textOf(w, '#a'), `Добре${ACCENT} дошли${ACCENT} на вя${ACCENT}тър`);

  let state = await w.__toggle();
  await settle(w);
  assert.equal(state.enabled, false);
  assert.equal(textOf(w, '#a'), original, 'restores byte-for-byte');

  state = await w.__toggle();
  await settle(w);
  assert.equal(state.enabled, true);
  assert.equal(textOf(w, '#a'), `Добре${ACCENT} дошли${ACCENT} на вя${ACCENT}тър`);
});

test('reports state to the service worker for the badge', async () => {
  // Spread across realms: jsdom's objects carry jsdom's prototype, which deepEqual rejects.
  const w = await load('<p lang="bg">вятър</p>');
  assert.deepEqual({ ...w.__sent.at(-1) }, { type: 'BG_ACCENT_STATE', enabled: true, hasBulgarian: true });

  const plain = await load('<p>hello</p>');
  assert.deepEqual(
    { ...plain.__sent.at(-1) },
    { type: 'BG_ACCENT_STATE', enabled: true, hasBulgarian: false }
  );
});
