# FIVB VIS data quirks

Things about the upstream data that are surprising, that cost real debugging
time, or that a future change could easily get wrong again.

This is not a complaint list. VIS is a free, generous service and most of what
follows is the ordinary shape of a database that has recorded a sport since
1987 through several format changes. The point is that none of it is
documented in a way that would have saved us the discovery, so it is written
down here instead of being rediscovered.

Each entry says what the quirk is, how it showed up, and where the pipeline
deals with it. Counts are from the archive as of **2026-08-09**; they drift.

---

## 1. `Type` 15 is National Tour, not "1-star"

**What.** VIS `BeachTournament.Type` 15 is named `NationalTour` in
[FIVB's own schema](https://www.fivb.org/VisSDK/VisWebService/BeachTournamentType.html).
The real 1-star is `Type` 42. We had 15 mapped to `world-tour`.

**How it showed up.** Australia had implausibly close to Brazil's player
count. A mate's profile showed one tournament he'd never played
internationally — it was a domestic NT event.

**The nastier half.** `OrganizerType` is *not* a reliable way to filter these
out. Plenty of confirmed domestic tour stops carry `OrganizerType` 1 (FIVB) —
Australia, Argentina, Poland, New Zealand, Cameroon, Mauritius, Egypt, Kenya,
Estonia, Guinea and more, all checked directly against VIS. Filtering on the
organizer alone leaves them in.

**Handled in.** `ingest/tiers.ts` — 15 is absent from `TIER_BY_TYPE`, with a
regression test in `tiers.test.ts` asserting it stays excluded *regardless* of
what `OrganizerType` claims.

---

## 2. Three different competitions look Olympic

`Type` 5 is the Olympic Games. `Type` 43 is the **Youth** Olympic Games and
`Type` 49 is the Olympic **Qualification** Tournament. All three carried the
`olympics` tier until it was noticed that they are not the same kind of event
at all.

They also behave differently in the data:

| Event | Team rows | With a real rank |
|---|---:|---:|
| `MYOG2014` / `WYOG2014` | 36 / 36 | **0 / 0** |
| `MYOG2026` / `WYOG2026` | 0 / 0 | 0 / 0 |
| `MOQT2019` / `WOQT2019` | 19 / 18 | 16 / 16 |

The Youth Games contribute nothing: VIS holds the 2014 entry lists with no
results attached, so §3's never-played rule drops all 72 rows, and the 2026
edition has no entries yet. The qualifier contributes normally — but its
`Rank` does not mean what `Rank` means anywhere else. **Several teams win it.**
The 2019 edition (China, September) has two teams at Rank 1 and two more at
Rank 3 in *each* draw, because the event awards Games berths rather than
crowning a champion:

```
Men    rank 1  ITA Nicolai/Lupo       rank 1  LAT Plavins/Tocs
Women  rank 1  ESP Liliana/Elsa       rank 1  LAT Graudina/Samoilova
```

**Handled in.** `ingest/tiers.ts` — the tier is the Games alone; 43 and 49 are
excluded, with a test pinning all three. Removing them cost no player and no
partnership: the 16 qualifier pairs all competed elsewhere, so only six
tournaments left the count.

Separately, `medalTournaments()` in `ingest/build.ts` reads `Type` off the raw
rows rather than deferring to `tierFor`, so a future addition to the tier
cannot quietly start minting medals. That guard mattered while the qualifier
was still in the tier, and is worth keeping now that it is not.

**The general lesson**, which §5 repeats from a different direction: a rank in
this data is not guaranteed unique within a tournament, and the reasons vary —
a missing bronze-medal match in 1997, multiple qualifiers in 2019.

---

## 3. `Rank` 0 means "registered but never played"

**What.** FIVB's field description for `BeachTeam.Rank` is literally *"team
has not played the tournament"* for 0. A blank `Rank` is the same case, and
`Number('')` is conveniently also `0`.

**Why it matters.** VIS keeps a team's registration row after it has been
superseded. A pair registers, one side pulls out before the event and
re-registers with someone else, and the original row is never deleted. Two
rows, two partners, one real appearance — inflating the departed partner's
edge and the dataset totals.

**Scale.** Excluding these dropped the published dataset by ~16% of players
and ~21% of partnerships in one go. That is not a bug in the exclusion: of
2,284 players who disappear entirely, a random sample showed *every* one had
zero rows with a real rank anywhere in their history — their whole FIVB
footprint was registrations that never became matches.

**Do not filter on `Status` instead.** It false-positives both ways.
`Status: Registered` rows still turn up with `Rank: 0`, and a genuine
in-competition retirement doesn't get marked `Withdrawn` at all if it happens
late enough to have earned a placement — a player hurt *during* a
bronze-medal match at a World Championships carries a normal `Status: 0` and a
real `Rank: 4`, because reaching that match locked the placement in. `Rank` is
what separates "never competed" from "competed and has a result".

**Negative ranks are real participation.** `<= -25` is elimination in
qualification, `-2` is elimination via a confederation/federation quota. Both
are kept.

**Handled in.** `ingest/build.ts`, the `didNotPlay` reject in
`aggregatePartnerships`.

---

## 4. Future tournaments are already in the archive, with entry lists

**What.** The tournament list includes events that have not happened. As of
2026-08-09 there are 23 qualifying tournaments whose main draw starts in the
future — 21 in season 2026, 2 in season 2027 — carrying **989 team rows**
between them. FIVB publishes entry lists ahead of the event.

**Why it is not a problem.** Every one of those 989 rows has `Rank` 0, so the
rule in §3 excludes them. Verified: zero rows from a future tournament survive
the filter, and zero season-2027 tournaments contribute a single appearance.
The rule written for withdrawn registrations turns out to cover
"hasn't been played yet" for the same underlying reason — no result, no rank.

**How safe is relying on `Rank` alone?** Safer than it first looks. The
pipeline does fetch `StartDateMainDraw`, but only to order events within a
season on the player card — nothing compares it to today, so `Rank` is still
the *only* thing separating a scheduled event from a played one. Which invites
the worry that a pre-event seeding value could leak into it. It can't: FIVB keeps seeding and
entry ordering in entirely separate fields, and
[documents `Rank` as "Rank in the tournament"](https://www.fivb.org/VisSDK/VisWebService/BeachTeam.html),
a result. The pre-event fields are:

| Field | What it holds |
|---|---|
| `MainDrawSeed1` / `MainDrawSeed2` | seed index for main-draw entry position |
| `EntryPoints1` / `EntryPoints2` | points used to decide who enters directly |
| `PositionInEntry`, `PositionInMainDraw`, `PositionInQualification`, `PositionInDispatch` | entry ordering |

None of them is `Rank`, and none is read by this pipeline. A registered team
for an unplayed event can carry a seed and entry points and still have
`Rank` 0 — which is exactly the state observed on all 989 rows above.

**Visible side effect.** `manifest.seasons.to` is computed over the qualifying
tournament set, not over tournaments that contributed data, so it reads 2027
while no 2027 match has been played. See §11.

---

## 5. A rank is not unique within a tournament

The 1997 World Championships (`MLAX1997`, `WLAX1997`) had no bronze-medal
match; both losing semi-finalists share `Rank` 3. Two teams, one rank, in both
the men's and women's events.

That is not a one-off historical oddity. The Olympic Qualification Tournament
does the same thing at the top of the table for a completely different reason
— it awards Games berths, so several teams "win" (see §2). Two independent
causes, same shape.

Any code that assumes one team per rank is wrong for both. The medal
aggregation credits both 1997 bronzes, and the test fixture in
`build.test.ts` includes them deliberately; the qualifier is kept out of the
medal set entirely.

---

## 6. A player's federation is a snapshot, with no history

`Player.FederationCode` is the player's *current* federation. There is no
record of who they represented at a given tournament — and VIS is not always
in step with reality.

**The worked example.** Chaim Schalk is a Canadian Olympian who played 55
events with Ben Saxton for Canada. VIS lists him as `USA`, and FIVB's own
public profile agrees — there is no Canadian profile for him. So on the
USA men's page his own tournament count is 115 while his partner edges sum to
48: four of his eight partners, including the biggest partnership of his
career, are tagged `CAN` and dropped by the same-federation rule.

This is accepted behaviour, not a bug to fix — but it is the reason
"tournaments" and the sum of partner entries can legitimately disagree on a
player card.

**Worth knowing.** `BeachTeam` rows carry their own `FederationCode` — the
federation the pair actually represented at that tournament. The pipeline
fetches it but does not use it. That field is the raw material for a proper
fix if this ever becomes worth doing.

---

## 7. Federation codes that aren't countries

- **`SMA`** — the player sample includes a literal `Test` / `Test` entry
  alongside otherwise unverifiable names. It reads as leftover test data.
- **`FIV`** — no discernible identity; FIVB is not a country. Most likely a
  placeholder for unaffiliated or neutral athletes.

Both are dropped outright rather than guessed at: misattributing a real
person's nationality is worse than omitting them.

**Handled in.** `EXCLUDED_FEDERATIONS` in `ingest/countries.ts`.

---

## 8. The same country under two codes

Netherlands Antilles (`AHO`) dissolved in 2010 and Curaçao's federation kept
the old code, but some player records still carry a standalone `CUR`. Without
an alias they render as two separate Curaçao entries.

**Handled in.** `FEDERATION_ALIASES` in `ingest/countries.ts`.

Related: `AHO`'s ISO code `AN` was withdrawn from ISO 3166. Building a flag
from a withdrawn code gives two boxed letters rather than one glyph, which
reads as the country appearing twice — remapped to `CW` in
`web/src/lib/format.ts`.

---

## 9. The UK home nations can't be told apart by country code

England, Scotland and Northern Ireland are separate FIVB federations that all
carry `CountryCode` `GB`; Wales carries the non-ISO value `04`. Deriving a
display name from the ISO code alone labels three different federations
"United Kingdom". Their federation *names* are organisation names
("VOLLEYBALL ENGLAND"), so neither source works alone.

Flags need Unicode tag sequences rather than regional indicators. Northern
Ireland has no equivalent — Unicode never standardised `gbnir` — so it stays
without one.

**Handled in.** `NAME_OVERRIDES` in `ingest/countries.ts`,
`SUBDIVISION_CODES` in `web/src/lib/format.ts`.

---

## 10. Units and formats that look like corruption

- **Height** is in ten-thousandths of a metre: `1930000` is 193cm.
- **Weight** is in millionths of a kilogram: `57000000` is 57kg.
- **Season** is usually a year but the earliest World Tour records use a
  range, `"1987-91"`. A plain `Number()` yields `NaN` and silently drops those
  events; the parser takes the leading year.
- **Birthdate** can be `0001-01-01` for "unknown".

**Handled in.** `toCentimetres` / `toKilograms` in `ingest/vis.ts`,
`parseSeason` and `normalisePlayers` in `ingest/build.ts`.

---

## 11. A cancelled tournament says so in its name

VIS has no status field for an event that was called off. The word goes in the
display name:

```
MHAM2017  Type=38  rows=10  played=0   Name: "Hamburg (canceled)"
MROM2017  Type=38  rows=21  played=0   Name: "Rome (canceled)"
```

Which is easy to miss, because `Name` is not a field you need for anything
else. It surfaced only by asking why just 16 of 32 World Tour 5\* events
contributed anything.

**Scale.** 131 of 1,825 qualifying tournaments are marked cancelled, and
**all 131 contribute zero appearances** — the correlation is exact, because a
cancelled event has no results and §3's rule already excluded its entrants.
2020 alone accounts for 59.

**Formatting varies enough to matter.** Real names from the archive:
`Hamburg (canceled)`, `Mangaung(Cancelled)`, `CEV Lille Masters - canceled`,
plain `Cancelled`, and Spanish-language `cancelado` / `cancelada`. A substring
test is the only thing that catches them all.

**"Postponed" is a different thing** — 7 in the qualifying set, none
contributing today, but a postponed event may still be played. Treating it as
cancelled would assert something the data does not say, and it costs nothing
left in: no results, no rank, no players.

**Handled in.** `isCancelled()` in `ingest/build.ts`, applied in
`normaliseTournaments`. `Name` is fetched purely for this.

### What is left over

Measured with both the narrowed Olympic tier (§2) and the cancellation filter
applied, 1,597 of 1,689 qualifying tournaments contribute an appearance. The
92 that do not:

| | count |
|---|---:|
| no team rows in VIS at all | 18 |
| team rows present, all `Rank` 0 | 74 |
| *(of those, events still in the future)* | *17* |

Down from 226 before either change, and the biggest single explanation —
cancellation — is now handled. What remains is genuinely miscellaneous:
events scheduled and quietly dropped without being marked, and events whose
team data never made it upstream.

So `manifest.totals.tournaments` still counts a residue of tracked-but-silent
events, and `seasons.to` runs to 2027 on the strength of two unplayed ones.
Much smaller than it was, but not zero — worth knowing before quoting the
tournament count as "tournaments in the graph".

---

## 12. Flags that don't mean what they say

- **`Player.IsActive`** is not beach-specific — it tracks overall FIVB
  registration across beach, indoor and snow — and is not reliably updated for
  retired athletes. Cross-checked: 66% of players it flags active have no
  qualifying beach tournament in the last five seasons. Deliberately not
  carried through.
- **`PlaysBeach`** is unreliable in the other direction: a few thousand
  players who have entered FIVB beach events are not flagged, and filtering on
  it silently drops their edges. The player list is fetched unfiltered because
  of this.

---

## 13. Responses can be large, and the shape rewards care

The player list alone is ~130,000 rows and the raw XML runs to tens of
megabytes. Two practical consequences:

- A general-purpose XML parser builds a multi-hundred-thousand-node tree and
  trips over entity-expansion limits on a document with this many accented
  names. VIS list responses are flat, attribute-only elements, so scanning
  attributes directly is both correct and an order of magnitude cheaper.
- Always send an explicit `Fields` list. The default response returns every
  attribute and is several times larger, for a service that charges nobody.

**Handled in.** `extractRows` in `ingest/vis.ts`.

---

## 14. Only one of the tournament date fields is reliably populated

`BeachTournament` exposes several dates, and they are not equally trustworthy.
Measured across all 9,264 tournaments VIS returns:

| Field | Populated |
|---|---:|
| `StartDateMainDraw` | 9,264 (100%) |
| `EndDateMainDraw` | 9,264 (100%) |
| `StartDateQualification` | 2,750 (30%) |
| `Dates` | 0 |

So `StartDateMainDraw` is the only start date worth ordering by. Using
`StartDateQualification` where it exists and falling back otherwise would sort
some seasons by one field and some by another — a worse error than being
uniformly a day or two late for the pairs that only played a qualification.

`Dates` exists in the schema and comes back empty on every row; asking for it
costs a field slot and returns nothing.

One trap once you do have dates: **a season does not always start in its own
calendar year.** Southern-hemisphere events can open in the previous December,
so a day-of-year would sort them *after* the following January's events. Store
an offset from 1 January of the season instead, which goes negative and orders
correctly.

**Handled in.** `startOffsetFor` in `ingest/build.ts`.

---

## 15. A rank is a bracket, not a position

§5 says a rank is not unique within a tournament. That is an understatement:
**89% of played rows share their rank with another team** (56,835 of 63,841 in
the qualifying set). It is not an anomaly, it is the format. Beach volleyball
stops distinguishing teams once they are out, so everyone knocked out in the
same round gets the same number:

| `Rank` | Rows | Means |
|---:|---:|---|
| 1, 2, 3, 4 | ~1,600 each | exactly what it says |
| 5 | 5,334 | 5th–8th |
| 9 | 8,707 | 9th–16th |
| 17 | 9,020 | 17th–32nd |
| 25, 33, 41, 57 | 7,079 / 5,520 / 6,982 / 2,621 | deeper brackets, draw-size dependent |

The small counts in between (39 rows at 6, 24 at 10, 18 at 11) are older
events that did rank every team, so the brackets are a convention rather than a
rule you can invert. There is no field saying how many teams shared a
placement; counting rows per rank per tournament is the only way to know, and
it is not worth publishing — FIVB, and every other results site, shows the bare
number.

**Negative ranks, measured.** §3 documents `<= -25` as qualification and `-2`
as a quota elimination. Across the qualifying set the actual values are `-2`
(1,182 rows), `-33` (10 rows, all 1996–97) and `-4` (8 rows, all 2015). `-4` is
documented nowhere and is too rare to infer from; it gets a neutral "did not
reach the main draw" rather than a guess.

**Two rows, one player, one tournament.** 45 player–tournament pairs in the
archive have more than one played row. In 43 of them the partner *differs* —
both entries are real, and the partner list counts the tournament on both
pairings, so collapsing them would leave a season's expanded rows short of the
tallies above them. The remaining 2 are the same pair twice, a qualification
row and a main-draw row; those collapse to the better rank.

**Handled in.** `formatFinish` in `web/src/lib/format.ts`, and the result
de-duplication in `aggregatePartnerships`.

---

## 16. Two qualifying "tournaments" are not tournaments

Tournament 18 is `FIVB Presidency Handover Ceremony` (2008) and 505 is
`Congress 2010`. Both carry `OrganizerType` 1 and a Type on the World Tour
allowlist, so both pass the filter in `tiers.ts` and are counted in
`manifest.totals.tournaments`.

Harmless in practice — neither has a single team row, so no player, edge or
result comes from them — but they are 2 of the 1,688 in the published count,
and now that `/v1/tournaments.json` publishes names they are visible. Left in
rather than name-matched away: a substring blocklist for "ceremony" and
"congress" is the kind of filter that quietly eats a real event later, and the
cost of these two is two rows in an index nobody links to.

**Handled in.** Nothing. Documented on purpose.

---

## 17. A finished tournament can have no results for days

**What.** An event ends, its matches are complete in VIS — and every one of its
`BeachTeam` rows still carries a blank `Rank`. §3 reads blank as "registered
but never played", correctly, so the whole tournament contributes nothing:
no appearances, no partnerships, no rows on any player card.

**The case that surfaced it.** BPT Futures Busan (`WBUS2026`, tournament 8954,
Korea, 14–16 August 2026). One day after it ended, all 39 team rows had a blank
`Rank`, including Jana Milutinovic / Jasmine Rayner. Meanwhile
`GetBeachMatchList` returned its 40 matches with scores and `Status: 15`
(finished).

**The placement does exist — in a different entity.** `GetBeachTeamList`, the
bulk request this pipeline is built on, is not the only source.
`GetBeachTournamentRanking` returns Busan's full final standings *right now*,
while every `BeachTeam.Rank` for the event is still blank:

```
<BeachTournamentRankingEntry NoTeam="3173540" Rank="1" TeamName="Progella/Pagara"/>
<BeachTournamentRankingEntry NoTeam="3173538" Rank="2" TeamName="Rondina/Pons"/>
<BeachTournamentRankingEntry NoTeam="3172894" Rank="3" TeamName="Milutinovic/Rayner"/>
```

**It is easy to conclude that entity is empty when it is not.** It returns a
bare `<BeachTournamentRanking />` — no error, no rows — unless an explicit
`Fields` attribute is supplied, and it takes the tournament as a `No` attribute
on the request rather than inside a `<Filter>`. Either mistake looks exactly
like "this tournament has no ranking", including for tournaments whose
standings are complete. `ingest/vis.ts` already says always send a `Fields`
list; this is what it costs to ignore that.

**Its negative ranks mean the opposite of `BeachTeam`'s.** Here a negative
marks a *shared* placement — the teams tied with the one above. A draw with
four teams on 5th returns one `5` and three `-5`. In `BeachTeam.Rank` a
negative means elimination in qualification or on quota (§3). Swapping one
source for the other without translating the sign would read every shared 5th
place as a qualification exit.

| | `BeachTeam.Rank` | `BeachTournamentRanking.Rank` |
|---|---|---|
| Busan, a day after the event | all blank | complete, 26 entries |
| Shared placements | flattened to the positive value | negative on all but the first |
| A negative means | eliminated in qualification / on quota | tied with the placement above |
| Qualification losers | present, `<= -25` | absent |
| Request shape | one bulk call for the whole archive | one call per tournament |

**How common.** Rare, and it does resolve. Of the 468 finished tournaments in
the qualifying set carrying tournament `Status` 7, Busan was the *only* one
with zero ranked rows. Every other recently finished event had placements.

| Tournament `Status` | Finished | With no ranks |
|---|---:|---:|
| 8 | 1,032 | 0 |
| 7 | 468 | 1 |
| 1 | 60 | 4 |
| 0 | 69 | 38 |
| 10 (relocated) | 8 | 8 |
| 11 (postponed) | 7 | 7 |

The long tail sits in `Status` 0, 10 and 11 — postponed, relocated and
abandoned records kept under their original dates. Those never had a result and
never will, which is why they are counted separately from recent lag rather
than reported by name.

**So the gap can be closed**, at the cost of the pipeline's "three bulk
requests, no per-tournament fan-out" property. Bounded, though: only events
that are finished and unranked need asking about, which is one or two a week.
Deriving placements from the match list — the other option considered — is not
needed and never was, because FIVB publishes them.

**Handled in.** `finishedWithoutResults` in `ingest/build.ts`, logged by
`ingest/main.ts` as the `awaiting` line. It does not fail the run — the next
one picks the placements up on its own. It exists so the gap is visible in the
run log instead of being noticed by a reader.

---

## Reporting these upstream

Most of the above is ours to work around. Two are arguably worth raising with
FIVB if a channel opens up (see the contact address in `web/src/site.ts`):

- **§1**, National Tour events carrying `OrganizerType` 1, which looks like a
  data-entry inconsistency rather than a deliberate classification.
- **§7**, the `SMA` test records sitting in production player data.
