# CLAUDE.md

## Read this first

**[docs/HANDOVER.md](docs/HANDOVER.md)** — what the project is, what state it is
in, and the six things that will bite you. It links the other four documents;
this file exists mainly to point at it, because nothing else does.

Most of what you need is already written down. The rest of this file is only
the conventions a new session cannot infer from the code.

## Who merges

**Open a pull request; do not merge it.** One PR per idea, the reasoning in the
commit message. The repository owner reviews and merges — including your own
work, including when CI is green and the change is trivial. Never merge, never
approve, never enable auto-merge.

When a PR of yours merges while you are still working, verify your last pushed
commit is actually an ancestor of `origin/main` before touching anything else,
and never push a follow-up onto a branch that has already merged: that commit
strands silently where nobody will look for it again.

**Subscribe to every PR you open, as you open it.** Nothing about a merge, a
CI failure or a review reaches a session that has not subscribed — a PR merged
an hour ago looks exactly like one nobody has touched, and the first sign is
the owner asking why you did not notice. Two PRs merged and one fell into
conflict before this was written down.

**PR titles and bodies are plain text, not HTML.** `&quot;` and `&#39;` arrive
on the page as those literal characters, so a title with a quote or an
apostrophe in it reads as mangled encoding to everyone who sees it. Write the
punctuation itself.

## Prove a regression test fails

A test written alongside a fix is worth nothing until you have watched it fail.
**Break the code the test guards and run it**, then restore. Check the total
test count is unchanged while doing so — a count that drops means you caused a
compile error, not the behaviour failure you were testing for.

This catches the assertion that passes on an empty list, and the one that
passes for a reason unrelated to the thing it names. Where a test guards a
boundary, break it in both directions: widening the rule and narrowing it
should each fail a different test.

## Numbers come from the archive

Already in HANDOVER, repeated because it is the convention most often broken
under time pressure: every count in a comment, document or PR description is
measured against live VIS data, not estimated. When a measurement contradicts
something already written down, the written thing is what changes.

## Design changes get a mockup first

Anything that changes how the site looks goes to the owner as a published
Artifact before it goes into a PR — real content from the archive, drawn in
both themes, with the options side by side. Declare the `artifact` capability
so the choice can be recorded on the page itself rather than in chat, and build
the static comparison first: the capability is granted per viewer and may not
resolve, and the page has to be readable either way.

**When the decision is about an interaction, make the mockup do it.** A
still of the finished state answers "what does it look like" and silently
skips "what does it feel like to open" — which is the actual question when
the options are a lightbox against an inline expansion, or a panel against a
nested list. The portrait and tournament mockups both drew the thing already
open, so the owner could compare two end states and could not click either
one; that is the half of the design they were being asked about.

A mockup is a page with a script in it, so this costs a few lines: make the
portrait open on click, the panel slide over on a tournament, the thing close
on Escape. Keep the resting state complete either way — the page still has to
read as a document to someone who never clicks, and to the first frame a
thumbnail captures.
