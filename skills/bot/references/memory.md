# Proposing a bot's memory

A bot remembers through ordinary irudd-okf proposals. A person accepts them;
then another conversation that activates a bot with the same target sees them
on its next resolve. Nothing is accepted automatically.

## Where

Write only into a target the definition declares with a `write` rule that
allows it. Use the target's library alias from `memory[].bundle` in the
resolve output, and a path inside `target.path`: that note itself when the
path ends in `.md`, otherwise a note under that directory. Read the library's
index and the target's notes first, and search for a note that already covers
the observation; update it rather than adding a duplicate.

## Request

Write `request.json` outside the repository and run
`irudd-okf change propose LIBRARY --file request.json`. Check
`irudd-okf cli schema change propose` for the exact schema.

```json
{
  "path": "game1/playtester/2026-11-01-crash-on-load.md",
  "raw": "---\ntype: Observation\ntitle: Crash when loading a save\npersona: {bot: game1-playtester}\nmemory:\n  id: game1-playtester-crash-on-load\n  kind: episodic\n  stage: bronze\n  applicability: {type: repository, id: game1}\n---\nWhat was observed, when, on which build, and how it was verified.\n",
  "expectedHash": null,
  "actor": {"type": "agent", "id": "YOUR-ACTUAL-AGENT-IDENTITY"},
  "reason": "Verified playtest observation for the playtester's own notes.",
  "requestId": "a fresh unique ID, reused only to retry this same request"
}
```

- **actor** is the agent run actually writing: your harness and model or
  session identity. Never the bot's name or ID.
- **persona** in the note records which bot the observation belongs to.
- **memory** gives a stable unique ID, a kind, stage `bronze` for a new note,
  and the target's applicability: its `repository` or `machine`, otherwise
  global. A note with other applicability is invisible to the bot.
- **sources** lists accepted notes the observation relies on, if any.
- **expectedHash** is `null` for a new note. For an edit, use the hash from
  `irudd-okf read LIBRARY PATH --current` and build the new text from those
  current bytes, so a pending change by someone else is kept.

## Personal libraries

A personal library requires `--authorize-personal`. Add it only when the
installed personal-memory instructions or the user authorize proposals in
that library; otherwise ask first.

## Afterwards

- Tell the user the change ID, that it is pending, and who must accept it.
  Never review or accept your own proposal, and do not treat it as known until
  it is accepted; until then recall keeps the previous accepted revision.
- `CONFLICT` means the note changed since you read it. Read `--current` again,
  merge both contributions and propose again with the new hash. Your proposal
  then supersedes the earlier pending one, which history keeps.
- `HUMAN_DECISION_PENDING` means a person must decide an outside edit or
  another person's proposal first. Tell the user instead of retrying.
