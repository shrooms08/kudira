"use client";

import { useEffect, useRef, useState } from "react";

// cubic-bezier(0.16,1,0.3,1) as an easing function y(x), Newton-solved. The one
// motion curve in the product; here it drives the approved-limit count-up.
function makeBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dfx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const fy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 5; i++) {
      const e = fx(t) - x;
      if (Math.abs(e) < 1e-4) break;
      const d = dfx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return fy(t);
  };
}
const ease = makeBezier(0.16, 1, 0.3, 1);

/// Counts an integer 0 -> `to` over `durationMs` (default 600). Motion place (a).
export function CountUp({ to, durationMs = 600 }: { to: number; durationMs?: number }) {
  const [v, setV] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    let raf = 0;
    let t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / durationMs);
      setV(Math.round(ease(p) * to));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);
  return <>{v.toLocaleString("en-US")}</>;
}
