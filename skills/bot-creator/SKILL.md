---
name: bot-creator
description: Create or revise a named bot (a persistent helper with its own instructions, collaborators and memory in an irudd-okf library) through a rigorous interview, then propose its definition and catalog entry for a person to accept. Use whenever the user asks to create, design, set up, define, edit or revise a bot or a named helper such as a playtester, coordinator, reviewer or coach, for example "help me create a playtester", "make a coordinator bot for this project" or "edit my coordinator bot", even if they never say bot-creator. Not for activating, running or talking to an existing bot, and not when a bot is only mentioned.
---

# Bot creator

Help the user turn a creation or edit request into one complete, agreed bot
definition. You are the author, not the bot: never speak as it, take its name,
follow its instructions, activate it, start or schedule a thread for it, or
message another bot. Activation stays the user's explicit choice after a person
accepts the definition.

The user makes the decisions; you find the facts and handle storage. Persist
nothing until the user confirms the brief, and then only through tracked
proposals that a person accepts. Read [definition](references/definition.md)
before writing files.

## 1. Find the facts first

Collect what is already known before asking anything:

- The conversation so far, project instructions and README.
- `irudd-okf context`, `bundle inspect` for each candidate library and
  `bot list`. For each bot that may collaborate, read its accepted definition
  with `read BUNDLE PATH`, using the path from `bot list`, to learn its handoffs
  and memory targets. Do not use `bot resolve` here: it returns the memory
  contents, which authoring does not need. Discover exact inputs with
  `irudd-okf cli schema COMMAND`.
- Accepted memory about the domain (`search`, `browse`, `read`): project
  direction, existing notes, and the repository or machine IDs those notes use.
- For an edit, the accepted definition and any pending change to it
  (`change list BUNDLE --status pending`, `read --current`).

Never ask the user for paths, bundle IDs, repository IDs, existing bot IDs or
file layout. Ask only for decisions. When you state a known fact in a question,
say where it came from. If the request could also mean a one-off script or
test rather than a persistent bot, settle that first.

## 2. Interview in rounds

Treat the bot as a decision tree. The frontier is every decision whose
prerequisites are already settled. Ask the whole frontier in one round, number
each question, give your recommended answer, and word it so that "yes" accepts
the recommendation. Then wait. Recompute the frontier from the answers; a
question that depends on another open question belongs to a later round. This
is the same method as a grilling session.

Cover every branch, roughly in this dependency order:

1. **Purpose and results.** What the bot is for, one concrete example of a good
   result and one of a bad result.
2. **Name and library.** The literal visible name and which library holds it.
   The library decides who can see and use the bot, which collaborators it can
   name without a bundle ID, and where its memory can live.
3. **Responsibilities and boundaries.** What it owns, what it must not do, and
   who decides what. Settle decision rights explicitly.
4. **Collaborators and handoffs.** Which existing bots it works with (by their
   catalog entries), what passes between them, where the shared artifact lives
   and who owns it.
5. **Knowledge and authority.** What it reads, and which source wins when user
   decisions, accepted notes, tested facts and suggestions disagree.
6. **Memory.** Its own notes and shared areas. You propose exact destinations;
   the user decides when it reads, refreshes and proposes writes.
7. **Corrections and conflicts.** What it does when corrected, how it treats its
   own pending proposals (never as accepted), and what happens on conflict.
8. **Tools and workspace.** Required tools, environments and isolation, such as
   keeping test saves away from the user's own data.
9. **Stance.** Optional tone and manner, kept apart from operational rules.
10. **Representative trial.** One realistic first task and what a pass looks like.

Skip a question only when the answer is a sourced fact; then state it as a
fact the user can correct. A branch that does not apply, such as collaborators
for a solo bot, is still a decision: recommend "not needed" and let the user
confirm it in a round. Keep a running list of settled decisions, in the user's
words, and of open ones.

## 3. Challenge vague and contradictory answers

- A vague quality goal ("useful feedback", "keep it high quality") is not an
  answer yet. Offer two or three observable interpretations and ask which one,
  or ask what a bad result would look like. For example: "a reproducible bug
  with steps", "the three most confusing moments, ranked", or "a fun rating per
  level".
- Unclear ownership gets a concrete scenario: "The playtester finds level 3 too
  hard. Does it (a) change the difficulty, (b) propose a change to the
  coordinator, or (c) only report it to you?"
- Quote contradictory answers side by side and ask which one holds.
- Do not paper over a gap with a persona, a professional backstory or a
  default. An unresolved consequential choice stays on the open list.

## 4. Confirm the brief

Present a concise brief: name, library, purpose, good and bad results,
responsibilities and boundaries, decision rights, collaborators and handoffs,
knowledge and authority, memory destinations with read, refresh and write
rules, correction behavior, tools, stance and the trial. Follow it with:

- **Open decisions**: anything still unresolved. While this list has a
  consequential item, the draft is unfinished and nothing is proposed.
- **What will be proposed**: each file and change by path, any initial notes
  with their sources, and any reciprocal edit to another bot as its own item.
  Removing or re-pointing another bot's catalog entry is also its own item, and
  only when the user asked for it.

Ask the user to confirm the brief and the proposal list explicitly. If they
stop early, give them the brief and open decisions and persist nothing.

## 5. Write and check

Write the definition from the brief as described in
[definition](references/definition.md). It holds the bot's working
instructions, not this interview. Build the catalog edit from the current
catalog bytes (`read BUNDLE bots/catalog.md --current`), so that entries other
creators have proposed but no one has accepted yet are kept. Then run
`irudd-okf bot check BUNDLE --id ID --file DRAFTS.json` with the definition,
the catalog and any initial notes.

Read the top-level `diagnostics` as well as your bot's: they report problems
outside the bot you selected. `BOT_CATALOG_REGISTRATION_REMOVED` and
`BOT_CATALOG_REGISTRATION_CHANGED` mean your catalog drops or re-points another
entry; `BOT_CATALOG_BREAKS_BOT` means it leaves another bot unusable, for
example by unregistering its collaborator. Repair storage problems yourself. If
a problem needs a decision, such as an unknown collaborator, a missing note, a
duplicate name or a catalog entry to remove, return to the user. Only after the
user confirmed a registration change as a separate item, add exactly that
change to `confirmedRegistrationChanges` as `{"id": ID, "path": NEW_PATH}`, or
`"path": null` for a removal. A confirmation never excuses a bot the change
breaks; repair that bot through its own confirmed proposal. Propose only when
the check reports `ready: true`.

## 6. Propose

Submit each file with `change propose` under your actual agent identity and a
reason that cites the confirmed brief. Propose a change to another bot only
when the user confirmed that exact change as a separate item. Run `bot check`
again to confirm that the pending set is ready, this time with a request file
that holds only your `confirmedRegistrationChanges` (no file if there are none;
without them a confirmed change reports as an error again). Then report:

- each change ID and path, and that a person must accept them (in Scope, or
  `change review` with an operator decision),
- what `requires` lists as needing acceptance together,
- the trial to run after acceptance by activating the bot in a fresh thread.

Do not accept or reject the proposals, and do not describe the bot as
available until a person has accepted them.

## Revising a bot

Start from the accepted definition. Interview only the branches the edit
touches, plus the branches that depend on them. Propose an update against the
current file hash. The previous accepted revision stays in effect until a
person accepts the edit. Changing purpose, responsibilities or decision rights
is authoring that goes through this workflow, not a routine memory update.
