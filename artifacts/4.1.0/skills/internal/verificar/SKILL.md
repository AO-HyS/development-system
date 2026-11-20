---
name: verificar
description: Prove that a product change does what the ask's «Terminado» lines say, one receipt per line. Screen lines go to a fresh verifier model that uses the running product through Browse by MCP; server lines go to the product's CLI; rule lines to lint and types. Use after building a product change, before merging a critical one and before closing any ask.
---

# Verificar

Verification is the last of four defences, in this order: the lint rule at
edit time, the types, the model reads the level orders (Codex once, one
independent read for a critical change or for a batch), and then this. It
proves behaviour on the running product. It is not a review and has no rounds.
In Claude Code the AF way (`~/.claude/skills/flow-implement/references/forma-af.md`)
adds no other read inside the run; the reads the level orders stay.

The contract is the «Terminado» the owner accepted: numbered lines
`acción -> lo que se ve`, each marked `pantalla`, `servidor` or `regla`. Do not
loosen a line to pass it. A case the independent read asks for becomes one more
line (`N1`, `N2`…); it never orders another read.

Every line ends as **PASA**, **NO PASA** or **NO ALCANZADO**, with what was
done, what was seen and a receipt. NO ALCANZADO is never a pass. No ask closes
with a line that has no receipt.

## When

- Critical change: its lines run before the merge.
- Normal change: it merges as the level allows; its lines run by batch before
  you call the ask done.
- Mechanical change: only `regla` lines (lint and typecheck output).

## Lines every screen change carries

Add these two without being asked when the change touches a screen:

- The touched screens look right at 1440x900 and at 390x844: nothing cut,
  overlapping, overflowing or unreadable.
- The browser console shows no errors on the touched screens.

## Who proves each kind of line

**`regla`.** Run the lint, type or model check. The command and its output are
the receipt.

**`servidor`.** You run it against the local or development backend, never
against production data, with the product's own CLI (Convex:
`npx convex run …`). A server rule needs three observations: the server
rejects the forbidden operation, nothing was written, and a valid neighbouring
operation still passes. The screen refusing it is not enough: report such a
line split, «pantalla PASA; servidor NO ALCANZADO», until the server case ran.
Save the command and its output to a file; that file is the receipt.

**`pantalla`.** A verifier that did not write the change uses the product as
a user through Browse by MCP and reports what it saw. Give it
[the verifier brief](references/encargo-verificador.md) with the blanks filled
in.

- In Claude Code: one fresh `verificador-pantalla`, through `Agent` with that
  `subagent_type` (Sonnet 5.5 medium), with no model override. Give it the
  complete brief, URL and origin, synthetic account, login helpers, seeded
  records and results folder. One verifier per ask, one round, five minutes;
  what it did not observe stays NO ALCANZADO. After a fix, check only the line
  and the lines it can touch with a fresh verifier. The same writer receives
  the corrections.
- In Codex the 4.0.0 path stays: Opus 5.5 High in a fresh context
  (`delegate_task` to `claudeAgent` / `claude-opus-5-5`, effort high), with
  the current limits.

At most three verifiers decide at the same time across asks. Verifiers that
change the same data run one after another or on separate data; say in each
brief which records are theirs.

Where a repository's guide names another tool for screen evidence (computer
use, another browser), this verifier replaces it: the owner chose Browse by MCP
for verification on 2026-11-17. Say so in the closing until that guide is
updated.

## Prepare

1. The product runs locally with seed data, as the repository's verification
   guide says. Note every PID you start.
2. Before dispatching, run your seed script against the local or development
   backend and read back what it left: the IDs and state each line uses go in
   the brief. Write down the PIDs you start and the `servidor` and `regla`
   commands you will run while the verifier works.
3. A receipts folder per verifier:
   `~/.development-system/private/verificacion/<ask>/<verifier>/`.
4. The test account: one the repository's seed or verification guide names,
   with the role the line needs. Its password never goes into a brief, a chat,
   a tool argument or Browse `execute` source (that source is journaled). Start
   the helper and name it in the brief:

   ```sh
   node scripts/servidor-clave.mjs <file-with-the-password> <product-origin> [port]
   ```

   It hands the password only to a page of that origin, on 127.0.0.1. The
   verifier runs `scripts/poner-clave-browse.js` inside `execute` when the
   password field is on screen. The helper is only for synthetic test accounts
   of a local product, lives for the task and is not a boundary against the
   agent. A real credential goes only through the owner's `browse secrets add`.
   Stop the helper by PID before you report.

## Browse runs in the owner's Chrome

He allowed it for verification. It is not isolated: every session shares the
profile's cookies, the console arrives mixed and all captures land in one
temporary folder. So each verifier:

- creates its own session (`session_new` with its own id and `allowedOrigins`
  set to the product origin only), passes that `session` on every call and
  ends with `session_delete`;
- touches only the tabs it opened, the product origin and the test account,
  never his open tabs or his accounts, and never signs out;
- when the product is already signed in, confirms on screen that the account
  is the test account before reading or changing anything, looking only at
  where the account is named and capturing nothing else until then; with
  another account it uses nothing, leaves every line NO ALCANZADO and says
  which account it saw;
- copies to its receipts folder only the capture file its own call returned,
  and takes no whole-screen capture.

Known traps, measured: `snapshot()` stops at 80 elements and does not see
pop-ups; at 390 the useful width is 375; a click on a submit button may time
out although it worked, so check the page before retrying; full-page captures
draw fixed bars in the middle of the page.

## Results

Each verifier leaves `resultado.json` and its captures. Read the file, open the
capture of every NO PASA and of every defect it lists under `visual`, and set
the line's verdict yourself: a verifier that calls a cut text «menor» and marks
PASA has reported a NO PASA of the look line.

- NO PASA: fix the cause and run again only that line and the lines the fix
  can touch. If a lint rule or a type could have caught the defect, add it in
  the same pull request. In Claude AF the parent opens the receipt and sends
  the fix to the same writer by `SendMessage`, or records «Rechazado: motivo»
  and keeps the real result: a rejection never turns a needed failure into a
  pass.
- Third NO PASA on the same line: stop patching. Diagnose the cause, leave the
  line NO PASA, tell the owner in the closing and continue with the rest.
- NO ALCANZADO: say why. Only the owner can waive it, and a waived line stays
  «no alcanzado».

Record the lines where the change already keeps its record:
`development-system registro` with each line as `--necesario "R1: …"` and its
result as `--caso "pass|fail: R1 <tried> => <seen, receipt>"` or
`--no-alcanzado`, and on the ask's card with
`development-system tarjeta renglon`. The closing lists every line with its
mark and receipt.

## Se ve bien

In Claude AF the verifier checks the look and the console; no visual council
and no other model is called. The two look lines stay, and five minutes is
never an automatic pass.

In Codex, only when the change touched a screen, after its lines pass: show
the captures to the visual council, one judge at a time and without telling the judge the
goal (Opus 5.5 High, then Sol 6.1 High, then Fable 5.2 Medium). A judge that
scores under 9 names what to fix; fix it and ask the same judge again. A third
round on the same screen goes to the owner. The council judges how it looks; it
does not count as a read and orders none.
