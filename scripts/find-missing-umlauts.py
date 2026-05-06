#!/usr/bin/env python3
"""Find suspicious German words missing umlauts."""
from __future__ import annotations
import pathlib, re

PATS = [
    "Hufig","Lsung","beschdigt","unvollstndig","ffnen","ffne","whlen","gltig",
    "knnen","mglich","whrend","wchst","luft","Verzgerung","mssen","Stck",
    "jhrlich","Mglich","spter","frhe","rckw","natrl","tatsch","schtz","erhh",
    "Erhh","hher","Verfg","verfg","nderung","Lsch","lsch","gelsch",
    "Stabilitt","Manahme","regelmig","gengt","gengen","ntig","Eintrge",
    "Eintrgen","besttig","Datenstze","Schlssel","jhrl","zukn","sptere",
    "Hher","grer","Strung","unmgli","Trgt","trgt","Beschdig",
    "ausfhr","auswhl","Prvent","Bestt","fhren","Whrend",
]

def main() -> int:
    p = pathlib.Path("docs/user/TROUBLESHOOTING_AND_FAQ.md")
    text = p.read_text(encoding="utf-8")
    hits = []
    for pat in PATS:
        for m in re.finditer(re.escape(pat), text):
            ctx = text[max(0, m.start()-30): m.end()+30].replace("\n", " ")
            hits.append(f"  {pat!r}: ...{ctx}...")
    print(f"Verdaechtige Treffer: {len(hits)}")
    for h in hits[:80]:
        print(h)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

