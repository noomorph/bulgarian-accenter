#!/usr/bin/env node
'use strict';
/**
 * Downloads the prebuilt dictionary from this repo's own GitHub release and verifies its hash.
 *
 * This is the fast path, and the one CI and most contributors want: 3 MB, a couple of seconds, no
 * 730 MB dump and no 6 GB of heap.
 *
 * Why we mirror it at all, rather than having everyone rebuild from the upstream dump:
 *
 *   1. The upstream (rechnik.chitanka.info) serves a 70 MB file for free and blocks datacenter
 *      IPs — GitHub Actions gets a 403. That is entirely reasonable of them, and the right
 *      response is to stop asking, not to route around it. We fetch it once, by hand, and pin it.
 *   2. It makes the build independent of a 12-year-old file on a site that has been raided before.
 *
 * The full rebuild from the true source is still one command — `npm run dict:all` — and it
 * reproduces this exact file, byte for byte. `data/stress-dict.sha256` is what proves it: this
 * script refuses a mirror that does not match the hash the source build produces.
 */
const { createWriteStream, readFileSync, writeFileSync, existsSync, unlinkSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { join } = require('node:path');

const root = join(__dirname, '..');
const OUT = join(root, 'data', 'stress-dict.txt');
const PIN = join(root, 'data', 'stress-dict.sha256');

const REPO = process.env.DICT_REPO || 'noomorph/bulgarian-accenter';
const TAG = process.env.DICT_TAG || 'dictionary';
const DICT_URL = `https://github.com/${REPO}/releases/download/${TAG}/stress-dict.txt`;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const expected = readFileSync(PIN, 'utf8').trim().split(/\s+/)[0];

  if (existsSync(OUT) && sha256(readFileSync(OUT)) === expected) {
    process.stderr.write('fetch-dict: data/stress-dict.txt is already present and matches. Nothing to do.\n');
    return;
  }

  process.stderr.write(`fetch-dict: GET ${DICT_URL}\n`);
  const res = await fetch(DICT_URL, {
    headers: { 'user-agent': `bulgarian-accenter (+https://github.com/${REPO})` },
  });
  if (!res.ok) {
    throw new Error(
      `fetch-dict: ${DICT_URL} -> HTTP ${res.status} ${res.statusText}\n` +
        'If the release asset is gone, rebuild from source instead: npm run dict:all'
    );
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(OUT));

  const actual = sha256(readFileSync(OUT));
  if (actual !== expected) {
    // A mirror that does not match the source build is worse than no mirror: it would ship a
    // dictionary nobody can reproduce. Refuse it, and leave nothing behind.
    unlinkSync(OUT);
    throw new Error(
      `fetch-dict: hash mismatch — refusing it.\n  expected ${expected}\n  got      ${actual}\n` +
        'The release asset does not match data/stress-dict.sha256. Rebuild from source: npm run dict:all'
    );
  }

  process.stderr.write(`fetch-dict: wrote data/stress-dict.txt (verified ${actual.slice(0, 16)}…)\n`);
}

// `npm run dict:hash` — re-pin after a genuine rebuild.
if (process.argv.includes('--write-pin')) {
  const hash = sha256(readFileSync(OUT));
  writeFileSync(PIN, `${hash}  stress-dict.txt\n`);
  process.stderr.write(`fetch-dict: pinned ${hash}\n`);
} else {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
