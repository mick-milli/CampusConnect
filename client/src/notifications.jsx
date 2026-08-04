import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";
import { useAuth } from "./auth.jsx";

// Shared notification state so the menu badge and the Notifications page agree.
// No websockets in this MVP — we poll on a light interval.
const NotificationsContext = createContext(null);
const POLL_MS = 20000;

export function NotificationsProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);

  const reload = useCallback(() => {
    if (!user) {
      setItems([]);
      return;
    }
    api.get("/notifications").then(setItems).catch(() => {});
  }, [user]);

  useEffect(() => {
    reload();
    if (!user) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [user, reload]);

  const markAllRead = useCallback(() => {
    setItems((prev) => (prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev));
    api.post("/notifications/read", {}).catch(() => {});
  }, []);

  const unread = items.filter((n) => !n.read).length;

  return (
    <NotificationsContext.Provider value={{ items, unread, reload, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
