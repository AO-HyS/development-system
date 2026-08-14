# Benchmark history

Run `pnpm run legacy:benchmark` to reproduce the historical benchmark harness and append a timestamped, immutable JSON result under `evidence/benchmarks/`. Every run retains the identical fixture hash, harness, model, reasoning, instructions, checks, duration, tokens, reported cost, corrections, findings, slop, and verified-delivery time. Results rank candidates only within a capability; they never declare a universal winning model.
