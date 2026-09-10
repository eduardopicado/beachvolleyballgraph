# What the VIS Web Service actually offers

A map of the upstream API: every request type that answers, every field on the
entities that matter, and which of them this project uses.

**Why this exists.** The ingest was built against the handful of requests it
needed, and nothing ever asked what else was there. That turned out to be a
lot, and the gaps surfaced one embarrassment at a time — a tournament `Title`
field found only while debugging a heading, a whole photographic archive found
only because the repository owner insisted it existed after this project had
reported, twice and confidently, that it did not.

This file is the answer to "what else is in there", written down once so the
next session does not have to rediscover it by accident.

**It is a survey, not a plan.** Nothing here is a commitment to use anything.
Several sections end in "and we deliberately do not use this".

---

## 1. The documentation is a subset of the API

FIVB publishes an SDK reference at
[fivb.org/VisSDK/VisWebService/](https://www.fivb.org/VisSDK/VisWebService/).
Its table of contents (`webtoc.html`) lists **17 request types**.

**The service answers at least 32.** Probed one request each, 43 candidates —
the 17 documented, the 6 this project already knew worked, and 20 systematic
guesses:

| | Count |
|---|---|
| Documented and answering | 17 |
| **Undocumented and answering** | **15** |
| Guessed and not a type | 11 |

The undocumented fifteen:

```
GetBeachTournamentList   GetPlayerList        GetImage         GetImageList
GetArticle               GetArticleList       GetDocument      GetDocumentList
GetPressRelease          GetFederation        GetFederationList
GetConfederationList     GetRefereeList       GetVolleyTournamentList
GetVolleyMatchList
```

**`GetBeachTournamentList` is on that list**, and this project's entire
tournament pipeline is built on it. So "not in the docs" says nothing about
whether a request works, and the docs cannot be used to rule anything out.
The only way to know is to ask.

Two quirks in the reference itself: `GetpressReleaseList` is spelled with a
lower-case `p` in the TOC, and `GetPressReleaseList` (capitalised) is what
answers.

**How to probe.** Send `<Requests><Request Type="X"/></Requests>` with no other
parameters and read the reply:

| Reply | Means |
|---|---|
| `<BadParameter id="1002">Type` | not a request type |
| `<ParameterMissing id="1009">Fields` | exists, needs a `Fields` list |
| `<ParameterMissing id="1009">No` | exists, needs a record number |
| a `<Responses>` payload | exists and answers bare |
| an ASP.NET `Runtime Error` page | exists; a bad `Fields` name or filter |

That last one is worth knowing: **a misspelled field name returns a 500 HTML
error page, not a structured error.** So does an unrecognised `<Filter>`
attribute. Neither is a sign the request type is wrong.

---

## 2. Rate limits, and the 503

This survey pushed the service into **HTTP 503** by making a few dozen
unpaced requests in a burst. It recovered within the hour. The image host is
separate infrastructure and stayed up throughout.

| Host | What it serves | Behaviour under load |
|---|---|---|
| `www.fivb.org/Vis2009/XmlRequest.asmx` | the XML API | 503s under a burst |
| `sharp.fivb.com/Legacy/GetImage` | every image, by number | unaffected, Cloudflare-fronted |

The daily ingest is a good citizen by design — three bulk list requests for
the whole archive, no per-record fan-out. **Any exploration should pace itself
at roughly one request a second and prefer a bulk list to a loop of singles.**
A survey of 43 request types plus 8 entity dumps is about a minute of work at
that pace and did not trip anything.

---

## 3. The entities, and what we use

Ask a singular request (`GetPlayer`, `GetBeachTournament`) with a record
number and **no `Fields` list** and it returns every attribute. That is how
the tables below were produced.

| Entity | Attributes | We read | Notes |
|---|---:|---:|---|
| `BeachMatch` | 99 | 0 | every score, set, duration, referee, venue |
| `Player` | 93 | 8 | see §4 |
| `BeachTeam` | 88 | 6 | prize money, seeding, world ranking |
| `BeachTournament` | 70 | 10 | see §5 |
| `Event` | 36 | 0 | groups the men's and women's draws of one event |
| `Federation` | 25 | 2 | via `GetFederationList` for names and codes |
| `Image` | 23 | 0 | see §6 |
| `BeachRound` | 14 | 0 | the bracket structure inside a tournament |

---

## 4. `Player` — 93 attributes, we read 8

We read `No`, `FirstName`, `LastName`, `Gender`, `FederationCode`,
`Birthdate`, `Height`, `Weight`, `BirthPlace`.

Populated across the **12,096 published players**, measured:

| Field | Populated | Worth having? |
|---|---:|---|
| `BeachPosition` | 100% | **No** — quirks §12: at least seven codes, and population tracks the federation, not the player. |
| `IsActive` | 100% | **No** — quirks §12: not beach-specific and not reliably updated. |
| `TeamName` | 100% | FIVB's own display name for the player. |
| `Handedness` | 97.4% | **Unconfirmed** — quirks §12: the 96:5 split is the right shape, but no code is checked against a known player. |
| `PopularName` | 29.6% | Almost certainly the source of what we publish as `short`. |
| `BeachYearBegin` | 12.8% | Year they started. |
| `BeachWhereBegin` | 5.5% | Where they started. |
| `WebSite` | 3.5% | |
| `NoCev` | 2.8% | Their id in the European confederation's system. |
| `Profile` | 1.2% | Free-text biography. |
| `InstagramUrl` | 1.2% | |
| **`PreviousNames`** | **0.5% (66)** | See below. |
| `NoPhoto` | **0%** | Empty on every published player. Not a lead. |
| `PortraitPhotoUri` | 100% | See below. |

Plus a long tail this file will not list: `FavoriteFood`, `NameSpouse`,
`PersonMostAdmire`, `WhyVolleyFavoriteSport`, `Pets`. FIVB collects a
questionnaire. It is almost entirely empty and none of it belongs here.

**`PortraitPhotoUri` is not a new lead — checked.** It resolves to
`http://www.fivb.org/Vis2009/Images/GetImage.asmx?Type=Player&No=<the player
number>`, which is the same URL this site already constructs, on an older
host. Sampled 40 published players and asked both: **both return an image for
exactly the same 10.** So the URL we build is right, and the field adds
nothing.

**`PreviousNames` does not replace `aliases.ts`.** It holds 66 former names
across the published set — `"Pavlinova"`, `"Lehmann"`, `"Kolosinska"`, and one
reading `"Married Name:  Ces"`, so the field is free text rather than a name.
The Wikidata join in `ingest/aliases.ts` finds 286. VIS's 66 are worth
cross-checking against those rather than replacing them, and the free-text
shape means anything taken from here needs parsing.

---

## 5. `BeachTournament` — 70 attributes, we read 10

The one that matters, because it was missed for a long time:

**`Title` is the event's full name.** `Name` is a bare venue —  `"Paris"` —
and `Title` is `"Paris Grand Slam 2008"`. Measured across all 1,688:

| | Count |
|---|---:|
| `Title` says more than `Name` | **668 (39.6%)** |
| identical to `Name` | 625 |
| a bare level word — "Satellite", "Challenger" | 27 |
| absent | 368 |

`Title` is **not** a general fix for the World Championships, though: it names
the host on only **14 of the 32** rows, so `ingest/worlds.ts` earns its place.
The first five editions have no `Title`, 2011 gives only "World
Championships", and 2013 says "Mazury" where the host is Stare Jablonki.
Quirks §23 has the rest.

Also unused and populated: `NbTeamsMainDraw`, `NbTeamsQualification`,
`CountryName`, `Deadline`, `StartDateQualification`, `NbWildCards`,
`DefaultVenue`, `Status`, `Logos` (see §6), `NoEvent` (see §7).

---

## 6. `Image` — the archive this project twice said did not exist

Images are **their own records that point at a tournament**, not fields on
one. Looking for image fields on `BeachTournament` finds nothing and proves
nothing, which is exactly the mistake that was made.

```xml
<Request Type="GetImageList" Fields="No TournamentCode Title TakenDT Copyright InSlideShow NoPerson NoMatch">
  <Filter NoTournament="319"/>
</Request>
```

`NoTournament` is the filter attribute; `Tournament` and `Code` both return a
500. That request returns **124 photographs of the 2008 Paris Grand Slam**,
captioned and timestamped to the second.

| Attribute | What it carries |
|---|---|
| `No` | the image number; `sharp.fivb.com/Legacy/GetImage?No=<n>&width=<w>` serves it |
| `Title` | a real caption — *"Jonathan Erdmann goes high as Germany's Sven Winter watches the outcome"* |
| `InSlideShow` | **FIVB's own editorial pick.** 32 of 389 on Gstaad 2019 |
| `NoPerson`, `TeamCode`, `NoMatch` | what the photograph is of |
| `TakenDT`, `Copyright`, `Credit` | provenance |
| `Publish`, `AccessLevel` | both `1` on everything seen so far |

**Coverage is 2006–2021 and nothing outside it.** Sampled 50 tournaments
spread evenly across the archive: none before 2006, none after 2021, and 22 of
the 50 in between, averaging about 460 images each. The upper edge is FIVB
moving to volleyballworld.com for the Beach Pro Tour.

The `Type` parameter on `GetImage` is ignored — `Type=Player`, `Type=Logo` and
no `Type` at all return identical bytes for the same `No`. Only the number
matters.

**Every image is `Copyright "FIVB"`, so none of this can ship without
permission.** That ask is in `fivb-email.md`.

Separately, `BeachTournament.Logos` and `EventLogos` hold image numbers for
**tour branding**, not events: 824 of 1,688 tournaments carry one, seasons
2012 onward, but only **38 distinct Competition images** between them. They
are the "FIVB Beach Volleyball World Tour" wordmark, reused. Not useful as
event identity.

---

## 7. `Event`, `BeachTeam`, `BeachMatch`, `BeachRound` — unused

**`Event` (36 attributes)** groups the men's and women's draws of one
tournament: `BeachTournament.NoEvent` points at it and its `Content` lists the
draws back. It also has `NoLogoImage`, populated on **4 events, all 2011** —
not a lead. Its `Info*` fields (`InfoHotels`, `InfoMedia`, `InfoSchedule`) are
organiser-facing and empty on everything sampled.

**`BeachTeam` (88)** is the row this project reads `Rank` and the two player
numbers from. It also carries **`EarningsTeam`, `EarningsTotalPlayer`,
`EntryPoints`, `TechnicalPoints`, `WorldTourRanking`,
`RankInFivbWorldRanking`, `MainDrawSeed`** and
`NbRank1InMajorTournaments`. Prize money and seeding are a whole dimension the
site does not have. Unmeasured for coverage — nobody has asked for them yet.

**`BeachMatch` (99)** is every match: set-by-set scores, durations, referees,
court, venue, spectators, even temperature and humidity. This project has
never fetched a match. A partnership graph does not need one, but a tournament
page showing a final's score would start here. Note `NoInTournamentForImages`,
which suggests matches and images are cross-referenced upstream.

**`BeachRound` (14)** is the bracket structure — 60,548 rounds across the
archive.

---

## 8. What this changes, if anything

Nothing here is scheduled. In rough order of value:

1. **`Title` for tournament headings** — 668 pages gain a real event name.
   Wanted by the tournament-page work.
2. **The photographs** — blocked on permission, not on availability.
3. ~~`BeachPosition`, `IsActive`, `Handedness`~~ — retracted. All three read as
   ~100% populated and none survive a QC pass: quirks §12 now covers all
   three. `IsActive` and `BeachPosition` are measurably wrong; `Handedness`
   is only a population-shaped ratio with no individual code confirmed. None
   of the three are a fact this site should assert about a real person.
4. **`PreviousNames`** — 66 names to cross-check against Wikidata's 286.
5. Everything else is real and unrequested.

---

## Method

Documentation first (`webtoc.html` and `webindex.html` are static files and
cost the API nothing), then one paced request per candidate type, then one
`Fields`-less singular request per entity to dump its attributes, then bulk
list requests to measure how populated the interesting fields are against the
published archive. Roughly 100 requests in total, spaced.

Counts here are measured, per the convention in HANDOVER — against the
published tree for "ours", and against live VIS for "theirs". Where a number
is a sample rather than a census it says so.
