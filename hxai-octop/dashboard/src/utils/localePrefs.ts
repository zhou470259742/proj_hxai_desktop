export type UiLocale = "zh" | "en";

export const UI_LOCALE_STORAGE_KEY = "hx:ui-locale";

/** Map browser language tags to a supported dashboard locale. */
export function detectBrowserLocale(): UiLocale {
  if (typeof navigator === "undefined") return "en";

  const candidates =
    navigator.languages?.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const raw of candidates) {
    const lang = raw?.toLowerCase() ?? "";
    if (lang.startsWith("zh")) return "zh";
    if (lang.startsWith("en")) return "en";
  }

  const primary = navigator.language?.toLowerCase() ?? "";
  if (primary.startsWith("zh")) return "zh";
  if (primary.startsWith("en")) return "en";

  return "en";
}

export function normalizeUiLocale(raw: string | null | undefined): UiLocale {
  if (!raw) return "zh";
  return raw.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function readStoredUiLocale(): UiLocale | null {
  try {
    const raw = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    if (raw === "zh" || raw === "en") return raw;
  } catch {
    // localStorage unavailable
  }
  return null;
}

export function storeUiLocale(locale: UiLocale): void {
  try {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // quota / disabled
  }
}

/** Stored user preference wins; the product defaults to Chinese (white-label). */
export function resolveInitialLocale(): UiLocale {
  return readStoredUiLocale() ?? "zh";
}

export function syncDocumentLang(locale: UiLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

/** BCP-47 tag for STT / SpeechRecognition from dashboard UI locale. */
export function speechLocaleFromUi(locale: string | null | undefined): string {
  return normalizeUiLocale(locale) === "zh" ? "zh-CN" : "en-US";
}
