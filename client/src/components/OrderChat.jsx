import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { timeAgo } from "./common.jsx";

// Per-order chat between the customer and provider. Polls while open.
const POLL_MS = 8000;

export default function OrderChat({ orderId, me, otherName, unread = 0, onSeen }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

  // Fetching the thread marks it read on the server; tell the parent so the
  // unread badge clears immediately instead of waiting for the next orders poll.
  const load = () =>
    api
      .get(`/orders/${orderId}/messages`)
      .then((msgs) => {
        setMessages(msgs);
        onSeen?.();
      })
      .catch(() => {});

  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  // Keep the conversation scrolled to the latest message.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, open]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const msg = await api.post(`/orders/${orderId}/messages`, { text: body });
      setMessages((prev) => [...prev, msg]);
      setText("");
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat">
      <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}>
        <span className="chat-icon">
          💬
          {!open && unread > 0 && (
            <span className="chat-unread" aria-label={`${unread} unread messages`}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>{" "}
        {open ? "Hide chat" : `Message ${otherName || "them"}`}
      </button>
      {open && (
        <div className="chat-panel">
          <div className="chat-body" ref={bodyRef}>
            {messages.length === 0 ? (
              <div className="muted chat-empty">No messages yet — say hello 👋</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`bubble ${m.senderId === me ? "mine" : "theirs"}`}>
                  {m.senderId !== me && <span className="bubble-name">{m.senderName}</span>}
                  <span className="bubble-text">{m.text}</span>
                  <span className="bubble-time">{timeAgo(m.createdAt)}</span>
                </div>
              ))
            )}
          </div>
          <form className="chat-input" onSubmit={send}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              maxLength={1000}
            />
            <button className="btn sm" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
