#!/usr/bin/env node
'use strict';
/**
 * Builds dist/chrome and dist/firefox from manifest.base.json + the per-target deltas below.
 *
 * Two targets exist because two browsers genuinely disagree, not because we like build steps:
 *
 *   background — Chrome MV3 wants a `service_worker`; Firefox MV3 wants an event page
 *                (`scripts`). Neither accepts the other's key. This is the whole reason a
 *                single manifest.json cannot be shipped to both stores.
 *
 *   identity   — AMO wants an explicit `browser_specific_settings.gecko.id`, and it is a
 *                one-way door: change it later and every existing install is orphaned.
 *
 *   dynamic URL— data/stress-dict.txt has to be web-accessible for the content script to fetch
 *                it, which in Chrome makes the extension fingerprintable: any page can probe
 *                chrome-extension://<fixed-id>/data/stress-dict.txt and learn that you have it
 *                installed. `use_dynamic_url` re-randomises that path per session and closes it.
 *                Firefox already randomises the moz-extension:// origin per install, so it needs
 *                nothing here.
 *
 * `version` is read from package.json and written into both manifests, so the two can never
 * drift apart — which, left to hand-editing, they always eventually do.
 *
 *   node scripts/build.js            # -> dist/chrome, dist/firefox
 *   node scripts/build.js --zip      # + dist/bulgarian-accenter-{chrome,firefox}-<version>.zip
 */
const { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dist = join(root, 'dist');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const base = JSON.parse(readFileSync(join(root, 'manifest.base.json'), 'utf8'));

// Everything the extension actually ships. Anything not listed here stays out of the zip —
// that includes scripts/, test/, docs/, the 730 MB dump and node_modules.
const PAYLOAD = ['src', 'icons', 'data/stress-dict.txt'];

const TARGETS = {
  chrome: {
    background: { service_worker: 'src/background.js' },
    minimum_chrome_version: '102',
    web_accessible_resources: [
      {
        resources: ['data/stress-dict.txt'],
        matches: ['<all_urls>'],
        use_dynamic_url: true,
      },
    ],
  },
  firefox: {
    background: { scripts: ['src/background.js'] },
    browser_specific_settings: {
      gecko: {
        id: 'bulgarian-accenter@noomorph.github.io',
        strict_min_version: '128.0',
        // Firefox's data-consent framework. "none" is not a dodge — the extension makes no
        // network requests, keeps no user content, and has no analytics. This is the whole
        // declaration, and it is the honest one.
        data_collection_permissions: { required: ['none'] },
      },
    },
    web_accessible_resources: [
      {
        resources: ['data/stress-dict.txt'],
        matches: ['<all_urls>'],
      },
    ],
  },
};

function build(target, delta) {
  const out = join(dist, target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const entry of PAYLOAD) {
    const from = join(root, entry);
    if (!existsSync(from)) {
      // Most likely a fresh clone: the dictionary is generated and not committed. Fail loudly
      // rather than quietly building an extension that knows no words.
      throw new Error(`build: missing ${entry} — run \`npm run dict:fetch\` to get the dictionary`);
    }
    cpSync(from, join(out, entry), { recursive: true });
  }

  const manifest = { ...base, version: pkg.version, ...delta };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  process.stderr.write(`build: dist/${target} (v${pkg.version})\n`);
  return out;
}

function zip(target, dir) {
  const name = `bulgarian-accenter-${target}-${pkg.version}.zip`;
  const archive = join(dist, name);
  rmSync(archive, { force: true });
  // -X drops the extended attributes macOS would otherwise bake in, so the same tree zips to the
  // same bytes on a laptop and on a CI runner.
  execFileSync('zip', ['-qrX', archive, '.'], { cwd: dir });
  process.stderr.write(`build: dist/${name}\n`);
}

const wantZip = process.argv.includes('--zip');
for (const [target, delta] of Object.entries(TARGETS)) {
  const dir = build(target, delta);
  if (wantZip) zip(target, dir);
}
