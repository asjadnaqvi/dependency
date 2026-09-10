"""Export the dashboard's compact HS2 JSON payloads from the BACI CSV source."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = WORKSPACE_ROOT / "baci_hs22_2024.csv"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "data" / "hs2"
MISSING_CODES = [f"{code:02d}" for code in range(50, 98) if code != 77]


def json_value(value: object) -> object:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def payload_filename(code: str, row_index: int) -> str:
    if code == "84":
        return f"84_{row_index % 2 + 1}"
    return code


def write_payloads(source: Path, output: Path, dry_run: bool) -> dict[str, int]:
    target_names = [code for code in MISSING_CODES if code != "84"] + ["84_1", "84_2"]
    counts = {name: 0 for name in target_names}
    if dry_run:
        handles: dict[str, object] = {}
    else:
        output.mkdir(parents=True, exist_ok=True)
        handles = {}
        for name in target_names:
            handle = (output / f"{name}.json").open("w+", encoding="utf-8")
            handle.write(f'{{"code2":"{name[:2]}","row_count":          ,"records":[')
            handles[name] = handle

    try:
        with source.open(encoding="utf-8", newline="") as stream:
            for row in csv.DictReader(stream):
                code = row["code2"]
                if code not in MISSING_CODES:
                    continue
                filename = payload_filename(code, counts["84_1"] + counts["84_2"])
                if not dry_run:
                    handle = handles[filename]
                    if counts[filename]:
                        handle.write(",")
                    record = {
                        "from": row["ex_iso3"],
                        "to": row["im_iso3"],
                        "value": json_value(float(row["value"])),
                        "code2": code,
                        "code4": row["code4"].zfill(4),
                        "code6": row["code6"].zfill(6),
                    }
                    handle.write(json.dumps(record, separators=(",", ":")))
                counts[filename] += 1
    finally:
        for name, handle in handles.items():
            handle.write("]}")
            handle.seek(len(f'{{"code2":"{name[:2]}","row_count":'))
            handle.write(f"{counts[name]:>10}")
            handle.close()

    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    counts = write_payloads(args.source, args.output, args.dry_run)
    missing_source_codes = [
        code
        for code in MISSING_CODES
        if not (counts["84_1"] + counts["84_2"] if code == "84" else counts[code])
    ]
    if missing_source_codes:
        raise ValueError(f"No source records found for HS2 codes: {', '.join(missing_source_codes)}")

    for filename, count in sorted(counts.items()):
        print(f"{filename}.json: {count:,} rows")


if __name__ == "__main__":
    main()