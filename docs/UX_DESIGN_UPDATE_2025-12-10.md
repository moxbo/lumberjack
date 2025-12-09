# 🎨 UX & Design Update – 10.12.2025

> **Benutzerfreundliche Oberfläche • Accessibility • Moderne Interaktionen**

---

## 📋 Übersicht

Umfassende Überarbeitung des UI/UX-Designs der Lumberjack Electron App für bessere Benutzerfreundlichkeit,
Zugänglichkeit und moderne Ästhetik.

---

## ✅ Durchgeführte Änderungen

### 1. 🔘 Buttons

| Vorher               | Nachher                                      |
|----------------------|----------------------------------------------|
| Einfaches Styling    | Hover-Animation mit Lift-Effekt              |
| Kein Fokus-Indikator | Sichtbarer Focus-Ring für Accessibility      |
| Einheitliches Design | Varianten: Primary, Danger, Ghost, Icon-only |

```css
/* Neue Button-Varianten */
.btn-primary → Gradient-Hintergrund, weiße Schrift
.btn-danger → Roter Hintergrund für destruktive Aktionen
.btn-ghost → Transparenter Hintergrund
.btn-icon → Quadratisch für Icon-only Buttons
```

### 2. 📝 Input-Felder

- **Hover-State**: Rand färbt sich beim Überfahren
- **Focus-State**: Blaue Umrandung + Schatten
- **Placeholder**: Gedimmte Farbe für bessere Lesbarkeit
- **Volle Breite**: Inputs füllen Container standardmäßig

### 3. 🏷️ Log-Level Badges

| Level | Verbesserung                     |
|-------|----------------------------------|
| TRACE | Pill-Form, zentriert             |
| DEBUG | Konsistente Mindestbreite        |
| INFO  | Animierte Hover-Effekte          |
| WARN  | Bessere Farbkontraste            |
| ERROR | Klare Warnsignale                |
| FATAL | Pulsierender Effekt (Attention!) |

### 4. 📊 Tabellenzeilen

```
┌─────────────────────────────────────────────┐
│ Zeile im Normalzustand                      │
├─────────────────────────────────────────────┤
│ ▌ Hover: Linker blauer Rand + Hintergrund   │
├─────────────────────────────────────────────┤
│ █ Selektiert: Stärkerer blauer Rand         │
└─────────────────────────────────────────────┘
```

- **Hover**: Sanfte Hintergrundänderung + linker Akzentrand
- **Selektiert**: Deutlicherer linker Rand
- **Fokus-Ring**: Für Keyboard-Navigation

### 5. 🪟 Modals & Dialoge

- **Animation**: Slide-up + Fade-in beim Öffnen
- **Backdrop**: Dunklerer Hintergrund (0.5 statt 0.35)
- **Schatten**: Tieferer Shadow + innerer Glow
- **Runde Ecken**: 16px statt 12px
- **Aktionen**: Separiert durch Border-Top

### 6. 📑 Tabs

```
┌──────────────────────────────────┐
│ ╭───────╮ ╭───────╮ ╭───────╮   │
│ │ Tab 1 │ │ Tab 2 │ │ Tab 3 │   │
│ ╰───────╯ ╰───────╯ ╰───────╯   │
└──────────────────────────────────┘
```

- **Pillen-Design**: Runde Tabs statt Flat-Buttons
- **Active-State**: Gradient-Hintergrund
- **Spacing**: Bessere Abstände zwischen Tabs

### 7. 🏷️ Badges

| Typ       | Aussehen                   |
|-----------|----------------------------|
| `on`      | Grün mit Punkt-Indikator ● |
| `off`     | Grau mit Ring-Indikator ○  |
| `warning` | Orange für Warnungen       |
| `error`   | Rot für Fehler             |

### 8. 🍿 Context Menu

- **Animation**: Scale-in beim Öffnen
- **Padding**: Mehr Innenabstand
- **Item-Styling**: Runde Ecken auf Items
- **Destructive Items**: Rot gefärbt mit speziellem Hover

---

## 🆕 Neue Utility-Klassen

### Tooltips

```html

<button data-tooltip="Beschreibung">Hover mich</button>
```

### Empty States

```html

<div class="empty-state">
    <div class="empty-state-icon">📭</div>
    <div class="empty-state-title">Keine Einträge</div>
    <div class="empty-state-description">Es wurden noch keine Logs empfangen.</div>
</div>
```

### Skeleton Loading

```html

<div class="skeleton skeleton-text"></div>
<div class="skeleton skeleton-text short"></div>
```

### Toast Notifications

```html

<div class="toast success">Erfolgreich gespeichert!</div>
<div class="toast error">Fehler beim Speichern</div>
<div class="toast warning">Achtung: Speicher fast voll</div>
<div class="toast info">Neue Version verfügbar</div>
```

### Keyboard Hints

```html
<span class="kbd">⌘</span> + <span class="kbd">K</span>
```

### Switch/Toggle

```html
<label class="switch">
    <input type="checkbox">
    <span class="switch-slider"></span>
</label>
```

### Progress Bar

```html

<div class="progress">
    <div class="progress-bar" style="width: 75%"></div>
</div>
```

### Cards

```html

<div class="card interactive">
    <div class="card-header">
        <span class="card-title">Titel</span>
    </div>
    Inhalt...
</div>
```

---

## ♿ Accessibility-Verbesserungen

### Focus-Management

- Alle interaktiven Elemente haben sichtbare Focus-Ringe
- `focus-visible` statt `focus` für bessere UX
- Konsistente Outline-Styles

### Screen Reader

```css
.sr-only {
    /* Versteckt visuell, aber für Screen Reader sichtbar */
}
```

### Responsive Design

```css
.hide-sm /* Versteckt unter 640px */
.hide-md /* Versteckt unter 768px */
.show-md-only

/* Nur sichtbar unter 768px */
```

---

## 🎭 Animation-Helpers

| Klasse              | Effekt                  |
|---------------------|-------------------------|
| `.animate-fade-in`  | Sanftes Einblenden      |
| `.animate-slide-up` | Von unten hereingleiten |
| `.animate-bounce`   | Kurzes Hüpfen           |

---

## 📏 Spacing & Layout

### Details-Panel

- **Mehr Padding**: 20px 24px statt 18px 20px
- **Meta-Grid**: Hintergrundfarbe + runde Ecken
- **Header**: Optionaler Header mit Border-Bottom

### Toolbar

- **Gruppentrennungen**: Visuelle Separator zwischen Sektionen
- **Kompaktere Gaps**: Optimierter Abstand

---

## 🎨 Farbverbesserungen

### Dark Mode

```css
--details-glass-bg:

rgba
(
28
,
32
,
38
,
0.35
)
;
/* Leicht transparenter für mehr Glaseffekt */
```

### Light Mode

```css
--details-glass-bg:

rgba
(
255
,
255
,
255
,
0.55
)
;
/* Ausreichend deckend für Lesbarkeit */
```

---

## 📊 Vorher/Nachher Vergleich

| Aspekt            | Vorher |  Nachher  |
|-------------------|:------:|:---------:|
| Button-Varianten  |   1    |     4     |
| Focus-Indikatoren |   🔴   |    🟢     |
| Animationen       |   3    |    10+    |
| Utility-Klassen   |   ~0   |    20+    |
| Accessibility     | Basic  | Erweitert |

---

## 🔧 Technische Details

### Datei

`src/main/styles.css`

### Größe

~1900 Zeilen CSS (von ~1600)

### Neue CSS-Features

- `@keyframes` Animationen
- CSS Custom Properties für alles
- `:focus-visible` für bessere Focus-Styles
- `animation` für UI-Feedback

---

## 📌 Nächste UX-Schritte

- [ ] **Dark/Light Mode Toggle**: Benutzerfreundlicherer Umschalter
- [ ] **Onboarding**: Erste-Schritte-Guide für neue Benutzer
- [ ] **Keyboard Shortcuts Panel**: Übersicht aller Tastenkombinationen
- [ ] **Drag & Drop Feedback**: Bessere visuelle Rückmeldung

---

<div align="center">

**🎨 Design ist nicht nur wie es aussieht, sondern wie es funktioniert.**

*Lumberjack Electron App – UX Update 10.12.2025*

</div>

