/**
 * Hook für Command Palette Commands
 *
 * Definiert alle verfügbaren Befehle für die Command Palette
 */
import { useMemo } from "preact/hooks";
import { useI18n } from "../utils/i18n";
import type { Command } from "../renderer/components/CommandPalette";

interface UseCommandsOptions {
  // Navigation
  onGotoStart: () => void;
  onGotoEnd: () => void;
  onToggleFollow: () => void;
  isFollowing: boolean;

  // Filter
  onSetLevelFilter: (level: string) => void;
  onClearFilters: () => void;
  onToggleMarked: () => void;
  isOnlyMarked: boolean;
  onFocusSearch: () => void;

  // Dialogs
  onOpenSettings: () => void;
  onOpenElastic: () => void;
  onOpenHelp: () => void;
  onOpenAlerts?: () => void;
  onOpenStats?: () => void;

  // File
  onOpenFile: () => void;
  onClearLogs: () => void;
  onExportLogs: () => void;

  // TCP
  onStartTcp: () => void;
  onStopTcp: () => void;
  isTcpActive: boolean;

  // Theme
  onToggleTheme: () => void;
  currentTheme: string;
}

export function useCommands(options: UseCommandsOptions): Command[] {
  const { t } = useI18n();

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      // === FILE ===
      {
        id: "open-file",
        label: t("commandPalette.commands.openFile") || "Datei öffnen",
        description:
          t("commandPalette.commands.openFileDesc") ||
          "Log-Datei von Festplatte öffnen",
        category: "file",
        shortcut: "⌘O",
        action: options.onOpenFile,
        keywords: ["open", "load", "import", "datei", "öffnen", "laden"],
      },
      {
        id: "clear-logs",
        label: t("commandPalette.commands.clearLogs") || "Logs leeren",
        description:
          t("commandPalette.commands.clearLogsDesc") ||
          "Alle geladenen Logs entfernen",
        category: "file",
        action: options.onClearLogs,
        keywords: [
          "clear",
          "delete",
          "remove",
          "löschen",
          "leeren",
          "entfernen",
        ],
      },
      {
        id: "export-logs",
        label: t("commandPalette.commands.exportLogs") || "Logs exportieren",
        description:
          t("commandPalette.commands.exportLogsDesc") ||
          "Sichtbare Logs als Datei speichern",
        category: "file",
        shortcut: "⌘S",
        action: options.onExportLogs,
        keywords: ["export", "save", "download", "speichern", "exportieren"],
      },

      // === NAVIGATION ===
      {
        id: "goto-start",
        label: t("commandPalette.commands.gotoStart") || "Zum Anfang",
        description:
          t("commandPalette.commands.gotoStartDesc") ||
          "Zum ersten Log-Eintrag springen",
        category: "navigation",
        shortcut: "Home",
        action: options.onGotoStart,
        keywords: ["start", "begin", "first", "anfang", "erster"],
      },
      {
        id: "goto-end",
        label: t("commandPalette.commands.gotoEnd") || "Zum Ende",
        description:
          t("commandPalette.commands.gotoEndDesc") ||
          "Zum letzten Log-Eintrag springen",
        category: "navigation",
        shortcut: "End",
        action: options.onGotoEnd,
        keywords: ["end", "last", "bottom", "ende", "letzter"],
      },
      {
        id: "toggle-follow",
        label:
          t("commandPalette.commands.toggleFollow") ||
          "Follow-Modus umschalten",
        description: options.isFollowing
          ? "Follow-Modus deaktivieren"
          : t("commandPalette.commands.toggleFollowDesc") ||
            "Automatisch zum neuesten Log scrollen",
        category: "navigation",
        shortcut: "F",
        action: options.onToggleFollow,
        keywords: ["follow", "auto", "scroll", "tail", "folgen"],
      },

      // === FILTER ===
      {
        id: "focus-search",
        label: t("commandPalette.commands.focusSearch") || "Suche fokussieren",
        description:
          t("commandPalette.commands.focusSearchDesc") ||
          "Zum Suchfeld springen",
        category: "filter",
        shortcut: "/",
        action: options.onFocusSearch,
        keywords: ["search", "find", "suchen", "finden"],
      },
      {
        id: "filter-error",
        label:
          t("commandPalette.commands.filterError") || "Nur Errors anzeigen",
        description:
          t("commandPalette.commands.filterErrorDesc") ||
          "Filter auf ERROR-Level setzen",
        category: "filter",
        action: () => options.onSetLevelFilter("ERROR"),
        keywords: ["error", "fehler", "red", "rot"],
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ),
      },
      {
        id: "filter-warn",
        label:
          t("commandPalette.commands.filterWarn") || "Nur Warnings anzeigen",
        description:
          t("commandPalette.commands.filterWarnDesc") ||
          "Filter auf WARN-Level setzen",
        category: "filter",
        action: () => options.onSetLevelFilter("WARN"),
        keywords: ["warn", "warning", "warnung", "yellow", "gelb"],
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ),
      },
      {
        id: "filter-info",
        label: t("commandPalette.commands.filterInfo") || "Nur Info anzeigen",
        description:
          t("commandPalette.commands.filterInfoDesc") ||
          "Filter auf INFO-Level setzen",
        category: "filter",
        action: () => options.onSetLevelFilter("INFO"),
        keywords: ["info", "information", "green", "grün"],
        icon: (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10b981"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        ),
      },
      {
        id: "clear-filter",
        label:
          t("commandPalette.commands.clearFilter") || "Filter zurücksetzen",
        description:
          t("commandPalette.commands.clearFilterDesc") ||
          "Alle aktiven Filter entfernen",
        category: "filter",
        shortcut: "⌘⌫",
        action: options.onClearFilters,
        keywords: ["clear", "reset", "remove", "zurücksetzen", "löschen"],
      },
      {
        id: "toggle-marked",
        label: t("commandPalette.commands.toggleMarked") || "Nur Markierte",
        description: options.isOnlyMarked
          ? "Alle anzeigen"
          : t("commandPalette.commands.toggleMarkedDesc") ||
            "Nur markierte Einträge anzeigen",
        category: "filter",
        shortcut: "M",
        action: options.onToggleMarked,
        keywords: ["mark", "markiert", "highlight", "color", "farbe"],
      },

      // === VIEW / SETTINGS ===
      {
        id: "open-settings",
        label:
          t("commandPalette.commands.openSettings") || "Einstellungen öffnen",
        description:
          t("commandPalette.commands.openSettingsDesc") ||
          "App-Einstellungen bearbeiten",
        category: "settings",
        shortcut: "⌘,",
        action: options.onOpenSettings,
        keywords: [
          "settings",
          "preferences",
          "config",
          "einstellungen",
          "optionen",
        ],
      },
      ...(options.onOpenAlerts
        ? [
            {
              id: "open-alerts",
              label: t("commandPalette.commands.openAlerts") || "Alerts…",
              description:
                t("commandPalette.commands.openAlertsDesc") ||
                "Benachrichtigungs-Regeln verwalten",
              category: "settings" as const,
              action: options.onOpenAlerts,
              keywords: ["alert", "notification", "rules", "warnung", "regel"],
            },
          ]
        : []),
      ...(options.onOpenStats
        ? [
            {
              id: "open-stats",
              label:
                t("commandPalette.commands.openStats") || "Statistik anzeigen",
              description:
                t("commandPalette.commands.openStatsDesc") ||
                "Histogramm & Top-Logger der aktuellen Ansicht",
              category: "view" as const,
              action: options.onOpenStats,
              keywords: [
                "stats",
                "statistics",
                "analytics",
                "histogram",
                "statistik",
                "auswertung",
              ],
            },
          ]
        : []),
      {
        id: "toggle-theme",
        label: t("commandPalette.commands.toggleTheme") || "Theme wechseln",
        description:
          options.currentTheme === "dark"
            ? "Zu hellem Theme wechseln"
            : "Zu dunklem Theme wechseln",
        category: "settings",
        action: options.onToggleTheme,
        keywords: ["theme", "dark", "light", "dunkel", "hell", "mode"],
      },
      {
        id: "open-elastic",
        label:
          t("commandPalette.commands.openElastic") || "Elasticsearch-Suche",
        description:
          t("commandPalette.commands.openElasticDesc") ||
          "Logs aus Elasticsearch laden",
        category: "settings",
        shortcut: "⌘E",
        action: options.onOpenElastic,
        keywords: ["elastic", "elasticsearch", "es", "search", "query"],
      },

      // === TCP ===
      options.isTcpActive
        ? {
            id: "stop-tcp",
            label: t("commandPalette.commands.stopTcp") || "TCP-Server stoppen",
            description:
              t("commandPalette.commands.stopTcpDesc") || "TCP-Empfang beenden",
            category: "settings",
            action: options.onStopTcp,
            keywords: ["tcp", "server", "stop", "stoppen", "beenden"],
          }
        : {
            id: "start-tcp",
            label:
              t("commandPalette.commands.startTcp") || "TCP-Server starten",
            description:
              t("commandPalette.commands.startTcpDesc") ||
              "Logs über TCP empfangen",
            category: "settings",
            action: options.onStartTcp,
            keywords: ["tcp", "server", "start", "starten", "listen"],
          },

      // === HELP ===
      {
        id: "open-help",
        label: t("commandPalette.commands.openHelp") || "Hilfe anzeigen",
        description:
          t("commandPalette.commands.openHelpDesc") || "Tastenkürzel und Hilfe",
        category: "help",
        shortcut: "F1",
        action: options.onOpenHelp,
        keywords: ["help", "hilfe", "keyboard", "shortcuts", "tastatur"],
      },
    ];

    return cmds;
  }, [t, options]);

  return commands;
}
