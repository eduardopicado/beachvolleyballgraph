# The FIVB introduction email

Task #12. Not sent yet. Kept as a file rather than a task-list line so the
wording survives, and so the field request below can be reviewed before anyone
clicks send.

**To:** the address the VIS SDK gives for developer accounts — see
[Application identifier](https://www.fivb.org/VisSDK/VisWebService/Application%20identifier.html).
The published page renders the address as an obfuscated mailto, so read it off
that page rather than trusting a copy here.

**From:** `beachgraph@picado.com.br` (the same address VIS already sees in our
`User-Agent` on every request, and the one published on the site's About page).

---

**Subject:** Hello from beachvolleyball.com.br — a few questions about VIS

Dear FIVB,

My name is Eduardo Picado and I run a small site called
**beachvolleyball.com.br**. It grew out of a simple curiosity — who has played
with whom — and turned into something bigger than I expected: the whole beach
archive since 1987, drawn as partnership graphs, one per federation, where you
can click a player and see every partner they ever had and follow the chain
outwards. It is free, has no advertising, and I am not trying to make money
from it. VIS is credited as the source on every page.

I should say first that I know how unusual it is for a federation to publish
its archive at all, let alone document it as carefully as the VIS SDK does.
Most of the sport's history simply would not be visible without it, and I am
grateful.

The ingest runs once a day. It sends a `Fields` list on every request, uses
POST rather than GET, and identifies itself with a contact address so you can
reach me directly if it ever causes you trouble:

```
beachvolleyballgraph/1.0 (+https://beachvolleyball.com.br/about/; beachgraph@picado.com.br)
```

I have four questions, one offer and one request for permission, and I have
tried to keep all of them small.

**1. May I have an application identifier?** The documentation asks that every
application send one in `X-FIVB-App-ID`, and at the moment I send none, which
makes me an anonymous client when I would rather not be.

**2. What do the beach agreement dates actually contain?** This is the one I am
least sure how to ask, so let me explain the problem first.

`Player.FederationCode` is a snapshot of today, which means the site sometimes
describes a partnership with a country neither player represented at the time.
Pedro Solberg and Tiago De J Santos played one event together in 2005, both
Brazilian — but because Tiago later moved to Qatar, my site filed a
Brazil–Brazil partnership under Qatar. `BeachTeam.FederationCode` fixes most of
these, because it records what was true at the entry itself. What it cannot fix
is when a federation change reaches backwards: Taiana Lima has two 2010 entries
tagged AZE alongside two BRA entries for the same events, because her partner
moved to Azerbaijan in 2015. I currently resolve that with a rule of thumb, and
a rule of thumb is an uncomfortable thing to have deciding which country an
athlete represented.

I noticed `BeachAgreementDate`, `BeachAgreementDate2`, `BeachAgreementDateCF`
and `BeachAgreementValid` in the documentation, and wondered whether they might
help. But reading more closely I am not sure they would, and I would rather ask
than assume:

- They sit on the player record, so I imagine they describe present agreements
  rather than a history.
- There are two dated slots. Would an athlete who has represented three
  federations overflow them? (In the public archive I can only find one who
  might, and that turns out to be a federation rename rather than a third move.)
- Nothing I can see records *which* federation each agreement was with — so a
  date alone would tell me when something was signed, but not what it changed.

So the honest question is: **is there anywhere in VIS a record of which
federation an athlete represented, and from when?** If those four dates are the
closest thing and they carry no federation, that is a genuinely useful answer
and I will document the limitation on the site rather than publish a guess. If
there is something better, I would rather ask for that instead.

**3. Is there a stable public URL for a tournament?** `BeachTournament.Code`
(`WGST2002`, `MBUS2026`) looks like the durable public handle, and I would like
to send readers to your own page for an event rather than keeping them on mine.
If there is a URL pattern you intend to keep stable I will use it; if there is
not, I will not invent one.

**4. Would a list of data issues be useful to you?** Reading the archive this
closely turns up a handful of records that look wrong rather than merely
surprising, and it seems a waste to notice them and say nothing.

Eleven events have a single pair entered twice under two different federations.
The clearest is Taiana Lima and Vivian Cunha at 2010 Gstaad, entered both as
BRA (team 509566) and as AZE (team 885720) — and the Azerbaijani rows carry
team numbers issued alongside Vivian's *2015* registrations, so they look like
a later change that reached back onto old entries. Taiana is Brazilian and has
no other Azerbaijani record anywhere in the archive.

There is also test data in the live player list — 19 records including
`Test Test` (SMA, ARU), `Dummy1 Dummy1` through `Dummy 4 Dummy 4` (AUT),
`Test Player First Name Test Player Last Name` (AFG) and
`Test RealWinner2 Test RealWinner1` (SUI). One of the Austrian dummies is
entered alongside a real athlete at a national tour event — `Dummy1 Dummy1`
partnering Markus Groeber at Innsbruck 2018 (`NAUT0118`, team 935106), with a
recorded finish of 13th.

The player name fields have picked up the ordinary wear of thirty years of
hand-typing at a couple of hundred federations. Across the 130,988 records in
the player list: 6,500 have leading or trailing spaces, 5,737 have a `FirstName`
typed entirely in capitals, 982 have a nickname in quotation marks inside
`FirstName` or `LastName` even though `TeamName` already holds it, 476 have a
double space, and 8 have an empty `FirstName`. None of that is urgent and I
tidy all of it on my side before publishing.

The one I cannot fix downstream is name order, because nothing in the record
says which word is the given name. Alexandre Ramos Samuel — "Tande" — is player
`102071`, and his row reads:

```
FirstName = ' Ramos Alexandre "Tande"'   LastName = 'Samuel'   TeamName = 'Tande'
```

So `FirstName` + `LastName` renders as "Ramos Alexandre "Tande" Samuel". His
surname is in front of his given name, and the nickname is in the middle of
both. `TeamName` is correct. Whoever else is filed this way is invisible to me
— I can only spot it for players I happen to recognise — so it is worth a look
from your side if names are ever tidied in bulk.

A few team rows credit the wrong person. Three published partnerships pair two
players of opposite recorded gender within one federation, which cannot be
right because there is no mixed beach competition — and each turns out to be a
different underlying problem. Two are a straightforward `Gender` value that
contradicts every event the player entered. One is a duplicated athlete: Josue
Flores Garita partnered the same man at two consecutive under-21 events under
two different player numbers, `137511` (filed `W`) and `137596` (filed `M`),
which share a birthdate of 1993-11-03 and hold the same four name-parts in
opposite order. A similar cluster sits under `Hafid Ouchrif` (MAR), who has
four player records — `137685` filed `W`, `137686` and `137687` filed `M` —
while `Anas Diouri` has two, `137684` and `150076`.

The third is not a gender error at all. `MRIO1989` rank 21 pairs Jean C. Gaston
(`100156`) with Marion Marquet (`101084`), who was born on 1981-01-28 and would
have been eight years old at a senior men's event; her only other appearance is
Marseille in 2000. Two records look like they may be the intended ones and are
currently unused: **Luc Marquet** (`111850`, M, FRA, born 1970-04-15) and
**Jean-Christophe Gaston** (`111846`, M, FRA, born 1970-05-19), which is what
"Jean C." expands to and sits four numbers away. I want to be clear that this
last part is a guess — neither record has a single team row, and I have found
nothing outside VIS naming that pair — but if the original entry list still
exists somewhere, those are the two numbers worth comparing it against.

Beyond those three, the same athlete turns up under two player numbers more
broadly. Grouping the whole player list by birthdate and name (not requiring
the federation code to match, since that is sometimes the field at fault)
finds 14 pairs where both numbers reach a published graph as separate people —
one Ukrainian case spans four numbers, one Venezuelan case three. Separately,
five records filed under the placeholder federation `FIV` match a `CUB` record
on birthdate and name, each corroborated by a Cuban province in the `FIV`
record's own `BirthPlace` field — Camagüey, Villa Clara, Havana, Santiago de
Cuba. I have not included the wider candidate list this same check turns up
across other federation pairs, because most of those are not errors — England
and Great Britain records for a UK athlete's dual representation, or a
Yugoslavia record beside the Serbia one a dissolved country's athlete
naturally gets later — and I only want to hand you ones I have individually
checked.

Four tournaments have a code whose year contradicts their own dates.
`WCAR1991` was played 19–21 August 1994, `MCAP2023` and `WCAP2023` on 2–5
November 2020, and `MRIO1996` carries 1–2 January 1996, which reads as a
placeholder rather than a date — contemporary reports put that event in
February.

Six player records carry the word `SUSPENDED` inside the name itself, appended
to `LastName` and, on five of the six, replacing `TeamName` entirely — so the
short competition name VIS holds for Tim Hovland (`100131`) is currently the
word "Suspended". The others are `100051`, `100368`, `100873`, `100875` and
`100881`. That one looks like the cheapest correction in this whole list.

Seven `BirthPlace` values are not places: two postcodes (`30019`, `98278`),
three dates written as digits (`2003-01-02`, `17072010`, `05011992`), and two
internal notes that have ended up in the athlete's record —
`to be Merged with (#164181) as ` and `Duplicate`.

Fifty records hold two names and the word `or` inside a single name field, and
they are two different problems. Nine are Greek surnames awaiting one
romanisation decision each — `Ntompra or Dobra` and its siblings — where you
hold the original spelling that would settle them. Two have the answer already
attached: `100058` is Takeshi Matsumoto, born 11 May 1969, and `100126` is
Mikiyo Tada; bvbinfo commits to one name for each, and all ten of their
combined results match yours to the date, partner and placement. The sharp one
is `100157`, `Olivier or Philippe Rossard`, which is **two men under one
number** — the inverse of the duplication above. Its single row, Cap d'Agde
1991 (`MCAG1991`) alongside Jean C. Gaston, was played by only one of them, and
only your entry list for that event can say which. Worth looking at beside
`MRIO1989`, because that is Gaston's other row and the athlete recorded beside
him there is wrong too.

Twenty-seven team-entry rows from 2006–2008 credit Shelda Bede (`100926`) for
tournaments her younger sister, Shaylyn Bede (`103655`), actually played,
partnered with Agatha Bednarczuk. Unlike the Rossard case above, both records
are already correct and distinct — nothing here needs untangling, only
twenty-seven rows repointed to the right one of two real ids. Twenty-three are
provable without any outside source: `100926` carries two team rows at the
same tournament in the same week, one with Shelda's real partner finishing
where that partnership belongs and one with Agatha finishing far behind it —
one player cannot enter a tournament twice. The other four (`WALA2007`,
`WMRS2007`, `WESP2007`, `WSHA2007`) have no such companion row, so they are
not provable the same way, but they share the same wrong id, the same partner
and the same three-season window as the twenty-three that are.

Thirty-seven player records have a `FirstName` of exactly `"..."` — three full
stops where a given name should be — and thirty of those men played FIVB
events, so the entry lists that named them presumably still exist. An empty
field would carry the same meaning without putting a placeholder into every
consumer's display; ours sorted all thirty to the head of the alphabet until we
special-cased it. Three neighbouring records have a character mangled rather
than missing: `M…Ttus` and `B…Hme` read as Möttus and Böhme.

Two small things in the tournament records themselves. Eight events carry the
literal string `01` where a country code belongs, in both `CountryCode` and
`CountryName`: `MU212008` and `WU212008` (Brighton), `MU212009` and `WU212009`
(Blackpool), `MLON2013` and `WLON2013` (London), and `MBRI2026` and `WBRI2026`
(Bridlington). All eight are British venues, so the intended value is probably
`GB` — though I have not assumed it, since your own records distinguish England,
Scotland and Wales as separate federations and I would not want to collapse
something you keep apart. Separately, `MOST1995` (Ostende) has an
`EndDateMainDraw` of 19 August 1995 against a `StartDateMainDraw` of 17
September, so it ends 29 days before it begins; one of the two dates is out by
about a month.

Two tournament codes disagree with the tournament. `Rio2016M` and `Rio2016W`
put the gender letter at the end where every other code opens with it, and
`WWRS2022` — Warsaw 2022 Futures — is a field of 54 men under a `W`. Your own
`Gender` field has all three right, so this is a rename rather than a data
correction; it matters only because the code is the identifier anyone outside
VIS keys on.

Separately from the defects, one classification question: 68 National Tour
events carry `OrganizerType` 1, which normally marks an FIVB-organised event.
If that is deliberate I will read it as such; it looks more like data entry
than a decision, and it is the field I use to decide what belongs in an
international archive.

Last, a request rather than a defect. `DefaultCity` is populated on only 6 of
the 48 Olympic and World Championship tournaments, so for most editions nothing
in the record says where they were held — the name is "Beach Volleyball Men
WCHs" or similar. I maintain a hand-written list of hosts to fill that gap, and
so, I suspect, does everyone else working with the archive. Populating that one
field would retire all of those lists at once.

**5. What do `Status` and `Type` mean on a team entry, and may I have
`StatusDate` and `StatusText`?** I publish entry lists for events that have not
been played yet, and three things on `BeachTeam` decide what those pages can
say.

`Status` is the one I rely on most and understand least. I read 0 as a team who
is in the tournament, 2 as a withdrawal and 3 as a medical certificate. That
came from comparing your own published list for BPT Futures Corigliano Rossano
against what VIS returns for it on 10 September 2026: 45 rows at `Status` 0
against the 12 main draw, 16 qualification and 17 reserves your page showed, and
three each at 2 and 3 against the three withdrawals and three medical
certificates beside them. (Both sides have moved since — four more teams have
withdrawn — which is the nature of an entry list rather than a discrepancy.)
Status 1 appears to be an entry superseded by a later one, which you publish
nowhere. That reading fits every event I have checked, but it is a guess from
the outside, and if any part of it is wrong my pages are quietly saying the
wrong thing about somebody's withdrawal.

Two related questions follow from it. **Is there a published meaning for
`Type`?** I read 1 as a wild card, 6 as a qualification wild card, 9 as a
continental quota place and 10 as an open vacancy, decoded against the same
event, and I show those four as badges. Every other value I treat as "entered
on ranking" and show nothing, which is safe only if none of them means
something I ought to be showing. **And how is the main draw, qualification and
reserve split actually derived?** All 45 of those teams share `Status` 0, so
whatever separates the 12 from the 16 from the 17 is not in the rows I can see.
Ordering by `EntryPoints` and cutting at `NbTeamsMainDraw` reproduces your
split on most events and not all, so I currently do not draw the line at all.

Last, the small one. `StatusDate` and `StatusText` are documented on
`BeachTeam` as the date of the last status change and the text about it, and
neither is returned to me — not empty, absent, the same way an unknown field
name is. Your own site shows a reason beside each withdrawn team, so the text
is evidently there. Access to those two would let an entry list say when a team
pulled out and why, in your words rather than my paraphrase of a number.

**6. May I show your photographs?** This one is a permission request rather
than a question about the data.

`GetImageList`, filtered by `NoTournament`, returns the tournament photography
— 124 images for the 2008 Paris Grand Slam, 389 for Gstaad 2019 — each with a
caption written by whoever filed it, a timestamp, and `Copyright` set to FIVB.
Every one I have looked at carries `Publish="1"` and `AccessLevel="1"`, and
`InSlideShow` marks a selection somebody made by hand: 32 of the 389 at
Gstaad. Sampling fifty tournaments spread across the archive, the photography
runs from 2006 to 2021 and there is none on either side of that.

I would like to show a handful of them on each tournament page, credited to
FIVB and served from your own image service rather than copied — the same way
the site already shows player portraits. If that needs a licence, or a
different form of credit, or is simply not something you grant, please say so
and I will leave them out; I would rather ask than assume that
`Publish="1"` means what I would like it to mean.

The same records carry `NoPerson`, `TeamCode` and `NoMatch`, so the answer
would also decide whether a player's page can show a photograph of them
playing. I am asking about the whole set once rather than coming back per use.

I have not sent anyone an unsolicited bug report and I do not intend to start.
But if a list would be useful to whoever looks after VIS, I would be glad to
send what I have in whatever form is easiest to act on, and to keep sending
them as they come up. It costs me nothing — I have to find them anyway to
decide what my site should show.

**What I am not asking for.** I noticed while reading the field documentation
that the non-public `Player` and `BeachTeam` fields also include postal
addresses, telephone and mobile numbers, e-mail addresses, passport numbers and
expiry dates, bank account numbers, blood groups, medical and femininity
certificates and maternity dates, along with `LastChangeUser` and
`LastChangeUsername`, which identify your own staff. I do not want any of that
and would prefer not to be given it. Whatever comes of question 2, please treat
it as a request for dates and nothing else.

Thank you for reading this far, and for keeping the archive open.

With best regards,

Eduardo Picado
beachvolleyball.com.br
beachgraph@picado.com.br

---

## Notes for whoever sends this

**Check the address on the SDK page first.** It is rendered obfuscated in the
published HTML, so it is not reproduced here — following the link is more
reliable than trusting a transcription.

**Why the field list is short.** VIS applies access per field, not per request
(`GetPlayer` documentation: *"Only the fields you have access to will be
returned"*), which is why asking for `BeachAgreementDate` today returns a
response with the field silently absent rather than an error. Asking for four
named date fields is therefore a normal request within that model, not a
request for elevated access to the record as a whole. Saying plainly which
fields we do *not* want costs a paragraph and removes the obvious reason to
refuse.

**How we know `StatusDate` is withheld rather than empty.** The two look
identical from outside — both are simply not in the response — so the claim in
request 5 rests on a control. Asking for `StatusDate` and `StatusText`
alongside `EarningsTeam`, `WorldTourRanking` and `MainDrawSeed`, which are
public and empty on that row, returns the three empties as `""` and the other
two not at all, which is exactly how VIS treats a field name that does not
exist. A `Fields`-less singular request, which returns everything this caller
may see, gives 88 attributes for `BeachTeam` and neither is among them.
[fivb-vis-survey.md §1.5](fivb-vis-survey.md) has the full probe. Worth keeping
straight before sending: "you are not returning this field" is a different
sentence from "this field is empty", and only one of them is true.

**Why request 5 leads with the enums rather than the field access.** The two
dates are the small ask and the easy one to say yes to; the meaning of `Status`
and `Type` is the part that actually protects readers from being told something
false. Every value in that request was decoded by comparing FIVB's own
published entry list for one event against what VIS returns for it, and the
counts are quoted so they can check the reading in a minute rather than take it
on trust — the same footing as request 4. If the reply corrects even one of
those values, the mail has paid for itself.

**Those counts are dated, and they have to stay dated.** An entry list moves
every day until the deadline: Corigliano stood at 45 entered with three
withdrawals and three medical certificates on 10 September 2026, and four
teams had pulled out by the 12th. Every other number in this mail describes a
played event and is stable, so this is the one paragraph that ages — which is
why it names the day rather than claiming a present tense it cannot keep.
Re-checking it before sending is cheap; quietly refreshing the figures without
the date is not, because the whole point of request 5 is that they can
reproduce the comparison.

**The main-draw split is asked as an open question on purpose.** An earlier
attempt at it here asserted a rule — order by `EntryPoints`, cut at
`NbTeamsMainDraw`, cap three per federation — that reproduced one event exactly
and then failed across the archive; tested over 169 played Futures, a cap of
three, a cap of four and no cap at all are indistinguishable. So the mail says
the line is not drawn rather than proposing one, which is both true and the
version that cannot be wrong.

**Why request 2 asks a question rather than only asking for access.** An
earlier draft of this mail requested the four dates as though they were a
transfer record. They are probably not. They live on the player row, so they
are a snapshot like `FederationCode`; there are only two dated slots; and
nothing in the documented field list attaches a *federation* to either date.
Granting them might therefore hand us two timestamps we still cannot attribute.
Asking what they hold costs nothing, cannot be refused, and if the answer is
"that is all there is" then the limitation is confirmed by the only people who
can confirm it — which is worth more than the access would have been.

**If the answer is no**, the fallback is documented in
[fivb-data-quirks.md §6](fivb-data-quirks.md) — keep `BeachTeam.FederationCode`
for what it is worth, keep the season-majority resolver for the duplicate-row
case, and say in the interface that a federation is the one held today rather
than implying it was the one held then.

**One follow-up, then leave it.** Not because anyone is doing us a favour —
FIVB is the international federation and VIS is the system its competitions run
on, so the archive's accuracy is somebody's job there. But a second chase adds
nothing, and the ask is small enough that silence is a legitimate answer to it.

**Request 4 is the part most likely to get a reply.** The others ask for
something; the fourth offers something, and it is the one a person who cares
about the data will recognise as useful. If only one request survives an edit,
keep that one.

**Make the opening paragraph yours.** The rest of the mail can go as written,
but the first paragraph is the only part that says who is writing, and it
should sound like you rather than like a project description. If there is a
real reason you started this — a player you were curious about, a partnership
you could not find recorded anywhere — that sentence is worth more than
anything else in the mail.

**Every specific in it has been checked against VIS.** The team numbers, the
tournament codes, the nineteen test records, the name-field counts, the player
numbers in the wrong-athlete paragraphs, the four contradicted dates, the six
`SUSPENDED` records, the seven bad `BirthPlace` values and the Innsbruck finish
are all real and re-checkable, which matters: the mail asks them to trust a
stranger's reading of their own data, and a single wrong detail would undo that.
Tande's row is quoted exactly as `GetPlayer` returns it, leading space included.
The Innsbruck event is deliberately described as a *national tour* event rather
than an FIVB one — it is `Type` 15, `OrganizerType` 5 — because overstating it
would be exactly the kind of error the paragraph is warning them about.

Two numbers in that list were revised downward while checking. The
`BirthPlace` scan first returned nine, but `Bad Mergentheim` and `Ukmerge` are
real places that matched a pattern looking for the word "merge" — seven are
genuine. And an earlier claim that FIVB's test accounts had never been entered
in a tournament was wrong; ten of the nineteen have team rows, which is why the
mail says the Innsbruck entry exists rather than implying it is unique.

**The Marquet guess is labelled as a guess, deliberately.** Everything else in
request 4 is something I can show them in their own data. The suggestion that
`111850` and `111846` are the intended records is inference from a name, a
birth year and an adjacent id, and the mail says so in the same sentence. If it
is wrong it costs them one lookup; presenting it as a finding would cost the
credibility the rest of the list depends on.

**What request 4 now covers**, against the section numbers in
[fivb-data-quirks.md](fivb-data-quirks.md): §1 (National Tour under
`OrganizerType` 1), §6c (duplicate rows disagreeing on federation), §7 (test
records), §6.5 (name-field wear and name order), §6.5a (`SUSPENDED` in the
name), §6.6 (`BirthPlace`), §6.7/§6.8 (`DefaultCity`), §18 (wrong-athlete and
duplicated records), §19 (codes contradicting their dates), §20 (the same
athlete under two player numbers, checked individually rather than reported as
the raw candidate list), §21 (two names and the word `or`), §22 (`"..."` as a
first name), §23 (the gender letter in a tournament code), §24 (team rows
crediting one sister for the other's results) and §25 (the `01` country codes
and Ostende's reversed dates). That is the whole reporting list at the end of
that document. If a new one is found, add it here too.

**Request 6 is not on that list and never will be**, because it is not a
defect: the photographs are FIVB's to license and the ask is for permission.
It sits last deliberately — everything above it costs them nothing and offers
them something, which is the wrong footing to spoil by leading with a favour.
