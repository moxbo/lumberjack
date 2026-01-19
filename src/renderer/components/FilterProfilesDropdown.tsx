/**
 * Filter Profiles Dropdown Component
 * Allows saving, loading, and managing filter configurations
 */
import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import { useI18n } from "../../utils/i18n";
import { useFilterProfiles } from "../../hooks";
import type { FilterProfile } from "../../store/filterProfiles";
import type { FilterState } from "../../hooks";

interface FilterProfilesDropdownProps {
  filter: FilterState;
  search: string;
  stdFiltersEnabled: boolean;
  onApplyProfile: (profile: FilterProfile) => void;
  getMdcFilters?: () => Array<{ key: string; value: string; active: boolean }>;
  disabled?: boolean;
}

export function FilterProfilesDropdown({
  filter,
  search,
  stdFiltersEnabled,
  onApplyProfile,
  getMdcFilters,
  disabled = false,
}: FilterProfilesDropdownProps): JSX.Element {
  const { t } = useI18n();
  const { profiles, saveProfile, loadProfile, deleteProfile } =
    useFilterProfiles();

  const [isOpen, setIsOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position state for dropdown
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  // Update position when opening
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(280, rect.width),
      });
      // Focus input after opening
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setError(null);
        setSuccessMessage(null);
        setConfirmDelete(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setError(null);
        setSuccessMessage(null);
        setConfirmDelete(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Clear messages after delay
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 2500);
      return (): void => clearTimeout(timer);
    }
    return undefined;
  }, [successMessage]);

  const handleSave = useCallback(() => {
    const name = newProfileName.trim();
    if (!name) {
      setError(t("filterProfiles.nameRequired"));
      return;
    }

    try {
      const mdcFilters = getMdcFilters?.() ?? [];
      const saved = saveProfile(
        name,
        filter,
        search,
        stdFiltersEnabled,
        mdcFilters,
      );

      if (saved) {
        setNewProfileName("");
        setError(null);
        setSuccessMessage(t("filterProfiles.saveSuccess", { name }));
      } else {
        setError(t("filterProfiles.saveFailed", { message: "Unknown error" }));
      }
    } catch (e) {
      setError(
        t("filterProfiles.saveFailed", {
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    }
  }, [
    newProfileName,
    filter,
    search,
    stdFiltersEnabled,
    getMdcFilters,
    saveProfile,
    t,
  ]);

  const handleLoad = useCallback(
    (id: string) => {
      const profile = loadProfile(id);
      if (profile) {
        onApplyProfile(profile);
        setSuccessMessage(
          t("filterProfiles.loadSuccess", { name: profile.name }),
        );
        setIsOpen(false);
      } else {
        setError(
          t("filterProfiles.loadFailed", { message: "Profile not found" }),
        );
      }
    },
    [loadProfile, onApplyProfile, t],
  );

  const handleDelete = useCallback(
    (id: string, name: string) => {
      if (confirmDelete === id) {
        if (deleteProfile(id)) {
          setSuccessMessage(t("filterProfiles.deleteSuccess", { name }));
          setConfirmDelete(null);
        } else {
          setError(
            t("filterProfiles.deleteFailed", { message: "Unknown error" }),
          );
        }
      } else {
        setConfirmDelete(id);
      }
    },
    [confirmDelete, deleteProfile, t],
  );

  const hasActiveFilters =
    filter.level ||
    filter.logger ||
    filter.thread ||
    filter.message ||
    search ||
    !stdFiltersEnabled;

  const getFilterSummary = (profile: FilterProfile): string => {
    const parts: string[] = [];
    if (profile.filters.level) parts.push(`Level: ${profile.filters.level}`);
    if (profile.filters.logger) parts.push(`Logger: ${profile.filters.logger}`);
    if (profile.filters.thread) parts.push(`Thread: ${profile.filters.thread}`);
    if (profile.filters.message)
      parts.push(`Msg: ${profile.filters.message.substring(0, 20)}...`);
    if (profile.filters.search)
      parts.push(`Search: ${profile.filters.search.substring(0, 20)}...`);
    if (profile.filters.mdcFilters && profile.filters.mdcFilters.length > 0)
      parts.push(`MDC: ${profile.filters.mdcFilters.length}`);
    return parts.length > 0 ? parts.join(", ") : "-";
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn-small filter-profiles-btn ${isOpen ? "active" : ""} ${
          profiles.length > 0 ? "has-profiles" : ""
        }`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title={t("filterProfiles.tooltip")}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
        <span>{t("filterProfiles.button")}</span>
        {profiles.length > 0 && (
          <span className="profile-count">{profiles.length}</span>
        )}
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            className="filter-profiles-dropdown"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              minWidth: position.width,
              zIndex: 10000,
            }}
          >
            <div className="filter-profiles-header">
              <h4>{t("filterProfiles.title")}</h4>
            </div>

            {/* Save new profile */}
            <div className="filter-profiles-save">
              <input
                ref={inputRef}
                type="text"
                value={newProfileName}
                onInput={(e) => {
                  setNewProfileName(e.currentTarget.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSave();
                  }
                }}
                placeholder={t("filterProfiles.savePlaceholder")}
                className="profile-name-input"
              />
              <button
                type="button"
                className="btn-small btn-primary"
                onClick={handleSave}
                disabled={!newProfileName.trim()}
                title={t("filterProfiles.save")}
              >
                {t("filterProfiles.save")}
              </button>
            </div>

            {/* Messages */}
            {error && <div className="filter-profiles-error">{error}</div>}
            {successMessage && (
              <div className="filter-profiles-success">{successMessage}</div>
            )}

            {/* Current filters preview */}
            {hasActiveFilters && (
              <div className="filter-profiles-current">
                <small>{t("filterProfiles.currentFilters")}:</small>
                <div className="current-filter-chips">
                  {filter.level && <span className="chip">{filter.level}</span>}
                  {filter.logger && (
                    <span className="chip" title={filter.logger}>
                      Logger
                    </span>
                  )}
                  {filter.thread && (
                    <span className="chip" title={filter.thread}>
                      Thread
                    </span>
                  )}
                  {filter.message && (
                    <span className="chip" title={filter.message}>
                      Msg
                    </span>
                  )}
                  {search && (
                    <span className="chip" title={search}>
                      Search
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Profile list */}
            <div className="filter-profiles-list">
              {profiles.length === 0 ? (
                <div className="no-profiles">
                  {t("filterProfiles.noProfiles")}
                </div>
              ) : (
                profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`profile-item ${
                      confirmDelete === profile.id ? "confirm-delete" : ""
                    }`}
                  >
                    <div
                      className="profile-info"
                      onClick={() => handleLoad(profile.id)}
                      title={getFilterSummary(profile)}
                    >
                      <span className="profile-name">{profile.name}</span>
                      <small className="profile-summary">
                        {getFilterSummary(profile)}
                      </small>
                    </div>
                    <div className="profile-actions">
                      <button
                        type="button"
                        className="btn-icon btn-load"
                        onClick={() => handleLoad(profile.id)}
                        title={t("filterProfiles.load")}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`btn-icon btn-delete ${
                          confirmDelete === profile.id ? "confirm" : ""
                        }`}
                        onClick={() => handleDelete(profile.id, profile.name)}
                        title={
                          confirmDelete === profile.id
                            ? t("filterProfiles.deleteConfirm", {
                                name: profile.name,
                              })
                            : t("filterProfiles.delete")
                        }
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
