# Release checklist — GitHub + Chrome Web Store + AMO

Status as of 2026-07-14. ✅ done · ⬜ open · ⛔ blocking.

---

## 0. Licensing — RESOLVED ✅

The original blocker was "under what terms may we redistribute this dictionary?". Answered:

- ✅ **The word list is copyleft, and that is the finding with teeth.** Rechnik's word forms descend
  from [БГ Офис](https://bgoffice.sourceforge.net/license.html) (© Радостин Раднев), whose licence
  page says «класифицираните думи» — *the classified words themselves*, not just the code — are
  GPL-2.0-or-later. Stress positions are facts and are not copyrightable; the words carrying them
  are a different matter.
- ✅ **A 2010 tri-licence is the way through.** БГ Офис re-licensed its distributed dictionary
  packages as *GPL-2.0+ **OR** LGPL-2.0+ **OR** MPL-1.1*, precisely so the Bulgarian dictionary
  could ship inside Firefox and Chrome. Debian's `hunspell-bg` and npm's `dictionary-bg` take the
  same route.
- ✅ **We elect MPL-1.1** for `data/stress-dict.txt` (text in `data/LICENSE-MPL-1.1.txt`). Code stays
  MIT. Chain and reasoning in `NOTICE`.
- ⚠️ **Речко grants nothing.** No LICENSE in `chitanka/rechko`, no terms on the site. "Available for
  download" is not a licence, and under the EU database right free publication does not exhaust the
  right to redistribute extracts. Mitigating: the dump's `last-modified` is **2013**, so the 15-year
  term lapses around 2028, and *CV-Online v Melons* (C-762/19) requires harm to the maker's
  investment. **Residual risk, accepted knowingly.** We credit Речко, ship none of its definitions
  (only word forms and stress positions), and would take the data down on a reasonable request.

## 1. Repo — DONE ✅

- ✅ `git init`, `main`, first commit contains `LICENSE` + `.gitignore` (no history to rewrite later)
- ✅ MIT `LICENSE` (code) · `NOTICE` + `data/LICENSE-MPL-1.1.txt` (data)
- ✅ `.editorconfig`, `.gitattributes` (dict marked `linguist-generated -diff`), `.nvmrc`, `.gitignore`
- ✅ `CHANGELOG.md` (Keep a Changelog), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `PRIVACY.md`
- ✅ Issue templates — including **`wrong_accent.yml`**, the one that actually matters: it is the
  feedback loop that grinds the 0.2% error rate down into `data/sql-corrections.json`
- ✅ `dependabot.yml` (npm + actions, monthly)
- ✅ ESLint + Prettier. **Markdown is excluded from Prettier on purpose** — the prose is dense with
  nested backticks around Bulgarian words that carry their own backtick stress marks, and Prettier
  silently turned `+ а → у́чиха` (concatenation) into a bullet list. It is not safe on this text.
- ✅ README is now a landing page; the engineering essay moved verbatim to `docs/ARCHITECTURE.md`
- ✅ `TZ.md` → `docs/TZ.ru.md` (it describes v1's JSON dictionary and is otherwise misleading)
- ⬜ Set repo description + topics on GitHub (`chrome-extension`, `firefox-addon`, `bulgarian`, …)
- ⬜ Enable branch protection on `main` (require CI green)
- ⬜ Enable GitHub Pages for `PRIVACY.md` — both stores want a privacy-policy **URL**

## 2. Build — DONE ✅

- ✅ `manifest.base.json` + `scripts/build.js` → `dist/chrome` and `dist/firefox`. Chrome gets a
  `service_worker`, Firefox an event page (`scripts`) — neither accepts the other's key, which is
  the whole reason one manifest cannot serve both stores.
- ✅ Version read from `package.json` at build time, so the two manifests cannot drift.
- ✅ `use_dynamic_url` on Chrome's `web_accessible_resources`. Without it, any page could probe
  `chrome-extension://<fixed-id>/data/stress-dict.txt` and fingerprint the extension's presence.
  Firefox already randomises its origin per install.
- ✅ `data_collection_permissions: { required: ["none"] }` for Firefox's data-consent framework.
  Not a dodge — it is the literal truth, and AMO's linter asked for it.
- ✅ **`npm run lint:ext` is clean: 0 errors, 0 warnings, 0 notices** from AMO's own linter.
- ⛔ **`gecko.id` is `bulgarian-accenter@noomorph.github.io` — confirm before first AMO submission.**
  Changing it later orphans every install. It is a one-way door.
- ⬜ **Test in a real Firefox.** Firefox MV3 treats host permissions as opt-in in a way Chrome does
  not, and a statically-declared `<all_urls>` content script may not run until the user grants site
  access. If so, the "it just works on bg.wikipedia" story needs onboarding copy for Firefox.
  Verify this **before** writing the store listing. `strict_min_version` is a conservative `128.0`
  and can be lowered once tested.

## 3. Dictionary provenance — VERIFIED ✅

The upstream dump is a **public download** (`rechnik.chitanka.info/db.sql.gz`), so the build is
reproducible by anyone — which is exactly what AMO's source-code review wants.

- ✅ **Reproducibility confirmed empirically.** `npm run dict:all` regenerates `data/stress-dict.txt`
  **byte for byte identical** (`c7c2bc2c…`) from the public dump (`83e588c8…`). This was run, not
  assumed.
- ✅ The dictionary is **not committed**. It is mirrored as a hash-pinned
  [release asset](https://github.com/noomorph/bulgarian-accenter/releases/tag/dictionary) and
  fetched by `npm run dict:fetch`, which **refuses any copy that does not match**
  `data/stress-dict.sha256` — the hash a from-source build produces. The convenient copy therefore
  cannot drift from the reproducible one.
- ⚠️ **The upstream 403s from datacenter IPs.** GitHub Actions cannot fetch the dump. This is
  correct behaviour on their part — it is a 70 MB file served for free — and it is why CI takes the
  mirror instead of rebuilding. Do not "fix" this by spoofing a browser User-Agent.
  `npm run dict:all` needs an ordinary connection.
- ✅ `scripts/fetch-dump.js` records the dump's SHA-256 in `data/PROVENANCE.json`; `npm run
dump:check` verifies a local copy. The hardcoded `/Users/noomorph/...` path is gone.
- Note: the dump has not been regenerated upstream since **2013**, so no refresh cron is warranted.

## 4. CI / Release — DONE ✅

- ✅ `ci.yml` — lint, format, tests on Node 20/22/24, build, AMO lint, both zips uploaded per PR so
  a reviewer can load-unpacked any branch. Actions pinned to `@v4` (the reference repo's `@v2`s are
  dead, and `upload-artifact@v3` has been switched off entirely).
- ✅ `release.yml` — tag `v*.*.*` → verify tag matches `package.json` **and** `CHANGELOG` → test →
  build → `source.zip` via `git archive` → draft GitHub Release → gated store publish.
- ✅ Store publishing sits behind **protected environments** (`chrome-web-store`, `addons-mozilla-org`),
  so a fork's PR can never see the credentials and a human is on the button.
- ⬜ Create those two environments and add the secrets: `CWS_*` (4) and `AMO_JWT_*` (2).

## 5. Store submission — TODO ⬜

**Do the first submission by hand.** You must fill in listing copy, screenshots, categories and
privacy forms in the dashboards regardless, and you will learn what review actually asks for.
Automate the *second* release, when only the .zip changes.

### Chrome Web Store

- ⬜ $5 one-time developer registration (a real gate — do it early)
- ⬜ Single purpose: *"Displays stress marks on Bulgarian words on web pages."* This extension is
  unusually easy to defend here.
- ⬜ Privacy tab: certify **no data collected** (true), and give the `PRIVACY.md` URL anyway
- ⬜ Justify `<all_urls>`: *it cannot know in advance which page contains Bulgarian; it must read the
  `lang` attribute of any page. On a page with no Bulgarian markup it runs one `querySelector`,
  finds nothing, and stops — it never even fetches its dictionary.*
- ⬜ Expect a **slow review** because of `<all_urls>`. Days, not hours.
- ⬜ Category: Education (not Productivity)

### Firefox / AMO

- ⬜ Register, generate API credentials
- ⬜ **Source-code submission.** AMO requires it when a shipped file is generated and not
  human-readable — and `data/stress-dict.txt` is: a reviewer opening it sees `8ове:3`, not
  Bulgarian. `release.yml` attaches `source.zip` automatically via `--upload-source-code`. Add a
  reviewer note: *the dictionary is reproducible byte-for-byte from a public dump with
  `npm run dict:all`; `data/PROVENANCE.json` pins the SHA-256.* That answer is unusually strong —
  lead with it rather than waiting to be asked.
- ⬜ Summary ≤ 250 chars; licence field must match `NOTICE` (MIT code / MPL-1.1 data)

## 6. Store assets — TODO ⬜

- ✅ `assets/banner.png` (1983×793, 2.50:1)
- ⬜ **Chrome marquee 1400×560** — the banner downscales exactly. No recrop needed.
- ⬜ **Chrome small tile 440×280** (1.57:1) — needs a *new* crop: icon + wordmark, drop the
  `вятър → вя́тър` chips.
- ⬜ **Screenshots, 1280×800, up to 5 — we have none, and they are what sell the extension.**
  Real `bg.wikipedia.org`, accents on, `ON` badge visible; a before/after pair; and one showing that
  **text selection still works**, which is a real differentiator nobody would guess from a
  description.
- ⬜ A demo GIF for the README — worth more to a first-time visitor than the entire architecture doc.
- ✅ Checked the 16px icon, which this section expected to mud. It does not. The bands read as three
  colour blocks at 16px and the ъ stays a recognisable silhouette; what is lost is the gloss and the
  bevel, which carry no meaning. It is softer than a geometric mark would be, and more distinctive —
  a fair trade. Revisit only if it looks wrong in a real toolbar. `icons/*.png` are generated from
  `assets/icon.png` by `npm run icons`, so a simplified 16px variant means editing the master, not
  the outputs.

## 7. Deliberately deferred — file as issues

- Options page (per-site allowlist, auto-on) · iframe support · language detection without `lang`
  markup · homograph resolution (needs real NLP) · Edge / Safari ports
- The ~0.2% wrong-accent rate: `wrong_accent.yml` is the loop that grinds it down.
