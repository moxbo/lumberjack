#!/usr/bin/env tsx
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { parsePaths } from "../src/main/parsers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function main() {
  const base = path.resolve(__dirname, "..");
  const files = [path.join(base, "adapter.teams_json.log")].filter((p) =>
    fs.existsSync(p),
  );

  // Inline Testfall: kaputte JSON-Zeile mit eingebettetem XML (aus Nutzerfrage)
  const brokenLine =
    '{"@timestamp":"2025-11-04T09:33:12.031424933+01:00","@version":"1","message":"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<TransportDeviceUpdated Id=\"AGV697\" Available=\"true\">\n    <Location Section=\"PB.B0206\"/>\n    <Command Id=\"35579\" Clearance=\"true\">\n        <Receive Section=\"WSTP.W06\" DoorDirection=\"HighBay\">\n            <Container Id=\"TGBU7296395\" Weight=\"12840\" Length=\"1219\" Width=\"244\" Height=\"290\"/>\n        </Receive>\n    </Command>\n    <Notification Code=\"9999\" Reference=\"44582\" Message=\"GREEN - ERRORENTRIES 3128( ON ) \"/>\n</TransportDevicemessage":"Notification sent"}';
  const tmpPath = path.join(__dirname, "broken_test.log");
  fs.writeFileSync(tmpPath, brokenLine + "\n", "utf8");
  files.push(tmpPath);

  if (!files.length) {
    console.log("Keine Beispiel-Logs gefunden.");
    process.exit(0);
  }

  const entries = parsePaths(files);
  console.log("Dateien:", files.map((f) => path.basename(f)).join(", "));
  console.log("Gesamt Einträge:", entries.length);
  const levels = entries.reduce((acc: any, e: any) => {
    const l = (e.level || "UNK").toUpperCase();
    acc[l] = (acc[l] || 0) + 1;
    return acc;
  }, {});
  console.log("Level Verteilung:", levels);
  console.log("Beispiel-Eintrag:", entries[0]);

  // Aufräumen: Temporäre Testdatei löschen
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }
}

main();
