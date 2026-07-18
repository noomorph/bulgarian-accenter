# Contributing

## Getting it running

```sh
npm ci
npm run dict:fetch    # 3 MB, hash-verified. The dictionary is generated and not in the repo.
npm run build         # -> dist/chrome, dist/firefox
npm test
```

Then load it:

- **Chrome** — `chrome://extensions` → Developer mode → _Load unpacked_ → `dist/chrome`
- **Firefox** — `about:debugging` → This Firefox → _Load Temporary Add-on_ → `dist/firefox/manifest.json`

Open `bg.wikipedia.org` and click the toolbar icon.

There is no bundler and no framework. `src/` is what ships, unminified.

## The thing that will trip you up

**`data/stress-dict.txt` is not in the repository.** It is generated, and it is `.gitignore`d.

A fresh clone has no dictionary, so the extension will find no words, and the tests that validate
all 405k entries will **skip** — they say so when they do. There are two ways to get it, and you
almost certainly want the first.

### `npm run dict:fetch` — the fast path

Downloads the prebuilt dictionary (3 MB) from the [`dictionary` release][dict-release] and verifies
it against `data/stress-dict.sha256`. Seconds. This is what CI does.

### `npm run dict:all` — rebuild from the true source

Fetches the ~70 MB dump from [rechnik.chitanka.info](https://rechnik.chitanka.info/), applies the
corrections in `data/sql-corrections.json`, and runs the two-pass extraction. ~30 seconds, ~6 GB of
heap, and it re-pins the hash.

**It reproduces the mirrored file byte for byte** — same SHA-256. That is the entire point of the
pin: `dict:fetch` *refuses* any mirror that does not match what a from-source build produces, so
the convenient copy can never quietly drift from the reproducible one.

Two things to know before you run it. It needs an ordinary internet connection: the upstream blocks
datacenter IPs, so it 403s on GitHub Actions and most cloud boxes. That is their prerogative — they
serve a 70 MB file for free — and it is why we mirror rather than hammer it. And the dump has not
been regenerated upstream since **2013**, so there is rarely a reason to.

Never hand-edit the dictionary. To change a stress mark, fix the *input* — see below.

### Why isn't it committed?

Committing it would be simpler, and two things outweigh that.

It is 3 MB of dense generated text that rewrites almost entirely on every regeneration, so each
rebuild would add another full copy to the history, permanently.

And Речко — the source of the stress marks — grants no licence to redistribute them (see `NOTICE`).
Keeping that data out of an immutable public history means a takedown request would cost a deleted
release asset, rather than a rewrite of published history that other people have already cloned and
forked. Reversibility is worth one `npm run dict:fetch`.

[dict-release]: https://github.com/noomorph/bulgarian-accenter/releases/tag/dictionary

## Correcting a wrong accent

This is the most valuable contribution, and the process is deliberately not "edit the dictionary".

About 0.2% of the derived entries carry a wrong accent — a known, measured, documented trade
(`docs/ARCHITECTURE.md`). The fix is never to patch the output; it is to fix the _input_ and
regenerate, so that the correction survives the next rebuild and can be reviewed by a human:

1. Add an entry to **`data/sql-corrections.json`** — an explicit list, meant to be read and argued
   with, not a heuristic.
2. `npm run dict:all`
3. `npm test` — the invariants must still hold over all 405k entries.
4. Open a PR explaining _why_ the new stress is right. Evidence, not vibes: a dictionary entry, the
   dump's own syllabification column, a native speaker's judgement. We have deliberately kept every
   guess out of the extractor, and that is the property worth protecting.

If you would rather just report the word and let someone else do this, that is completely fine and
still useful — [file it here][wrong].

[wrong]: https://github.com/noomorph/bulgarian-accenter/issues/new?template=wrong_accent.yml

## Before you open a PR

```sh
npm run lint
npm run format:check
npm run lint:ext        # AMO's own linter, against the Firefox build
npm test
```

CI runs all of these, plus the tests on Node 20, 22 and 24.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
