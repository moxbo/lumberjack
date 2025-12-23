# Code Signing Guide für Lumberjack

Diese Anleitung beschreibt, wie Code Signing für macOS und Windows eingerichtet wird.

---

## 📋 Übersicht

| Plattform | Zertifikat | Kosten | Nutzen |
|-----------|------------|--------|--------|
| **macOS** | Apple Developer ID | $99/Jahr | Keine Gatekeeper-Warnung |
| **Windows** | EV Code Signing Certificate | $200-500/Jahr | Keine SmartScreen-Warnung |
| **Windows** | Standard OV Certificate | $70-300/Jahr | SmartScreen baut Reputation auf |

---

## 🍎 macOS Code Signing & Notarization

### Voraussetzungen

1. **Apple Developer Account** ($99/Jahr)
   - Registrierung: https://developer.apple.com/programs/
   - Dauer: 1-2 Tage für Genehmigung

2. **Developer ID Application Certificate**
   - Erstellen in: Xcode → Preferences → Accounts → Manage Certificates
   - Oder: https://developer.apple.com/account/resources/certificates/

3. **App-Specific Password** (für Notarization)
   - Erstellen unter: https://appleid.apple.com/account/manage
   - Unter "Security" → "App-Specific Passwords"

### Zertifikat erstellen

```bash
# 1. CSR (Certificate Signing Request) erstellen
openssl req -new -keyout developer-id.key -out developer-id.csr

# 2. CSR bei Apple hochladen (developer.apple.com)
# 3. Zertifikat herunterladen und im Schlüsselbund installieren

# Prüfen, ob Zertifikat installiert ist:
security find-identity -v -p codesigning
```

### Umgebungsvariablen für CI/CD

```bash
# Für lokales Signing
export CSC_LINK="path/to/certificate.p12"
export CSC_KEY_PASSWORD="your-certificate-password"

# Für Notarization
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"  # 10-stellige Team ID
```

### GitHub Secrets einrichten

| Secret Name | Beschreibung |
|-------------|--------------|
| `CSC_LINK` | Base64-encoded .p12 Zertifikat |
| `CSC_KEY_PASSWORD` | Passwort für das Zertifikat |
| `APPLE_ID` | Apple ID E-Mail |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-spezifisches Passwort |
| `APPLE_TEAM_ID` | 10-stellige Team ID |

```bash
# Zertifikat zu Base64 konvertieren:
base64 -i certificate.p12 | pbcopy
# → In GitHub Secret CSC_LINK einfügen
```

### afterSign Hook für Notarization

Erstelle `scripts/afterSign.cjs`:

```javascript
const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Nur in CI oder wenn Credentials vorhanden
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.log('Skipping notarization: APPLE_ID or APPLE_APP_SPECIFIC_PASSWORD not set');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarizing ${appPath}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log('Notarization complete!');
};
```

### package.json anpassen

```json
{
  "build": {
    "afterSign": "./scripts/afterSign.cjs",
    "mac": {
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

### Entitlements erstellen

Erstelle `build/entitlements.mac.plist`:

```plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

---

## 🪟 Windows Code Signing

### Option A: EV Code Signing Certificate (Empfohlen)

**Vorteile:**
- Sofortige SmartScreen-Reputation
- Keine Warnungen ab Tag 1
- Hardware-Token (sicherer)

**Anbieter & Preise (ca.):**
| Anbieter | 1 Jahr | 3 Jahre |
|----------|--------|---------|
| DigiCert | $474 | $1,269 |
| Sectigo | $319 | $599 |
| GlobalSign | $259 | $649 |
| SSL.com | $239 | $429 |

**Benötigt:**
- Firmenregistrierung/Gewerbeschein
- Identitätsnachweis
- Hardware-Token (meist inkludiert)

### Option B: Standard OV Certificate

**Vorteile:**
- Günstiger (~$70-200/Jahr)
- Keine Hardware nötig

**Nachteile:**
- SmartScreen zeigt zunächst Warnungen
- Reputation muss aufgebaut werden (Downloads)

### Umgebungsvariablen

```bash
# Für .pfx/.p12 Zertifikat (OV)
export CSC_LINK="path/to/certificate.pfx"
export CSC_KEY_PASSWORD="your-password"

# Für EV-Zertifikat mit Hardware-Token
export CSC_LINK="path/to/certificate.pfx"
export CSC_KEY_PASSWORD="your-token-pin"
# Zusätzlich: signtool.exe muss Token finden
```

### GitHub Secrets für Windows

| Secret Name | Beschreibung |
|-------------|--------------|
| `CSC_LINK` | Base64-encoded .pfx Zertifikat |
| `CSC_KEY_PASSWORD` | Zertifikat-Passwort |

```powershell
# Zertifikat zu Base64 konvertieren (PowerShell):
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Clipboard
```

### EV-Zertifikat in CI (Self-hosted Runner)

EV-Zertifikate benötigen einen Hardware-Token (USB), daher:
- **Option 1**: Self-hosted GitHub Runner mit angeschlossenem Token
- **Option 2**: Signing-Dienst wie Azure SignTool, SignPath.io

---

## 🔧 CI/CD Integration

### GitHub Actions Workflow anpassen

```yaml
# .github/workflows/build.yml

jobs:
  release:
    runs-on: ${{ matrix.os }}
    # ...
    steps:
      # Windows Signing
      - name: Build Windows (Signed)
        if: matrix.platform == 'win'
        run: npx electron-builder --win --publish never
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}

      # macOS Signing & Notarization
      - name: Build macOS (Signed)
        if: matrix.platform == 'mac'
        run: npx electron-builder --mac --publish never
        env:
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

---

## 📝 Checkliste

### macOS
- [ ] Apple Developer Account registriert ($99/Jahr)
- [ ] Developer ID Application Certificate erstellt
- [ ] App-Specific Password generiert
- [ ] `@electron/notarize` installiert: `npm i -D @electron/notarize`
- [ ] `scripts/afterSign.cjs` erstellt
- [ ] `build/entitlements.mac.plist` erstellt
- [ ] `package.json` mit `afterSign` und Entitlements aktualisiert
- [ ] GitHub Secrets konfiguriert

### Windows
- [ ] Code Signing Certificate gekauft (OV oder EV)
- [ ] .pfx Datei exportiert
- [ ] GitHub Secrets konfiguriert
- [ ] (EV) Self-hosted Runner oder Signing-Dienst eingerichtet

---

## 💡 Tipps

### Ohne Signing testen
```bash
# Signing temporär deaktivieren
export CSC_IDENTITY_AUTO_DISCOVERY=false
npm run build:mac:dmg
```

### Signature verifizieren

**macOS:**
```bash
codesign --verify --deep --strict /path/to/Lumberjack.app
spctl --assess --verbose=4 /path/to/Lumberjack.app
```

**Windows (PowerShell):**
```powershell
Get-AuthenticodeSignature "path\to\Lumberjack.exe"
```

---

## 🔗 Weiterführende Links

- [Apple Developer Program](https://developer.apple.com/programs/)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [Notarization Guide](https://www.electron.build/notarization)
- [DigiCert EV Certificates](https://www.digicert.com/signing/code-signing-certificates)
- [SSL.com Code Signing](https://www.ssl.com/certificates/ev-code-signing/)

