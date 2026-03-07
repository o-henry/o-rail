import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  THEME_MODE_STORAGE_KEY,
  applyThemeModeToDocument,
  type ThemeModeValue,
} from "../themeMode";

type ThemeContextValue = {
  mode: ThemeModeValue;
  setMode: (nextMode: ThemeModeValue | string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeModeValue>("light");

  const setMode = useCallback((_nextMode: ThemeModeValue | string) => {
    setModeState("light");
  }, []);

  useEffect(() => {
    applyThemeModeToDocument(mode);
    try {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore persistence failures
    }
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, setMode }),
    [mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemeMode must be used inside ThemeProvider");
  }
  return context;
}
