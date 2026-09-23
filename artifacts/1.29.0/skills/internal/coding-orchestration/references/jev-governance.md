# Historical governed execution

Contracts 1.25 through 1.28 used per-boundary enforcement. New work follows
[Jev advisory execution](jev-advisory.md). Do not enable old hooks or require
permits for a new advisory task. Historical runs and unresolved ownership remain
intact; use the exact old recipe only for explicitly requested recovery. Never
relabel recovery as acceptance or silently resume an old run under a new policy.
