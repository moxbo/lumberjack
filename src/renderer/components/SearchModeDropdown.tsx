/**
 * Search Mode Dropdown Component
 */
import { createPortal } from "preact/compat";
import type { SearchMode } from "../../utils/msgFilter";

interface SearchModeDropdownProps {
  searchMode: SearchMode;
  showOptions: boolean;
  onModeChange: (mode: SearchMode) => void;
  onToggle: () => void;
  onClose: () => void;
}

export function SearchModeDropdown({
  searchMode,
  showOptions,
  onModeChange,
  onToggle,
  onClose,
}: SearchModeDropdownProps) {
  const handleSelectMode = (mode: SearchMode) => {
    onModeChange(mode);
    onClose();
  };

  return (
    <div style={{ position: "relative" }} id="searchModeBtn">
      <button
        onClick={onToggle}
        title="Suchmodus"
        style={{
          padding: "6px 10px",
          minWidth: "unset",
          background:
            searchMode !== "insensitive" ? "var(--accent-gradient)" : undefined,
          color: searchMode !== "insensitive" ? "white" : undefined,
          borderColor: searchMode !== "insensitive" ? "transparent" : undefined,
        }}
      >
        {searchMode === "insensitive" && "Aa ▾"}
        {searchMode === "sensitive" && "Aa ▾"}
        {searchMode === "regex" && ".* ▾"}
      </button>

      {showOptions &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: getDropdownTop(),
              left: getDropdownLeft(),
              background: "var(--color-bg-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
              zIndex: 999999,
              minWidth: "180px",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownItem
              active={searchMode === "insensitive"}
              label="Aa ignorieren"
              hint="Case-insensitiv"
              onClick={() => handleSelectMode("insensitive")}
            />
            <DropdownItem
              active={searchMode === "sensitive"}
              label="Aa beachten"
              hint="Case-sensitiv"
              onClick={() => handleSelectMode("sensitive")}
            />
            <DropdownItem
              active={searchMode === "regex"}
              label="Regex"
              hint="Regulärer Ausdruck"
              onClick={() => handleSelectMode("regex")}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

interface DropdownItemProps {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}

function DropdownItem({ active, label, hint, onClick }: DropdownItemProps) {
  return (
    <div
      style={{
        padding: "8px 12px",
        cursor: "pointer",
        background: active ? "var(--color-bg-hover)" : undefined,
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
      onClick={onClick}
    >
      <span style={{ width: "20px" }}>{active ? "✓" : ""}</span>
      <div>
        <div style={{ fontWeight: "500" }}>{label}</div>
        <div style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
          {hint}
        </div>
      </div>
    </div>
  );
}

// Helper functions to calculate dropdown position
function getDropdownTop(): string {
  const btn = document.getElementById("searchModeBtn");
  if (btn) {
    const rect = btn.getBoundingClientRect();
    return rect.bottom + 4 + "px";
  }
  return "60px";
}

function getDropdownLeft(): string {
  const btn = document.getElementById("searchModeBtn");
  if (btn) {
    const rect = btn.getBoundingClientRect();
    return Math.max(0, rect.right - 180) + "px";
  }
  return "auto";
}
