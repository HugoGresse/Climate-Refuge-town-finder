"""Aggregates INSEE BPE (base permanente des équipements) into per-commune
livability indicators. Source: BPE24 parquet on data.gouv (Licence Ouverte).

Selected TYPEQU codes (BPE 2024 nomenclature):
  D101 établissement santé court séjour · D106 urgences · D201 médecin
  généraliste · D307 pharmacie · B101/B102 hyper/supermarché · B203
  boulangerie · C107/C108 écoles · C201 collège · C301-C303 lycées ·
  E107/E108/E109 gares (nationale/régionale/locale).

Usage: .venv-etl/bin/python data-pipeline/fetch_livability.py
"""

from __future__ import annotations

import json
import pathlib

import duckdb

ROOT = pathlib.Path(__file__).resolve().parent.parent
PARQUET = ROOT / "data" / "hazard-src" / "bpe24.parquet"
OUT = ROOT / "data" / "livability.json"

CODES = {
    "hospital": ["D101"],
    "urgences": ["D106"],
    "gp": ["D201"],
    "pharmacy": ["D307"],
    "supermarket": ["B101", "B102"],
    "bakery": ["B203"],
    "school": ["C107", "C108"],
    "college": ["C201"],
    "lycee": ["C301", "C302", "C303"],
    "station": ["E107", "E108", "E109"],
}


def main() -> None:
    con = duckdb.connect()
    rows = con.execute(
        f"SELECT DEPCOM, TYPEQU, COUNT(*) FROM '{PARQUET}' "
        "WHERE TYPEQU IN ({}) GROUP BY DEPCOM, TYPEQU".format(
            ",".join(f"'{c}'" for codes in CODES.values() for c in codes)
        )
    ).fetchall()

    communes: dict[str, dict[str, int]] = {}
    code_to_key = {c: key for key, codes in CODES.items() for c in codes}
    for depcom, typequ, count in rows:
        key = code_to_key[typequ]
        commune = communes.setdefault(depcom, {})
        commune[key] = commune.get(key, 0) + count

    OUT.write_text(
        json.dumps(
            {
                "meta": {
                    "source": "INSEE BPE 2024 (data.gouv, Licence Ouverte 2.0)",
                    "codes": CODES,
                    "communesWithData": len(communes),
                },
                "communes": communes,
            }
        )
    )
    with_hospital = sum(1 for c in communes.values() if c.get("hospital"))
    with_station = sum(1 for c in communes.values() if c.get("station"))
    print(
        f"livability.json: {len(communes)} communes · "
        f"{with_hospital} with hospital · {with_station} with station"
    )


if __name__ == "__main__":
    main()
