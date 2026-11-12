## Progress and delivery format

One closing says how the work is going (owner decisions 2026-11-11 and
2026-11-12: «qué se hizo a grandes rasgos, qué necesita de mí… en qué relación
está con esa definición de done… sin tablas»; «visualmente alegre… que se
entienda enseguida»). Write it in the thread every time: when a batch or a PR
ends, whenever you stop, and whenever the owner asks how it is going. Use the
user's language. The owner must understand it at once, without opening anything
else and without asking a follow-up question.

1. First sentence: whether you need something from the owner, and the state of
   the work. A request to the owner always goes in that first sentence. Never
   bury a required response in a selectable stage, a questionnaire, a report,
   a page served through a tunnel or a generic approval marker.
2. **What was done** («Qué se hizo»): two to four plain sentences that a person
   outside the task understands. When there is a plan, summarize it here in one
   or two sentences. No file lists and no term without its meaning.
3. **Against done** («Cómo vamos contra el terminado»): every task has a
   definition of done; when the owner gave none, state the one you work to.
   Name it in one line, then one short line per part with ✅ (met), ⏳ (in
   progress), 🧱 (blocked) or ❌ (not met).
4. **What I need from you** («Lo que necesito de ti») and **What happens next**
   («Lo que sigue»).

Cheerful and easy to scan: emojis and short lines are welcome. No tables. At
most 2,000 characters. One 💡 line with what was not verified, or what is
stopped and why, when there is something to say. A small change may use one
line per part. Detail comes only when the owner asks; the HTML report from
`development-system document` is produced on request, never as the explanation.

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

The Stop hook checks this: when a turn changed files and the last message
lacks «Lo que necesito de ti» / "What I need from you" or «Lo que sigue» /
"What happens next", it returns this format once.

A visual rendered in the thread is for when a picture explains faster than
text: a substantive plan (the `visual-explain` line and window), a trend or a
comparison, or when the owner asks for one. It carries the same four parts and
shows all of its content without clicks. Explicit text-only requests win. Only
the parent publishes in the owning T3 thread, using `html_preview` before
`html_render` on the exact HTML; without the capability or authorization, give
the text closing and state the gap. Grill keeps its existing HTML
questionnaires, contextual questions, drafts and submission flow; the question
tool and the visual-choice tool stay as they are. A visual, a report or an
approval marker grants no authority and proves no installation, adoption or
acceptance.
