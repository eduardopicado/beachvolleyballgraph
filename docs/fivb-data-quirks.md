# FIVB VIS data quirks

Things about the upstream data that are surprising, that cost real debugging
time, or that a future change could easily get wrong again.

This is not a complaint list. VIS is a free, generous service and most of what
follows is the ordinary shape of a database that has recorded a sport since
1987 through several format changes. The point is that none of it is
documented in a way that would have saved us the discovery, so it is written
down here instead of being rediscovered.

Each entry says what the quirk is, how it showed up, and where the pipeline
deals with it. Counts are from the archive as of **2026-08-09** unless a
section says otherwise; they drift, and a section re-measured since then names
its own date. What is being asserted is the *finding* — that a field is empty
on every row, that 89% of ranks are shared — so a re-measurement is worth doing
when it might overturn one, not to keep an absolute count current.

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

**The second worked example, which runs the other way.** Schalk shows a
partnership *dropped*. The inverse is a partnership **relabelled**: a pair who
were compatriots at the time, filed as cross-federation because one of them
moved afterwards.

Pedro Solberg and Tiago De J Santos played one event together in 2005. Both
were Brazilian then — `BeachTeam.FederationCode` says `BRA` for Tiago on every
entry from 2005 to 2010, and `BRA` for Solberg on all 24 of his, 2002 to 2026.
Tiago later moved to Qatar, and `Player.FederationCode` is a snapshot, so today
he is `QAT`. The consequence is that a Brazil–Brazil partnership is missing
from the Brazil men's graph and appears on Solberg's card under *Other
federations*, attributed to a country neither of them represented in 2005.

Note which way round the distortion goes, because the obvious guess is
backwards. A pair who **both** move stay correct: Jefferson Santos Pereira and
Tiago played nine events together in 2013–14, and `BeachTeam.FederationCode`
records `QAT` for both across exactly those seasons, so the Qatar men's graph
is right about them. What breaks is not the transfer — it is the transfer that
only **one** of them made.

There is a third thing in those same rows: Jefferson's entries run `BRA`
(2006–08), then `QAT` (2013–19), then `GER` (2018–19), while his player record
says `QAT`. The snapshot is not even reliably the *latest* federation.

**Worth knowing.** `BeachTeam` rows carry their own `FederationCode` — the
federation the pair actually represented at that tournament, which is where
every figure above came from. That field is the raw material for a proper fix,
and it fixes both directions at once: Schalk's dropped edges and Solberg's
relabelled one.

**Scale.** 157 players have at least one partner in another federation and 49
have no partner in their own, so for those 49 the *Other federations* block is
the whole career rather than a footnote — which is also why it is worth being
precise about what that heading means. It means "other federations **today**".

### 6a. Don't be fooled into thinking the team code is a snapshot too

`BeachTeam.FederationCode` agrees with player 1's *current* federation on
203,273 of 204,263 comparable rows — 99.5%. (§6a–6c count a full team dump
taken 2026-08-25, 206,325 rows, rather than the archive date at the top.)
That number reads like proof the
field is just today's value stamped backwards onto old entries, and it is not.
It is the base rate of never transferring. Of 7,138 players with five or more
rows as player 1, **58** carry more than one code at all:

| | players |
|---|---|
| one code for the whole career | 7,080 |
| clean chronological split (a transfer) | 27 |
| mixed or non-contiguous | 31 |

The 27 are unmistakable, and the seasons line up with real moves:

```
120495  BRA 2008-2014 → QAT 2016-2019      145124  BRA 2006-2008 → QAT 2013-2019
103670  FIN 2001-2017 → CYP 2021-2024      147368  RUS 2006-2013 → AZE 2014-2017
120577  UKR 2008-2013 → RUS 2018-2020
```

The 31 that don't split cleanly are mostly not transfers either. Federation
*renames* account for most of them — `GBR`↔`ENG`/`SCO`, `LIB`↔`LBN`,
`MLD`↔`MDA`, `CUR`↔`AHO` (§8 covers those) — plus `RUS`↔`ROC` for 2021, which
is historically correct rather than an error. Four are genuine round trips:
`AUS`→`DEN`→`AUS`, `AZE`→`BRA`→`AZE`, `BUL`→`NED`→`BUL`, `ESP`→`GER`→`ESP`.

**The trap.** A `BeachTeam` row also carries `Player1FederationCode` and
`Player2FederationCode`. Those *are* live joins to the player record, and they
are worth nothing as history: Tiago's 2005 entry says
`Player2FederationCode="QAT"` for a move he made in 2013. The team's own
`FederationCode` on that same row says `BRA`. Two fields on one row, one true
at the time and one true today — take the team's.

### 6b. VIS has no transfer record at all

There is no request type for one. Probed and rejected with
`BadParameter id="1002">Type`: `GetPlayerTransferList`, `GetTransferList`,
`GetBeachTransferList`, `GetPlayerHistoryList`, `GetPlayerFederationList`,
`GetPlayerNationalityList`, `GetPlayerCareerList`, `GetVolleyTransferList`,
`GetPlayerRegistrationList`, `GetLicenseList`, `GetBeachTeamPlayerList`,
`GetPlayerVersionList`. `GetFederationList`, `GetConfederationList`,
`GetBeachTeam` and `GetBeachRoundList` do exist.

The full player record (below) has no history field either — `PreviousNames`
tracks name changes, and nothing tracks federation changes. Reconstructing a
transfer from the team rows, as §6a does, is the only route there is.

**How to enumerate fields at all.** VIS silently ignores a `Fields` name it
doesn't recognise — asking for `ZzzNotAField` returns rows without it rather
than an error — so a bad field name teaches you nothing. The singular
`Get<Thing> No="…"` requests take no `Fields` and return every attribute, which
makes them the field list:

```
<Requests><Request Type="GetPlayer" No="102285"/></Requests>
<Requests><Request Type="GetBeachTeam" No="884126"/></Requests>
```

`GetPlayer` returns ~90 attributes. Beyond what the pipeline already uses:
`ConfederationCode`, `PreviousNames`, `PopularName`, `BeachYearBegin`,
`BirthPlace`, `BirthCountryCode`, `Languages`, `Sponsors`, `Handedness`,
`NoPerson`, `NoCev`. `GetBeachTeam` returns ~80, including `EarningsTeam`,
`EntryPoints`, `MainDrawSeed`, `TechnicalPoints` and the two player joins above.

### 6c. A "mixed-nationality pair" is usually a transfer we failed to detect

A team row carries one `FederationCode`. When the two players appear to belong
to different federations, the obvious reading is that FIVB filed the pair under
one of them. That reading is mostly wrong, and the number that seemed to
support it has now been measured three times, wrongly twice.

**Restrict to the events this pipeline actually publishes.** Counted over every
row VIS returns, mixed teams look common and *rising* — 1.22% overall, 2.3% by
2026. Almost all of that is `Type` 15 (National Tour, §1), which we exclude:
687 of the 700 mixed rows in 2025–26 are domestic. Over qualifying tournaments
only, mixed teams have all but disappeared:

| Seasons | Mixed share of qualifying entries |
|---|---|
| 1996–2003 | 0.67 – 1.30% |
| 2004–2015 | 0.04 – 0.52% |
| 2016–2026 | **0.00 – 0.10%** |

296 rows in the whole archive. 2016, 2018 and 2024 have **none at all**.

**What the survivors actually are.** Half the recent ones are one person:

```
2023 WBDI2023   Karen Noppen [NED] + Emmanuelie Ndayikengurukiye [BDI]
2025 WBDI2025   Karen Noppen [NED] + Gynette Kamwemwe [BDI]
2026 WBUJ2026   Karen Noppen [NED] + Gynette Kamwemwe [BDI]
```

Noppen moved BDI to NED. She was Burundian at all three events; her record says
Netherlands today. These are not mixed pairs — they are a transfer the
detection missed, wearing a mixed pair's clothes.

**Why the detection misses them, and will keep missing them.** A transfer is
inferred from a player's `FederationCode` varying across seasons on rows where
they are **player 1** — the only rows whose code is reliably theirs. But
**4,517 of 14,340 players (31.5%) never appear as player 1 at all**, so any
move they make is structurally invisible. Noppen is one of them.

**So how often does the team code follow player 1?** On qualifying events,
**207 of 296 (69.9%)**, with 89 (30.1%) following player 2. Two earlier figures
in this section were higher and both were artefacts:

- *99.6%* came from deriving each player's federation from their player-1 rows
  — a set that **contains the row being tested**, so the code vouched for
  itself and the answer was fixed in advance.
- *93.8%* fixed that but counted domestic events, where mixed entries are
  ordinary and behave differently.

A third shortcut is wrong the other way and worth naming: keeping only players
whose codes *never* vary excludes anyone who ever played a mixed pair, since
such a player picks up their partner's code. That reports mixed teams at
0.0–0.6% by construction.

**The worked example, and why it stays unresolved.** Giseli "Gisi" Gavio
Farinazzo (`102285`) is player 1 on all fifteen of her teams, every one
registered `BRA`, every partner otherwise `ITA`. So she stands alone on the
Brazil women's graph with five partners and no edges.

Her events are real: `WGST2002` Gstaad, `WKLA2003` Klagenfurt, `WBER2003`
Berlin, `WMRS1998` Marseille — `Type` 0 and 1, organiser FIVB. Not §1 domestic
events.

But we cannot say which of two things she is. Either she was Brazilian and
played the World Tour with Italians — one of roughly a dozen such entries in
2002 — or she was Italian-registered then and later became Brazilian, and every
one of her rows says `BRA` because of it. **No evidence available to us
separates the two**, because all fifteen of her rows are the rows in dispute:
there is no independent row of hers for the variation test to read. The same
blindness that hides Noppen hides Gisi, for a different reason.

**Do not report this upstream without resolving it first.** FIVB's records may
be entirely correct; the ambiguity is ours, and it comes from having no
federation history to check against (§6b).

### 6d. Rows agreeing with each other is not corroboration

§6a establishes that the team `FederationCode` is stored on the row rather than
joined live — it does not follow that the stored value is contemporaneous. Every
argument in §6a–6c leans on rows agreeing with one another, and it is worth
knowing what that agreement is made of.

`BeachTeam` will return a **`Version`** if you ask for it. It is a global
monotonic write counter, not a date: rows written in the same transaction share
a value, and a higher value means "written later than". So it cannot say *when*
a row was last touched, but it says exactly **which rows were written together**,
which turns out to be the more useful question.

Ask for it carefully. VIS **silently ignores field names it does not recognise**
and answers with the default set instead — `LastChangeDate`, `ModifiedDate` and
`Timestamp` all come back looking like successful responses containing no such
field. An unrecognised field is not an error, so a typo in a `Fields` list
degrades quietly rather than failing.

**What the counter shows.** Across 206,459 team rows there are 23,911 distinct
versions, and the large ones reach across the whole archive at once:

| version | rows | share | seasons it spans |
| --- | --- | --- | --- |
| 2362678 | 21,580 | 10.5% | 1996–2024 |
| 4293583 | 12,846 | 6.2% | 2002–2026 |
| 4190115 | 3,320 | 1.6% | 2004–2026 |
| 4248077 | 1,958 | 0.9% | 1999–2026 |

Of the 350 writes touching 100 rows or more, **303 rewrite rows a decade or
more apart in a single operation** — median span 14 seasons, longest 28. FIVB
does mass-rewrite its own past, and 4293583 sits near the top of the sequence,
so it is recent. Restricted to 1996–2005, **30.1% of rows carry a version above
the 2362678 floor**: they were written to after the bulk import that created
them.

**What this costs the arguments above.** Take the §6c worked example. All
fifteen of Gisi Gavio's rows carry version 2362678 exactly — none rewritten
since the import, which sounds reassuring until you notice that 2362678 *is*
the import. Fifteen rows saying `BRA` is not fifteen observations; it is one
write, copied fifteen times, and whatever those rows said before it is gone.
Generalised: of the 23,456 players ever listed first, **60.0% have their entire
player-1 record written in a single transaction**, and 4,740 of those have
several rows that all agree with each other.

So a rule that accepts a federation because several rows concur is, most of the
time, consulting one assertion several times. That is still worth doing — it
catches the case where the rows genuinely *disagree*, which is how the false
transfers in §6c were found — but it is a **consistency** check, not evidence
that the value is historically true. Nothing in VIS can supply the latter; only
a source outside it can.

---

## 6.5. `FirstName` and `LastName` are free text, not name parts

`Player.FirstName` and `Player.LastName` are typed by hand at 200-odd
federations over three decades, and it shows. Taking the site's 12,074
published players as the population:

| what | published | whole 130,988-row table |
|---|---:|---:|
| untrimmed whitespace | 205 | 6,500 (4.96%) |
| typed entirely in capitals | 64 | 5,737 have an ALL-CAPS `FirstName` |
| a quoted nickname inside the field | 547 | 982 |
| a double space | 36 | 476 |
| empty `FirstName` | 0 | 8 |

**The worked example.** Alexandre Ramos Samuel — "Tande" — is player `102071`:

```
FirstName = ' Ramos Alexandre "Tande"'    LastName = 'Samuel'    TeamName = 'Tande'
```

Three problems in one row. A leading space; the surname `Ramos` sitting in
front of the given name, so `FirstName + LastName` reads "Ramos Alexandre
"Tande" Samuel"; and the nickname stuffed into `FirstName` when `TeamName`
already holds it correctly.

**Capitals sometimes carry meaning.** 64 published names shout in every word,
where the capitals say nothing. But 66 others shout in *some* words —
"Katharina HETZENDORFER", "MUKUNZI Christ Ornel" — and there the capitals mark
the family name, which is the convention across much of Europe and Africa and
the only indication of name order those rows have. Normalising case per word
would delete it. `tidyName` in `ingest/build.ts` therefore tests the whole name
and only touches the ones where every word shouts.

**What can't be fixed downstream.** Name *order*. Nothing in the row says which
token is the given name, so Tande stays "Ramos Alexandre …" until FIVB fixes
the record. Reported upstream — see the bottom of this document.

**Handled in.** `ingest/build.ts`, `tidyName`, applied in `fullName` and
`shortName`. Trimming, whitespace collapsing, and case where case is noise.
Particles are deliberately *not* lowercased: the same "DE" is a Portuguese
particle in "TAVARES DE PINA" and part of a Flemish surname in "LOTTE DE
CLERCQ", and "LE" in "OOI TIAN LE" is a Malaysian name rather than a French
particle. Telling them apart needs the player's culture, not their string.

---

## 6.6. `BirthPlace` is free text, and occasionally not a place

One field, no separate city or country, filled in by hand at a couple of
hundred federations. It reaches **6,496 of the 12,074 published players
(53.8%)** and holds at least four conventions at once:

| Player | `BirthPlace`, exactly as stored | What it is |
|---|---|---|
| Emanuel Rego | `Curitiba, PR` | city and state |
| Laura Ludwig | `Berlin` | city alone — the median shape |
| Gisi Gavio | `Juiz de Fora (BRA)` | city and country code |
| Tande | `Resende-Rio de Janeiro` | city and state, hyphenated |
| — | `TN` | a province code, not a city |

None of that is repairable: nothing separates a city from a province, and
nothing says which country a bare "Portland" is in. It is published verbatim.

**It is much cleaner than it first looks.** Only **21 of 6,496 (0.32%)** are
unusable, and most of those are merely suspicious — `Paris 14e`, `Praha 4`,
`Sèvres (92)`, `St Brieul (12)`, `Auckland N2` are arrondissements, districts
and department numbers, which are real answers. Rejecting anything containing a
digit would discard all of them to catch **seven** genuinely broken records:

```
21.08.77   03/09/1988   06-05-1991   17/01/1992     a date in the place field
30019      98278                                    a bare postcode
to be Merged with (#164181) as                      an internal editing note
```

That last one is worth reporting upstream: it is a note to whoever maintains
the record, sitting in a public field.

**Capitals are normalised per word here, not per string.** §6.5 leaves a partly
capitalised *name* alone because the capitals mark the family name; a place has
no such convention, so `9 de JULIO` should become `9 de Julio` even though "de"
is already lower case. What makes per-word safe is a length gate — a short
upper-case token in a place is a **code**: the `PR` in `Curitiba, PR`, the
`BRA` in `Juiz de Fora (BRA)`, the whole of `TN`. 444 published birth places
shout and are fixed; the codes survive.

**The same box is filled in with caps lock the other way round**, on 102
records: `rio de janeiro`, `buenos aires`, `salvador`. Those are title-cased
too, with the length gate switched off, because a value carrying no capital
cannot be hiding a code — `arg` becomes `Arg` and nothing is lost that was
there. A particle stays lower case only *between* two words, since `el` is a
preposition in `Yacoub el Mansour` and the start of the name in `El Jadida`,
and a trailing token is far likelier to be a region than a preposition.

**Only a uniformly-cased value is touched.** Mixed capitals are a choice
somebody made, and rewriting them would mean deciding that
`St-jean-sur-richelieu` is wrong while `St-Gallen` is right. 5 records are
sloppy rather than deliberate — `Arendal, norway`, `Darwin, aus` — and are left
as stored.

**Where the case rule reads a word boundary matters more than it looks.** FIVB
stores `Poltana (URSS)` and `AKTAU,KAZAKHSTAN` as single space-free tokens.
De-shouting them by lower-casing and then capitalising only after a start,
hyphen or apostrophe published `Poltana (urss)` and `Aktau,kazakhstan` — a
different mistake from the one being fixed. A part now starts at any letter not
preceded by another letter.

A four-letter acronym still loses: `LENINGRAD, USSR` publishes as
`Leningrad, Ussr`, because the length gate calls anything from four letters up
a word. Raising the gate would re-break `Juiz de Fora (BRA)`; an acronym
allowlist would be a third rule for a handful of records.

**Handled in.** `ingest/build.ts`, `tidyBirthPlace`, with the published
artifact asserted in `build.test.ts` — no empty string, no bare date, no bare
postcode, no internal note, nothing shouting, nothing entirely lower case, and
the codes still present.

The bracket rule is pinned by a unit test rather than by the published tree,
deliberately: once it is fixed, a repaired `Poltana (Urss)` and a genuinely
sloppy `Arendal, norway` are the same shape in the output, so an assertion over
the published places cannot tell them apart and would pass whatever the rule
did.
## 6.7. FIVB names the Olympics six different ways

The eight Games in the archive carry five naming conventions between them, and
two of the editions never say where they were held:

```
1996  "Atlanta"
2012  "Olympic Games 2012"                          no city anywhere
2016  "Men's Olympic Game - Rio 2016"               city, gender, and a typo
2021  "Tokyo Olympic Games - Men's Tournament"      city, gender, no year
2024  "Olympic Games Paris 2024 - Beach Volleyball"
```

**The city is in the code, not the name.** `MLON2012` says London where the
name never does. But the codes are inconsistent too — `MATL1996` and
`MLON2012` follow one shape, `Rio2016M` another — so parsing them is no more
reliable than parsing the names.

**Keyed by season instead.** There is exactly one Olympic Games per season, so
the season is a complete key, and it does not require guessing the code FIVB
will invent for an edition that has not happened. `ingest/olympics.ts` maps
season to the official designation; anything not in the map keeps FIVB's own
name, which is worse-looking but never wrong. **Los Angeles 2028 and Brisbane
2032 are already in it** — both hosts are settled, neither has a tournament in
VIS yet, and keying by season means adding them cost nothing and risked
nothing.

**Watch 2021.** The Tokyo Games were postponed a year. The archive files them
under season **2021** and they are officially **Tokyo 2020**, so the label and
the season deliberately disagree — the timeline shows the season in its gutter
and the name beside it, which is the one place a reader gets both.

`BeachNbSelOG` is not a usable count of Olympic appearances, incidentally. It
reads **0** for Pablo Herrera, who has played six Games, and 3 for Natalie
Cook, who has played five. Appearances are derived from the results instead.

## 6.8. The World Championships stopped naming their host in 2015

FIVB named the first ten editions after the host city and nothing else, then
stopped. The 32 published rows — 16 editions, a men's draw and a women's for
each — break down like this:

(**Sixteen editions, starting 1997.** Ten more men's editions were held in Rio
de Janeiro between 1987 and 1996, and they are deliberately not here: the public
record treats those as the *unofficial* championships, and the first official
edition is Los Angeles 1997. VIS files all of them as ordinary World Tour Opens
— `Type` 1, the same value as Enoshima 1989 or Sète 1990 — which is what
`tiers.ts` publishes them as. See §19: that whole era is also where the ranged
`Season` values live.

Careful with the word *unofficial*. Wikipedia describes them as "not organised
by the FIVB", and this section used to repeat that — but VIS stamps
`OrganizerType` 1, FIVB, on **all 100 rows played in 1987–1996**, these
included, and `tierFor` only admits a tournament *because* of that value. So
FIVB's own database does claim them. What the record actually supports is the
narrower "not FIVB's official championships": `Type` 4, the World Championship
value, is never applied to a Rio row in this window.)

```
1997-2013, 2017  "Los Angeles" / "Vienna"                 the host, on its own
2015             "Beach Volleyball Men WCHs"              no host anywhere
2019             "WCH Hamburg"                            prefixed
2022             "Rome World Championships"               suffixed
2023             "World Championships 2023 - Tlaxcala Mexico"
                 "World Championships 2023 - Tlaxcala, Mexico"   men vs women
2025, 2027       "FIVB Beach Volleyball World Championships"     no host anywhere
```

**Unlike the Olympics, the code does not rescue it.** `MLAX1997` carries Los
Angeles, but from 2017 every code is `MWCH####` or `WWCH####` — the shape that
finally became consistent is the one that dropped the city.

**Nor do the location fields.** Three look like they should supply the host,
measured across all 32 rows:

- **`DefaultCity`** is populated on **4** of them — 2022 and 2025 only.
- **`CountryName`** is populated on all 32, but names a country.
- The per-match **`City`** is empty for every edition through 2013, reports
  three separate towns for 2023 (Tlaxcala 56 matches, Apizaco 27, Huamantla
  25), court-suffixed strings for 2025 (`Adelaide (CC)`, `Adelaide (2)`,
  `Adelaide (3)`), and nothing at all for an edition not yet played. It also
  costs one request per tournament.

**Keyed by season, same as the Olympics.** `ingest/worlds.ts` maps season to
host; anything not in the map keeps FIVB's own name. The value is the bare host
rather than "Hamburg 2019", because that is how FIVB itself named ten of the
sixteen, and because the row already carries a "Worlds" badge with the season
in the timeline gutter beside it.

**Four editions had no single host city**, and each takes the smallest label
that contains the whole event rather than one of its towns:

```
2001  Klagenfurt / Maria Wörth / Velden                 "Klagenfurt"
2015  The Hague / Amsterdam / Apeldoorn / Rotterdam     "Netherlands"
2023  Tlaxcala / Apizaco / Huamantla                    "Tlaxcala"
2027  the 2015 four again                               "Netherlands"
```

Tlaxcala is the state the other two towns sit in as well as its own capital, so
it contains the edition; the four Dutch cities are in four provinces, so only
the country does. 2001 keeps Klagenfurt because that is what FIVB chose to call
it — deciding a multi-city edition needs a broader label is only this map's call
where FIVB left the question open.

The per-match `City` field is what established this, and it agrees with the
public record: 29 matches in The Hague against 25 each in Amsterdam, Apeldoorn
and Rotterdam for 2015, and 56 in Tlaxcala against 27 in Apizaco and 25 in
Huamantla for 2023.

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
Measured across all 9,270 tournaments VIS returns (re-measured 2026-08-30; the
shape has not moved):

| Field | Populated |
|---|---:|
| `StartDateMainDraw` | 9,270 (100%) |
| `EndDateMainDraw` | 9,270 (100%) |
| `StartDateQualification` | 2,754 (30%) |
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

## 19. `Season` is sometimes a range, not a year

**What.** `BeachTournament.Season` reads `2024` on almost every row — and
`"1987-91"`, `"1995-96"`, `"1993-94"` on **70 of the 9,270**. A cross-year
season is ordinary in a sport that runs through a southern summer; `"1987-91"`
is not a season at all, it is five of them in one bucket.

`parseSeason` keeps the leading four digits, so every row in that bucket
publishes as season **1987**, including events played in 1988, 1989, 1990 and
1991. That is a deliberate choice and its comment says so — `Number("1987-91")`
is `NaN`, which would drop the events entirely — but the cost of taking the
first year had never been measured. It is: **71 qualifying rows carry a ranged
`Season`, and 26 of them were played in a year other than the one we publish**,
off by one to four years.

The Rio de Janeiro series is the clearest case, and it is visible in the codes:

| Code | Published season | `StartDateMainDraw` |
|---|---:|---|
| `MRIO1987` | 1987 | 1987-02-17 |
| `MRIO1988` | 1987 | 1988-02-20 |
| `MRIO1989` | 1987 | 1989-02-18 |
| `MRIO1990` | 1987 | 1990-02-13 |
| `MRIO1991` | 1987 | 1991-02-12 |

Five annual editions, five correct codes, one season between them.

**The ranges are exactly the pre-1997 archive.** All 70 of them were played
between **1987 and 1996**, and no row outside that window has one. That is the
era before FIVB ran a World Championship: the ten Rio de Janeiro editions above
are the *unofficial* championships, and the first official edition is Los
Angeles 1997 (§6.8, and why `worlds.ts` starts there — including the caveat
there about who actually organised them).
A block of years rather than a season per year is what back-filled records of
somebody else's events look like — which is a reason to trust the dates over
the bucket, not merely a licence to.

**Not the same thing as a wrong code.** Of the 29 codes whose year differed from
the published season, 25 were this — the code right, the season coarse — and
they agree now. Six disagreements remain and all are explicable: `WCAR1991` was
played in August 1994 and `MCAP2023` / `WCAP2023` in November 2020, which are
genuinely mis-coded; the two Tokyo rows are named for 2020 and were played in
2021 (§6.7); and `MSAN1995` is a January 1996 event whose code names the season
it opened rather than the year it ran.

**The offset gave it away twice over.** `startOffset` is days from 1 January of
the season, and is documented as two or three digits. While the range start won,
**18 rows ran to four** — `MSYD1991` sat **1,533 days** after the 1 January of
the 1987 it was filed under. A field cannot be that far into its own season.

**Handled in.** `seasonFor` in `ingest/build.ts`. A ranged `Season` defers to
`StartDateMainDraw`, which is populated on every row (§14) and, on all 70 of
these, lands inside the range the season itself declares — so the range is the
bound, and a date outside it leaves the start in place. A **single-year**
`Season` still wins over its date, deliberately: a southern season opens in the
previous December, so an event dated 2019-12-05 in season 2020 is filed exactly
right, and `startOffset` goes negative to say so. Only a range has lost
information.

25 tournaments moved, which corrects the careers built on top of them: Paulo
Roberto "Paulão" Moreira da Costa published as 1987–2003 and is 1990–2003, his
earliest event being the Rio de Janeiro of February 1990. No four-digit offset
survives.

**The dates themselves are sound**, which is worth stating because it is what
makes deferring to them safe. Every edition in the series carries a specific
range of a plausible length, and they check out against an outside reader of the
same API: `WRIO1995` is `1995-03-02` to `1995-03-05` in VIS and 02–05 March 1995
on `fivb.12ndr.at`. Only the season was ever coarse.

```
MRIO1987  1987-02-17 → 02-22    6 days
MRIO1991  1991-02-12 → 02-23   12 days
WRIO1995  1995-03-02 → 03-05    4 days
WRIO1996  1996-02-28 → 03-03    5 days
MRIO1996  1996-01-01 → 01-02    2 days   <- the exception
```

**`MRIO1996` is the one bad date in the series, and it is confirmed wrong.**
VIS dates it `1996-01-01` to `1996-01-02`. It was played **8–11 February 1996**,
per [bvbinfo](http://bvbinfo.info/TeamPreview?TournID=624&ID1=409&ID2=597),
which lists it as the Brazil Open in Rio de Janeiro on those dates. That is a
hand-compiled database rather than another reader of this API, so unlike the
12ndr check above it is genuinely independent evidence.

Everything about the VIS row already pointed that way. A **1 January** start
occurs on 2 of the 9,270 rows in the whole archive — this and `MDOH2022` — its
two-day main draw stands against 4 to 12 for every other edition, and the
women's 1996 draw sits in late February where the men's editions always sat.
The real dates are four days in February, which is exactly the shape of the
rest of the series. It is a placeholder typed in when the day was not to hand.

There is no ambiguity about which event it is: `MRIO1996` is the only men's
Brazilian tournament VIS holds for 1996 before April.

It costs us almost nothing: the season is 1996 either way, and only the event's
position within that season on a card is affected. It is on the upstream list
because it is a one-field correction somebody at FIVB could make in a minute,
and because the right value is now known.

---

## Reporting these upstream

Most of the above is ours to work around. These are the ones worth raising with
FIVB if a channel opens up (see the contact address in `web/src/site.ts`):

- **§1**, National Tour events carrying `OrganizerType` 1, which looks like a
  data-entry inconsistency rather than a deliberate classification.
- **§6**, whether anything in VIS records which federation an athlete
  represented and from when.
- **§7**, the `SMA` test records sitting in production player data.
- **§19**, the three tournament codes whose year contradicts their own dates —
  `WCAR1991` played in 1994, `MCAP2023` and `WCAP2023` in 2020 — and
  `MRIO1996`, dated 1–2 January 1996 when it was played 8–11 February 1996.
- **§6.5**, names shouting in all capitals or carrying a nickname inside the
  surname field — `Ramos Alexandre "Tande" Samuel` is one person, one field.
- **§6.6**, `BirthPlace` values that are dates, postcodes or internal merge
  notes rather than places.
- **§6.7 and §6.8**, championship editions whose names never say where they
  were held. A request rather than a defect report: a populated `DefaultCity`
  on the Olympics and the World Championships would retire two hand-maintained
  maps here and help every other consumer of the archive.

Everything in this list is worked around already. Raising them is about the
archive being better for everyone reading it, not about unblocking this site.

**The draft introduction email covers the first three only.** It is
`docs/fivb-email.md` on the unsent branch (task #12), written before the name,
birth-place and championship-naming quirks were found. Anyone picking that task
up should add the last three to its "would a list of data issues be useful"
section before sending — it already offers exactly that list.
