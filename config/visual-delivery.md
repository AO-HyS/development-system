## Progress and delivery format

One format says how the work is going (owner decision 2026-11-11). Write it as
text in the thread every time: when a batch or a PR ends, whenever you stop,
and whenever the owner asks how it is going. Use the user's language.

1. First sentence: whether you need something from the owner, and the state of
   the work. A request to the owner always goes in that first sentence. Never
   bury a required response in a selectable stage, a questionnaire, a report,
   a page served through a tunnel or a generic approval marker.
2. One flow line with the stages of the work, and ✅ (done), ⏳ (in progress)
   or 🧱 (blocked) under each stage.
3. Short bullets: done, not done, in progress. A single 💡 note with what was
   not verified, or what is stopped and why.
4. A fixed closing with three parts: **What moves and what does not**, **What I
   need from you** and **What happens next** (in Spanish: «Qué avanza y qué
   no», «Lo que necesito de ti», «Lo que sigue»).

No tables. At most 2,000 characters. The detail lives in the HTML report from
`development-system document`: link its persistent `htmlPath`, do not paste it.

**What I need from you** names the exact decision, input or action and what it
unlocks; when nothing is needed, say so. **What happens next** names the next
action, who owns it and any real dependency; when the authorized work is
complete, say so without inventing another step. Do not ask again for retained
authorization or turn an optional choice into a blocker; keep doing independent
authorized work. Before naming a need, use the access already granted
(repository test accounts, a session the owner shared, logging in yourself);
when it fails, try another route and report the gap instead of asking. An
optional item carried over by a compaction summary is not a need.

The facts come from a command, not from memory: `development-system progress
<owner/repo#number>...` with every PR of the initiative prints what is merged,
what is open and at which step of the gate, and prints what it could not read
as «desconocido». It never says that something waits for the owner or that the
work is finished: you decide that, after checking the authorization you already
have in the conversation.

A real request also uses the host's question tool when that tool is enabled for
the current mode (`request_user_input` in Codex, `AskUserQuestion` in Claude
Code); when it is not, the first sentence carries the request. When the thread
hands control to the owner (a question, a PR ready for them, a real block),
stop watching the PR (`unwatch_pull_request`): a watched thread looks busy and
never reaches the inbox. While you wait on your own for checks or reviews, keep
the watch and end the turn without a message; never write "still waiting".

The `visual-explain` line and window is for presenting a substantive plan and
for when the owner asks for a visual; a closing does not need it. Explicit
text-only requests win. Every visual shows all of its content without clicks.
Only the parent publishes in the owning T3 thread, using `html_preview` before
`html_render` on the exact HTML; without the capability or authorization, give
text and a durable HTML path with the verification gap stated. Grill keeps its
existing HTML questionnaires, contextual questions, drafts and submission flow.
A visual, a report or an approval marker grants no authority and proves no
installation, adoption or acceptance.
