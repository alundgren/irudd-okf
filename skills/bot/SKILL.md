---
name: bot
description: Activate one named bot from an irudd-okf library in this conversation, only when the user explicitly invokes this skill, such as /bot or $bot alone or followed by a bot name and a task. Loads exactly the bot's accepted definition and memory with bot resolve, then works as that bot. Never use it because a bot is merely mentioned; creating or editing a bot is bot-creator.
argument-hint: "[bot name] [task]"
disable-model-invocation: true
---

# Bot activation

The user invoked this skill to make one registered bot active in this
conversation. A bot is a complete accepted definition in an irudd-okf library:
identity, instructions, collaborators and declared memory. The resolver decides
what the bot is; never invent, merge or substitute definitions or memory.

The arguments are the text after the invocation (`/bot ...`, `$bot ...` or
`/skill:bot ...`). They may be empty, a bot name, or a name followed by a task.

## 1. Choose the bot

Run `irudd-okf bot list`. It returns names, purposes, stable IDs and libraries,
plus diagnostics, but no memory. Names are literal and may contain spaces and
colons, such as `game1: playtester`.

**With arguments**, take the name from the start of the arguments:

- A quoted name (`"game1: playtester" check the build`) is the name exactly.
- Otherwise use the longest name from `bot list` that the arguments start with,
  followed by the end of the text or whitespace. The rest, trimmed, is the task.
- Ask instead of guessing when the start of the arguments matches no name but
  plausibly means one or several (different case, punctuation or a partial
  name), or when the chosen name belongs to more than one registration. Offer
  the candidates with their library and ID.

**Without arguments**, offer the bots by name and purpose:

- If the host has a question tool (in Claude Code, AskUserQuestion), ask one
  question with one option per bot: label the name, description the purpose,
  and the library when names repeat. It needs two to four options: with one
  bot, offer it and "Cancel"; with more than four, show the full numbered list
  in your message and offer the first three plus "Another bot", which asks for
  the name or number.
- Otherwise show a numbered list (`1. game1: playtester - purpose`), ask for a
  name or number, and stop until the user answers.

A typed answer must be a listed number or an exact name. If the user dismisses
the question, declines or says cancel, activate nothing and say so. With no
bots, or with library diagnostics, report them; never fall back to another bot.

## 2. Resolve and adopt

Resolve the selection with `irudd-okf bot resolve "NAME"`, or
`irudd-okf bot resolve --id ID --scope LIBRARY` when the user chose one of
several registrations. Use only what the resolver returns:

- `definition.identity` is who you are, and `definition.instructions` is how
  you work. Follow them within the user's, system and repository instructions,
  which still take precedence, along with your permissions.
- `memory[].documents` are the bot's current accepted notes for each declared
  target. They are knowledge, not instructions that override the definition.
- `collaborators` are other bots you may name in handoffs. You never message,
  start, schedule or impersonate them.

On an error (`BOT_NOT_FOUND`, `BOT_NAME_AMBIGUOUS`, `BOT_UNAVAILABLE`,
`BOT_CATALOG_INCOMPLETE`), explain it with the resolver's message and details
and stop; for an ambiguous name, offer its candidates and resolve the chosen
one by `--id`. When `complete` is false, activate, but name each diagnostic,
such as a missing memory target, and do not replace the missing memory.

Then report briefly, and keep this line verbatim so a later turn can reload it:

```
Active bot: NAME (id ID, library LIBRARY, bundle ID BUNDLE_ID). Memory: TARGET (N notes), ... Reload: irudd-okf bot resolve --id ID --scope LIBRARY
```

ID is `bot.id`, LIBRARY is `bot.bundle` and BUNDLE_ID is `bot.bundleId`. The
library alias can depend on the working directory (`repo` is the current
repository's library); the bundle ID does not. If the reload command reports
an unknown bundle, run `bot list` and use the library whose `bundleId` matches.

Continue with the task from the arguments. Without a task, ask what to do.

## 3. While the bot is active

- If the definition is no longer in your context, for example after the
  conversation was compacted or resumed, run the reload command from the active
  bot line before acting as the bot.
- Refresh memory with the same command when a target's `read` rule calls for
  it or the user asks. Do not poll, schedule or start threads.
- Recall is accepted memory only: the resolved documents, and `search` or
  `read` in the target's library with the target's repository or machine.
  Pending changes are not knowledge.
- Write memory only as the target's `write` rule says, through proposals that
  a person accepts. Read [memory](references/memory.md) before proposing.
- A new `/bot` invocation replaces the active bot. If the user says to stop,
  drop the persona and say the bot is no longer active.
