#!/usr/bin/env python3
"""Validate the personal Droid droid roster used by coding-orchestration."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED_DROIDS = {
    "architecture-planner",
    "backend-specialist",
    "browser-qa",
    "code-mapper",
    "docs-researcher",
    "fast-implementer",
    "implementer",
    "mechanical-worker",
    "performance-auditor",
    "qa-planner",
    "release-manager",
    "reviewer",
    "security-reviewer",
    "test-runner",
    "ui-designer",
    "visual-reviewer",
}
EXPECTED_TOOLS = {
    "architecture-planner": "read-only",
    "backend-specialist": None,          # all tools
    "browser-qa": None,
    "code-mapper": "read-only",
    "docs-researcher": "read-only",
    "fast-implementer": None,
    "implementer": None,
    "mechanical-worker": None,
    "performance-auditor": "read-only",
    "qa-planner": "read-only",
    "release-manager": None,
    "reviewer": "read-only",
    "security-reviewer": "read-only",
    "test-runner": None,
    "ui-designer": None,
    "visual-reviewer": None,
}

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def parse_frontmatter(text: str) -> dict[str, str]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}
    fm: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            fm[key.strip()] = value.strip().strip('"').strip("'")
    return fm


def main() -> int:
    droid_dir = Path.home() / ".factory" / "droids"
    errors: list[str] = []
    names: set[str] = set()

    for path in sorted(droid_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        fm = parse_frontmatter(text)

        name = fm.get("name", path.stem)
        if name in names:
            errors.append(f"{path.name}: duplicate name {name}")
        names.add(name)

        if not fm.get("description"):
            errors.append(f"{path.name}: missing description")

        expected_tools = EXPECTED_TOOLS.get(name)
        if expected_tools == "read-only":
            if "read-only" not in fm.get("tools", ""):
                errors.append(f"{path.name}: {name} must use tools: read-only")
        elif expected_tools is None and name in REQUIRED_DROIDS:
            if fm.get("tools", "") == "read-only":
                errors.append(f"{path.name}: {name} must not be read-only")

    missing = sorted(REQUIRED_DROIDS - names)
    if missing:
        errors.append("missing droids: " + ", ".join(missing))

    if errors:
        print("Droid roster validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Validated {len(names & REQUIRED_DROIDS)} coding droids in {droid_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
