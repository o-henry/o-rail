export function saveToLocalStorageSafely(key: string, value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota/security failures so UI interaction remains available.
  }
}

export function toCssBackgroundImageValue(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    return "none";
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "");
  return `url("${escaped}")`;
}
