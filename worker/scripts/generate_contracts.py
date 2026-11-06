#!/usr/bin/env python3
"""Generate Pydantic contract models from backend OpenAPI specification."""

import subprocess
import sys
from pathlib import Path

OPENAPI_PATH = (
    Path(__file__).resolve().parent.parent.parent / "backend" / "openapi" / "openapi.json"
)
OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "src" / "kiru_worker" / "contracts" / "api.py"
)


def main() -> None:
    if not OPENAPI_PATH.exists():
        print(f"Notice: OpenAPI specification not found at {OPENAPI_PATH}")
        print("Contract generation is deferred until backend exports openapi.json (P2).")
        print("Using hand-crafted stub models in src/kiru_worker/contracts/api.py.")
        return

    print(f"Generating contracts from {OPENAPI_PATH} -> {OUTPUT_PATH}")
    cmd = [
        "datamodel-codegen",
        "--input",
        str(OPENAPI_PATH),
        "--output",
        str(OUTPUT_PATH),
        "--input-file-type",
        "openapi",
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--snake-case-field",
        "--use-annotated",
        "--use-subclass-enum",
    ]
    res = subprocess.run(cmd, check=False)
    if res.returncode != 0:
        print(f"datamodel-codegen failed with exit code {res.returncode}")
        sys.exit(res.returncode)

    print("Formatting contracts with ruff...")
    subprocess.run(["ruff", "format", str(OUTPUT_PATH)], check=False)
    print("Contracts updated successfully.")


if __name__ == "__main__":
    main()
