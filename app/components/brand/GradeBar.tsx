"use client";

import { useEffect, useState } from "react";

import { LADDER } from "@/lib/format";

/// The grade on the 0–99 scale, its fill animating to position on mount.
/// Motion place (b): width transitions on cubic-bezier(0.16,1,0.3,1) (--ease).
/// Faint ticks mark the band boundaries so the bar reads against the ladder.
export function GradeBar({ grade, max = 99 }: { grade: number; max?: number }) {
  const [w, setW] = useState(0);
  const target = Math.max(0, Math.min(100, (grade / max) * 100));

  useEffect(() => {
    const id = requestAnimationFrame(() => setW(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  return (
    <div style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--raised-2)", overflow: "hidden" }}>
      {LADDER.filter((b) => b.min > 0).map((b) => (
        <span
          key={b.min}
          aria-hidden
          style={{ position: "absolute", top: 0, bottom: 0, left: `${(b.min / max) * 100}%`, width: 1, background: "rgba(245,245,240,0.12)" }}
        />
      ))}
      <div style={{ height: "100%", width: `${w}%`, background: "var(--accent)", borderRadius: 999, transition: "width 680ms var(--ease)" }} />
    </div>
  );
}
