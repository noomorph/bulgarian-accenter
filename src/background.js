'use strict';
/**
 * Minimal service worker. Exists only because chrome.action.onClicked is the only way to
 * react to a toolbar-icon click without adding a popup — all real work is in the content script.
 */

const GREEN = '#00966e'; // Bulgarian flag green
const GREY = '#8a8a8a';

async function paint(tabId, state) {
  if (!state || !state.hasBulgarian) {
    // Nothing to do on this page: leave the badge empty rather than implying it's "off".
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'Bulgarian Accenter — no lang="bg" text on this page' });
    return;
  }
  await chrome.action.setBadgeText({ tabId, text: state.enabled ? 'ON' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: state.enabled ? GREEN : GREY });
  await chrome.action.setTitle({
    tabId,
    title: state.enabled
      ? 'Bulgarian Accenter — on (click to turn off)'
      : 'Bulgarian Accenter — off (click to turn on)',
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'BG_ACCENT_TOGGLE' });
    await paint(tab.id, state);
  } catch {
    // No content script here (chrome://, the web store, a PDF viewer, ...). Nothing to toggle.
    await paint(tab.id, null);
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'BG_ACCENT_STATE' && sender.tab && sender.tab.id !== undefined) {
    paint(sender.tab.id, msg);
  }
  return false;
});
