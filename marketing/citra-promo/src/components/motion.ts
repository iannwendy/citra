/**
 * Pure, FPS-agnostic motion & camera spline math for CITRA 120fps Spatial Cinema.
 * Zero DOM/Remotion runtime side effects so Node native test runner executes in <20ms.
 */

export const DEFAULT_FPS = 120;

export const sec = (seconds: number, fps: number = DEFAULT_FPS): number =>
  Math.round(seconds * fps);

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, x));

export const clamp01 = (x: number): number => clamp(x, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (t: number): number => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

export const smootherstep = (t: number): number => {
  const u = clamp01(t);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

export const easeOutExpo = (t: number): number => {
  const u = clamp01(t);
  return u === 1 ? 1 : 1 - Math.pow(2, -10 * u);
};

export const easeOutQuart = (t: number): number => {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 4);
};

/**
 * Fritsch–Carlson / Brodlie Monotone Cubic Hermite Interpolation.
 * - Starts and ends gently at rest (m[0] = 0, m[n-1] = 0) when n >= 2.
 * - Preserves continuous non-zero C1 velocity through monotonic interior waypoints (zero stop-and-go hitch).
 * - Guarantees zero overshoot on holds (y[k] === y[k+1]) and direction reversals.
 */
export function monotoneHermite(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];

  if (n === 2) {
    const u = clamp01((x - xs[0]) / Math.max(1e-9, xs[1] - xs[0]));
    return lerp(ys[0], ys[1], smootherstep(u));
  }

  const h: number[] = new Array(n - 1);
  const delta: number[] = new Array(n - 1);
  for (let k = 0; k < n - 1; k++) {
    h[k] = Math.max(1e-9, xs[k + 1] - xs[k]);
    delta[k] = (ys[k + 1] - ys[k]) / h[k];
  }

  const m: number[] = new Array(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    if (delta[k - 1] * delta[k] > 0) {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k]);
    } else {
      m[k] = 0;
    }
  }

  // Fritsch–Carlson monotonicity clamp
  for (let k = 0; k < n - 1; k++) {
    if (Math.abs(delta[k]) < 1e-12) {
      m[k] = 0;
      m[k + 1] = 0;
    } else {
      const alpha = m[k] / delta[k];
      const beta = m[k + 1] / delta[k];
      const hyp = Math.hypot(alpha, beta);
      if (hyp > 3) {
        const tau = 3 / hyp;
        m[k] = tau * alpha * delta[k];
        m[k + 1] = tau * beta * delta[k];
      }
    }
  }

  // Binary search active interval
  let lo = 0;
  let hi = n - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < xs[mid]) hi = mid - 1;
    else if (x > xs[mid + 1]) lo = mid + 1;
    else {
      lo = mid;
      break;
    }
  }
  const idx = clamp(lo, 0, n - 2);
  const hk = h[idx];
  const t = clamp01((x - xs[idx]) / hk);
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * ys[idx] + h10 * hk * m[idx] + h01 * ys[idx + 1] + h11 * hk * m[idx + 1];
}

export type CamKey = {
  /** Time in seconds from scene start */
  t: number;
  /** Image-normalized focus center X [0..1] */
  cx: number;
  /** Image-normalized focus center Y [0..1] */
  cy: number;
  /** Fraction of image width visible in viewport (smaller = deeper zoom in) */
  w: number;
  /** 3D pitch in degrees */
  rotX?: number;
  /** 3D yaw in degrees */
  rotY?: number;
  /** Subtle 3D roll in degrees */
  rotZ?: number;
};

export type CamPose = {
  t: number;
  cx: number;
  cy: number;
  w: number;
  rotX: number;
  rotY: number;
  rotZ: number;
};

/**
 * Evaluates a smooth C1 camera pose at `timeSec` using log-space zoom interpolation
 * so optical zoom speed feels perceptually uniform across wide-to-macro dives.
 */
export function camSplineAt(timeSec: number, keys: readonly CamKey[]): CamPose {
  if (keys.length === 0) {
    return { t: timeSec, cx: 0.5, cy: 0.5, w: 1, rotX: 0, rotY: 0, rotZ: 0 };
  }
  const ts = keys.map((k) => k.t);
  const cxs = keys.map((k) => k.cx);
  const cys = keys.map((k) => k.cy);
  const logWs = keys.map((k) => Math.log(clamp(k.w, 0.15, 1.25)));
  const rxs = keys.map((k) => k.rotX ?? 0);
  const rys = keys.map((k) => k.rotY ?? 0);
  const rzs = keys.map((k) => k.rotZ ?? 0);

  return {
    t: timeSec,
    cx: monotoneHermite(ts, cxs, timeSec),
    cy: monotoneHermite(ts, cys, timeSec),
    w: Math.exp(monotoneHermite(ts, logWs, timeSec)),
    rotX: monotoneHermite(ts, rxs, timeSec),
    rotY: monotoneHermite(ts, rys, timeSec),
    rotZ: monotoneHermite(ts, rzs, timeSec),
  };
}

export type ViewportLayout = {
  DW: number;
  DH: number;
  left: number;
  top: number;
};

/**
 * Computes pixel dimensions and clamped offsets for a screenshot of `aspect = H / W`
 * inside a viewport of `(VW, VH)` under camera `cam`.
 */
export function computeViewportLayout(
  cam: Pick<CamPose, 'cx' | 'cy' | 'w'>,
  aspect: number,
  VW: number,
  VH: number,
): ViewportLayout {
  const safeW = clamp(cam.w, 0.15, 1.25);
  const DW = VW / safeW;
  const DH = DW * aspect;
  let left = VW / 2 - cam.cx * DW;
  let top = VH / 2 - cam.cy * DH;
  left = DW >= VW ? Math.min(0, Math.max(VW - DW, left)) : (VW - DW) / 2;
  top = DH >= VH ? Math.min(0, Math.max(VH - DH, top)) : (VH - DH) / 2;
  return { DW, DH, left, top };
}

export type LoupeCropGeometry = {
  cardHeight: number;
  imgWidth: number;
  imgHeight: number;
  imgLeft: number;
  imgTop: number;
};

/**
 * Computes exact pixel placement for cropping normalized `[rx, ry, rw, rh]` from a screenshot
 * of `aspect = H / W` so it fills a `cardWidth` Floating Glass Loupe cleanly.
 */
export function computeLoupeCrop(
  rect: readonly [number, number, number, number],
  aspect: number,
  cardWidth: number,
): LoupeCropGeometry {
  const [rx, ry, rw, rh] = rect;
  const safeRw = Math.max(0.04, rw);
  const safeRh = Math.max(0.02, rh);
  const cropAspect = (safeRh * aspect) / safeRw;
  const cardHeight = Math.round(clamp(cardWidth * cropAspect, 76, 360));
  const imgWidth = cardWidth / safeRw;
  const imgHeight = imgWidth * aspect;
  const centerX = rx + safeRw / 2;
  const centerY = ry + safeRh / 2;
  const imgLeft = cardWidth / 2 - centerX * imgWidth;
  const imgTop = cardHeight / 2 - centerY * imgHeight;
  return { cardHeight, imgWidth, imgHeight, imgLeft, imgTop };
}

const VIETNAMESE_DIACRITIC_RE =
  /[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵÁÀẢÃẠẤẦẨẪẬẮẰẲẴẶÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ]/u;

/**
 * Verifies that display text rendered in `Sentient` (`F.display`) contains zero Vietnamese
 * diacritics that would trigger ugly mid-word font fallback.
 */
export function isSentientSafe(text: string): boolean {
  return !VIETNAMESE_DIACRITIC_RE.test(text);
}

export function assertSentientSafe(text: string): string {
  if (!isSentientSafe(text)) {
    throw new Error(
      `Sentient font safety violation: "${text}" contains Vietnamese diacritics; use F.sans or F.serif instead.`,
    );
  }
  return text;
}

export type Box2D = { x: number; y: number; w: number; h: number };

export type ConnectorEndpoints = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
};

/**
 * Computes clean non-overlapping cubic Bezier connector endpoints between a target
 * region box and a floating GlassLoupe card box.
 */
export function computeConnectorEndpoints(source: Box2D, loupe: Box2D): ConnectorEndpoints {
  const scx = source.x + source.w / 2;
  const scy = source.y + source.h / 2;
  const lcx = loupe.x + loupe.w / 2;
  const lcy = loupe.y + loupe.h / 2;

  const dx = lcx - scx;
  const dy = lcy - scy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      const x1 = source.x + source.w;
      const y1 = scy;
      const x2 = loupe.x;
      const y2 = clamp(scy, loupe.y + 24, loupe.y + loupe.h - 24);
      const mid = (x1 + x2) / 2;
      return { x1, y1, x2, y2, cx1: mid, cy1: y1, cx2: mid, cy2: y2 };
    }
    const x1 = source.x;
    const y1 = scy;
    const x2 = loupe.x + loupe.w;
    const y2 = clamp(scy, loupe.y + 24, loupe.y + loupe.h - 24);
    const mid = (x1 + x2) / 2;
    return { x1, y1, x2, y2, cx1: mid, cy1: y1, cx2: mid, cy2: y2 };
  }

  if (dy >= 0) {
    const x1 = scx;
    const y1 = source.y + source.h;
    const x2 = clamp(scx, loupe.x + 28, loupe.x + loupe.w - 28);
    const y2 = loupe.y;
    const mid = (y1 + y2) / 2;
    return { x1, y1, x2, y2, cx1: x1, cy1: mid, cx2: x2, cy2: mid };
  }
  const x1 = scx;
  const y1 = source.y;
  const x2 = clamp(scx, loupe.x + 28, loupe.x + loupe.w - 28);
  const y2 = loupe.y + loupe.h;
  const mid = (y1 + y2) / 2;
  return { x1, y1, x2, y2, cx1: x1, cy1: mid, cx2: x2, cy2: mid };
}

export type PortalMode = 'bloom' | 'depth' | 'glide' | 'dissolve' | 'none';

export type PortalTransform = {
  opacity: number;
  scale: number;
  tx: number;
  ty: number;
  blurPx: number;
  bloomOpacity: number;
};

/**
 * Computes smooth entrance & exit spatial transforms for overlapping scene portals.
 * `localSec` runs from `0` to `totalRenderSec` (which includes trailing `overlapSec` for non-final scenes).
 */
export function computePortalTransform(
  localSec: number,
  totalRenderSec: number,
  overlapSec: number,
  mode: PortalMode,
  isFirstScene: boolean,
  isLastScene = false,
): PortalTransform {
  const enterP = isFirstScene ? 1 : smootherstep(localSec / Math.max(0.05, overlapSec));
  const exitStart = totalRenderSec - overlapSec;
  const exitP = isLastScene || mode === 'none' ? 0 : smootherstep((localSec - exitStart) / Math.max(0.05, overlapSec));

  // Keep exiting underlying layer at full alpha while incoming top layer ramps 0 -> 1
  // so Porter-Duff source-over compositing never dips below 100% combined opacity.
  const opacity = enterP;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let blurPx = 0;
  let bloomOpacity = 0;

  if (!isFirstScene && enterP < 1) {
    const inv = 1 - enterP;
    if (mode === 'bloom') {
      scale *= 1 - 0.045 * inv;
      blurPx += inv * 10;
      bloomOpacity = Math.max(bloomOpacity, inv * 0.55);
    } else if (mode === 'depth') {
      scale *= 1 - 0.065 * inv;
      ty += inv * 24;
      blurPx += inv * 8;
    } else if (mode === 'glide') {
      tx += inv * 90;
      scale *= 1 - 0.025 * inv;
      blurPx += inv * 6;
    } else {
      scale *= 1 - 0.02 * inv;
    }
  }

  if (!isLastScene && exitP > 0) {
    if (mode === 'bloom') {
      scale *= 1 + 0.06 * exitP;
      blurPx += exitP * 12;
      bloomOpacity = Math.max(bloomOpacity, Math.sin(exitP * Math.PI) * 0.6);
    } else if (mode === 'depth') {
      scale *= 1 + 0.08 * exitP;
      ty -= exitP * 20;
      blurPx += exitP * 10;
    } else if (mode === 'glide') {
      tx -= exitP * 90;
      scale *= 1 - 0.02 * exitP;
      blurPx += exitP * 8;
    } else if (mode === 'dissolve') {
      scale *= 1 + 0.03 * exitP;
      blurPx += exitP * 6;
    }
  }

  return { opacity, scale, tx, ty, blurPx, bloomOpacity };
}
