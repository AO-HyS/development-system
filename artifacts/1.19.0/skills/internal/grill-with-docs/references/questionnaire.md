# Shared HTML questionnaire

One HTML template, one JSON per round. Uses Python 3 standard library on macOS or
Linux; `cloudflared` is needed only for a public tunnel. No frontend installation.

## Prepare questions

Copy the shape in [questions.example.json](questions.example.json). Use a unique
`id` for the topic and round; question IDs and option keys begin with a letter
and contain only letters, digits, hyphens or underscores. Required fields are
`id`, `title`, and `questions` with `id` and `text`. The other example fields are
optional. Omit `options` for a free-text answer. Recommendations never select an
answer. Group related questions and ask only what is useful for the current topic.

Resolve the installed directory containing this SKILL.md as `SKILL_DIR`. Run:

```sh
python3 "$SKILL_DIR/scripts/questionnaire.py" --input /absolute/questions.json --tunnel
```

Keep the process alive using the host's process facility. It prints JSON events:
`ready` has `localUrl`; `shared` adds `publicUrl`. Both include `questionsPath`,
`htmlPath` and `responsesPath`. Open the actual shared URL before presenting it.
If cloudflared is unavailable, omit `--tunnel` and give a local link; do not
claim that a local link is reachable from another device. `--build-only` produces
the HTML without a server; that file can export answers but cannot submit them.

## Read submitted answers

Files live under `~/.development-system/private/questionnaires/<id>/`:

- `questions.json`: canonical questions and their content hash.
- `responses.json`: latest submitted answers, revision and receipt.
- `submissions/`: earlier submissions for recovery.
- `runtime.json`: last server link and process ID; verify it before reusing it.

After the user says “ya contesté”, read the exact `responsesPath`. Answers are in
`data.answers` (`id`, `choice`, `note`, `deferred`), with `data.generalNotes` for
overall comments. Blank and deferred answers are not approvals. Respect literal
wording; do not turn an example or tentative comment into a settled decision.

Browser drafts stay in the browser until Submit. A successful Submit returns a
receipt; revision conflicts preserve the draft and let the user choose which
copy to keep. Refreshing or restarting with the same unchanged input preserves
submitted answers. Changed questions require a new `id` and a new input JSON.

The link grants access to this questionnaire and its answers. Share only the
requested material; do not add secrets or unrelated private content. Quick
tunnels are temporary, depend on the computer and server staying on, and change
after restarting. Restart from the same input JSON to recover local submissions,
then give the new URL. Ctrl+C stops this server and its tunnel.

## Verify changes to the template

Use `--home /absolute/isolated-home` for synthetic submissions and browser QA.
Never test saves against the user's real questionnaire. Verify Submit writes the
literal answer, refresh recovers it, and another round leaves earlier answers
intact. Serving an entire project directory is unnecessary: this helper exposes
only the questionnaire and its answer endpoint at an unguessable path.
