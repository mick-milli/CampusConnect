import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { cedis, CategoryIcon, Spinner } from "../components/common.jsx";

const MAX_MEDIA = 6;
const MAX_VIDEO_MB = 60;

// Downscale a photo in the browser (max 1200px, JPEG) so uploads stay small.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], "photo.jpg", { type: "image/jpeg" })),
        "image/jpeg",
        0.8
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Couldn't read ${file.name} — is it an image?`));
    };
    img.src = url;
  });
}

// Normalize a picked file into { file, previewUrl, type } ready for upload.
async function prepareMedia(file) {
  if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_MB * 1024 * 1024)
      throw new Error(`${file.name} is too large — videos must be under ${MAX_VIDEO_MB} MB`);
    return { file, previewUrl: URL.createObjectURL(file), type: "video" };
  }
  const jpeg = await shrinkPhoto(file);
  return { file: jpeg, previewUrl: URL.createObjectURL(jpeg), type: "image" };
}

export default function ProviderDashboard() {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const NEW_CATEGORY = "__new__";
  const [form, setForm] = useState({ title: "", description: "", price: "", categoryId: "" });
  const [newCategory, setNewCategory] = useState("");
  const [mediaFiles, setMediaFiles] = useState([]); // { file, previewUrl, type }
  const [publishing, setPublishing] = useState(false);
  const [editingId, setEditingId] = useState(null); // listing open in the editor
  const [deletingId, setDeletingId] = useState(null); // listing mid-delete

  const load = () =>
    Promise.all([api.get("/services/mine"), api.get("/categories"), api.get("/orders")]).then(
      ([s, c, o]) => {
        setServices(s);
        setCategories(c);
        setOrders(o);
        if (!form.categoryId && c[0]) setForm((f) => ({ ...f, categoryId: c[0].id }));
      }
    );

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const addMedia = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    setError("");
    try {
      const prepared = await Promise.all(files.map(prepareMedia));
      setMediaFiles((prev) => [...prev, ...prepared].slice(0, MAX_MEDIA));
    } catch (err) {
      setError(err.message);
    }
  };

  const removeMedia = (i) =>
    setMediaFiles((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, j) => j !== i);
    });

  const create = async (e) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setPublishing(true);
    try {
      // Upload photos/videos first, then create the service pointing at them.
      let media = [];
      if (mediaFiles.length > 0) {
        const fd = new FormData();
        mediaFiles.forEach((m) => fd.append("files", m.file));
        ({ media } = await api.upload("/media", fd));
      }

      const creatingCategory = form.categoryId === NEW_CATEGORY;
      const payload = creatingCategory
        ? { ...form, categoryId: undefined, categoryName: newCategory, media }
        : { ...form, media };
      const created = await api.post("/services", payload);
      setServices((prev) => [created, ...prev]);
      if (creatingCategory) {
        setNewCategory("");
        api.get("/categories").then(setCategories);
      }
      setForm({ title: "", description: "", price: "", categoryId: categories[0]?.id || "" });
      mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl));
      setMediaFiles([]);
      setMsg("Service published! It's now live on the marketplace.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const toggle = async (svc) => {
    const updated = await api.patch(`/services/${svc.id}`, { active: !svc.active });
    setServices((prev) => prev.map((s) => (s.id === svc.id ? updated : s)));
  };

  // Replace a listing in place after the editor saves it.
  const onSaved = (updated) => {
    setServices((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setEditingId(null);
  };

  const remove = async (svc) => {
    if (
      !window.confirm(
        `Delete "${svc.title}"? It's removed from the marketplace. Past orders keep their history.`
      )
    )
      return;
    setError("");
    setDeletingId(svc.id);
    try {
      await api.del(`/services/${svc.id}`);
      setServices((prev) => prev.filter((s) => s.id !== svc.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <Spinner />;

  const pending = orders.filter((o) => !["completed", "cancelled"].includes(o.status)).length;
  // Net of the platform fee: online orders keep the released `net`; cash is full.
  const earnings = orders
    .filter((o) => o.status === "completed")
    .reduce((sum, o) => {
      const pay = o.payment || {};
      if (pay.method === "cash") return sum + (o.price || 0);
      return sum + (pay.net ?? pay.amount ?? o.price ?? 0);
    }, 0);

  return (
    <div style={{ margin: "26px 0" }}>
      <h1>Provider Dashboard</h1>

      <div className="grid cols-3" style={{ marginBottom: 10 }}>
        <Stat label="Active listings" value={services.filter((s) => s.active).length} />
        <Stat label="Open orders" value={pending} />
        <Stat label="Earnings (completed)" value={cedis(earnings)} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Link to="/earnings" style={{ color: "var(--green)", fontWeight: 700 }}>
          💰 View earnings &amp; payouts →
        </Link>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 24 }}>
        <strong>How payouts work</strong>
        <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          Online payments are held in escrow until the customer confirms the work — then you're paid
          out. You keep <strong>95%</strong>; a 5% platform fee applies to each completed order. If
          work is left uncompleted, a customer can raise it with you in the order chat and, if it
          stays unresolved, flag the order for a full refund. Keep every agreement in the chat — it's
          your record.
        </p>
      </div>

      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <form className="card" style={{ padding: 22 }} onSubmit={create}>
          <h2 style={{ marginTop: 0 }}>Add a service</h2>
          {error && <div className="error">{error}</div>}
          {msg && <div className="success">{msg}</div>}
          <label>Name of provider</label>
          <input value={form.title} onChange={set("title")} required placeholder="e.g. Kwame Prints" />
          <label>Service</label>
          <select value={form.categoryId} onChange={set("categoryId")}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
            <option value={NEW_CATEGORY}>➕ Other — create a new service</option>
          </select>
          {form.categoryId === NEW_CATEGORY && (
            <>
              <label>New service name</label>
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                required
                placeholder="e.g. Laundry & Ironing"
              />
            </>
          )}
          <label>Description</label>
          <textarea value={form.description} onChange={set("description")} />
          <label>Price (GH₵)</label>
          <input type="number" min="0" step="0.5" value={form.price} onChange={set("price")} />

          <label>
            Photos & videos{" "}
            <span className="muted">
              (up to {MAX_MEDIA} — customers swipe through them; videos under {MAX_VIDEO_MB} MB)
            </span>
          </label>
          <input
            type="file"
            accept="image/*,video/mp4,video/webm,video/quicktime"
            multiple
            onChange={addMedia}
            disabled={mediaFiles.length >= MAX_MEDIA}
          />
          {mediaFiles.length > 0 && (
            <div className="upload-thumbs">
              {mediaFiles.map((m, i) => (
                <div key={m.previewUrl} className="upload-thumb">
                  {m.type === "video" ? (
                    <>
                      <video src={m.previewUrl} muted preload="metadata" />
                      <span className="vid-tag">▶ VIDEO</span>
                    </>
                  ) : (
                    <img src={m.previewUrl} alt={`Photo ${i + 1}`} />
                  )}
                  <button type="button" aria-label="Remove" onClick={() => removeMedia(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <button className="btn" style={{ width: "100%", marginTop: 16 }} disabled={publishing}>
            {publishing ? "Publishing…" : "Publish service"}
          </button>
        </form>

        <div>
          <h2 style={{ marginTop: 0 }}>Your listings</h2>
          {services.length === 0 ? (
            <div className="empty">No services yet — add your first one.</div>
          ) : (
            <div className="grid">
              {services.map((s) =>
                editingId === s.id ? (
                  <div key={s.id} className="card" style={{ padding: 16 }}>
                    <EditServiceForm
                      service={s}
                      categories={categories}
                      onSaved={onSaved}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <div key={s.id} className="card" style={{ padding: 16 }}>
                    <div className="spread" style={{ alignItems: "flex-start" }}>
                      <div>
                        <div className="cat" style={{ color: "var(--green)", fontSize: 12, fontWeight: 700 }}>
                          <CategoryIcon id={s.categoryId} icon={s.category?.icon} /> {s.category?.name}
                        </div>
                        <strong>{s.title}</strong>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {cedis(s.price)}
                          {s.media?.length ? ` · ${s.media.length} photo${s.media.length === 1 ? "" : "s"}` : ""}
                          {s.active ? "" : " · (hidden)"}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn ghost sm" onClick={() => toggle(s)}>
                          {s.active ? "Hide" : "Show"}
                        </button>
                        <button className="btn ghost sm" onClick={() => setEditingId(s.id)}>
                          Edit
                        </button>
                        <button
                          className="btn danger sm"
                          onClick={() => remove(s)}
                          disabled={deletingId === s.id}
                        >
                          {deletingId === s.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

// Inline editor for a published listing: change its details, price, category,
// and add/remove photos & videos. Already-uploaded media are kept by URL;
// newly picked files are uploaded on save, then the full set is sent at once.
function EditServiceForm({ service, categories, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: service.title || "",
    description: service.description || "",
    price: service.price ?? "",
    categoryId: service.categoryId || "",
  });
  const [existing, setExisting] = useState(service.media || []); // { url, type } on the server
  const [picked, setPicked] = useState([]); // { file, previewUrl, type } not yet uploaded
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const total = existing.length + picked.length;

  const addMedia = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    setError("");
    try {
      const prepared = await Promise.all(files.map(prepareMedia));
      setPicked((prev) => [...prev, ...prepared].slice(0, Math.max(0, MAX_MEDIA - existing.length)));
    } catch (err) {
      setError(err.message);
    }
  };

  const removeExisting = (i) => setExisting((prev) => prev.filter((_, j) => j !== i));
  const removePicked = (i) =>
    setPicked((prev) => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, j) => j !== i);
    });

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Upload any newly added files, then persist the kept + new media together.
      let uploaded = [];
      if (picked.length > 0) {
        const fd = new FormData();
        picked.forEach((m) => fd.append("files", m.file));
        ({ media: uploaded } = await api.upload("/media", fd));
      }
      const updated = await api.patch(`/services/${service.id}`, {
        title: form.title,
        description: form.description,
        price: form.price,
        categoryId: form.categoryId,
        media: [...existing, ...uploaded],
      });
      picked.forEach((m) => URL.revokeObjectURL(m.previewUrl));
      onSaved(updated);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const cancel = () => {
    picked.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    onCancel();
  };

  return (
    <form onSubmit={save}>
      <h3 style={{ marginTop: 0 }}>Edit listing</h3>
      {error && <div className="error">{error}</div>}
      <label>Name of provider</label>
      <input value={form.title} onChange={set("title")} required />
      <label>Service</label>
      <select value={form.categoryId} onChange={set("categoryId")}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon} {c.name}
          </option>
        ))}
      </select>
      <label>Description</label>
      <textarea value={form.description} onChange={set("description")} />
      <label>Price (GH₵)</label>
      <input type="number" min="0" step="0.5" value={form.price} onChange={set("price")} />

      <label>
        Photos & videos <span className="muted">(up to {MAX_MEDIA})</span>
      </label>
      {total > 0 && (
        <div className="upload-thumbs">
          {existing.map((m, i) => (
            <div key={m.url} className="upload-thumb">
              {m.type === "video" ? (
                <>
                  <video src={m.url} muted preload="metadata" />
                  <span className="vid-tag">▶ VIDEO</span>
                </>
              ) : (
                <img src={m.url} alt={`Photo ${i + 1}`} />
              )}
              <button type="button" aria-label="Remove" onClick={() => removeExisting(i)}>
                ×
              </button>
            </div>
          ))}
          {picked.map((m, i) => (
            <div key={m.previewUrl} className="upload-thumb">
              {m.type === "video" ? (
                <>
                  <video src={m.previewUrl} muted preload="metadata" />
                  <span className="vid-tag">▶ VIDEO</span>
                </>
              ) : (
                <img src={m.previewUrl} alt={`New photo ${i + 1}`} />
              )}
              <button type="button" aria-label="Remove" onClick={() => removePicked(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        multiple
        onChange={addMedia}
        disabled={total >= MAX_MEDIA}
        style={{ marginTop: 10 }}
      />

      <div className="row" style={{ marginTop: 16, gap: 8 }}>
        <button className="btn sm" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="btn ghost sm" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
