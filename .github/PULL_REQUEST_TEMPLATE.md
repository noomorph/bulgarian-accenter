## What this changes

<!-- One or two sentences. -->

## Why

<!-- What was wrong, or what is now possible. -->

## Checklist

- [ ] `npm test` passes (including the invariants asserted over every shipped dictionary entry)
- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `npm run lint:ext` passes (AMO's linter, run against the Firefox build)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`, if this is user-visible

<!--
If you are touching the dictionary or its build:

data/stress-dict.txt is generated and is NOT in the repo — `npm run dict:all` builds it from the
public dump. Do not hand-edit it, and do not commit it. To correct a specific word, add an entry to
data/sql-corrections.json and regenerate: that file is the one a human is meant to read and argue
with. See CONTRIBUTING.md.
-->
