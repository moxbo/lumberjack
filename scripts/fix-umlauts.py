#!/usr/bin/env python3
"""Restore German umlauts in TROUBLESHOOTING_AND_FAQ.md.

The original file was committed without umlauts (ä/ö/ü/ß stripped).
This script applies a curated word-level mapping. Code fences and
ASCII-only words are unaffected.
"""
from __future__ import annotations
import pathlib

MAPPING: dict[str, str] = {
    # subtitle / chapter words
    "Hufige": "H\u00e4ufige",
    "hufige": "h\u00e4ufige",
    "hufigem": "h\u00e4ufigem",
    "Lsungen": "L\u00f6sungen",
    "Lsung": "L\u00f6sung",
    # security warnings
    "beschdigt": "besch\u00e4digt",
    "unvollstndig": "unvollst\u00e4ndig",
    "mglicherweise": "m\u00f6glicherweise",
    "mglich": "m\u00f6glich",
    "Mglichkeit": "M\u00f6glichkeit",
    "Mglichkeiten": "M\u00f6glichkeiten",
    "geffnet": "ge\u00f6ffnet",
    "ffnen": "\u00f6ffnen",
    "auswhlen": "ausw\u00e4hlen",
    "whlen": "w\u00e4hlen",
    "gewhlt": "gew\u00e4hlt",
    "zuknftige": "zuk\u00fcnftige",
    "zuknftig": "zuk\u00fcnftig",
    "besttigen": "best\u00e4tigen",
    "Besttigung": "Best\u00e4tigung",
    "ausfhren": "ausf\u00fchren",
    # "Fr" -> "Für" (only as standalone word, but trailing space variant is safe)
    "Fr Entwickler": "F\u00fcr Entwickler",
    "Fr installierte": "F\u00fcr installierte",
    "Fr DMG": "F\u00fcr DMG",
    "Fr ZIP": "F\u00fcr ZIP",
    # general german
    "berprfen": "\u00fcberpr\u00fcfen",
    "berprfe": "\u00dcberpr\u00fcfe",
    "berprft": "\u00fcberpr\u00fcft",
    "berprfung": "\u00dcberpr\u00fcfung",
    "Prvention": "Pr\u00e4vention",
    "regelmig": "regelm\u00e4\u00dfig",
    "Sofort-Manahme": "Sofort-Ma\u00dfnahme",
    "Manahmen": "Ma\u00dfnahmen",
    "Manahme": "Ma\u00dfnahme",
    "whrend": "w\u00e4hrend",
    "Whrend": "W\u00e4hrend",
    "wchst": "w\u00e4chst",
    "Verzgerung": "Verz\u00f6gerung",
    "Eintrgen": "Eintr\u00e4gen",
    "Eintrge": "Eintr\u00e4ge",
    "ntig": "n\u00f6tig",
    "Knnen": "K\u00f6nnen",
    "knnen": "k\u00f6nnen",
    "gltig": "g\u00fcltig",
    "ungltig": "ung\u00fcltig",
    "ndern": "\u00e4ndern",
    "gendert": "ge\u00e4ndert",
    "nderungen": "\u00c4nderungen",
    "Lschen": "L\u00f6schen",
    "lschen": "l\u00f6schen",
    "gelscht": "gel\u00f6scht",
    "Stabilitt": "Stabilit\u00e4t",
    "Verfgbarkeit": "Verf\u00fcgbarkeit",
    "verfgbar": "verf\u00fcgbar",
    "luft": "l\u00e4uft",
    "frhzeitig": "fr\u00fchzeitig",
    "frher": "fr\u00fcher",
    "spter": "sp\u00e4ter",
    "sptere": "sp\u00e4tere",
    "natrlich": "nat\u00fcrlich",
    "tatschlich": "tats\u00e4chlich",
    "rckwrts": "r\u00fcckw\u00e4rts",
    "Datenstze": "Datens\u00e4tze",
    "Schlssel": "Schl\u00fcssel",
    "mssen": "m\u00fcssen",
    "Mssen": "M\u00fcssen",
    "Trgt": "Tr\u00e4gt",
    "trgt": "tr\u00e4gt",
    "Erhhe": "Erh\u00f6he",
    "erhhe": "erh\u00f6he",
    "erhht": "erh\u00f6ht",
    "Hher": "H\u00f6her",
    "hher": "h\u00f6her",
    "schtzt": "sch\u00fctzt",
    "schtzen": "sch\u00fctzen",
    "geschtzt": "gesch\u00fctzt",
    "Stck": "St\u00fcck",
    "Stcke": "St\u00fccke",
    "jhrlich": "j\u00e4hrlich",
    "Verfgbar": "Verf\u00fcgbar",
    "Eintrag": "Eintrag",  # bereits korrekt – dient als Sicherung
    # phrase-level (safer than single 'Fr ' replacement)
    "Fr  ": "F\u00fcr ",  # falls doppelt
}


def collapse_double_umlauts(text: str) -> str:
    """Repair accidental doubled umlauts (idempotency safety net)."""
    for ch in "\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df":
        text = text.replace(ch + ch, ch)
    return text


def main() -> int:
    p = pathlib.Path("docs/user/TROUBLESHOOTING_AND_FAQ.md")
    text = p.read_text(encoding="utf-8")
    # 1) Erst doppelte Umlaute zusammenklappen (falls Skript schon mal lief)
    text = collapse_double_umlauts(text)
    # 2) Dann fehlende Umlaute ergänzen (längste Schlüssel zuerst)
    for k in sorted(MAPPING, key=len, reverse=True):
        v = MAPPING[k]
        if k != v and k in text:
            text = text.replace(k, v)
    # 3) Sicherheits-Pass: erneut Doppel kollabieren
    text = collapse_double_umlauts(text)
    p.write_text(text, encoding="utf-8")
    print("normalized:", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

