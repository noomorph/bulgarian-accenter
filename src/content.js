'use strict';
/**
 * Content script. Finds text under lang="bg" and inserts combining grave accents.
 *
 * This runs on <all_urls>, so the first thing it does is check whether the page has any
 * Bulgarian at all. If not, it never fetches or decodes the ~3.1 MB dictionary — that gate is
 * what keeps the extension free on the overwhelming majority of pages.
 */
(function () {
  const { ACCENT, accentText, removeAccents, hasCyrillic } = globalThis.BgAccent;

  const BG_SELECTOR = '[lang="bg" i], [lang^="bg-" i]';
  const BG_LANG_RE = /^bg(-|$)/i;

  // Never rewrite text the user is editing, text that isn't prose, or text that isn't rendered.
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'OPTION',
    'TITLE',
  ]);
  const SKIP_SELECTOR = 'script, style, noscript, textarea, input, select, option, title';

  const DEBOUNCE_MS = 200;
  const PROBE_DEBOUNCE_MS = 500;
  const FRAME_BUDGET_MS = 8; // keep each chunk inside a frame so we never visibly jank the page

  /** Original text of every node we rewrote, so toggling off restores it exactly. */
  const originals = new WeakMap();

  let dict = null;
  let enabled = true;
  let observer = null;
  let applying = false;
  let pending = null;
  const dirty = new Set();

  /** rAF is throttled to zero in background tabs, which would strand a page opened in a new tab. */
  function nextTick(fn) {
    if (document.hidden) setTimeout(fn, 0);
    else requestAnimationFrame(fn);
  }

  // --- lang resolution -------------------------------------------------------
  // lang is inherited, so a text node is Bulgarian iff its *nearest* ancestor carrying a
  // lang attribute declares Bulgarian. closest() resolves exactly that, which also gives
  // us "stop at a subtree with a different language" for free.
  function isBgLang(value) {
    return value != null && BG_LANG_RE.test(value.trim());
  }

  function inBgRegion(el) {
    const owner = el && el.closest('[lang]');
    return !!owner && isBgLang(owner.getAttribute('lang'));
  }

  /**
   * contenteditable is inherited, and contenteditable="false" carves a *non*-editable
   * island out of an editable region — so the nearest ancestor carrying the attribute wins.
   * (Resolved by hand rather than via el.isContentEditable, which not every DOM implements.)
   */
  function isEditable(el) {
    const owner = el.closest('[contenteditable]');
    return !!owner && (owner.getAttribute('contenteditable') || '').toLowerCase() !== 'false';
  }

  /** True for an element whose text we must never rewrite. */
  function isEditableElement(el) {
    if (!el.hasAttribute('contenteditable')) return false;
    return (el.getAttribute('contenteditable') || '').toLowerCase() !== 'false';
  }

  function isSkipped(el) {
    return !el || !!el.closest(SKIP_SELECTOR) || isEditable(el);
  }

  /**
   * Outermost elements whose subtree is Bulgarian. An element nested in another Bulgarian
   * region is redundant — but only if nothing in between switched language, so we test the
   * parent's *resolved* language rather than mere containment.
   */
  function bgRoots(scope) {
    const roots = [];
    if (
      scope.nodeType === Node.ELEMENT_NODE &&
      scope.matches(BG_SELECTOR) &&
      !inBgRegion(scope.parentElement)
    ) {
      roots.push(scope);
    }
    for (const el of scope.querySelectorAll(BG_SELECTOR)) {
      if (!inBgRegion(el.parentElement)) roots.push(el);
    }
    return roots;
  }

  /** Bulgarian text nodes under `root`, stopping at subtrees that switch language. */
  function collectTextNodes(root, sink) {
    if (root.nodeType === Node.ELEMENT_NODE && (SKIP_TAGS.has(root.tagName) || isEditable(root))) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (SKIP_TAGS.has(node.tagName) || isEditableElement(node)) return NodeFilter.FILTER_REJECT;
        const lang = node.getAttribute('lang');
        if (lang !== null && !isBgLang(lang)) return NodeFilter.FILTER_REJECT; // language switch ends the region
        return NodeFilter.FILTER_SKIP;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (hasCyrillic(n.data)) sink(n);
    }
  }

  // --- applying / restoring --------------------------------------------------
  function accentNode(node) {
    const out = accentText(node.data, dict);
    if (out === null) return; // unknown words, or already accented — accentText is idempotent
    if (!originals.has(node)) originals.set(node, node.data);
    node.data = out;
  }

  /** Spread work across frames so a large page never blocks the main thread visibly. */
  function processChunked(nodes) {
    let i = 0;
    const step = () => {
      applying = true;
      const deadline = performance.now() + FRAME_BUDGET_MS;
      while (i < nodes.length && performance.now() < deadline) accentNode(nodes[i++]);
      applying = false;
      if (observer) observer.takeRecords(); // drop the mutations we just caused
      if (i < nodes.length) nextTick(step);
    };
    step();
  }

  function scan(scope) {
    if (!enabled || !dict) return;
    const nodes = [];
    for (const root of bgRoots(scope)) collectTextNodes(root, (n) => nodes.push(n));
    if (nodes.length) processChunked(nodes);
  }

  function restoreAll() {
    applying = true;
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    const touched = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.data.includes(ACCENT)) touched.push(n);
    }
    for (const n of touched) {
      const original = originals.get(n);
      // Nodes we have no original for (e.g. the page cloned them) fall back to stripping
      // the accent: we only ever *add* U+0301, so removing it is lossless.
      n.data = original !== undefined ? original : removeAccents(n.data);
      originals.delete(n);
    }
    applying = false;
    if (observer) observer.takeRecords();
  }

  // --- dynamic content -------------------------------------------------------
  function flush() {
    pending = null;
    if (!enabled || !dict) {
      dirty.clear();
      return;
    }
    const scopes = [...dirty];
    dirty.clear();

    const nodes = [];
    for (const node of scopes) {
      if (!node.isConnected) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (parent && inBgRegion(parent) && !isSkipped(parent) && hasCyrillic(node.data)) nodes.push(node);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // The node may sit inside a Bulgarian region itself, or merely contain one.
      if (inBgRegion(node) && !isSkipped(node)) collectTextNodes(node, (n) => nodes.push(n));
      else for (const root of bgRoots(node)) collectTextNodes(root, (n) => nodes.push(n));
    }
    if (nodes.length) processChunked(nodes);
  }

  function schedule() {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(flush, DEBOUNCE_MS);
  }

  function startObserver() {
    observer = new MutationObserver((records) => {
      if (applying) return; // ignore our own rewrites
      for (const r of records) {
        if (r.type === 'childList') for (const n of r.addedNodes) dirty.add(n);
        else dirty.add(r.target); // characterData, or a lang/contenteditable flip
      }
      if (dirty.size) schedule();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['lang', 'contenteditable'],
    });
  }

  // --- toggle / lifecycle ----------------------------------------------------
  function reportState() {
    chrome.runtime
      .sendMessage({ type: 'BG_ACCENT_STATE', enabled, hasBulgarian: dict !== null })
      .catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'BG_ACCENT_TOGGLE') {
      if (dict) {
        enabled = !enabled;
        if (enabled) scan(document.documentElement);
        else restoreAll();
      }
      sendResponse({ enabled, hasBulgarian: dict !== null });
    }
    return false;
  });

  /**
   * Decoding 405k entries costs ~290 ms. Doing that in one go would blow the frame budget by an
   * order of magnitude and jank the page — the one thing this extension refuses to do — so the
   * decoder is stepped in 8 ms slices, like the DOM work.
   *
   * Unlike the DOM work, it is stepped on a *timer*, not on rAF. The decode touches nothing
   * visual, and rAF is not merely throttled when a page is not being rendered — it stops. A
   * background tab, an occluded window, a browser stricter about this than Chrome (Safari is)
   * and the pump never resumes, `dict` is never assigned, and the extension does nothing at all:
   * no accents, no badge, a dead toggle, no error. A frame-aligned clock is the right tool for
   * work that has to land in a frame and the wrong one for work that merely has to finish.
   */
  function decodeChunked(text) {
    const decoder = globalThis.BgDict.createDecoder(text);
    return new Promise((resolve) => {
      const step = () => {
        if (decoder.step(FRAME_BUDGET_MS)) resolve(decoder.dict);
        else setTimeout(step, 0);
      };
      step();
    });
  }

  async function boot() {
    try {
      const res = await fetch(chrome.runtime.getURL('data/stress-dict.txt'));
      dict = await decodeChunked(await res.text());
    } catch (err) {
      console.warn('[bulgarian-accenter] could not load dictionary:', err);
      return;
    }
    scan(document.documentElement);
    startObserver();
    reportState();
  }

  /**
   * The page has no Bulgarian *yet*. Rather than give up (an SPA may route to it later),
   * watch cheaply for one to appear: the callback only ever schedules a single debounced
   * querySelector, and we disconnect as soon as we boot for real.
   */
  function watchForBulgarian() {
    let probePending = null;
    const probe = new MutationObserver(() => {
      if (probePending !== null) return;
      probePending = setTimeout(() => {
        probePending = null;
        if (!document.querySelector(BG_SELECTOR)) return;
        probe.disconnect();
        boot();
      }, PROBE_DEBOUNCE_MS);
    });
    probe.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['lang'],
    });
  }

  function init() {
    if (document.querySelector(BG_SELECTOR)) {
      boot();
    } else {
      reportState();
      watchForBulgarian();
    }
  }

  init();
})();
