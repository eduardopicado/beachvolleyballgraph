---
name: data-conventions
description: How this repo makes and verifies claims about its published data. Use whenever you touch ingest/, regenerate web/public/v1/, write or change a test that reads published JSON, or write a number into a comment, a doc, or a commit message. Also use when a published number looks wrong and you are about to investigate, when resolving a merge conflict that involves the published tree, and when deciding whether the pipeline should rename or reclassify something FIVB named. The conventions here are cheap to follow and expensive to rediscover — several have already been rediscovered the hard way.
---

# Making and verifying claims about the data

This repo publishes a **committed data artifact** (`web/public/v1/`) and then
makes claims about it everywhere: in code comments, in five documents, in test
assertions, in commit messages. That combination is the reason for everything
below. A claim about a file you can read is checkable, so it should be checked;
and because the tree is committed and diffed, a wrong claim survives.

## Numbers are measured, not estimated

Anything you write as a number should have come from a command you ran.
Measuring is usually one line, because the published tree is JSON on disk:

```bash
node -e "
const fs=require('fs');
let n=0;
for (const f of fs.readdirSync('web/public/v1/players')) {
  const p = JSON.parse(fs.readFileSync('web/public/v1/players/'+f,'utf8'));
  for (const pl of p.players) if (pl.birthPlace) n++;
}
console.log(n);
"
```

For claims about *upstream* rather than the published tree, `ingest/vis.ts` is
importable directly — a `.mts` script under your scratchpad that calls
`fetchList` will answer most questions about VIS in one request. Prefer this to
guessing at what a field contains, especially since VIS silently ignores field
names it does not recognise and returns its defaults instead: a typo in
`Fields` does not error, it quietly answers a different question.

If you genuinely cannot measure something, say so in the text rather than
writing a number that reads as measured.

### Two kinds of number, and they age differently

- **The artifact as it stands** — file sizes, row counts, how many tests there
  are. These must be true today. They go stale on the weekly refresh, and the
  fix is to re-measure.
- **What an investigation found** — "89% of played rows share a rank", "38% of
  shared seasons changed order". These are dated observations. They stay as
  written unless re-measuring would overturn the *finding*, not merely move the
  absolute count.

`docs/fivb-data-quirks.md` stamps its own vintage at the top and lets a section
name its own date when re-measured. Follow that pattern rather than silently
refreshing a number, which loses the fact that it was ever checked.

## Verify a test by breaking the code

A test that has never failed has never been checked. Before keeping a new
regression test, break the thing it guards and watch it fail:

```bash
cp ingest/build.ts /tmp/b.bak
# make the minimal edit that reintroduces the bug
npm test 2>&1 | grep -E "×|Tests "
cp /tmp/b.bak ingest/build.ts
```

Two failure modes this catches, both of which have happened here:

**The vacuous assertion.** A published-artifact test that passes whatever the
code does. One written for the birth-place bracket rule could not work at all:
once the rule is fixed, a repaired `Poltana (Urss)` and a genuinely sloppy
`Arendal, norway` are the same shape in the output, so nothing could tell them
apart. It was deleted rather than shipped — a test that cannot fail is worse
than no test, because it looks like coverage. When a published assertion turns
out to be unwriteable, pin the rule with a unit test and say in the doc why the
published tree cannot carry it.

**The disappearing suite.** If a break makes the *total* test count drop rather
than turning a test red, the file failed to compile and nothing ran. `Tests 327
passed` where you expected `472 passed, 3 failed` is a broken experiment, not a
passing one. Re-break it in a way that still type-checks.

Also: don't compute the expectation with the code under test. `table.spec.ts`
writes its own comparator rather than importing `sortRows`, because sharing it
would make the test agree with any comparator including a broken one.

## Prefer assertions on the published tree

A unit test proves the rule works on a fixture. It does not prove the rule is
*reached* — a value travels through normalisation and the publish step before
anybody sees it. So where the claim is about what ships, assert against
`web/public/v1/` directly. `build.test.ts` has several of these blocks, each
explaining what a fixture-only test would have missed.

**Guard the guard.** Assert the subject is non-trivial before asserting on it,
or the test passes vacuously the week the data changes shape. Find subjects by
*scanning for the shape* the feature is about, never by hard-coding a player's
name — that turns a regression test into a test that fails whenever FIVB
updates a federation.

## Changing the shape of the data

The loop, in order:

1. Change the pure function in `ingest/build.ts` and unit-test it.
2. `npm run ingest` — a full rebuild, ~17s, no incremental cache.
3. **Check the diff touches only what you expect.** This is the step that
   catches accidents:
   ```bash
   git diff -U0 web/public/v1 | grep "^[+-]" | grep -v "^[+-][+-]" \
     | grep -oE '"[a-zA-Z]+":' | sort | uniq -c | sort -rn
   ```
   `generatedAt` always appears — it is the manifest's own timestamp and moves
   on every run. Beyond that, one field name means one field changed. Several
   means you changed more than you meant to, or more than you have measured.
4. Verify the specific invariant you were fixing, on the published tree.
5. Spot-check one real subject end to end against its own source data rather
   than trusting the aggregate. When 25 tournaments moved season, one player's
   career span was checked against the dates of the events he actually entered
   — the diff alone could not distinguish a correction from damage.

`regression.ts` will refuse to publish a rebuild that looks like a broken
fetch. A deliberate exclusion change *should* trip it; re-run with
`ALLOW_DATA_REGRESSION` and note the drop in the commit message.

### Never hand-resolve `manifest.json`

It carries `generatedAt` and `sourceVersion` — a freshness marker for the tree
around it. Resolving it in a merge leaves it describing slices it was not built
with. Take either side, then re-run the ingest so the whole tree is internally
consistent again. This is the only conflict in the published tree worth
thinking about; the slice files merge cleanly because they sort by immutable
keys.

## The editorial boundary

The pipeline reports what FIVB records. It does not re-referee the sport.

Tiers come from FIVB's own `Type`. Names come from FIVB except where FIVB
published nothing usable — `olympics.ts` and `worlds.ts` supply a host for two
championship tiers whose editions are known years ahead, and both fall back to
FIVB's own name for any edition they have not been told about.

Where that line has been tested, the answer has been the same each time. The
Tokyo Games are filed under 2021 and named "Tokyo 2020" because that is their
official designation, not ours to modernise. The ten Rio de Janeiro editions of
1987–1996 are widely considered the sport's de facto world championships of
that era, and they stay `world-tour` because FIVB never sanctioned them as
championships — promoting them would mint World Championship medals on player
cards that no other source recognises.

When you find something upstream that is genuinely wrong rather than merely
unhelpful, the move is to document it in `docs/fivb-data-quirks.md` and add it
to the "reporting these upstream" list, with the *correct value* where you know
it. That list is what the FIVB email offers to send. A one-field correction
somebody can apply beats a workaround nobody can review.

## Comments carry the reasoning

A comment saying what the code does is noise; one saying why it is not the
obvious alternative is the point. When you change the code, change the comment
— and when a comment cites a measurement, re-measure it or date it.
