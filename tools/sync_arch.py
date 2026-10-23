"""Az Arch/ tükör frissítése a vault aktuális tervezési köréből.

A mester a `Projekt dokumentációk/Tervezés/<aktuális kör>/` mappa; az `Arch/` ennek
bájtra azonos másolata, hogy a README, a flotta és az agentek stabil útvonalra
hivatkozhassanak. Új kör nyitásakor csak a CURRENT_ROUND értékét kell átírni.

Használat (Windows: `py -3`):
    py -3 tools/sync_arch.py          # másolja az eltérő fájlokat a vaultból az Arch/-ba
    py -3 tools/sync_arch.py --check  # csak ellenőriz; eltérésnél 1-es kóddal lép ki
"""

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

CURRENT_ROUND = "Tervezés (hetedik kör)"

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "Projekt dokumentációk" / "Tervezés" / CURRENT_ROUND
MIRROR = ROOT / "Arch"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="csak ellenőrzés, nem másol")
    args = parser.parse_args()

    if not SOURCE.is_dir():
        print(f"HIBA: nincs ilyen vault-mappa: {SOURCE}", file=sys.stderr)
        return 2

    sources = sorted(p for p in SOURCE.glob("*.md") if p.is_file())
    drift = False

    for src in sources:
        dst = MIRROR / src.name
        if dst.is_file() and filecmp.cmp(src, dst, shallow=False):
            print(f"  azonos   {src.name}")
            continue
        drift = True
        state = "eltér" if dst.exists() else "hiányzik"
        if args.check:
            print(f"  {state:<8} {src.name}")
        else:
            shutil.copy2(src, dst)
            print(f"  másolva  {src.name} ({state} volt)")

    source_names = {p.name for p in sources}
    for extra in sorted(MIRROR.glob("*.md")):
        if extra.name not in source_names:
            drift = True
            print(f"  csak az Arch/-ban: {extra.name} (kézzel döntsd el: vaultba vagy törlés)")

    print(f"Forrás: {SOURCE.relative_to(ROOT)}")
    if args.check:
        print("Eltérés van." if drift else "Az Arch/ szinkronban van.")
        return 1 if drift else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
