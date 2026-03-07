export const THEME_MODE_STORAGE_KEY = "rail.settings.theme_mode";

export type ThemeModeValue = "light" | "dark";
export const THEME_MODE_META_COLOR: Record<ThemeModeValue, string> = {
  light: "#f6f6f6",
  dark: "#1e1e1e",
};

export function normalizeThemeMode(value: unknown): ThemeModeValue {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "dark") {
    return "dark";
  }
  if (normalized === "light") {
    return "light";
  }
  return "light";
}

export function loadPersistedThemeMode(): ThemeModeValue {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_MODE_STORAGE_KEY));
  } catch {
    return "light";
  }
}

function upsertThemeColorMeta(themeMode: ThemeModeValue) {
  if (typeof document === "undefined") {
    return;
  }
  let themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (!(themeColorMeta instanceof HTMLMetaElement)) {
    themeColorMeta = document.createElement("meta");
    themeColorMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeColorMeta);
  }
  const bgApp = getComputedStyle(document.documentElement).getPropertyValue("--bg-app").trim();
  themeColorMeta.setAttribute("content", bgApp || THEME_MODE_META_COLOR[themeMode]);
}

export function applyThemeModeToDocument(themeMode: ThemeModeValue) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", themeMode);
  document.documentElement.style.colorScheme = themeMode;
  upsertThemeColorMeta(themeMode);
}
