# Privacy Policy

**Bulgarian Accenter collects nothing. It sends nothing. It has no server.**

That is the entire policy. The rest of this page is just the evidence, because "we don't collect
data" is what every extension says.

## What the extension does with the page you are on

It reads text nodes inside elements whose nearest `lang` ancestor declares Bulgarian, looks each
word up in a dictionary file that ships inside the extension, and splices an accent mark into the
text. All of it happens in your browser, in the page's own tab.

## What it does not do

- **No network requests.** The extension makes exactly one `fetch()`, and it is for
  `data/stress-dict.txt` — a file bundled inside the extension itself. There is no remote endpoint
  to call, because there is no server. You can confirm this: open DevTools → Network on any
  Bulgarian page and watch.
- **No analytics, no telemetry, no crash reporting, no unique identifier.**
- **No storage of anything you read.** The extension keeps the original text of the current page in
  memory only, so that toggling it off can restore the page exactly, and that memory dies with the tab.
- **No cookies, no `chrome.storage`, no `localStorage`.**
- **No third parties.** Nothing is shared with anyone, because nothing is collected in the first place.

## Permissions, and why

The extension requests access to all websites (`<all_urls>`). This is the broadest permission
Chrome and Firefox offer, and it deserves a straight answer rather than a shrug.

It needs it because it cannot know in advance which page will contain Bulgarian. It must be able to
look at the `lang` attribute of any page you visit. On a page with no Bulgarian markup — which is
almost all of them — it runs a single `querySelector`, finds nothing, and stops. It does not read
the page, it does not load its dictionary, and it does nothing else.

The extension is fully open source. If this page and the code ever disagree, the code is the truth:
<https://github.com/noomorph/bulgarian-accenter>

## Contact

Questions, or something here that turns out not to be true:
<https://github.com/noomorph/bulgarian-accenter/issues>

_Last updated: 2026-07-14_
