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

The ingest runs once a week. It sends a `Fields` list on every request, uses
POST rather than GET, and identifies itself with a contact address so you can
reach me directly if it ever causes you trouble:

```
beachvolleyballgraph/1.0 (+https://beachvolleyball.com.br/about/; beachgraph@picado.com.br)
```

I have three questions and one offer, and I have tried to keep all of them
small.

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

Last, a request rather than a defect. `DefaultCity` is populated on only 6 of
the 48 Olympic and World Championship tournaments, so for most editions nothing
in the record says where they were held — the name is "Beach Volleyball Men
WCHs" or similar. I maintain a hand-written list of hosts to fill that gap, and
so, I suspect, does everyone else working with the archive. Populating that one
field would retire all of those lists at once.

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

**Request 4 is the part most likely to get a reply.** The first three ask for
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
[fivb-data-quirks.md](fivb-data-quirks.md): §6c (duplicate rows disagreeing on
federation), §7 (test records), §6.5 (name-field wear and name order), §18
(wrong-athlete and duplicated records), §19 (codes contradicting their dates),
§6.5a (`SUSPENDED` in the name), §6.6 (`BirthPlace`) and §6.7/§6.8
(`DefaultCity`). That is the whole reporting list at the end of that document.
If a new one is found, add it here too.
