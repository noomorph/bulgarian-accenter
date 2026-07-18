# Architecture

How Bulgarian Accenter decides what to accent, where its dictionary comes from, why that
dictionary is 3 MB instead of 29 MB, and what it gets wrong.

This is the long version. For installing and using the thing, see the [README](../README.md).

Two claims in here are worth stating up front, because they are the ones that cost something:
**~0.2% of derived dictionary entries render a wrong accent**, and **58% of Bulgarian lexemes have
no stress data in the source at all**. Both are measured, neither is hidden, and the reasoning for
accepting them is below.

## How it works

- Text counts as Bulgarian when its **nearest** ancestor with a `lang` attribute declares
  `bg` / `bg-XX`. This gives inheritance and "stop at a subtree in another language" in one
  rule — a `lang="en"` island inside a `lang="bg"` page is skipped, and a `lang="bg"` island
  nested back inside _that_ is picked up again.
- Each Cyrillic word is lowercased and looked up in the dictionary. A hit gets a combining
  grave accent (U+0300) spliced in after the stressed vowel — Bulgarian's own stress-mark
  convention, not the acute (U+0301) Russian dictionaries favour. A word already carrying either
  mark — ours from an earlier pass, or a source page's own acute — is left exactly as it is,
  rather than torn apart at the mark and re-processed piecemeal. A miss is left alone — a word the
  dictionary does not contain is never guessed at _on the page_. (The dictionary itself now
  contains ~328k forms whose stress was inferred at build time rather than read off a source;
  that inference is bounded and measured, and it is the subject of "Derived forms" below.)
- Capitalisation survives because only the _offsets_ come from the dictionary; the accent is
  spliced into the original token (`Вятър` → `Вя̀тър`).
- Accents are plain text, so text selection, copy-paste and the page's own layout all keep
  working. Toggling off restores the original text exactly.

Skipped: `<script>`, `<style>`, `<noscript>`, `<textarea>`, `<input>`, `<select>`, `<option>`,
`<title>`, and any `contenteditable` region.

### Performance

The content script matches `<all_urls>`, so it opens with a single `querySelector` for
Bulgarian markup and, finding none, does nothing else — the 3.0 MB dictionary is never
fetched or decoded. That gate is what makes it free on the ~99.9% of pages that aren't
Bulgarian. A `MutationObserver` (debounced 200 ms) handles content that loads later, and a
page with no Bulgarian _yet_ keeps a cheap probe running in case an SPA routes to some.

On a page that _is_ Bulgarian, decoding 405k entries costs ~290 ms — an order of magnitude
over a frame, and quite enough to freeze the page visibly. So the decoder is **resumable**:
`BgDict.createDecoder(text).step(ms)` decodes until its budget runs out and reports whether
it is done, and `content.js` pumps it in the same 8 ms slices it already used for the DOM
work. Measured across ~33 slices the median is 8.1 ms and exactly one (the first, before JIT
warm-up) exceeds 16 ms — so booting costs about one dropped frame, not fifteen.

The decoded dictionary is a plain object — a hash lookup. A trie was considered and measured:
**40x slower** (pointer-chasing per character vs. one hash of a short string) and **2x the
memory** (one node per prefix). Tries pay off for _prefix_ queries; this is exact whole-word
lookup, which is the case a hash already wins.

## Dictionary

`data/stress-dict.txt` — **404,971 entries**, of which 94,647 are _attested_ (a source recorded
the mark) and 310,324 are _derived_ (see below).

It is **generated, and not committed**. `npm run dict:fetch` pulls the hash-pinned copy (3 MB);
`npm run dict:all` rebuilds it from the public dump and reproduces that copy byte for byte — which
is what the pin is for. See [CONTRIBUTING.md](../CONTRIBUTING.md).

The obvious format, ``{"вятър": "вя`тър"}``, spends most of its bytes twice — once on the key,
once on a near-copy of it. That was tolerable at 94k entries (3.9 MB); at 405k it is ~28 MB,
which is not a file you want to ship, fetch and decode in a content script. So keys are sorted
and **front-coded**: each line stores only what its key does not share with the previous one.

```
0аванпост:3        ->  аванпост       ава`нпост
8а:3               ->  аванпоста      ава`нпоста
8ове:3             ->  аванпостове    ава`нпостове
```

Bulgarian inflections sort next to each other and share long stems, which is exactly the case
front-coding is for: **405k entries fit in 3.0 MB — smaller than the old 94k-entry file.** The
leading byte is the shared-prefix length (ASCII `48 + n`); the numbers are the offsets at which
a mark is spliced into the key. The separator carries the provenance in a byte already being
spent — `:` attested, `;` derived — so `BgDict.decode(text, false)` reconstructs the
attested-only dictionary exactly, with no second file and no extra memory.

`decode()` hands back the same shape the runtime always consumed (``key -> "вя`тър"``), so
`accent.js` still re-validates every mark against the word and a corrupt dictionary still cannot
render an accent on a consonant. Three properties are enforced by tests over every shipped entry:
stripping the backticks yields the key exactly, every mark follows a vowel, and every key is a
single Cyrillic token.

**2,375 entries (2.5%) carry more than one stress mark**, for two different reasons. Most are
genuine: a single source form that really does have two phonetic stresses, as compounds do
(`а̀виоа̀с`). The other **1,047** are flattened ambiguity — the sources recorded more than one
stress _position_ for the same spelling (true pronunciation variance, homographs, or plain
disagreement between the four merged sources), and the generator unions them. We deliberately
mark _all_ observed positions rather than guessing which is right. This is a known compromise,
not a bug.

## Derived forms (the second pass)

The `word` table is only the visible half of this dump. It also carries **`derivative_form`:
4,013,667 fully-enumerated inflected forms**, each linked to its lemma and labelled with exactly
what it is (`ед.ч. пълен член`, `мин.св.вр., 3л., мн.ч.`). Its own `name_stressed` column is
**NULL in 100% of rows**: the paradigm is known, the stress is not. v1 ignored the table entirely,
which is why it knew `уча` but not `учиха`, and `аванпост` but not `аванпостът`.

Pass 2 fills that in by propagating a lemma's attested stress across its own paradigm:
``у`чих`` + `а` → ``у`чиха``. On real prose this lifts coverage of polysyllabic words from
**32% to 85%**.

Held out (the blacklist is learned on half the lexemes and scored on the other half), the derived
forms are **99.5% exactly right, and 0.21% carry a wrong accent** — an accent on a vowel that is
not the stressed one. That last number is the price, and it is a real one: see "What this costs".

Four constraints do the work. Each was measured; dropping any one visibly degrades the result.

**1. Witnesses are bound to their lexeme.** A stress is evidence about lemma _L_ only if the
marked token is itself a form of _L_. Pooling by string instead lets `пѝта` (the flatbread) supply
the stress for `питах` (a form of `питам`), and scores `веселѝя` (plural of `веселѝе`) against the
adjective `вѐселия`. Most of the naive rule's apparent error was this — not a real disagreement
about Bulgarian, just two words spelled alike.

**2. Anchor on the stem, not the suffix.** Appending to a known form is the intuitive rule and it
only reaches 213k forms, because `уча` → `учиш` is not an append. Requiring instead that witness
and target share a prefix _containing the witness's stressed vowel_ reaches 700k.

**3. Verbs have two stems, and stress can differ between them.** Forms built on the aorist stem
(`мин.св.`, `мин.деят.св.прич.`, and the compound tenses built on that participle) may be stressed
differently from forms built on the present stem — which is precisely _why_ a dictionary prints
"мин. св." and "мин. прич." as separate principal parts. Propagating across that boundary invents
``бу`чал`` for a verb whose aorist is ``буча`л``. So we don't: stress moves freely within a stem
group and never across one. This alone took verb error from 1.4% to 0.24%.

The imperative gets its own group for a different reason. It is built on the _present_ stem, so it
is not a third stem — but the mood carries stress independently of the indicative present built on
that same stem: `беля` → ``бели` ``, `лъжа` → ``лъжи` ``, `суша` → ``суши` ``, and three more.
Constraint 4's blacklist cannot catch this on its own, because it needs a contradicting witness
and there almost never is one: of the 17,664 verbs with an imperative slot, only 21 have the
imperative stress attested at all. It blocked those six and had nothing to say about the rest — so
``ка`жи`` shipped for a word that is ``кажи` ``. Separating the mood costs 17,267 derived entries,
which are now unmarked instead of wrongly marked.

**4. Block by evidence, not by permission.** A whitelist of (class, slot) pairs _known_ to be safe
sounds like the conservative choice and is useless: the witnesses are far too sparse to cover 399
inflection classes, so almost every cell is merely _unseen_, and rejecting the unseen collapses
the yield to 5,792 forms. Assume instead that stress is fixed on the stem — the common case — and
_subtract_ the cells where the data shows it isn't.

That blacklist needs one non-obvious feature: **whether the lemma is monosyllabic**. Every failure
on the masculine definite article was one — ``бикъ`т``, ``видъ`т``, ``дъбъ`т``, ``трудъ`т`` — because a
monosyllabic masculine stresses its article while ``ава`нпостът`` does not. Keyed on (class, slot)
alone, those few words poison the slot for every polysyllabic noun in their class; keyed on
(class, slot, monosyllabic?) they are contained, and `аванпостът` survives.

The 118 blocked cells are written to **`data/derivation-blocked.json`**, with counts and worked
examples, so they can be read and argued with — the same principle as `data/sql-corrections.json`.
They are legible as linguistics, not as noise:

| class                        | slot               | wrong     | why                                                         |
| ---------------------------- | ------------------ | --------- | ----------------------------------------------------------- |
| `noun_female` 49             | `ед.ч. членувано`  | 166 / 166 | `-ост` abstracts always stress the article: `безкрайността̀` |
| `noun_neutral` 54            | `мн.ч.`            | 59 / 211  | end-stressed neuter plurals: `блата̀`, `белила̀`              |
| `noun_male` 1 (monosyllabic) | `ед.ч. пълен член` | 30 / 455  | `бикъ̀т`, `видъ̀т` — but not `ава̀нпостът`                     |

An attested stress **always** wins over a derived one; pass 2 can only fill gaps, never overrule.
So ``бикъ`т`` keeps the stressed article the sources recorded, and is not overwritten by ``би`кът``
inferred off the plural ``би`кове``. A test asserts this over every attested entry.

### What this costs, stated plainly

Roughly **0.2% of derived entries will render a wrong accent** — order several hundred words. v1
could be described as never guessing; this version guesses, carefully, about three quarters of its
own dictionary. That is a deliberate trade: on real prose it is the difference between accenting a
third of the words and accenting most of them, which is the entire point of the extension.

Two honest caveats on that 0.2%:

- It is measured only on forms whose stress the sources happened to record — which skews toward the
  forms a lexicographer thought _worth_ recording, i.e. the irregular ones. The routine
  article-and-agreement forms that dominate the derived set are probably easier than that number
  suggests, but this data cannot prove it, because the forms it can check are exactly the ones that
  aren't routine.
- The blacklist is learned from the dump. A fresh dump can shift it, so it is regenerated on every
  build and `npm test` fails if the shipped file stops satisfying its invariants.

Because provenance is in the file, an "attested only" mode is one boolean away
(`BgDict.decode(text, false)`) if that trade ever needs to be taken back.

### The ceiling

This does not finish the job, and it is worth knowing why. **Only 42% of lexemes have any stress
witness at all** — `name_stressed` is NULL for roughly half the `word` rows — so 2.45M of the 3.25M
distinct forms have nothing to propagate _from_ and remain unreachable by any rule of this kind.
Closing that gap needs a source with more stress data, not a cleverer inference.

**2,375 entries (2.5%) carry more than one stress mark**, for two different reasons. Most are
genuine: a single source form that really does have two phonetic stresses, as compounds do
(`а̀виоа̀с`). The other **1,047** are flattened ambiguity — the sources recorded more than one
stress _position_ for the same spelling (true pronunciation variance, homographs, or plain
disagreement between the four merged sources), and the generator unions them. v1 deliberately
marks _all_ observed positions rather than guessing which is right. This is a known compromise,
not a bug.

### Misplaced marks, and where they were fixed

25 `name_stressed` cells in the dump carried the backtick on the wrong side of the vowel
(``врабц`ите`` instead of ``врабци`те``), which would have rendered an accent on a consonant (`ц̀`).
All of them are in the curated `name_stressed` column — the prose contains none.

**These are corrected at source.** `scripts/fix-stress-sql.js` rewrites the dump in place (keeping
a `.bak`) from `data/sql-corrections.json`, an explicit 22-entry list you can read and argue with.
Each correction only _moves a backtick_ within one word — same letters, same byte length — so it is
a length-preserving substitution that matches the fully-quoted SQL literal and therefore can only
ever replace a whole column value, never a word inside a definition. Two independent signals fixed
the position, no guessing:

- **Prose.** For 10 of them the definitions already carry a clean, well-formed mark for the identical
  form, which is simply ground truth: ``защитн`о`` → ``защи`тно``.
- **Syllabification.** For the rest, the dump's own `name_broken` column (`враб-ци-те`) decides it: a
  stress mark belongs to a syllable, and a syllable has exactly one vowel.

Three are left alone. In ``упой`но``, ``избул` `` and ``бръм`барге`йт`` the stray mark is followed by a
consonant or by nothing, so it lands on a syllable boundary with a candidate vowel either side and
nothing in the data chooses between them. Their marks are dropped and the words render unaccented —
which is the correct outcome. The extension never guesses.

The extractor deliberately contains **no repair heuristic**. Shifting a stray mark onto the
neighbouring vowel looks reasonable and is right most of the time, but it is confidently wrong the
rest: it invents `защитно̀` for a word whose own dictionary entry plainly says `защѝтно`. Corrections
belong in a file a human can review, not in a rule that guesses in the dark. All the extractor does
is _drop_ a mark that isn't after a vowel, as a safety net.

Monosyllables are dropped too: the only syllable is the stressed one, so a mark adds nothing.
(58 had slipped through.) `accent.js` re-checks every invariant at runtime, so a stale or
hand-edited dictionary still can't put an accent on a consonant.

### Why the two columns are pooled, not ranked

It is tempting to treat `name_stressed` as curated truth and `meaning` as hand-written noise, and
let the former veto the latter for identical spellings. **This was tried and it is wrong**, for two
independent reasons, both measured against this dump:

- Every one of the 24 malformed marks is in `name_stressed`. The prose has **zero**. Ranking the
  columns would prefer the corrupt source: `защитно` would keep the repaired-from-typo `защитно̀`
  and discard prose's well-formed `защѝтно`.
- `name_stressed` is NULL for roughly half the word-forms, so prose is the **only** witness for most
  inflections, and for variants a lexicographer noted by hand (`абзац`'s definition literally reads
  ``и [[абза`ц]]`` — "and абза̀ц"). Vetoing prose destroyed ~227 genuine readings.

Among the casualties were true homographs — different words that merely share a spelling:

|            |       |                          |
| ---------- | ----- | ------------------------ |
| ``ни`ва``  | нѝва  | a field                  |
| ``нива` `` | нива̀  | plural of ниво, "levels" |
| ``ро`ден`` | ро̀ден | native                   |
| ``роде`н`` | родѐн | born                     |

Marking both is the whole point; the ambiguity is information, not dirt. So both
columns feed one pool and the 1,045 flattened-ambiguous entries stand.

### Regenerating from a fresh dump

The corrections live in the dump, so a freshly downloaded one will have the 25 misplaced marks back.
Re-apply them, then rebuild — `npm run dict:all` does all three steps in order:

```sh
npm run dump                               # fetch + unpack the upstream dump, record provenance
node scripts/fix-stress-sql.js --dry-run   # review the 22 substitutions
node scripts/fix-stress-sql.js             # rewrite in place, keeps <dump>.bak
npm run dict
```

The dump is fetched from <https://rechnik.chitanka.info/db.sql.gz>, which the Речко project
publishes for download. `data/PROVENANCE.json` records the SHA-256 of the exact dump the shipped
dictionary was built from, so anyone — including an add-on reviewer — can reproduce this file
byte for byte. `npm run dump:check` verifies a local copy against it.

`npm test` guards the result: it asserts over every shipped entry that stripping the backticks
returns the key, that no mark can land anywhere but on a vowel, that every key is a single
Cyrillic token, and that no derived entry overrules an attested one.

## Development

```sh
npm test         # 37 tests: pure logic + dictionary format + DOM behaviour (jsdom)
npm run build    # -> dist/chrome, dist/firefox
npm run dict:all # re-fetch the dump and regenerate data/stress-dict.txt (needs ~6 GB of heap)
npm run icons    # regenerate icons/*.png
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full loop, and for why `data/stress-dict.txt` is
a _committed_ build product rather than a file someone forgot to gitignore.

- `src/dict.js` — the front-coded dictionary format: `encode`, `decode`, and the resumable
  `createDecoder`. No DOM.
- `src/accent.js` — pure lookup/placement logic, no DOM. Unit-tested.
- `src/content.js` — DOM walking, the `MutationObserver`, the toggle.
- `src/background.js` — service worker; exists only because `chrome.action.onClicked` is the
  only way to catch a toolbar click without a popup.

Regenerating the dictionary streams a 730 MB dump and holds 4M inflected forms in memory, which
is why `npm run dict` raises the heap limit. It takes ~30 s.

## Known limits

- **~0.2% of derived forms carry a wrong accent.** See "What this costs" above. This is the one
  limit that is a deliberate trade rather than an omission.
- Top frame only — Bulgarian text inside an `<iframe>` is not accented.
- Pages with no `lang` markup are ignored by design, even if the text is obviously Bulgarian.
- No homograph resolution: `въ̀лна` (wool) and `вълна̀` (wave) are the same spelling, and both
  marks are shown. Derivation inherits this: `уча` records both ``у`чих`` and ``учи`х``, so the
  derived `учиха` carries both marks too.
- **58% of lexemes have no stress data at all** in the source, so most of the paradigm space is
  still unreachable — see "The ceiling".
- U+0300 changes the text content, so the browser's in-page find (Ctrl+F) won't match an
  accented word when you type it unaccented.
