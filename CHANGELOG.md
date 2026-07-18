# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-07-18

### Changed

- Stress is now marked with the combining grave accent (U+0300) instead of the acute (U+0301) —
  Bulgarian's own orthographic convention, not the one Russian dictionaries use.

### Fixed

- A word already carrying a stress mark — ours from an earlier pass, or a source page's own
  (acute-marked text is common in the wild) — was treated as a token boundary rather than a whole
  word: the pieces on either side got looked up and re-marked independently, so an already-accented
  word could come out wearing two or three accents. It is now left exactly as it is, whichever
  convention marked it.

## [1.0.0] - 2026-07-14

First public release.

### Added

- Marks stressed vowels in Bulgarian text on any page, offline, with no network requests.
- Bulgarian text is identified by the nearest ancestor `lang` attribute (`bg` / `bg-XX`), which
  gives inheritance and "stop at a subtree in another language" in a single rule.
- A dictionary of **422,238 word forms** — 94,647 with the stress attested in the source, and
  327,591 derived at build time by propagating a lemma's stress across its own paradigm. On real
  prose this lifts coverage of polysyllabic words from 32% to 85%.
- Front-coded dictionary format: 422k entries in 3.1 MB, decoded incrementally in 8 ms slices so
  that booting on a Bulgarian page costs about one dropped frame rather than fifteen.
- Toolbar toggle with an `ON`/`OFF` badge; toggling off restores the page's text exactly.
- Builds for both Chrome (MV3 service worker) and Firefox (MV3 event page) from one manifest base.

### Known limitations

- **~0.2% of derived forms carry a wrong accent.** A deliberate trade — see `docs/ARCHITECTURE.md`.
- No homograph resolution: `въ́лна` (wool) and `вълна́` (wave) are one spelling, and both marks show.
- Top frame only; text inside an `<iframe>` is not accented.
- Pages with no `lang` markup are ignored by design, even when the text is obviously Bulgarian.
- U+0301 changes the text content, so the browser's in-page find (Ctrl+F) will not match an
  accented word typed unaccented.

[Unreleased]: https://github.com/noomorph/bulgarian-accenter/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/noomorph/bulgarian-accenter/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/noomorph/bulgarian-accenter/releases/tag/v1.0.0
