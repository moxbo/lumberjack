/**
 * Command Palette Component
 *
 * Schneller Zugriff auf alle App-Funktionen via Cmd+K (macOS) / Ctrl+K (Windows/Linux)
 * Inspiriert von VS Code's Command Palette
 */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";
import { useI18n } from "../../utils/i18n";
import type { JSX } from "preact/jsx-runtime";

// Command Definition
export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: JSX.Element;
  shortcut?: string;
  category: "navigation" | "filter" | "view" | "file" | "settings" | "help";
  action: () => void;
  keywords?: string[]; // Zusätzliche Suchbegriffe
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

// Kategorie-Labels und Icons
function getCategoryConfig(
  t: (key: string) => string,
): Record<string, { label: string; icon: JSX.Element }> {
  return {
    navigation: {
      label: t("commandPalette.categories.navigation"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 12h18M12 3v18" />
        </svg>
      ),
    },
    filter: {
      label: t("commandPalette.categories.filter"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      ),
    },
    view: {
      label: t("commandPalette.categories.view"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
    },
    file: {
      label: t("commandPalette.categories.file"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      ),
    },
    settings: {
      label: t("commandPalette.categories.settings"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
    help: {
      label: t("commandPalette.categories.help"),
      icon: (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
    },
  };
}

// Fuzzy search scoring
function fuzzyMatch(text: string, query: string): number {
  if (!query) return 1;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exakter Match am Anfang = höchste Punktzahl
  if (textLower.startsWith(queryLower)) return 100;

  // Enthält Query = hohe Punktzahl
  if (textLower.includes(queryLower)) return 50;

  // Fuzzy Match (alle Zeichen in Reihenfolge vorhanden)
  let queryIdx = 0;
  let score = 0;
  let consecutive = 0;

  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      score += 1 + consecutive;
      consecutive++;
      queryIdx++;
    } else {
      consecutive = 0;
    }
  }

  // Alle Query-Zeichen gefunden?
  if (queryIdx === queryLower.length) {
    return score;
  }

  return 0;
}

function scoreCommand(
  command: Command,
  query: string,
  catConfig: Record<string, { label: string }>,
): number {
  if (!query) return 1;

  let maxScore = fuzzyMatch(command.label, query);

  if (command.description) {
    maxScore = Math.max(maxScore, fuzzyMatch(command.description, query) * 0.8);
  }

  if (command.keywords) {
    for (const keyword of command.keywords) {
      maxScore = Math.max(maxScore, fuzzyMatch(keyword, query) * 0.9);
    }
  }

  // Kategorie-Match
  const catLabel = catConfig[command.category]?.label || "";
  maxScore = Math.max(maxScore, fuzzyMatch(catLabel, query) * 0.5);

  return maxScore;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: CommandPaletteProps): JSX.Element | null {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const categoryConfig = useMemo(() => getCategoryConfig(t), [t]);

  // Filter und sortiere Commands basierend auf Query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      // Ohne Query: nach Kategorie gruppiert
      return commands;
    }

    return commands
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, query, categoryConfig) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ cmd }) => cmd);
  }, [commands, query, categoryConfig]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input after mount
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            onClose();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredCommands, selectedIndex, onClose],
  );

  // Global keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (macOS) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // Gruppiere nach Kategorie wenn kein Query
  const groupedCommands = useMemo(() => {
    if (query.trim()) return null;

    const groups: Record<string, Command[]> = {};
    for (const cmd of filteredCommands) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      const categoryGroup = groups[cmd.category];
      if (categoryGroup) {
        categoryGroup.push(cmd);
      }
    }
    return groups;
  }, [filteredCommands, query]);

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown as any}
      >
        {/* Search Input */}
        <div className="command-palette-input-wrapper">
          <svg
            className="command-palette-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={t("commandPalette.placeholder")}
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setSelectedIndex(0);
            }}
          />
          <kbd className="command-palette-shortcut">ESC</kbd>
        </div>

        {/* Command List */}
        <div className="command-palette-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">
              {t("commandPalette.noResults")}
            </div>
          ) : groupedCommands ? (
            // Gruppierte Ansicht
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="command-palette-group">
                <div className="command-palette-group-header">
                  {categoryConfig[category]?.icon}
                  <span>{categoryConfig[category]?.label || category}</span>
                </div>
                {cmds.map((cmd) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  return (
                    <CommandItem
                      key={cmd.id}
                      command={cmd}
                      isSelected={globalIndex === selectedIndex}
                      index={globalIndex}
                      onSelect={() => {
                        cmd.action();
                        onClose();
                      }}
                      onHover={() => setSelectedIndex(globalIndex)}
                      categoryConfig={categoryConfig}
                    />
                  );
                })}
              </div>
            ))
          ) : (
            // Flache Liste (mit Query)
            filteredCommands.map((cmd, index) => (
              <CommandItem
                key={cmd.id}
                command={cmd}
                isSelected={index === selectedIndex}
                index={index}
                onSelect={() => {
                  cmd.action();
                  onClose();
                }}
                onHover={() => setSelectedIndex(index)}
                categoryConfig={categoryConfig}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> {t("commandPalette.footer.navigate")}
          </span>
          <span>
            <kbd>Enter</kbd> {t("commandPalette.footer.execute")}
          </span>
          <span>
            <kbd>ESC</kbd> {t("commandPalette.footer.close")}
          </span>
        </div>
      </div>
    </div>
  );
}

// Einzelner Command-Eintrag
interface CommandItemProps {
  command: Command;
  isSelected: boolean;
  index: number;
  onSelect: () => void;
  onHover: () => void;
  categoryConfig: Record<string, { label: string; icon: JSX.Element }>;
}

function CommandItem({
  command,
  isSelected,
  index,
  onSelect,
  onHover,
  categoryConfig,
}: CommandItemProps): JSX.Element {
  return (
    <div
      className={`command-palette-item ${isSelected ? "selected" : ""}`}
      data-index={index}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <div className="command-palette-item-icon">
        {command.icon || categoryConfig[command.category]?.icon}
      </div>
      <div className="command-palette-item-content">
        <span className="command-palette-item-label">{command.label}</span>
        {command.description && (
          <span className="command-palette-item-description">
            {command.description}
          </span>
        )}
      </div>
      {command.shortcut && (
        <kbd className="command-palette-item-shortcut">{command.shortcut}</kbd>
      )}
    </div>
  );
}

export default CommandPalette;
