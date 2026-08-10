"use client";

import { useEffect, useState } from "react";

/// The grade on the 0–99 scale, its lime fill animating to position on mount.
/// Motion place (b): width transitions on cubic-bezier(0.16,1,0.3,1) (--ease).
/// The band structure is carried by the open ladder directly below, so the bar
/// stays a clean track + fill rather than carrying its own ticks.
export function GradeBar({ grade, max = 99 }: { grade: number; max?: number }) {
  const [w, setW] = useState(0);
  const target = Math.max(0, Math.min(100, (grade / max) * 100));

  useEffect(() => {
    const id = requestAnimationFrame(() => setW(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  return (
    <div style={{ height: 8, borderRadius: 999, background: "var(--raised-2)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: "var(--accent)", borderRadius: 999, transition: "width 680ms var(--ease)" }} />
    </div>
  );
}
