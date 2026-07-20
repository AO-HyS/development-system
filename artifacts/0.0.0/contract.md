# AOHYS Development System bootstrap contract

Contract version: `0.0.0`

This bootstrap contract exists as the known-good rollback target for the first canonical release.
It establishes only two invariants:

1. Installed HOME files are generated mirrors, never the canonical source.
2. Merge, release, and production require separate, explicit authorization.

The supported operations are `install`, `audit`, `validate`, and `rollback`.
