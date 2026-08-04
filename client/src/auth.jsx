import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken, setRefreshToken, clearToken } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  // Store tokens + user from a successful auth response.
  const applySession = ({ token, refreshToken, user }) => {
    setToken(token);
    if (refreshToken) setRefreshToken(refreshToken);
    if (user) setUser(user);
    return user;
  };

  // Returns { mfaRequired: true, factorId } when a code is needed, else signs in.
  const login = async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    if (res.mfaRequired) {
      setToken(res.token); // aal1 token — used only to complete the MFA step
      return { mfaRequired: true, factorId: res.factorId };
    }
    applySession(res);
    return { mfaRequired: false, user: res.user };
  };

  // Verify a 6-digit code — completes a login challenge OR confirms enrolment.
  const completeMfa = async (factorId, code) => {
    const res = await api.post("/auth/mfa/verify", { factorId, code });
    return applySession(res);
  };

  const register = async (payload) => applySession(await api.post("/auth/register", payload));

  const logout = () => {
    clearToken();
    setUser(null);
  };

  // Merge fresh profile fields into the signed-in user (after editing profile).
  const updateUser = (patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <AuthContext.Provider
      value={{ user, loading, login, completeMfa, register, logout, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
