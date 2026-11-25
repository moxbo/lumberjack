---
name: ncu-review
description: >
  Führt npm-check-updates aus und prüft, welche Updates in Lumberjack Migrationen
  erfordern, neue Features nutzbar machen, eigenen Code ersetzen oder messbare
  Optimierungen ermöglichen. Bei NCU- oder Dependency-Reviews verwenden.
---

# NCU-Review für Lumberjack

Gib einen Bericht aus, ohne Projektdateien zu ändern. Aktualisiere keine Pakete
und lege auch den Bericht nicht als Datei im Repository ab.

## 1. Update-Kandidaten ermitteln

Lies die Update-Regeln in [CONTRIBUTING.md](../../../CONTRIBUTING.md).
Führe im Repository-Root mit Node 22.x ab 22.22.2 und npm ab 10 aus:

```sh
npx --yes npm-check-updates@23.1.1 --packageFile package.json --reject typescript --jsonUpgraded --no-upgrade
```

Verwende nur das Root-Manifest; `release/app/package.json` wird generiert.
TypeScript ist wegen der Peer-Anforderung von `@typescript-eslint/parser`
ausgenommen. Vergleiche die Zielversion jedes Kandidaten mit der tatsächlich
aufgelösten Version in `package-lock.json`, nicht nur mit dem Bereich in
`package.json`. Ist das Ziel schon installiert, melde nur die Bereichsänderung.
Melde bei einem erfolgreichen leeren Ergebnis „Keine Update-Kandidaten“.
Schlägt der Aufruf fehl, nenne den Fehler statt eines leeren Ergebnisses.

## 2. Änderungen mit der Nutzung im Repository abgleichen

Lies die offiziellen Release Notes oder Migrationsleitfäden zwischen Ist und
Ziel. Suche für die geänderte API nach konkreten Aufrufen, Konfigurationen und
Tests. Unterscheide:

- **Pflichtmigration:** Welche verwendete API entfällt oder verhält sich anders?
  Prüfe auch Node-, Electron- und Peer-Anforderungen sowie `overrides`.
- **Neue Features und Verbesserungen:** Welche neue API vereinfacht eine
  bestehende Funktion? Welcher Bugfix löst ein Problem an einer konkreten Stelle?
- **Obsoleter Code:** Welchen Workaround ersetzt das Update? Prüfe unterstützte
  Plattformen und indirekte Aufrufe. Ein fehlender statischer Import ist etwa
  bei Electron-IPC kein Beleg dafür, dass ein Handler unbenutzt ist.
- **Optimierung:** Benenne die erwartete Wirkung und eine passende Messung,
  bei Filteränderungen etwa `npm run test:filter-latency`. Ohne vergleichbare
  Vorher-/Nachher-Messung bleibt der Gewinn eine Hypothese.

## 3. Bericht liefern

Liste Pflichtmigrationen vor optionalen Verbesserungen. Gib pro Befund an:
**Paket (Lock-Version → Ziel)**, **Kategorie**, **Link zur Release-Note**,
**Datei:Zeile**, **Empfehlung mit Nutzen** und **passender Test oder Messwert**.
Ist keine Codeanpassung nötig, sage das ausdrücklich. Fehlt eine belastbare
Quelle oder lässt sich die Nutzung nicht klären, markiere den Punkt als
„nicht verifiziert“, statt eine Änderung oder Löschung zu empfehlen.
