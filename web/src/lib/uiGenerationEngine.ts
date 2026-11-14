/* ==========================================================================
   transitions-ui-generation — Real DOM-Measuring Blueprint & Scanline Engine
   Ported from transitions.dev/ui-generation and calibrated for Solva Editorial
   Light (#FBFAF6) & Dark (#1A1814) surfaces with zero horizontal overflow.
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

const PH = {
  dots: [0, 0.3] as const,
  probe: [0.02, 0.24] as const,
  guides: [0.04, 0.3] as const,
  outline: [0.1, 0.42] as const,
  parts: [0.28, 0.74] as const,
  reveal: [0.72, 1.04] as const,
  clean: [0.84, 1.05] as const,
};

const END = 1.09;
const FLOW = 0.016;
const DOT_GAP = 4.8;
const GUIDE_GAP = 6.5;

export interface MeasuredTextLine {
  x: number;
  x2: number;
  y: number;
  h: number;
}

export interface MeasuredIconPath {
  tag: string;
  attrs: Record<string, string>;
  m: [number, number, number, number, number, number];
}

export type MeasuredPart =
  | {
      kind: 'box';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      interactive: boolean;
      name: string;
      key?: boolean;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      w: number;
      h: number;
      lines: MeasuredTextLine[];
      name: 'text';
      key?: boolean;
    }
  | {
      kind: 'icon';
      x: number;
      y: number;
      w: number;
      h: number;
      paths: MeasuredIconPath[];
      name: 'svg';
      key?: boolean;
    };

export interface MeasuredTarget {
  w: number;
  h: number;
  r: number;
  parts: MeasuredPart[];
}

export interface UIGenerationOptions {
  durationMs?: number;
  maxParts?: number;
  keys?: number;
  stepsCount?: number;
  onStepChange?: (stepIndex: number) => void;
  onFinish?: () => void;
}

const clamp = (x: number): number => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
const smooth = (a: number, b: number, x: number): number => {
  const q = clamp((x - a) / (b - a));
  return q * q * (3 - 2 * q);
};
const win = (r: readonly [number, number], p: number): number =>
  clamp((p - r[0]) / (r[1] - r[0]));
const f2 = (n: number): string => (+n).toFixed(2);
const hashN = (x: number): number => {
  const v = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = (t: number) =>
    3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const cy = (t: number) =>
    3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let m = 0.5;
    for (let i = 0; i < 24; i++) {
      m = (lo + hi) / 2;
      if (cx(m) < x) lo = m;
      else hi = m;
    }
    return cy(m);
  };
}

const OUT = bezier(0.16, 1, 0.3, 1);
const SMOOTH_OUT = bezier(0.22, 1, 0.36, 1);

function createSvg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(el);
  return el;
}

function rrPath(x: number, y: number, w: number, h: number, r: number): string {
  const cr = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${f2(x + cr)} ${f2(y)}H${f2(x + w - cr)}` +
    `A${f2(cr)} ${f2(cr)} 0 0 1 ${f2(x + w)} ${f2(y + cr)}` +
    `V${f2(y + h - cr)}` +
    `A${f2(cr)} ${f2(cr)} 0 0 1 ${f2(x + w - cr)} ${f2(y + h)}` +
    `H${f2(x + cr)}` +
    `A${f2(cr)} ${f2(cr)} 0 0 1 ${f2(x)} ${f2(y + h - cr)}` +
    `V${f2(y + cr)}` +
    `A${f2(cr)} ${f2(cr)} 0 0 1 ${f2(x + cr)} ${f2(y)}Z`
  );
}

function rrHalf(x: number, y: number, w: number, h: number, r: number, dir: 0 | 1): string {
  const cr = Math.max(0, Math.min(r, w / 2, h / 2));
  const X = (v: number) => f2(x + v);
  const Y = (v: number) => f2(y + v);
  const R = f2(cr);
  return dir
    ? `M${X(w / 2)} ${Y(0)}H${X(w - cr)}A${R} ${R} 0 0 1 ${X(w)} ${Y(cr)}V${Y(h - cr)}A${R} ${R} 0 0 1 ${X(w - cr)} ${Y(h)}H${X(w / 2)}`
    : `M${X(w / 2)} ${Y(0)}H${X(cr)}A${R} ${R} 0 0 0 ${X(0)} ${Y(cr)}V${Y(h - cr)}A${R} ${R} 0 0 0 ${X(cr)} ${Y(h)}H${X(w / 2)}`;
}

function safeLength(el: Element, fallback: number): number {
  const geo = el as SVGGeometryElement;
  if (typeof geo.getTotalLength === 'function') {
    try {
      const len = geo.getTotalLength();
      if (Number.isFinite(len) && len > 0) return len;
    } catch {
      // Fallback for JSDOM or detached SVG nodes
    }
  }
  return Math.max(4, fallback);
}

function safePoint(
  el: Element,
  dist: number,
  fallback: { x: number; y: number },
): { x: number; y: number } {
  const geo = el as SVGGeometryElement;
  if (typeof geo.getPointAtLength === 'function') {
    try {
      const pt = geo.getPointAtLength(dist);
      if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        return { x: pt.x, y: pt.y };
      }
    } catch {
      // Fallback for JSDOM
    }
  }
  return fallback;
}

function parseColorAlpha(colorStr: string): number {
  if (!colorStr || colorStr === 'transparent') return 0;
  const m = String(colorStr).match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
}

export function measureTarget(
  el: HTMLElement,
  opts: { maxParts?: number; keys?: number } = {},
): MeasuredTarget {
  const maxParts = opts.maxParts ?? 55;
  const maxKeys = opts.keys ?? 5;
  const R = el.getBoundingClientRect();
  if (!R.width || !R.height) {
    return { w: 0, h: 0, r: 0, parts: [] };
  }

  const invScaleX = el.offsetWidth > 0 ? el.offsetWidth / R.width : 1;
  const invScaleY = el.offsetHeight > 0 ? el.offsetHeight / R.height : 1;
  const W = R.width * invScaleX;
  const H = R.height * invScaleY;
  const area = W * H;
  const parts: MeasuredPart[] = [];
  const rel = (r: DOMRect) => ({
    x: (r.left - R.left) * invScaleX,
    y: (r.top - R.top) * invScaleY,
    w: r.width * invScaleX,
    h: r.height * invScaleY,
  });

  const isHidden = (node: Element): boolean => {
    for (
      let cur: Element | null = node;
      cur && cur !== el;
      cur = cur.parentElement
    ) {
      if (cur.classList.contains('sr-only')) return true;
      const cs = getComputedStyle(cur);
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        return true;
      }
    }
    return false;
  };

  let radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;

  const walk = (node: Element) => {
    for (const c of Array.from(node.children)) {
      if (
        c.matches('script, style, template, [data-t-generate-skip]') ||
        isHidden(c)
      ) {
        continue;
      }

      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      if (!r.width || !r.height) {
        walk(c);
        continue;
      }

      if (Math.abs(r.width - R.width) < 2 && Math.abs(r.height - R.height) < 2) {
        radius = Math.max(radius, parseFloat(cs.borderTopLeftRadius) || 0);
      }

      if (c instanceof SVGSVGElement) {
        if (r.width <= 120 && r.height <= 120) {
          const paths: MeasuredIconPath[] = [];
          const shapes = c.querySelectorAll(
            'path, circle, ellipse, rect, line, polyline, polygon',
          );
          shapes.forEach((g) => {
            if (g.closest('defs, clipPath, mask, symbol') || isHidden(g)) return;
            const gfx = g as SVGGraphicsElement;
            if (typeof gfx.getScreenCTM !== 'function') return;
            const m = gfx.getScreenCTM();
            if (!m) return;
            const attrs: Record<string, string> = {};
            for (const attr of [
              'd',
              'cx',
              'cy',
              'r',
              'rx',
              'ry',
              'x',
              'y',
              'width',
              'height',
              'x1',
              'y1',
              'x2',
              'y2',
              'points',
            ]) {
              const val = g.getAttribute(attr);
              if (val !== null) attrs[attr] = val;
            }
            paths.push({
              tag: g.tagName.toLowerCase(),
              attrs,
              m: [m.a, m.b, m.c, m.d, m.e - R.left, m.f - R.top],
            });
          });
          if (paths.length > 0) {
            parts.push({ kind: 'icon', ...rel(r), paths, name: 'svg' });
          }
        }
        continue;
      }

      const isFullWrapper = r.width * r.height > area * 0.88;
      const isBlurred = /blur/.test(cs.filter || '');
      const hasBg = parseColorAlpha(cs.backgroundColor) > 0.02;
      const hasBorder = (parseFloat(cs.borderTopWidth) || 0) > 0;
      const isFormOrMedia = /^(IMG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(
        c.tagName,
      );
      const hasBgImg = Boolean(cs.backgroundImage && cs.backgroundImage !== 'none');

      if (!isFullWrapper && !isBlurred && (hasBg || hasBorder || isFormOrMedia || hasBgImg)) {
        const role = c.getAttribute('role') || '';
        const interactive =
          /^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(c.tagName) ||
          /button|tab|switch|checkbox|slider/.test(role);
        const name =
          c.tagName === 'INPUT' || c.tagName === 'TEXTAREA'
            ? 'input'
            : c.tagName === 'BUTTON' || role === 'button'
              ? 'button'
              : /^(IMG|CANVAS|VIDEO)$/.test(c.tagName)
                ? 'image'
                : 'frame';
        parts.push({
          kind: 'box',
          ...rel(r),
          r: Math.min(
            parseFloat(cs.borderTopLeftRadius) || 0,
            r.width / 2,
            r.height / 2,
          ),
          interactive,
          name,
        });
      }

      for (const n of Array.from(c.childNodes)) {
        if (n.nodeType !== 3 || !n.nodeValue?.trim()) continue;
        if (typeof document.createRange !== 'function') continue;
        const rg = document.createRange();
        rg.selectNodeContents(n);
        if (typeof rg.getClientRects !== 'function') continue;
        const lines: MeasuredTextLine[] = [];
        for (const q of Array.from(rg.getClientRects())) {
          if (!q.width || !q.height) continue;
          const last = lines[lines.length - 1];
          const y = q.top - R.top;
          if (last && Math.abs(last.y - y) < 2) {
            last.x2 = Math.max(last.x2, q.right - R.left);
          } else {
            lines.push({
              x: q.left - R.left,
              x2: q.right - R.left,
              y,
              h: q.height,
            });
          }
        }
        if (lines.length > 0) {
          parts.push({
            kind: 'text',
            lines,
            x: Math.min(...lines.map((l) => l.x)),
            y: lines[0].y,
            w: Math.max(...lines.map((l) => l.x2 - l.x)),
            h: lines.reduce((acc, l) => acc + l.h, 0),
            name: 'text',
          });
        }
      }

      walk(c);
    }
  };

  walk(el);

  // Deduplicate identical boxes (e.g. button + full-size inner span)
  for (let i = parts.length - 1; i > 0; i--) {
    const p = parts[i];
    if (p.kind !== 'box') continue;
    const dup = parts.some(
      (q, j) =>
        j < i &&
        q.kind === 'box' &&
        Math.abs(q.x - p.x) < 1.5 &&
        Math.abs(q.y - p.y) < 1.5 &&
        Math.abs(q.w - p.w) < 1.5 &&
        Math.abs(q.h - p.h) < 1.5,
    );
    if (dup) parts.splice(i, 1);
  }

  // Cap total parts while preserving document order
  if (parts.length > maxParts) {
    const keep = new Set(
      [...parts].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, maxParts),
    );
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!keep.has(parts[i])) parts.splice(i, 1);
    }
  }

  // Mark key elements (interactive controls first, then largest boxes)
  const boxes = parts.filter(
    (p): p is Extract<MeasuredPart, { kind: 'box' }> => p.kind === 'box',
  );
  [
    ...boxes.filter((b) => b.interactive),
    ...boxes.filter((b) => !b.interactive).sort((a, b) => b.w * b.h - a.w * a.h),
  ]
    .slice(0, maxKeys)
    .forEach((k) => {
      k.key = true;
    });

  return {
    w: W,
    h: H,
    r: Math.min(radius, W / 2, H / 2),
    parts,
  };
}

interface StrokeRecord {
  el: SVGElement;
  L: number;
  gap: number;
  k?: number;
  local?: SVGGElement;
  together?: boolean;
  idx: number;
  n?: number;
  live?: boolean;
  pt: { x: number; y: number };
  fallbackEnd: { x: number; y: number };
  head?: SVGCircleElement;
  caps?: [SVGCircleElement, SVGCircleElement];
}

let instanceSeq = 0;

export function runUIGeneration(
  targetEl: HTMLElement,
  svgRoot: SVGSVGElement,
  canvasEl: HTMLElement | null,
  options: UIGenerationOptions = {},
): { cancel: () => void } {
  const durationMs = Math.max(400, options.durationMs ?? 1450);
  const stepsCount = Math.max(1, options.stepsCount ?? 3);
  let stopped = false;
  let rafId = 0;
  let lastStepIdx = 0;

  const cleanupDom = () => {
    svgRoot.replaceChildren();
    if (canvasEl) {
      canvasEl.style.clipPath = '';
      canvasEl.style.opacity = '0';
    }
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    cleanupDom();
    options.onFinish?.();
  };

  rafId = requestAnimationFrame(() => {
    if (stopped) return;
    const M = measureTarget(targetEl, {
      maxParts: options.maxParts ?? 55,
      keys: options.keys ?? 5,
    });

    if (M.w <= 4 || M.h <= 4) {
      finish();
      return;
    }

    const { w, h } = M;
    const seq = ++instanceSeq;
    const SP = 18;

    svgRoot.replaceChildren();
    svgRoot.setAttribute('viewBox', `0 0 ${f2(w)} ${f2(h)}`);
    if (canvasEl) {
      canvasEl.style.opacity = '1';
      canvasEl.style.clipPath = 'inset(0px 0px 0px 0px)';
    }

    const defs = createSvg('defs', {}, svgRoot);

    // 1. Rippling dot-matrix field bounded inside [0..w, 0..h]
    const dotsGroup = createSvg('g', {}, svgRoot);
    const dots: Array<{
      el: SVGCircleElement;
      x: number;
      y: number;
      d: number;
      v: number;
      ph: number;
      tr: number;
    }> = [];
    let maxD = 0;
    for (let x = SP / 2; x <= w - SP / 2; x += SP) {
      for (let y = SP / 2; y <= h - SP / 2; y += SP) {
        const d = Math.hypot(x - w / 2, y - h / 2);
        const col = Math.round(x / SP);
        dots.push({
          el: createSvg('circle', { cx: f2(x), cy: f2(y), r: 1.05, class: 't-gen-dot' }, dotsGroup),
          x,
          y,
          d,
          v: 0.07 + 0.09 * hashN(col * 7.13 + seq * 31.7),
          ph: hashN(col * 3.71 + seq * 11.3) * 900,
          tr: 50 + 70 * hashN(col * 1.91 + seq),
        });
        maxD = Math.max(maxD, d);
      }
    }

    const makeStroke = (
      d: string,
      parent: Element,
      fallbackLen: number,
      fallbackEnd: { x: number; y: number },
      cls = 't-gen-wire',
      extra: Record<string, string | number> = {},
    ): StrokeRecord => {
      const e = createSvg('path', { d, class: cls, ...extra }, parent);
      return {
        el: e,
        L: safeLength(e, fallbackLen),
        gap: cls === 't-gen-guide' ? GUIDE_GAP : DOT_GAP,
        idx: 0,
        pt: fallbackEnd,
        fallbackEnd,
      };
    };

    const makeHead = (parent: Element, r = 2.3) =>
      createSvg('circle', { r: f2(r), class: 't-gen-head', opacity: 0 }, parent);

    // 2. Vertical probe, perimeter guides, and dimension readout
    const probe = createSvg(
      'path',
      { d: `M0 0V${f2(h)}`, class: 't-gen-guide t-gen-guide--dashed', opacity: 0 },
      svgRoot,
    );
    const guides = [
      [0, 1, w, 1],
      [w - 1, 0, w - 1, h],
      [w, h - 1, 0, h - 1],
      [1, h, 1, 0],
    ].map(([a, b, c, d]) =>
      makeStroke(
        `M${f2(a)} ${f2(b)}L${f2(c)} ${f2(d)}`,
        svgRoot,
        Math.hypot(c - a, d - b),
        { x: c, y: d },
        't-gen-guide',
      ),
    );
    const dimLabel = createSvg(
      'text',
      { x: 10, y: 14, class: 't-gen-label', opacity: 0 },
      svgRoot,
    );

    // 3. Wireframe group clipped behind the downward-sweeping scanline
    const clipId = `t-gen-clip-${seq}`;
    const glowId = `t-gen-glow-${seq}`;
    const clip = createSvg('clipPath', { id: clipId }, defs);
    const clipRect = createSvg('rect', { x: -4, y: 0, width: f2(w + 8), height: f2(h + 8) }, clip);

    const glow = createSvg('linearGradient', { id: glowId, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    createSvg('stop', { offset: 0, class: 't-gen-glow-stop', 'stop-opacity': 0 }, glow);
    createSvg('stop', { offset: 1, class: 't-gen-glow-stop', 'stop-opacity': 0.16 }, glow);

    const wire = createSvg(
      'g',
      { 'clip-path': `url(#${clipId})`, class: 't-gen-wireframe' },
      svgRoot,
    );

    const outline: StrokeRecord[] = ([1, 0] as const).map((dir) => {
      const s = makeStroke(
        rrHalf(1, 1, Math.max(2, w - 2), Math.max(2, h - 2), M.r, dir),
        wire,
        w + h,
        { x: w / 2, y: h - 1 },
      );
      s.head = makeHead(wire, 2.6);
      return s;
    });

    // 4. Traced internal parts (boxes, text lines, SVG icons)
    const partGroups: Array<{
      strokes: StrokeRecord[];
      strokeCount: number;
      b: { x: number; y: number; w: number; h: number };
      name: string;
      key: boolean;
      t0: number;
      t1: number;
    }> = [];

    for (const P of M.parts) {
      const strokes: StrokeRecord[] = [];
      if (P.kind === 'box' && P.key) {
        ([1, 0] as const).forEach((dir) => {
          const s = makeStroke(
            rrHalf(P.x, P.y, P.w, P.h, P.r, dir),
            wire,
            P.w + P.h,
            { x: P.x + P.w / 2, y: P.y + P.h },
          );
          s.together = true;
          strokes.push(s);
        });
      } else if (P.kind === 'box') {
        strokes.push(
          makeStroke(
            rrPath(P.x, P.y, P.w, P.h, P.r),
            wire,
            2 * (P.w + P.h),
            { x: P.x + P.w, y: P.y + P.h },
          ),
        );
      } else if (P.kind === 'text') {
        for (const ln of P.lines) {
          const y = ln.y + ln.h * 0.56;
          const s = makeStroke(
            `M${f2(ln.x)} ${f2(y)}H${f2(ln.x2)}`,
            wire,
            Math.max(4, ln.x2 - ln.x),
            { x: ln.x2, y },
          );
          s.caps = [
            createSvg('circle', { cx: f2(ln.x), cy: f2(y), r: 1.6, class: 't-gen-head', opacity: 0 }, wire),
            createSvg('circle', { cx: f2(ln.x2), cy: f2(y), r: 1.6, class: 't-gen-head', opacity: 0 }, wire),
          ];
          strokes.push(s);
        }
      } else if (P.kind === 'icon') {
        for (const src of P.paths) {
          const [a, b, c, d] = src.m;
          const k = Math.sqrt(Math.abs(a * d - b * c)) || 1;
          const g = createSvg(
            'g',
            {
              transform: `matrix(${src.m.map((v) => (+v).toFixed(3)).join(' ')})`,
              style: `stroke-width:${(1.8 / k).toFixed(3)}`,
            },
            wire,
          );
          const e = createSvg(
            src.tag as keyof SVGElementTagNameMap,
            { ...src.attrs, class: 't-gen-wire' },
            g,
          );
          strokes.push({
            el: e,
            L: safeLength(e, 24),
            gap: 3.6,
            k,
            local: g,
            idx: 0,
            pt: { x: P.x + P.w / 2, y: P.y + P.h / 2 },
            fallbackEnd: { x: P.x + P.w / 2, y: P.y + P.h / 2 },
          });
        }
      }

      if (strokes.length === 0) continue;
      strokes.forEach((s) => {
        s.head = makeHead(s.local || wire, 2.3 / (s.k || 1));
      });
      let ix = -1;
      strokes.forEach((s, i) => {
        s.idx =
          s.together && i > 0 && strokes[i - 1].together ? ix : ++ix;
      });
      partGroups.push({
        strokes,
        strokeCount: ix + 1,
        b: { x: P.x, y: P.y, w: P.w, h: P.h },
        name: P.name,
        key: Boolean(P.key),
        t0: 0,
        t1: 0,
      });
    }

    const totalParts = partGroups.length;
    const partSpan = PH.parts[1] - PH.parts[0];
    const partDur = Math.min(0.2, partSpan * 0.6);
    partGroups.forEach((pt, i) => {
      pt.t0 =
        PH.parts[0] +
        (totalParts > 1 ? (partSpan - partDur) * (i / (totalParts - 1)) : 0);
      pt.t1 = pt.t0 + partDur;
    });

    // 5. Key element guides, corner handles, and dimension badges
    const keyDecorations = partGroups
      .filter((pt) => pt.key)
      .map((pt) => {
        const { x, y, w: bw, h: bh } = pt.b;
        const E = 12;
        return {
          pt,
          guides: [
            [Math.max(0, x - E), y, Math.min(w, x + bw + E), y],
            [x + bw, Math.max(0, y - E), x + bw, Math.min(h, y + bh + E)],
            [Math.min(w, x + bw + E), y + bh, Math.max(0, x - E), y + bh],
            [x, Math.min(h, y + bh + E), x, Math.max(0, y - E)],
          ].map(([a, b, c, d]) =>
            makeStroke(
              `M${f2(a)} ${f2(b)}L${f2(c)} ${f2(d)}`,
              svgRoot,
              Math.hypot(c - a, d - b),
              { x: c, y: d },
              't-gen-guide',
              { opacity: 0 },
            ),
          ),
          handles: [
            [x, y],
            [x + bw, y],
            [x + bw, y + bh],
            [x, y + bh],
          ].map(([hx, hy]) => ({
            el: createSvg(
              'rect',
              {
                x: -2,
                y: -2,
                width: 4,
                height: 4,
                class: 't-gen-handle',
                transform: `translate(${f2(hx)} ${f2(hy)}) scale(0)`,
              },
              svgRoot,
            ),
            x: hx,
            y: hy,
          })),
          dim: createSvg(
            'text',
            {
              x: f2(Math.max(4, x)),
              y: f2(Math.max(10, y - 4)),
              class: 't-gen-label t-gen-label--small',
              opacity: 0,
            },
            svgRoot,
          ),
        };
      });

    // 6. Reticle, card handles, coordinate readout, and horizontal scanline
    const reticle = createSvg('path', { class: 't-gen-reticle', opacity: 0 }, svgRoot);
    const reticleTag = createSvg(
      'text',
      { class: 't-gen-label t-gen-label--tag', opacity: 0 },
      svgRoot,
    );
    const cardHandles = [
      [3, 3, 0.17],
      [w - 3, 3, 0.17],
      [w - 3, h - 3, 0.37],
      [3, h - 3, 0.37],
    ].map(([hx, hy, at]) => ({
      el: createSvg(
        'rect',
        {
          x: -2.5,
          y: -2.5,
          width: 5,
          height: 5,
          class: 't-gen-handle',
          transform: `translate(${f2(hx)} ${f2(hy)}) scale(0)`,
        },
        svgRoot,
      ),
      x: hx,
      y: hy,
      at,
    }));
    const coordReadout = createSvg(
      'text',
      { class: 't-gen-label t-gen-label--small', opacity: 0 },
      svgRoot,
    );

    const scanGroup = createSvg('g', { class: 't-gen-scan', opacity: 0 }, svgRoot);
    createSvg(
      'rect',
      { x: 0, y: -26, width: f2(w), height: 26, fill: `url(#${glowId})` },
      scanGroup,
    );
    const scanLine = createSvg(
      'path',
      { d: `M0 0H${f2(w)}`, class: 't-gen-guide t-gen-guide--scan' },
      scanGroup,
    );
    createSvg('circle', { cx: 2, cy: 0, r: 2.3, class: 't-gen-head' }, scanGroup);
    createSvg('circle', { cx: f2(w - 2), cy: 0, r: 2.3, class: 't-gen-head' }, scanGroup);

    const drawStroke = (s: StrokeRecord, q: number, t: number) => {
      const on = q > 0;
      s.el.style.opacity = on ? '1' : '0';
      if (on) {
        const gap = s.gap / (s.k || 1);
        const n = Math.max(1, Math.floor((s.L * Math.min(1, q)) / gap) + 1);
        if (n !== s.n) {
          s.n = n;
          s.el.style.strokeDasharray = `${`0 ${f2(gap)} `.repeat(n - 1)}0 ${f2(s.L + 10)}`;
        }
        s.el.style.strokeDashoffset = f2(-((t * FLOW) / (s.k || 1)) % gap);
      }
      if (s.head) {
        const live = (s.live = q > 0 && q < 1);
        s.head.setAttribute('opacity', live ? '1' : '0');
        if (live) {
          const gap = s.gap / (s.k || 1);
          const dist = Math.floor((s.L * q) / gap) * gap;
          s.pt = safePoint(s.el, dist, {
            x: lerp(0, s.fallbackEnd.x, q),
            y: lerp(0, s.fallbackEnd.y, q),
          });
          s.head.setAttribute('cx', f2(s.pt.x));
          s.head.setAttribute('cy', f2(s.pt.y));
        }
      }
      if (s.caps) {
        s.caps[0].setAttribute('opacity', on ? '1' : '0');
        s.caps[1].setAttribute('opacity', q >= 1 ? '1' : '0');
      }
    };

    const tStart = performance.now();

    const tick = (now: number) => {
      if (stopped) return;
      const t = Math.max(0, now - tStart);
      const p = t / durationMs;

      // Notify step progress
      if (options.onStepChange && stepsCount > 1) {
        const nextIdx = Math.min(
          stepsCount - 1,
          Math.floor(clamp(p / 0.92) * stepsCount),
        );
        if (nextIdx !== lastStepIdx) {
          lastStepIdx = nextIdx;
          options.onStepChange(nextIdx);
        }
      }

      const clean = 1 - smooth(PH.clean[0], PH.clean[1], p);
      const sq = SMOOTH_OUT(win(PH.reveal, p));
      const scanY = sq * (h + 4) - 2;

      // Wipe Solva blueprint canvas & wireframe downward behind the scanline
      if (canvasEl) {
        if (p < PH.reveal[0]) {
          canvasEl.style.clipPath = 'inset(0px 0px 0px 0px)';
          canvasEl.style.opacity = '1';
        } else if (p >= PH.reveal[1]) {
          canvasEl.style.opacity = '0';
        } else {
          canvasEl.style.clipPath = `inset(${f2(Math.max(0, scanY))}px 0px 0px 0px)`;
          canvasEl.style.opacity = f2(Math.max(0, 1 - smooth(0.88, 1, sq)));
        }
      }

      clipRect.setAttribute('y', f2(p < PH.reveal[0] ? -4 : scanY));
      clipRect.setAttribute('height', f2(h + 8));
      wire.setAttribute('opacity', f2(1 - 0.55 * sq));

      const scanOp =
        p >= PH.reveal[0] && p < PH.reveal[1]
          ? smooth(0, 0.12, sq) * (1 - smooth(0.86, 1, sq))
          : 0;
      scanGroup.setAttribute('opacity', f2(scanOp));
      scanGroup.setAttribute('transform', `translate(0 ${f2(scanY)})`);
      scanLine.style.strokeDashoffset = f2(-(t * FLOW * 2) % 5);

      // Dot-matrix ripple + probe + reticle illumination
      const rippleR = OUT(win(PH.dots, p)) * (maxD + 48);
      const rainOn = smooth(0.04, 0.2, p) * (1 - smooth(0.62, 0.86, p));
      const pw = win(PH.probe, p);
      const probeX = lerp(0, w, OUT(pw));
      const probeOp =
        pw > 0 && pw < 1 ? smooth(0, 0.1, pw) * (1 - smooth(0.85, 1, pw)) : 0;
      probe.setAttribute('transform', `translate(${f2(probeX)} 0)`);
      probe.setAttribute('opacity', f2(probeOp * 0.8));

      let rb: { x: number; y: number; w: number; h: number } | null = null;
      let rOp = 0;
      const activePartIdx = partGroups.reduce(
        (acc, pt, idx) => (p >= pt.t0 ? idx : acc),
        -1,
      );
      if (activePartIdx >= 0 && p < PH.reveal[0] + 0.06) {
        const pt = partGroups[activePartIdx];
        const from =
          activePartIdx > 0
            ? partGroups[activePartIdx - 1].b
            : { x: 0, y: 0, w, h };
        const q = OUT(clamp((p - pt.t0) / 0.05));
        const pad = 4;
        rb = {
          x: lerp(from.x, pt.b.x, q) - pad,
          y: lerp(from.y, pt.b.y, q) - pad,
          w: lerp(from.w, pt.b.w, q) + pad * 2,
          h: lerp(from.h, pt.b.h, q) + pad * 2,
        };
        rOp =
          smooth(PH.parts[0], PH.parts[0] + 0.04, p) *
          (1 - smooth(PH.reveal[0], PH.reveal[0] + 0.06, p));
        const l = Math.min(7, rb.w / 3, rb.h / 3);
        const { x: X, y: Y, w: RW, h: RH } = rb;
        reticle.setAttribute(
          'd',
          `M${f2(X)} ${f2(Y + l)}V${f2(Y)}H${f2(X + l)}` +
            `M${f2(X + RW - l)} ${f2(Y)}H${f2(X + RW)}V${f2(Y + l)}` +
            `M${f2(X + RW)} ${f2(Y + RH - l)}V${f2(Y + RH)}H${f2(X + RW - l)}` +
            `M${f2(X + l)} ${f2(Y + RH)}H${f2(X)}V${f2(Y + RH - l)}`,
        );
        reticleTag.setAttribute('x', f2(Math.max(4, X)));
        reticleTag.setAttribute('y', f2(Math.max(10, Y - 4)));
        reticleTag.textContent = `${pt.name} ${Math.round(pt.b.w)}×${Math.round(pt.b.h)}`;
      }
      reticle.setAttribute('opacity', f2(rOp));
      reticleTag.setAttribute('opacity', f2(rOp));

      for (const d of dots) {
        const lag = rippleR - d.d;
        const env = clamp(lag / 46);
        const front =
          p < PH.dots[1] + 0.05 ? Math.exp(-(((lag - 6) / 14) ** 2)) : 0;
        const headY = ((t * d.v + d.ph) % (h + d.tr));
        const back = headY - d.y;
        const rain =
          back >= 0 && back < d.tr ? (1 - back / d.tr) ** 1.6 * rainOn * env : 0;
        const near = rb
          ? Math.max(
              0,
              1 -
                Math.max(
                  rb.x - d.x,
                  d.x - rb.x - rb.w,
                  rb.y - d.y,
                  d.y - rb.y - rb.h,
                  0,
                ) /
                  16,
            ) *
            (d.x > rb.x && d.x < rb.x + rb.w && d.y > rb.y && d.y < rb.y + rb.h
              ? 1
              : 0.6)
          : 0;
        const probeLit =
          probeOp > 0
            ? Math.exp(-(((d.x - probeX) / 9) ** 2)) * probeOp * env
            : 0;
        const lit = Math.max(front, rain, near * rOp * 0.8, probeLit);
        const under = p >= PH.reveal[0] && d.y < scanY ? 0 : 1;
        d.el.setAttribute('opacity', f2(Math.max(env * 0.45, lit) * clean * under));
        d.el.setAttribute('r', f2(1.0 + lit * 0.8));
        d.el.classList.toggle('is-lit', lit > 0.35);
      }

      // Guides, dimension label, card outline, handles
      const gOp = 0.5 * (1 - smooth(0.66, 0.92, p));
      guides.forEach((g, i) => {
        const q = OUT(
          clamp((p - PH.guides[0] - i * 0.03) / (PH.guides[1] - PH.guides[0] - 0.09)),
        );
        drawStroke(g, q, t);
        g.el.style.opacity = q > 0 ? f2(gOp) : '0';
      });

      const oq = OUT(win(PH.outline, p));
      dimLabel.textContent = `${Math.round(w * oq)} × ${Math.round(h * oq)}   t+${((Math.min(p, 1) * durationMs) / 1000).toFixed(2)}s`;
      dimLabel.setAttribute(
        'opacity',
        f2(p > PH.outline[0] ? (1 - smooth(0.66, 0.9, p)) * 0.85 : 0),
      );
      outline.forEach((s) => drawStroke(s, oq, t));

      cardHandles.forEach((hd) => {
        const sc =
          OUT(clamp((p - hd.at) / 0.1)) * (1 - smooth(0.82, 0.96, p));
        hd.el.setAttribute(
          'transform',
          `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(sc)})`,
        );
      });

      // Part strokes & key element guides/handles
      for (const pt of partGroups) {
        const q = clamp((p - pt.t0) / (pt.t1 - pt.t0));
        pt.strokes.forEach((s) => {
          drawStroke(s, OUT(clamp(q * pt.strokeCount - s.idx * 0.75)), t);
        });
      }

      const kOut = 1 - smooth(PH.reveal[0] - 0.02, PH.reveal[0] + 0.1, p);
      for (const K of keyDecorations) {
        const kt0 = K.pt.t0 - 0.03;
        const hq = OUT(clamp((p - K.pt.t0 - 0.04) / 0.08));
        const oq2 = OUT(clamp((p - K.pt.t0) / (K.pt.t1 - K.pt.t0)));
        K.guides.forEach((g, i) => {
          const q = OUT(clamp((p - kt0 - i * 0.012) / 0.1));
          drawStroke(g, q, t);
          g.el.style.opacity = q > 0 ? f2(0.45 * kOut) : '0';
        });
        K.handles.forEach((hd) => {
          hd.el.setAttribute(
            'transform',
            `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(hq * kOut)})`,
          );
        });
        K.dim.setAttribute('opacity', f2(p > kt0 ? 0.85 * kOut : 0));
        K.dim.textContent = `${Math.round(K.pt.b.w * oq2)} × ${Math.round(K.pt.b.h * oq2)}`;
      }

      // Live coordinate readout on active stroke head
      let activeStroke: StrokeRecord | null = null;
      for (const s of [
        ...outline,
        ...partGroups.flatMap((pt) => pt.strokes),
      ]) {
        if (s.live && !s.local) activeStroke = s;
      }
      coordReadout.setAttribute('opacity', activeStroke ? '1' : '0');
      if (activeStroke) {
        coordReadout.setAttribute(
          'x',
          f2(Math.min(w - 44, activeStroke.pt.x + 6)),
        );
        coordReadout.setAttribute('y', f2(Math.max(10, activeStroke.pt.y - 5)));
        coordReadout.textContent = `${String(Math.round(activeStroke.pt.x)).padStart(3, '0')}·${String(Math.round(activeStroke.pt.y)).padStart(3, '0')}`;
      }

      if (p >= END) {
        finish();
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  });

  return {
    cancel: () => {
      if (stopped) return;
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      cleanupDom();
    },
  };
}
