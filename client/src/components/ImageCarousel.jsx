import { useRef, useState } from "react";

// Swipeable media slideshow (photos + videos): native touch swipe via CSS
// scroll-snap, plus arrows and dots for mouse users. `media` is a list of
// { url, type: "image" | "video" }. Renders nothing when the list is empty.
export default function ImageCarousel({ media, alt = "", height = 160 }) {
  const track = useRef(null);
  const [idx, setIdx] = useState(0);

  if (!media || media.length === 0) return null;

  const onScroll = () => {
    const el = track.current;
    if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
  };

  const go = (i, e) => {
    e?.preventDefault();
    e?.stopPropagation();
    const el = track.current;
    const next = Math.max(0, Math.min(media.length - 1, i));
    el?.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="carousel" style={{ height }}>
      <div className="carousel-track" ref={track} onScroll={onScroll}>
        {media.map((m, i) =>
          m.type === "video" ? (
            <video
              key={m.url}
              src={m.url}
              controls
              playsInline
              muted
              preload="metadata"
            />
          ) : (
            <img
              key={m.url}
              src={m.url}
              alt={`${alt} photo ${i + 1}`}
              loading="lazy"
              draggable={false}
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          )
        )}
      </div>
      {media.length > 1 && (
        <>
          {idx > 0 && (
            <button className="carousel-arrow left" onClick={(e) => go(idx - 1, e)} aria-label="Previous slide">
              ‹
            </button>
          )}
          {idx < media.length - 1 && (
            <button className="carousel-arrow right" onClick={(e) => go(idx + 1, e)} aria-label="Next slide">
              ›
            </button>
          )}
          <div className="carousel-dots">
            {media.map((_, i) => (
              <button
                key={i}
                className={`carousel-dot ${i === idx ? "active" : ""}`}
                onClick={(e) => go(i, e)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
