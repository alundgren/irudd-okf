# Exact revision review

Use change read for review material and accepted read for current task guidance.
Submit expectedRevisionHash and the full recorded sources list. A source accepted
correction requires fresh review; a pending source draft retains accepted recall.
Human and agent decisions remain separately visible on each exact revision.
Conversational approval of a brief is stored on the acting agent's review as
`approval: {reference, scope, changes: [{path, revisionHash}]}`. It authorizes
execution within that scope without asserting that a human reviewed generated
bytes. Bind only the checked implementation; do not apply it to deviations or
unrelated pending work. Routine supported maintenance needs only agent review.
Rejection retains the draft in immutable history and restores accepted files.
