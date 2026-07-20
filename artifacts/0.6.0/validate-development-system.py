#!/usr/bin/env python3
"""Validate one installed Development System HOME from its declared contracts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


CODEX_ROLES = {
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
FACTORY_ROLES = {name.replace("_", "-") for name in CODEX_ROLES}


def read_json(path: Path, errors: list[str]) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("root must be an object")
        return value
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors.append(f"cannot read {path}: {exc}")
        return {}


def resolve_home_path(home: Path, relative_path: str) -> Path:
    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise ValueError(f"declared destination must be relative: {relative_path}")
    target = (home / candidate).resolve()
    resolved_home = home.resolve()
    if target != resolved_home and resolved_home not in target.parents:
        raise ValueError(f"declared destination escapes HOME: {relative_path}")
    return target


def directory_hash(directory: Path) -> str:
    if not directory.is_dir():
        raise ValueError(f"declared skill directory is missing: {directory}")
    digest = hashlib.sha256()
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"declared physical mirror contains a symbolic link: {path}")
        if not path.is_file():
            continue
        digest.update(path.relative_to(directory).as_posix().encode())
        digest.update(b"\0")
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def validate_declared_mirrors(home: Path, errors: list[str]) -> int:
    lock = read_json(home / ".development-system" / "skills-lock.json", errors)
    variants: dict[str, dict[str, Any]] = {}
    for logical_skill in lock.get("logicalSkills", []):
        if not isinstance(logical_skill, dict):
            continue
        for variant in logical_skill.get("variants", []):
            if isinstance(variant, dict) and isinstance(variant.get("id"), str):
                variants[variant["id"]] = variant

    mirror_count = 0
    for variant in variants.values():
        original_id = variant.get("expectedMirrorOf")
        if not original_id:
            continue
        mirror_count += 1
        original = variants.get(str(original_id))
        if not original:
            errors.append(f"{variant.get('id')} mirrors missing variant {original_id}")
            continue
        try:
            original_path = resolve_home_path(home, str(original.get("destination", "")))
            mirror_path = resolve_home_path(home, str(variant.get("destination", "")))
            if directory_hash(original_path) != directory_hash(mirror_path):
                errors.append(f"physical mirror {variant.get('id')} does not match {original_id}")
        except ValueError as exc:
            errors.append(str(exc))
    return mirror_count


def frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    values: dict[str, str] = {}
    for line in text[4:end].splitlines():
        match = re.match(r"([A-Za-z][A-Za-z0-9_-]*):\s*(.*)", line)
        if match:
            values[match.group(1)] = match.group(2).strip().strip('"')
    return values


def flat_toml(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"\n]*)"$', line)
        if match:
            values[match.group(1)] = match.group(2)
    return values


def canonical_repositories(root: Path) -> list[Path]:
    repositories: list[Path] = []
    if not root.is_dir():
        return repositories
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        result = subprocess.run(
            ["git", "-C", str(child), "rev-parse", "--show-toplevel"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or Path(result.stdout.strip()).resolve() != child.resolve():
            continue
        common = subprocess.run(
            ["git", "-C", str(child), "rev-parse", "--git-common-dir"],
            check=False,
            capture_output=True,
            text=True,
        )
        if common.returncode != 0:
            continue
        common_path = Path(common.stdout.strip())
        if not common_path.is_absolute():
            common_path = child / common_path
        if common_path.resolve() == (child / ".git").resolve():
            repositories.append(child)
    return repositories


def validate_global_surfaces(home: Path, repos_root: Path | None, errors: list[str]) -> tuple[int, int, int]:
    codex_agents = set()
    for path in sorted((home / ".codex" / "agents").glob("*.toml")):
        try:
            data = flat_toml(path.read_text(encoding="utf-8"))
        except OSError as exc:
            errors.append(f"cannot read Codex agent {path.name}: {exc}")
            continue
        if data.get("name"):
            codex_agents.add(data["name"])

    factory_droids = set()
    for path in sorted((home / ".factory" / "droids").glob("*.md")):
        try:
            data = frontmatter(path.read_text(encoding="utf-8"))
        except OSError as exc:
            errors.append(f"cannot read Factory droid {path.name}: {exc}")
            continue
        if data.get("name"):
            factory_droids.add(data["name"])

    missing_codex = sorted(CODEX_ROLES - codex_agents)
    missing_factory = sorted(FACTORY_ROLES - factory_droids)
    if missing_codex:
        errors.append("missing Codex roles: " + ", ".join(missing_codex))
    if missing_factory:
        errors.append("missing Factory roles: " + ", ".join(missing_factory))

    for harness_path in [home / ".codex" / "AGENTS.md", home / ".factory" / "AGENTS.md"]:
        try:
            contents = harness_path.read_text(encoding="utf-8")
        except OSError as exc:
            errors.append(f"cannot read {harness_path}: {exc}")
            continue
        for skill in ["drive-development-flow", "coding-orchestration"]:
            if skill not in contents:
                errors.append(f"{harness_path} does not trigger {skill}")

    repositories = canonical_repositories(repos_root) if repos_root else []
    for repository in repositories:
        agents = repository / "AGENTS.md"
        if not agents.is_file():
            continue
        contents = agents.read_text(encoding="utf-8")
        for forbidden in [".codex/agents", ".factory/droids", "CODEX_HOME"]:
            if forbidden in contents:
                errors.append(f"{agents} hardcodes harness-specific roster path: {forbidden}")
    return len(codex_agents), len(factory_droids), len(repositories)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--repos-root", type=Path)
    parser.add_argument("--mirrors-only", action="store_true")
    args = parser.parse_args()
    home = args.home.resolve()
    errors: list[str] = []
    mirror_count = validate_declared_mirrors(home, errors)
    codex_agents = factory_droids = repositories = 0
    if not args.mirrors_only:
        codex_agents, factory_droids, repositories = validate_global_surfaces(
            home, args.repos_root, errors
        )

    if errors:
        print("Development-system validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    if args.mirrors_only:
        print(f"Validated declared physical mirrors: {mirror_count}.")
    else:
        print(
            "Validated development system: "
            f"{codex_agents} Codex agents, {factory_droids} Factory droids, "
            f"{mirror_count} declared physical mirrors, {repositories} canonical repositories."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
