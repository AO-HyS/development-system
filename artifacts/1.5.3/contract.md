# Development System Contract 1.5.3

Version 1.5.3 retains every guarantee and authorization boundary of 1.5.2. Published 1.5.0, 1.5.1, and 1.5.2 bytes remain unchanged.

## T3 Code live recertification patch for the exact installed contract

- Resolve the contract version, catalog version, and source commit from the exact Development System and skill lock installed in HOME; never use a historical hard-coded catalog.
- Require the installed manifest, contract, and skill catalog to bind the same exact catalog version and source commit before probing T3 Code.
- Refuse recertification unless both the pre-turn and post-turn Development System and skill audits are healthy and match that installed binding.
- Consume the canonical private `skills-live-latest.json` produced by the immediately preceding Codex skill probe, while retaining an explicit evidence-path override.
- Record the installed source commit separately from the checkout used to launch the probe.
- Support both unpacked and current packed Electron server entrypoints, and fail immediately when neither the stable nor nightly application is installed.
- Persist a bounded, privacy-safe failed probe report when the T3 turn, HTTP polling, or JSON response fails; never discard the benchmark evidence by throwing before output.
- Replace the canonical private skill evidence atomically at mode `0600`, rejecting symbolic-link paths before any write.
- Keep the probe read-only, approval-bound, and state-invariant across the product repository and managed HOME.
