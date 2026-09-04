# Handover

Start here. This is the orientation document: what the project is, what state
it is in, what to be careful about, and where everything else is written down.

| Document | What it answers |
|---|---|
| **HANDOVER.md** (this file) | Where am I, what is open, what will bite me |
| [architecture.md](architecture.md) | How the system is shaped, and why |
| [implementation.md](implementation.md) | What each module does; how to make a change |
| [data-model.md](data-model.md) | The published `/v1/` contract, field by field |
| [fivb-data-quirks.md](fivb-data-quirks.md) | Upstream surprises that cost real debugging time |
| [../README.md](../README.md) | Public-facing: what counts as a tournament, counting rules |

---

## What this is

A static site that answers one question: **who has played beach volleyball
with whom.** Pick a country and a gender, get a force-directed graph of every
player from that federation who has competed internationally, linked to their
partners. Click a player for a card with their career; open a season to see
the individual tournaments; ask for the chain of partnerships joining any two
players.

Live at **https://beachvolleyball.com.br**. Data from the FIVB VIS Web Service,
rebuilt weekly.

**Scale, when you need it, is read and not remembered.**
`web/public/v1/manifest.json` carries the live totals — tournaments, players,
partnerships, the season span and every country with its per-slice node and
edge counts — and the site's own home page prints them. They are deliberately
not copied here: the archive is rebuilt every Monday, so any figure written
into this file is wrong by the following week.

## The one-paragraph architecture

A **Node/TypeScript ingest** fetches the whole FIVB archive in three bulk
requests, normalises it, and writes static JSON into `web/public/v1/` — which
is **committed to git**. A **React/Vite app** reads that JSON at runtime, and a
**prerenderer** emits one static HTML page per slice so the site works without
JavaScript and is indexable. GitHub Actions runs the ingest weekly and
publishes to GitHub Pages. There is no server, no database and no API of our
own. See [architecture.md](architecture.md).

## Current state

Everything described here is shipped and live.

**This file does not keep score.** No open pull requests, no branch list, no
test counts, no dataset totals — anything a command or a committed file already
answers is left to that command, because a number typed in here is only correct
until the next push. The open tasks below are the exception, and only because
they live in the task list rather than in the repository.

**Open tasks** (in the task list, not in code):

| | |
|---|---|
| #12 | Send the FIVB introduction email. Drafted as `docs/fivb-email.md`; its data-issues request names each reportable quirk by its [fivb-data-quirks.md](fivb-data-quirks.md) section, so keep the two in step. Nothing is missing — the opening paragraph is the part worth putting in the owner's own voice |
| #13 | Wire in the VIS application identifier once granted (blocked by #12) |
| #27 | Cloudflare: analytics → serve from Cloudflare Pages → possibly make the repo private |
| #28 | Ask 12ndr.at before linking out to their tournament pages |

## Things that will bite you

Ordered by how much time they have already cost.

**1. `Rank` 0 or blank means "never played", and that rule is load-bearing.**
It is the only thing separating a registered team from one that competed —
`Status` does not work, it false-positives both ways. Excluding these rows
dropped the dataset by ~16% of players when it was introduced. It also
silently handles future events, whose entry lists are published in advance.
Quirks §3, §4.

**2. A rank is a bracket, not a position.** 89% of played rows share their rank
with another team. Eight teams finish 9th. Any code that assumes one team per
rank is wrong. Quirks §5, §15.

**3. A player's federation is a snapshot with no history.** When someone
transfers, every partnership they built under the old flag leaves the graph
with them — from *both* countries, since the slicing needs both endpoints in
the same slice. The ingest counts and logs how many players this touches on
every run, and a good fraction of them are left with **no partner in their own
federation at all** — which is why the player card has an *Other federations*
section, and why an all-foreign card needs its own empty state. Quirks §6.

**4. The published data is committed to git and is the project's only durable
copy.** FIVB is a free service with no continuity guarantee. Treat
`web/public/v1/` as files real history will remember: pretty-printed for
readable diffs, sorted by immutable keys for stable diffs, and guarded by
`regression.ts` against committing a fetch that came back broken.

**5. The `/v1/` contract is public.** `llms.txt` and the README both point at
it. Adding fields is fine — append, never reorder. Breaking it means writing
`/v2/` and cutting the frontend over.

**6. A finished tournament can have no results for a day or two.** FIVB
publishes matches before placements. The ingest logs an `awaiting` line naming
any finished event with no ranked row; it resolves itself. Quirks §17.

## Routine operations

```bash
npm ci                 # install
npm run ingest         # ~15s: fetch FIVB, rebuild every file under web/public/v1/
npm run dev            # Vite dev server
npm run build          # typecheck + vite build + prerender a page per slice, plus the home page
npm run preview        # serve the built site
npm test               # unit tests (vitest)
npm run test:e2e       # browser tests (Playwright, against the built site)
npm run lint           # eslint + stylelint
```

**The weekly refresh** runs `.github/workflows/deploy.yml` on a Monday cron
(09:17 UTC — Monday because FIVB publishes placements after the Sunday
finals, not with them). It
commits the refreshed data to `main`, then builds and deploys. A code push to
`main` *skips* the ingest and builds from committed data — so shipping a CSS
fix never depends on FIVB being reachable.

**If the ingest refuses to publish**, it has decided the fetch looks broken
rather than genuinely smaller. Read the error, and if the drop is real (a
deliberate exclusion change), re-run with the `ALLOW_DATA_REGRESSION` input.

## Conventions worth keeping

- **Comments explain why, not what.** The codebase is unusually heavily
  commented, and deliberately so: almost every non-obvious line is a decision
  with a measurement behind it. When you change one, change its comment.
- **Measure before asserting.** Claims in comments and docs are numbers taken
  from the live archive, not estimates. If you cannot measure it, say so.
- **Tests assert against the published data**, not against hardcoded values, so
  they stay true as the archive changes and fail when page and data disagree.
- **One PR per idea**, with the reasoning in the commit message. The commit log
  is the design record.

## Where the bodies are buried

- `web/public/v1/` is generated JSON, megabytes of it. Never hand-edit it.
- **Merged branches are not deleted automatically**, so `claude/*` accumulates
  on the remote. Every one of them belongs to a merged pull request unless its
  own pull request says otherwise — check that before assuming a branch name
  implies unshipped work, and never read the pile as a to-do list.
- `.github/workflows/deploy-cloudflare.yml` is a complete alternative to
  `deploy.yml` but **has no automatic gate**: its header says to disable the
  other workflow by hand. If you enable it, do that, or both will rebuild on
  the same schedule.
