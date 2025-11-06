import { useI18n, type Locale } from "../utils/i18n";

export default function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        marginLeft: "10px",
      }}
    >
      <label style={{ fontSize: "13px" }}>
        {t("settings.language.label")}:
      </label>
      <select
        value={locale}
        onChange={(e) => setLocale(e.currentTarget.value as Locale)}
        style={{
          padding: "2px 6px",
          fontSize: "13px",
          borderRadius: "4px",
          border: "1px solid var(--color-border, #ccc)",
          background: "var(--color-bg, #fff)",
          color: "var(--color-text, #000)",
        }}
        aria-label={t("settings.language.label")}
      >
        <option value="de">{t("settings.language.german")}</option>
        <option value="en">{t("settings.language.english")}</option>
      </select>
    </div>
  );
}
