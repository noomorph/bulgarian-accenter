# Contributing

## Getting it running

```sh
npm ci
npm test              # pure logic, dictionary format, DOM behaviour (jsdom)
npm run dict:all      # build the dictionary — see below. ~70 MB download, ~30 s, ~6 GB of heap.
npm run build         # -> dist/chrome, dist/firefox
```

Then load it:

- **Chrome** — `chrome://extensions` → Developer mode → _Load unpacked_ → `dist/chrome`
- **Firefox** — `about:debugging` → This Firefox → _Load Temporary Add-on_ → `dist/firefox/manifest.json`

Open `bg.wikipedia.org` and click the toolbar icon.

There is no bundler and no framework. `src/` is what ships, unminified.

## The thing that will trip you up

**`data/stress-dict.txt` is not in the repository.** It is generated, and it is `.gitignore`d.

A fresh clone has no dictionary, so the extension will find no words, and the tests that validate
all 422k entries will **skip** — they say so when they do. Build it:

```sh
npm run dict:all
```

That is `npm run dump` (fetch the ~70 MB dump from
[rechnik.chitanka.info](https://rechnik.chitanka.info/), unpack it, record its SHA-256 in
`data/PROVENANCE.json`), then `npm run fix-sql` (apply the corrections in
`data/sql-corrections.json` to the dump), then `npm run dict` (the two-pass extraction). It takes
about 30 seconds and wants ~6 GB of heap. You only need to do it once.

**It rebuilds byte for byte.** The dictionary that ships in the stores hashes identically to the one
you get from that command — CI asserts it. Which is precisely why it does not need to be in git.

Never hand-edit it. To change a stress mark, fix the *input* — see below.

### Why isn't it committed?

Committing it would be more convenient, and two things outweigh that.

It is 3 MB of dense generated text that rewrites almost entirely on every regeneration, so each
rebuild would add another full copy to the history, permanently.

And Речко — the source of the stress marks — grants no licence to redistribute them (see `NOTICE`).
Keeping that data out of an immutable public history means a takedown request would cost us a
deleted release asset, rather than a rewrite of published history that other people have already
cloned and forked. Reversibility is worth a `npm run dict:all`.

If you just want the file and not the build, it is attached to every [release][releases].

[releases]: https://github.com/noomorph/bulgarian-accenter/releases

## Correcting a wrong accent

This is the most valuable contribution, and the process is deliberately not "edit the dictionary".

About 0.2% of the derived entries carry a wrong accent — a known, measured, documented trade
(`docs/ARCHITECTURE.md`). The fix is never to patch the output; it is to fix the _input_ and
regenerate, so that the correction survives the next rebuild and can be reviewed by a human:

1. Add an entry to **`data/sql-corrections.json`** — an explicit list, meant to be read and argued
   with, not a heuristic.
2. `npm run dict:all`
3. `npm test` — the invariants must still hold over all 422k entries.
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
