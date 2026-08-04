import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext(null);
const KEY = "cc_theme";

// Apply the stored theme immediately on load so dark users don't see a flash.
const stored = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
if (stored === "dark") document.documentElement.setAttribute("data-theme", "dark");

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(stored === "dark" ? "dark" : "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const setTheme = (t) => setThemeState(t === "dark" ? "dark" : "light");
  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
