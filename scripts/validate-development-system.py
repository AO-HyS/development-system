#!/usr/bin/env python3
"""Run the versioned Development System validator from the canonical checkout."""

from pathlib import Path
import runpy


if __name__ == "__main__":
    runpy.run_path(
        str(Path(__file__).resolve().parents[1] / "artifacts" / "0.6.0" / "validate-development-system.py"),
        run_name="__main__",
    )
