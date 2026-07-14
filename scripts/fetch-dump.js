#!/usr/bin/env node
'use strict';
/**
 * Downloads the rechnik.chitanka.info database dump — the one input the dictionary is built from.
 *
 * The dump is published for download by the Речко project itself
 * (https://rechnik.chitanka.info/, "Скриптовете и базата са достъпни за сваляне"), and its
 * generator scripts are open at https://github.com/chitanka/rechko. That is what makes this
 * build reproducible by anyone — including an AMO reviewer, who is entitled to ask how a
 * 3 MB front-coded blob came to exist.
 *
 * The .gz is cached (it is ~100 MB over the wire and ~730 MB unpacked); the .sql is re-extracted
 * from it on every run, so `fix-stress-sql.js` always edits a pristine file and can never
 * double-apply. Delete .cache/ to start over.
 *
 *   node scripts/fetch-dump.js            # download if absent, unpack, record provenance
 *   node scripts/fetch-dump.js --force    # re-download even if cached
 *   node scripts/fetch-dump.js --check    # verify the cached dump matches data/PROVENANCE.json
 */
const {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { createGunzip } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { join } = require('node:path');

const root = join(__dirname, '..');
const CACHE = join(root, '.cache');
const GZ = join(CACHE, 'db.sql.gz');
const SQL = join(CACHE, 'rechnik.db.sql');
const PROVENANCE = join(root, 'data', 'PROVENANCE.json');

const DUMP_URL = process.env.RECHNIK_URL || 'https://rechnik.chitanka.info/db.sql.gz';

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function download() {
  process.stderr.write(`fetch-dump: GET ${DUMP_URL}\n`);
  const res = await fetch(DUMP_URL);
  if (!res.ok) throw new Error(`fetch-dump: ${DUMP_URL} -> HTTP ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(GZ));
  process.stderr.write(`fetch-dump: wrote ${GZ} (${(statSync(GZ).size / 1e6).toFixed(1)} MB)\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const checkOnly = argv.includes('--check');

  mkdirSync(CACHE, { recursive: true });

  if (checkOnly) {
    if (!existsSync(GZ)) throw new Error('fetch-dump: nothing cached — run `npm run dump` first');
    if (!existsSync(PROVENANCE)) throw new Error(`fetch-dump: ${PROVENANCE} is missing`);
    const recorded = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
    const actual = await sha256(GZ);
    if (actual !== recorded.sha256) {
      // Not necessarily an error: Речко updates its data. But the shipped dictionary was built
      // from a *specific* dump, and if you are about to regenerate it you should know that the
      // input moved under you.
      process.stderr.write(
        `fetch-dump: cached dump does NOT match data/PROVENANCE.json\n` +
          `  recorded: ${recorded.sha256} (fetched ${recorded.fetchedAt})\n` +
          `  actual:   ${actual}\n` +
          `  Upstream has published new data since the shipped dictionary was built.\n`
      );
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`fetch-dump: cached dump matches PROVENANCE.json (${actual.slice(0, 16)}…)\n`);
    return;
  }

  if (force || !existsSync(GZ)) {
    await download();
  } else {
    process.stderr.write(`fetch-dump: using cached ${GZ} (--force to re-download)\n`);
  }

  const sha = await sha256(GZ);

  process.stderr.write('fetch-dump: unpacking…\n');
  await pipeline(createReadStream(GZ), createGunzip(), createWriteStream(SQL));
  process.stderr.write(`fetch-dump: wrote ${SQL} (${(statSync(SQL).size / 1e6).toFixed(0)} MB)\n`);

  // Provenance is only rewritten on an explicit --force. A plain run must not silently
  // re-stamp the file: the recorded hash is the one the *shipped* dictionary was built from,
  // and it is the thing `--check` compares against.
  if (force || !existsSync(PROVENANCE)) {
    writeFileSync(
      PROVENANCE,
      JSON.stringify(
        {
          source: 'Речник на българския език (Речко) — https://rechnik.chitanka.info/',
          generator: 'https://github.com/chitanka/rechko',
          url: DUMP_URL,
          sha256: sha,
          bytes: statSync(GZ).size,
          fetchedAt: new Date().toISOString().slice(0, 10),
          note: 'SHA-256 of the gzipped dump that data/stress-dict.txt was built from. `npm run dump:check` verifies a local copy against it.',
        },
        null,
        2
      ) + '\n'
    );
    process.stderr.write(`fetch-dump: recorded provenance in ${PROVENANCE}\n`);
  }

  process.stderr.write('fetch-dump: done. Next: `npm run fix-sql && npm run dict`\n');
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
});
