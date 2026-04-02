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
  const {
    profiles,
    saveProfile,
    loadProfile,
    deleteProfile,
    renameProfile,
    exportProfiles,
    importProfiles,
  } = useFilterProfiles();

  const [isOpen, setIsOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmUpdate, setConfirmUpdate] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

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
        setConfirmUpdate(null);
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
        setConfirmUpdate(null);
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

  const handleStartRename = useCallback((id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
    setConfirmDelete(null);
    setError(null);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setError(t("filterProfiles.nameRequired"));
      return;
    }
    const result = renameProfile(renamingId, trimmed);
    if (result) {
      setSuccessMessage(t("filterProfiles.renameSuccess", { name: trimmed }));
      setRenamingId(null);
      setRenameValue("");
      setError(null);
    } else {
      setError(
        t("filterProfiles.renameFailed", { message: "Name already exists" }),
      );
    }
  }, [renamingId, renameValue, renameProfile, t]);

  const handleUpdate = useCallback(
    (id: string, name: string) => {
      if (confirmUpdate === id) {
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
            setSuccessMessage(t("filterProfiles.updateSuccess", { name }));
            setConfirmUpdate(null);
            setError(null);
          }
        } catch (e) {
          setError(
            t("filterProfiles.saveFailed", {
              message: e instanceof Error ? e.message : "Unknown error",
            }),
          );
        }
      } else {
        setConfirmUpdate(id);
        setConfirmDelete(null);
      }
    },
    [
      confirmUpdate,
      filter,
      search,
      stdFiltersEnabled,
      getMdcFilters,
      saveProfile,
      t,
    ],
  );

  const handleExport = useCallback(() => {
    if (profiles.length === 0) {
      setError(t("filterProfiles.exportEmpty"));
      return;
    }
    const json = exportProfiles();
    void navigator.clipboard.writeText(json).then(() => {
      setSuccessMessage(
        t("filterProfiles.exportSuccess", { count: profiles.length }),
      );
    });
  }, [profiles, exportProfiles, t]);

  const handleImport = useCallback(() => {
    const trimmed = importText.trim();
    if (!trimmed) return;
    try {
      const count = importProfiles(trimmed, importOverwrite);
      if (count > 0) {
        setSuccessMessage(t("filterProfiles.importSuccess", { count }));
        setShowImport(false);
        setImportText("");
        setImportOverwrite(false);
        setError(null);
      } else {
        setError(t("filterProfiles.importNone"));
      }
    } catch (e) {
      setError(
        t("filterProfiles.importFailed", {
          message:
            e instanceof Error
              ? e.message
              : t("filterProfiles.errorInvalidJson"),
        }),
      );
    }
  }, [importText, importOverwrite, importProfiles, t]);

  const hasActiveFilters =
    filter.level ||
    filter.logger ||
    filter.thread ||
    filter.message ||
    search ||
    !stdFiltersEnabled;

  const getFilterSummary = (profile: FilterProfile): string => {
    const parts: string[] = [];
    if (profile.filters.level)
      parts.push(
        t("filterProfiles.includesLevel", { level: profile.filters.level }),
      );
    if (profile.filters.logger)
      parts.push(
        t("filterProfiles.includesLogger", {
          logger: profile.filters.logger,
        }),
      );
    if (profile.filters.thread)
      parts.push(
        t("filterProfiles.includesThread", {
          thread: profile.filters.thread,
        }),
      );
    if (profile.filters.message)
      parts.push(
        t("filterProfiles.includesMessage", {
          message: profile.filters.message.substring(0, 20) + "…",
        }),
      );
    if (profile.filters.search)
      parts.push(
        t("filterProfiles.includesSearch", {
          search: profile.filters.search.substring(0, 20) + "…",
        }),
      );
    if (profile.filters.mdcFilters && profile.filters.mdcFilters.length > 0)
      parts.push(
        t("filterProfiles.includesMdc", {
          count: profile.filters.mdcFilters.length,
        }),
      );
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
              <div className="filter-profiles-toolbar">
                <button
                  type="button"
                  className="btn-icon"
                  onClick={handleExport}
                  title={t("filterProfiles.export")}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => {
                    setShowImport(!showImport);
                    setError(null);
                  }}
                  title={t("filterProfiles.import")}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Import area */}
            {showImport && (
              <div className="filter-profiles-import">
                <textarea
                  value={importText}
                  onInput={(e) => setImportText(e.currentTarget.value)}
                  placeholder={t("filterProfiles.importPrompt")}
                  rows={4}
                  className="import-textarea"
                />
                <div className="import-controls">
                  <label className="import-overwrite-label">
                    <input
                      type="checkbox"
                      checked={importOverwrite}
                      onChange={(e) =>
                        setImportOverwrite(e.currentTarget.checked)
                      }
                    />
                    <span>{t("filterProfiles.importOverwrite")}</span>
                  </label>
                  <button
                    type="button"
                    className="btn-small btn-primary"
                    onClick={handleImport}
                    disabled={!importText.trim()}
                  >
                    {t("filterProfiles.import")}
                  </button>
                </div>
              </div>
            )}

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
                      {t("filterProfiles.chipLogger")}
                    </span>
                  )}
                  {filter.thread && (
                    <span className="chip" title={filter.thread}>
                      {t("filterProfiles.chipThread")}
                    </span>
                  )}
                  {filter.message && (
                    <span className="chip" title={filter.message}>
                      {t("filterProfiles.chipMessage")}
                    </span>
                  )}
                  {search && (
                    <span className="chip" title={search}>
                      {t("filterProfiles.chipSearch")}
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
                    {renamingId === profile.id ? (
                      <div className="profile-rename">
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onInput={(e) => setRenameValue(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleConfirmRename();
                            }
                            if (e.key === "Escape") {
                              setRenamingId(null);
                              setRenameValue("");
                            }
                          }}
                          className="profile-name-input"
                        />
                        <button
                          type="button"
                          className="btn-small btn-primary"
                          onClick={handleConfirmRename}
                          disabled={!renameValue.trim()}
                        >
                          {t("filterProfiles.confirmOk")}
                        </button>
                        <button
                          type="button"
                          className="btn-small"
                          onClick={() => {
                            setRenamingId(null);
                            setRenameValue("");
                          }}
                          title={t("filterProfiles.cancelRename")}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <>
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
                            className={`btn-icon btn-update ${
                              confirmUpdate === profile.id ? "confirm" : ""
                            }`}
                            onClick={() =>
                              handleUpdate(profile.id, profile.name)
                            }
                            title={
                              confirmUpdate === profile.id
                                ? t("filterProfiles.updateConfirm", {
                                    name: profile.name,
                                  })
                                : t("filterProfiles.update")
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
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                              <polyline points="17 21 17 13 7 13 7 21" />
                              <polyline points="7 3 7 8 15 8" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="btn-icon btn-rename"
                            onClick={() =>
                              handleStartRename(profile.id, profile.name)
                            }
                            title={t("filterProfiles.rename")}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              <path d="m15 5 4 4" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className={`btn-icon btn-delete ${
                              confirmDelete === profile.id ? "confirm" : ""
                            }`}
                            onClick={() =>
                              handleDelete(profile.id, profile.name)
                            }
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
                      </>
                    )}
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
