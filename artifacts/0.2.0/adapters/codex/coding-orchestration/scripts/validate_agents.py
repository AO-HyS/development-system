#!/usr/bin/env python3
"""Validate the personal Codex agent roster used by coding-orchestration."""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys


REQUIRED_AGENTS = {
    "architecture_planner",
    "backend_specialist",
    "browser_qa",
    "code_mapper",
    "docs_researcher",
    "fast_implementer",
    "implementer",
    "mechanical_worker",
    "performance_auditor",
    "qa_planner",
    "release_manager",
    "reviewer",
    "security_reviewer",
    "test_runner",
    "ui_designer",
    "visual_reviewer",
}
ALLOWED_MODELS = {
    "gpt-5.3-codex-spark",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
}
ALLOWED_EFFORTS = {"low", "medium", "high", "xhigh", "max"}
ALLOWED_SANDBOX_MODES = {"read-only", "workspace-write"}
EXPECTED_MODEL_EFFORT = {
    "architecture_planner": ("gpt-5.6-sol", "xhigh"),
    "backend_specialist": ("gpt-5.6-sol", "medium"),
    "browser_qa": ("gpt-5.6-terra", "max"),
    "code_mapper": ("gpt-5.6-luna", "xhigh"),
    "docs_researcher": ("gpt-5.6-luna", "xhigh"),
    "fast_implementer": ("gpt-5.3-codex-spark", "low"),
    "implementer": ("gpt-5.6-sol", "medium"),
    "mechanical_worker": ("gpt-5.6-luna", "high"),
    "performance_auditor": ("gpt-5.6-sol", "medium"),
    "qa_planner": ("gpt-5.6-luna", "xhigh"),
    "release_manager": ("gpt-5.6-sol", "medium"),
    "reviewer": ("gpt-5.6-sol", "medium"),
    "security_reviewer": ("gpt-5.6-sol", "xhigh"),
    "test_runner": ("gpt-5.6-luna", "high"),
    "ui_designer": ("gpt-5.6-sol", "xhigh"),
    "visual_reviewer": ("gpt-5.6-sol", "high"),
}
EXPECTED_SANDBOX = {
    "architecture_planner": "read-only",
    "backend_specialist": "workspace-write",
    "browser_qa": "workspace-write",
    "code_mapper": "read-only",
    "docs_researcher": "read-only",
    "fast_implementer": "workspace-write",
    "implementer": "workspace-write",
    "mechanical_worker": "workspace-write",
    "performance_auditor": "read-only",
    "qa_planner": "read-only",
    "release_manager": "workspace-write",
    "reviewer": "read-only",
    "security_reviewer": "read-only",
    "test_runner": "workspace-write",
    "ui_designer": "workspace-write",
    "visual_reviewer": "workspace-write",
}


def parse_flat_toml(text: str) -> dict[str, str]:
    """Parse the flat string fields used by agent files on Python 3.9+."""
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not match:
            continue
        key, raw = match.groups()
        if raw.startswith('"""'):
            values[key] = "multiline"
        elif len(raw) >= 2 and raw.startswith('"') and raw.endswith('"'):
            values[key] = raw[1:-1]
    return values


def main() -> int:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    agent_dir = codex_home / "agents"
    errors: list[str] = []
    names: set[str] = set()

    for path in sorted(agent_dir.glob("*.toml")):
        try:
            data = parse_flat_toml(path.read_text(encoding="utf-8"))
        except OSError as exc:
            errors.append(f"{path.name}: cannot read TOML: {exc}")
            continue

        for field in ("name", "description", "developer_instructions"):
            if not data.get(field):
                errors.append(f"{path.name}: missing {field}")

        name = data.get("name")
        if isinstance(name, str):
            if name in names:
                errors.append(f"{path.name}: duplicate name {name}")
            names.add(name)

        if data.get("model") not in ALLOWED_MODELS:
            errors.append(f"{path.name}: model must be Sol, Terra, or Luna")
        if data.get("model_reasoning_effort") not in ALLOWED_EFFORTS:
            errors.append(f"{path.name}: unsupported reasoning effort")
        if data.get("sandbox_mode") not in ALLOWED_SANDBOX_MODES:
            errors.append(f"{path.name}: sandbox must be read-only or workspace-write")
        expected_sandbox = EXPECTED_SANDBOX.get(name)
        if expected_sandbox and data.get("sandbox_mode") != expected_sandbox:
            errors.append(f"{path.name}: {name} must use sandbox {expected_sandbox}")
        expected_model_effort = EXPECTED_MODEL_EFFORT.get(name)
        if expected_model_effort:
            expected_model, expected_effort = expected_model_effort
            if data.get("model") != expected_model or data.get("model_reasoning_effort") != expected_effort:
                errors.append(
                    f"{path.name}: {name} must use {expected_model} at {expected_effort}"
                )

    missing = sorted(REQUIRED_AGENTS - names)
    if missing:
        errors.append("missing agents: " + ", ".join(missing))

    if errors:
        print("Agent roster validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Validated {len(names)} coding agents in {agent_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
