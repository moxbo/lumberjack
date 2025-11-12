import { SettingsService } from "../src/services/SettingsService";

async function run() {
  const svc = new SettingsService();
  await svc.load();
  console.log("Initial settings loaded");
  // Erste Änderung
  svc.update({ tcpPort: 5555 });
  await svc.save();
  // Zweite Änderung (keine Änderung) -> sollte "No changes" loggen
  await svc.save();
  // Dritte Änderung
  svc.update({ locale: "en", elasticMaxParallel: 4 });
  svc.saveSync();
}
run().catch((e) => console.error(e));
