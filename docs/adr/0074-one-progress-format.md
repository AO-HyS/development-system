# ADR 0074: one format for progress and closings

Status: accepted direction; candidate contract 2.13.0 / catalog 0.77.0.
Changes ADR 0072 in one point: the line-and-window visual is no longer a
trigger at every closing.

The owner said the system «está estorbando más de lo que está ayudando». Two
of the causes were in how an agent reports: a closing could be a visual whose
content sat behind clicks, and a request to the owner could be buried in a
questionnaire, a report or a tunnel page. On 2026-11-11 the owner approved the
format already used in one product thread (Planeta Aula) as the only format.

Decision:

- Every progress answer and every closing is text in the thread: a first
  sentence that says whether something is needed from the owner and where the
  work stands, one flow line with ✅ / ⏳ / 🧱 under each stage, short bullets
  with one note about what was not verified, and a fixed closing («Qué avanza y
  qué no», «Lo que necesito de ti», «Lo que sigue»). No tables, at most 2,000
  characters, the report linked instead of pasted.
- It is emitted when a batch or a PR ends, whenever the agent stops, and
  whenever the owner asks.
- `config/visual-delivery.md` stays the single source: the builder writes it
  into the installed instructions and into the declared Claude rule artifact.
  `flow-implement/references/completion-report.md` points to it. Instructions
  that contradicted it were removed, and `check-agents-rules` lists which.
- The facts come from `development-system progress <owner/repo#number>...`:
  GitHub state, gate step, ledger rounds and recorded evidence per PR. A read
  that fails is printed as «desconocido». The command never says that
  something waits for the owner or that the work is finished; the coordinator
  decides that against the authorization it already has.
- `visual-explain` remains for substantive plans and for when the owner asks.
  Its renderer writes every stage with both annotations below the drawing, so
  no content needs a click; selecting a stage only moves the focus.
- A real request also uses the host's question tool when it is enabled for the
  current mode, and a thread that hands control to the owner stops watching
  its PR.

No hook enforces the format. Adoption is observed on the next real turn of
each host after installation; copying the file does not prove it.

Not chosen: a hook that rejects a closing that breaks the format (a new guard
is what this version is removing), and a `progress` that also states what the
owner must do (that needs the conversation's authorization, which a command
cannot read).
