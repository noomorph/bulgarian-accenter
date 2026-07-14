# Store listing copy

The text the dashboards ask for, kept here so it is reviewable, diffable, and not retyped from
memory into a web form at submission time. Paste from here into the Chrome Web Store and AMO.

Two fields decide whether review goes smoothly, and both are about `<all_urls>`: the **single
purpose** and the **permission justification**. They are last in this file, and they are the ones
worth reading twice.

---

## Listing language

**English.** The dashboard's `Language` field is the language *this listing is written in*, not the
language the extension operates on. It is not a statement about Bulgarian. A Bulgarian translation
of the listing can be added later as an additional locale; declaring the listing Bulgarian while
the copy is English is the one wrong answer.

## Category

**Education.** Not Productivity — the extension teaches you how a word is said.

## Title

Bulgarian Accenter

## Summary (≤ 132 chars, taken from the package)

Marks stressed vowels in Bulgarian text on any page, offline, from a built-in dictionary.

## Description

```text
Bulgarian Accenter puts the stress mark on Bulgarian words as you read them, so you know how to
say what you are reading.

Bulgarian does not print its stress marks, and stress is not predictable from spelling — it is the
single hardest thing to guess as a learner, and getting it wrong is the fastest way to sound
foreign. This extension adds the marks back: вятър becomes вя́тър, ветрове becomes ветрове́.

HOW IT WORKS

Click the toolbar icon to toggle accents on the current tab. The badge shows ON or OFF.

Everything happens on your machine. The extension ships with a dictionary of 422,238 Bulgarian
word forms — it never sends a page, a word, or anything else to a server. It makes zero network
requests, has no analytics, and collects nothing. There is no account and nothing to sign in to.

The text stays text. Accents are applied without breaking selection, copy-paste or layout, and
copying a word gives you the word — not a mangled version of it. Capitalisation survives, so
Вятър becomes Вя́тър.

WHY IT ASKS TO READ EVERY PAGE

The extension cannot know in advance which page has Bulgarian on it, so it must be able to look.
On a page with no Bulgarian it runs a single check, finds nothing, and stops — it does not even
load its dictionary. It reads pages; it never transmits them.

HONEST ABOUT ACCURACY

Around 0.2% of entries carry a wrong accent. Most of the dictionary is attested; the rest is
derived from inflection patterns, and inflection is not always regular. If you find a mistake
there is a one-click report link, and corrections ship in the next version.

Free, open source, and auditable: github.com/noomorph/bulgarian-accenter
```

Every number above is checkable against the repo — 422,238 forms, zero network requests, ~0.2%
wrong. Do not round them up in the listing. An extension whose pitch is "we send nothing anywhere"
cannot afford a single claim a reviewer can catch out.

## Single purpose

```text
Displays stress marks on Bulgarian words on web pages.
```

## Permission justification — `<all_urls>`

```text
The extension cannot know in advance which pages contain Bulgarian, so it must be able to read the
lang attribute of any page. On a page with no Bulgarian markup it runs one querySelector, finds
nothing, and stops — it never even fetches its dictionary. No page content is transmitted anywhere:
the extension makes zero network requests, and the dictionary it consults is bundled in the
package.
```

## Privacy

No data collected. Certify that in the Privacy tab, and give the `PRIVACY.md` URL anyway.
Firefox's equivalent is already declared in the manifest:
`data_collection_permissions: { required: ["none"] }`.

## Graphic assets

| Asset          | File                              | Notes                                            |
| -------------- | --------------------------------- | ------------------------------------------------ |
| Store icon     | `icons/icon128.png`               | Generated from `assets/icon.png` by `npm run icons` |
| Small promo    | `assets/promo-small-440x280.png`  | Icon + wordmark, composed; 24-bit, no alpha      |
| Marquee promo  | `assets/promo-marquee-1400x560.png` | The banner, downscaled; 24-bit, no alpha       |
| Screenshots    | —                                 | **Still missing.** 1280×800, up to 5.            |

Both promo tiles are derived from `assets/banner.png` and `assets/icon.png`. The store rejects
alpha in promo tiles, so both are 24-bit RGB — if you ever regenerate them, keep that. Redraw the
mark and these go stale silently; nothing checks them.
