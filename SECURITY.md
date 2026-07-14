# Security Policy

## Supported versions

The latest released version, on both stores. There are no maintained branches.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private reporting — [Security → Report a vulnerability][advisories] — or email
<noomorph@gmail.com>. Expect a first reply within a week.

[advisories]: https://github.com/noomorph/bulgarian-accenter/security/advisories/new

## The threat model, honestly

This extension has an unusually small attack surface and it is worth being precise about where the
risk actually is, so that reports land where they matter.

It makes **no network requests**, has **no server**, **stores nothing**, and **evaluates no remote
code**. It has no options page, no message-passing with web pages, and its only privileged surface
is a toolbar click. What it does have:

- **`<all_urls>` content-script access.** A bug here — say, one that leaked page text across
  origins — would matter a great deal. It cannot leak it anywhere (there is nowhere to send it),
  but a DOM-level flaw is still in scope.
- **DOM rewriting on arbitrary pages.** The extension splices text into pages it did not write. It
  only ever inserts a combining accent character into an existing text node — it never creates
  elements, never sets `innerHTML`, and never touches attributes. A path that let page-controlled
  content escape that constraint would be a real finding.
- **A 3 MB dictionary parsed at runtime.** `src/dict.js` decodes a front-coded text file. It is
  bundled and integrity-checked by the browser, so an attacker cannot substitute it without already
  owning your profile — but parser bugs (a hang, unbounded memory) are in scope.
- **`web_accessible_resources`.** The dictionary must be fetchable by the content script, which in
  Chrome would let any page fingerprint the extension's presence. We set `use_dynamic_url` to close
  that. If you find it still leaks, that is a valid report.

Out of scope: the ~0.2% of derived dictionary entries that carry a wrong accent. That is a known,
documented accuracy trade-off, not a vulnerability — please use the
[wrong accent][wrong] issue template instead, which is genuinely useful.

[wrong]: https://github.com/noomorph/bulgarian-accenter/issues/new?template=wrong_accent.yml
