# Design warning signs

Use these to compare an affected boundary, not to justify an unrelated rewrite.

- **Shallow interface:** callers coordinate several stages or learn internal
  rules to perform one operation. Concentrate the invariant behind a useful API.
- **Leaked representation:** several modules duplicate a storage or transport
  detail. Locate its owner and adapt at the boundary; preserve public contracts.
- **Stage-shaped modules:** load, validate and save modules repeat the same
  policy. Consider grouping by domain knowledge and ownership.
- **Pass-through layers:** forwarding adds neither policy nor adaptation.
  Remove a layer only after checking its callers and supported boundary.
- **Split ownership:** multiple writers independently enforce one invariant.
  Give the invariant an owner and make callers use its operation.
- **Competing paths:** agents can copy either old or current implementations.
  Migrate callers within scope and preserve compatibility until retirement is safe.
- **Importable internals:** callers bypass the intended API. Use exports and
  import checks that fail for unsupported access.
- **Hand-synchronized lists:** the same inventory is copied in several places.
  Derive consumers from one source or enforce agreement deterministically.

These are evidence prompts. Indirection, multiple consumers or an intentional
compatibility layer alone do not establish a defect.
