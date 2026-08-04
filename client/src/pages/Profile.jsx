import { useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Avatar } from "../components/common.jsx";

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({
    name: user.name || "",
    bio: user.bio || "",
    phone: user.phone || "",
    location: user.location || "",
  });
  const [avatar, setAvatar] = useState(user.avatar || "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
  };

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await api.upload("/avatar", fd);
      setAvatar(url);
      setSaved(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user: updated } = await api.patch("/auth/me", { ...form, avatar });
      updateUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const roleLabel = user.role === "provider" ? "Service provider" : "Customer";

  return (
    <div style={{ margin: "26px 0" }} className="center-narrow">
      <h1>Your Profile</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        Your name, photo and bio are shown to the {user.role === "provider" ? "customer" : "provider"}{" "}
        when {user.role === "provider" ? "your service gets ordered" : "you place an order"}.
      </p>

      <form className="card" style={{ padding: 24, marginTop: 12 }} onSubmit={save}>
        {error && <div className="error">{error}</div>}
        {saved && <div className="success">Profile saved ✓</div>}

        <div className="profile-avatar-row">
          <Avatar user={{ name: form.name, avatar }} size={84} />
          <div>
            <button
              type="button"
              className="btn sm ghost"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : avatar ? "Change photo" : "Upload photo"}
            </button>
            {avatar && (
              <button
                type="button"
                className="linkish-plain muted"
                style={{ marginLeft: 12 }}
                onClick={() => {
                  setAvatar("");
                  setSaved(false);
                }}
              >
                Remove
              </button>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              JPG, PNG or WebP · up to 5MB
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={pickFile}
          />
        </div>

        <label>Display name</label>
        <input value={form.name} onChange={set("name")} maxLength={80} />

        <label>About you</label>
        <textarea
          placeholder={
            user.role === "provider"
              ? "Tell customers what you do and why they can trust you…"
              : "A short intro so providers know who they're delivering to…"
          }
          value={form.bio}
          maxLength={300}
          onChange={set("bio")}
        />
        <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
          {form.bio.length}/300
        </div>

        <label>Phone</label>
        <input value={form.phone} onChange={set("phone")} maxLength={30} />

        <label>Campus location</label>
        <input
          placeholder="e.g. Unity Hall, Block C"
          value={form.location}
          onChange={set("location")}
          maxLength={120}
        />

        <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Signed in as <strong>{user.email}</strong> · {roleLabel}
        </div>

        <button className="btn" style={{ width: "100%", marginTop: 16 }} disabled={busy || uploading}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}
