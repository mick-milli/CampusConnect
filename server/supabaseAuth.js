// Backend-for-frontend wrapper over Supabase's GoTrue auth REST API. The server
// holds the service_role key and proxies auth, so no Supabase key ever reaches
// the browser. Plain fetch — works on Node 18 (no SDK / WebSocket needed).
const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const AUTH_ENABLED = Boolean(URL && KEY);
const AUTH = `${URL}/auth/v1`;

async function call(method, path, { token, body } = {}) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${AUTH}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      json.msg || json.error_description || json.error || json.message || `Auth request failed (${res.status})`
    );
    err.status = res.status;
    throw err;
  }
  return json;
}

export const supaAuth = {
  // Admin-create a confirmed user (bypasses email confirmation for dev/demo).
  // Admin endpoints require the service_role key in the Authorization header.
  adminCreateUser: ({ email, password, metadata }) =>
    call("POST", "/admin/users", {
      token: KEY,
      body: { email, password, email_confirm: true, user_metadata: metadata },
    }),
  // Public self-service signup. When the project has "Confirm email" enabled,
  // GoTrue emails a confirmation link and returns the new user WITHOUT a session;
  // otherwise it returns a live session (auto-confirmed). `redirectTo` is where
  // the user lands after clicking the link (must be in the project's allowlist).
  signUp: ({ email, password, metadata, redirectTo }) =>
    call("POST", `/signup${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ""}`, {
      body: { email, password, data: metadata },
    }),
  // Re-send the signup confirmation email (link expired or never arrived).
  resendSignup: ({ email, redirectTo }) =>
    call("POST", `/resend${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ""}`, {
      body: { type: "signup", email },
    }),
  signIn: (email, password) =>
    call("POST", "/token?grant_type=password", { body: { email, password } }),
  refresh: (refresh_token) =>
    call("POST", "/token?grant_type=refresh_token", { body: { refresh_token } }),
  getUser: (token) => call("GET", "/user", { token }),
  updatePassword: (token, password) => call("PUT", "/user", { token, body: { password } }),

  // ---- MFA (TOTP) ----
  mfaEnroll: (token, friendlyName) =>
    call("POST", "/factors", { token, body: { factor_type: "totp", friendly_name: friendlyName } }),
  mfaChallenge: (token, factorId) => call("POST", `/factors/${factorId}/challenge`, { token }),
  mfaVerify: (token, factorId, challengeId, code) =>
    call("POST", `/factors/${factorId}/verify`, { token, body: { challenge_id: challengeId, code } }),
  mfaUnenroll: (token, factorId) => call("DELETE", `/factors/${factorId}`, { token }),
};
