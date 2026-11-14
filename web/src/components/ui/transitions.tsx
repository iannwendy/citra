import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { cn } from '@/lib/utils';
import { runUIGeneration } from '@/lib/uiGenerationEngine';
import {
  m,
  AnimatePresence,
  TRANSITION_ENTER,
  TRANSITION_EXIT,
} from './motion-primitives';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function prefersReducedMotion(): boolean {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return true;
  }
  if (
    typeof import.meta !== 'undefined' &&
    import.meta.env?.MODE === 'test' &&
    !(globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__
  ) {
    return true;
  }
  return false;
}

/* ==========================================================================
   #01 Card resize (<CardResize>)
   Smoothly transitions height when children change size
   ========================================================================== */
export function CardResize({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;
    if (prefersReducedMotion()) return;

    let initialized = false;
    let prevHeight = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h =
          entry.borderBoxSize?.[0]?.blockSize ??
          inner.getBoundingClientRect().height;
        if (!initialized) {
          initialized = true;
          prevHeight = h;
          outer.style.height = 'auto';
          return;
        }
        if (Math.abs(h - prevHeight) < 0.5) return;
        const fromH = prevHeight;
        prevHeight = h;
        if (settleTimer) clearTimeout(settleTimer);
        outer.style.height = `${fromH}px`;
        void outer.offsetHeight;
        outer.style.height = `${h}px`;
        settleTimer = setTimeout(() => {
          outer.style.height = 'auto';
        }, 320);
      }
    });
    ro.observe(inner);
    return () => {
      ro.disconnect();
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  return (
    <div ref={outerRef} className={cn('t-card-resize', className)}>
      <div ref={innerRef} className={cn('t-card-resize-inner', innerClassName)}>
        {children}
      </div>
    </div>
  );
}

/* ==========================================================================
   #02 Number pop-in (<NumberPopIn>)
   3D drum per-character pop-in for counters, prices, and stat cards.
   Unchanged prefix/suffix/digits stay stationary via [data-same];
   outgoing characters render via CSS ::before { content: attr(data-char) }
   so element.textContent remains 100% pure at every frame.
   ========================================================================== */
interface DigitSlotDiff {
  newCh: string;
  oldCh: string | null;
  isSame: boolean;
  stagger?: '1' | '2';
}

function diffNumberSlots(prevStr: string | null, nextStr: string): DigitSlotDiff[] {
  const nextChars = Array.from(nextStr);
  if (prevStr === null || prevStr === nextStr) {
    return nextChars.map((newCh) => ({
      newCh,
      oldCh: null,
      isSame: true,
    }));
  }

  const prevChars = Array.from(prevStr);

  // Preserve shared leading non-digit prefix (e.g. "$") and trailing non-digit suffix (e.g. "%", "ms")
  let prefixLen = 0;
  while (
    prefixLen < prevChars.length &&
    prefixLen < nextChars.length &&
    prevChars[prefixLen] === nextChars[prefixLen] &&
    !/\d/.test(nextChars[prefixLen])
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < prevChars.length - prefixLen &&
    suffixLen < nextChars.length - prefixLen &&
    prevChars[prevChars.length - 1 - suffixLen] ===
      nextChars[nextChars.length - 1 - suffixLen] &&
    !/\d/.test(nextChars[nextChars.length - 1 - suffixLen])
  ) {
    suffixLen++;
  }

  const prevMid = prevChars.slice(prefixLen, prevChars.length - suffixLen);
  const nextMid = nextChars.slice(prefixLen, nextChars.length - suffixLen);

  const slots: DigitSlotDiff[] = [];

  for (let i = 0; i < prefixLen; i++) {
    slots.push({ newCh: nextChars[i], oldCh: null, isSame: true });
  }

  for (let i = 0; i < nextMid.length; i++) {
    const prevIdx = i - (nextMid.length - prevMid.length);
    const oldCh = prevIdx >= 0 ? prevMid[prevIdx] : null;
    const newCh = nextMid[i];
    const isSame = oldCh === newCh;
    slots.push({
      newCh,
      oldCh: isSame ? null : oldCh,
      isSame,
    });
  }

  for (let i = nextChars.length - suffixLen; i < nextChars.length; i++) {
    slots.push({ newCh: nextChars[i], oldCh: null, isSame: true });
  }

  const changedIndices: number[] = [];
  slots.forEach((slot, idx) => {
    if (!slot.isSame) changedIndices.push(idx);
  });

  if (changedIndices.length === 2) {
    slots[changedIndices[1]].stagger = '1';
  } else if (changedIndices.length >= 3) {
    slots[changedIndices[changedIndices.length - 2]].stagger = '1';
    slots[changedIndices[changedIndices.length - 1]].stagger = '2';
  }

  return slots;
}

export function NumberPopIn({
  value,
  className,
  'data-testid': testId,
}: {
  value: string | number;
  className?: string;
  'data-testid'?: string;
}) {
  const str = String(value);
  const trackRef = useRef<{
    current: string;
    old: string | null;
    runId: number;
  }>({
    current: str,
    old: null,
    runId: 0,
  });
  const [, setCleanupTick] = useState(0);

  if (str !== trackRef.current.current) {
    const prev = trackRef.current.current;
    trackRef.current = {
      current: str,
      old: prefersReducedMotion() ? null : prev,
      runId: trackRef.current.runId + 1,
    };
  }

  const activeOld = trackRef.current.old;
  const activeRunId = trackRef.current.runId;

  useEffect(() => {
    if (activeOld === null) return;
    const runAtSchedule = activeRunId;
    const timer = setTimeout(() => {
      if (trackRef.current.runId === runAtSchedule) {
        trackRef.current = { ...trackRef.current, old: null };
        setCleanupTick((t) => t + 1);
      }
    }, 780);
    return () => clearTimeout(timer);
  }, [activeOld, activeRunId]);

  const animating = activeOld !== null;
  const slots = diffNumberSlots(activeOld, str);

  return (
    <span
      data-testid={testId}
      className={cn('t-digit-group', animating && 'is-animating', className)}
    >
      <span className="sr-only">{str}</span>
      {slots.map((slot, idx) => (
        <span
          key={slot.isSame ? `same-${idx}` : `${activeRunId}-${idx}`}
          className="t-digit-slot"
          aria-hidden="true"
        >
          {slot.oldCh !== null && !slot.isSame && (
            <span
              className="t-digit-old"
              data-char={slot.oldCh}
              data-stagger={slot.stagger}
              aria-hidden="true"
            />
          )}
          <span
            className="t-digit"
            data-char={slot.newCh}
            data-same={slot.isSame ? '' : undefined}
            data-stagger={!slot.isSame ? slot.stagger : undefined}
            aria-hidden="true"
          />
        </span>
      ))}
    </span>
  );
}

/* ==========================================================================
   #36 Number subtle change (<SubtleNumber>)
   Quiet cross-fade for frequently polled telemetry numbers
   ========================================================================== */
export function SubtleNumber({
  value,
  suffix = '',
  prefix = '',
  className,
}: {
  value: number | string;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const str = `${prefix}${value}${suffix}`;
  const numVal = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
  const trackRef = useRef<{
    current: string;
    numVal: number;
    old: string | null;
    dir: 1 | -1;
    runId: number;
  }>({
    current: str,
    numVal,
    old: null,
    dir: 1,
    runId: 0,
  });
  const [, setCleanupTick] = useState(0);

  if (str !== trackRef.current.current) {
    const prev = trackRef.current;
    trackRef.current = {
      current: str,
      numVal,
      old: prefersReducedMotion() ? null : prev.current,
      dir: numVal >= prev.numVal ? 1 : -1,
      runId: prev.runId + 1,
    };
  }

  const activeOld = trackRef.current.old;
  const activeDir = trackRef.current.dir;
  const activeRunId = trackRef.current.runId;

  useEffect(() => {
    if (activeOld === null) return;
    const runAtSchedule = activeRunId;
    const timer = setTimeout(() => {
      if (trackRef.current.runId === runAtSchedule) {
        trackRef.current = { ...trackRef.current, old: null };
        setCleanupTick((t) => t + 1);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [activeOld, activeRunId]);

  const animating = activeOld !== null;

  return (
    <span
      style={{ '--subtle-dir': activeDir } as React.CSSProperties}
      className={cn('t-subtle-number', animating && 'is-animating', className)}
    >
      <span key={activeRunId} className="t-subtle-slot">
        {activeOld !== null && (
          <span className="t-subtle-old" data-old={activeOld} aria-hidden="true" />
        )}
        <span className="t-subtle-new">{str}</span>
      </span>
    </span>
  );
}

/* ==========================================================================
   #34 Text swap soft (<SoftTextSwap>)
   In-place cross-blur when values in a panel/table change simultaneously
   ========================================================================== */
export function SoftTextSwap({
  text,
  className,
  align = 'start',
}: {
  text: string;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  const trackRef = useRef<{
    current: string;
    old: string | null;
    runId: number;
  }>({
    current: text,
    old: null,
    runId: 0,
  });
  const [, setCleanupTick] = useState(0);

  if (text !== trackRef.current.current) {
    const prev = trackRef.current;
    trackRef.current = {
      current: text,
      old: prefersReducedMotion() ? null : prev.current,
      runId: prev.runId + 1,
    };
  }

  const activeOld = trackRef.current.old;
  const activeRunId = trackRef.current.runId;

  useEffect(() => {
    if (activeOld === null) return;
    const runAtSchedule = activeRunId;
    const timer = setTimeout(() => {
      if (trackRef.current.runId === runAtSchedule) {
        trackRef.current = { ...trackRef.current, old: null };
        setCleanupTick((t) => t + 1);
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [activeOld, activeRunId]);

  const swapping = activeOld !== null;

  return (
    <span
      style={{ '--text-soft-align': align } as React.CSSProperties}
      className={cn('t-text-soft', swapping && 'is-swapping', className)}
    >
      {activeOld !== null && (
        <span
          key={`old-${activeRunId}`}
          className="t-text-soft-old"
          data-old={activeOld}
          aria-hidden="true"
        />
      )}
      <span
        key={`new-${activeRunId}`}
        className={activeOld !== null ? 't-text-soft-new' : undefined}
      >
        {text}
      </span>
    </span>
  );
}

/* ==========================================================================
   #04 Text states swap (<TextStatesSwap>)
   Three-phase vertical exit/enter swap for status labels ("Verify" -> "Uploading...")
   ========================================================================== */
export function TextStatesSwap({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState(text);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter-start'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (text === displayed) return;
    if (prefersReducedMotion()) {
      setDisplayed(text);
      setPhase('idle');
      return;
    }

    setPhase('exit');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDisplayed(text);
      setPhase('enter-start');
      requestAnimationFrame(() => {
        if (spanRef.current) {
          void spanRef.current.offsetHeight;
        }
        setPhase('idle');
      });
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, displayed]);

  return (
    <span
      ref={spanRef}
      className={cn(
        't-text-swap',
        phase === 'exit' && 'is-exit',
        phase === 'enter-start' && 'is-enter-start',
        className,
      )}
    >
      {displayed}
    </span>
  );
}

/* ==========================================================================
   #33 Text morph (<TextMorph>)
   Keeps shared prefix/suffix characters stationary while morphing the diff
   ("Copy" -> "Copied", "Share" -> "Shared")
   ========================================================================== */
export function TextMorph({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const elRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<string>(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = elRef.current;
    const prev = prevRef.current;
    if (!el || prev === text) return;
    prevRef.current = text;

    if (prefersReducedMotion()) {
      el.textContent = text;
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    let a = 0;
    while (a < prev.length && a < text.length && prev[a] === text[a]) a++;
    let b = 0;
    while (
      b < prev.length - a &&
      b < text.length - a &&
      prev[prev.length - 1 - b] === text[text.length - 1 - b]
    ) {
      b++;
    }

    const swap = document.createElement('span');
    swap.className = 't-morph-swap';
    const out = document.createElement('span');
    out.className = 't-morph-old';
    out.setAttribute('aria-hidden', 'true');
    out.textContent = prev.slice(a, prev.length - b);
    const inn = document.createElement('span');
    inn.className = 't-morph-new';
    inn.textContent = text.slice(a, text.length - b);
    swap.append(out, inn);

    el.textContent = '';
    el.append(text.slice(0, a), swap, text.slice(text.length - b));

    const w0 = out.getBoundingClientRect().width;
    const w1 = inn.getBoundingClientRect().width;
    swap.style.width = `${w0}px`;
    void swap.offsetWidth;
    swap.classList.add('is-morphing');
    swap.style.width = `${w1}px`;

    timerRef.current = setTimeout(() => {
      if (elRef.current) {
        elRef.current.textContent = text;
      }
    }, 260);
  }, [text]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span ref={elRef} className={cn('t-morph', className)}>
      {text}
    </span>
  );
}

/* ==========================================================================
   #09 Icon swap (<IconSwap>)
   Cross-fades two icons in the same grid slot with 2px blur and scale
   ========================================================================== */
export function IconSwap({
  active,
  iconA,
  iconB,
  className,
}: {
  active: 'a' | 'b' | boolean;
  iconA: React.ReactNode;
  iconB: React.ReactNode;
  className?: string;
}) {
  const state = active === true || active === 'b' ? 'b' : 'a';
  return (
    <span className={cn('t-icon-swap', className)} data-state={state}>
      <span className="t-icon" data-icon="a" aria-hidden={state !== 'a'}>
        {iconA}
      </span>
      <span className="t-icon" data-icon="b" aria-hidden={state !== 'b'}>
        {iconB}
      </span>
    </span>
  );
}

/* ==========================================================================
   #10 Success check (<SuccessCheck>)
   Measures SVG path.getTotalLength() on mount and animates rotate+bob+draw
   ========================================================================== */
export function SuccessCheck({
  show = true,
  size = 16,
  strokeWidth = 2.25,
  className,
}: {
  show?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useIsomorphicLayoutEffect(() => {
    const path = pathRef.current;
    const wrap = wrapRef.current;
    if (!path || !wrap) return;
    try {
      if (typeof path.getTotalLength === 'function') {
        const len = Math.ceil(path.getTotalLength()) + 1;
        wrap.style.setProperty('--check-len', String(len));
      }
    } catch {
      // Fallback for JSDOM where getTotalLength may not be implemented
      wrap.style.setProperty('--check-len', '24');
    }
  }, []);

  return (
    <span
      ref={wrapRef}
      className={cn('t-success-check', className)}
      data-state={show ? 'in' : 'out'}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path ref={pathRef} d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </span>
  );
}

/* ==========================================================================
   #31 Matrix dot loader (<MatrixDotLoader>)
   4x4 dot matrix inline loader with scan / twinkle / orbit / pulse delay table
   ========================================================================== */
const MATRIX_CORNERS = [0, 3, 12, 15];
const MATRIX_RING = [1, 2, 7, 11, 14, 13, 8, 4];
const MATRIX_INNER = [5, 6, 9, 10];
const MATRIX_TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

export function MatrixDotLoader({
  variant = 'scan',
  rounded = false,
  cycleMs = 1100,
  className,
}: {
  variant?: 'scan' | 'twinkle' | 'orbit' | 'pulse';
  rounded?: boolean;
  cycleMs?: number;
  className?: string;
}) {
  const dots = Array.from({ length: 16 }, (_, idx) => {
    const col = idx % 4;
    const isGap = rounded && MATRIX_CORNERS.includes(idx);
    let delay = 0;
    let steady = false;

    if (!isGap) {
      if (variant === 'scan') {
        delay = Math.round(col * (cycleMs / 10));
      } else if (variant === 'twinkle') {
        delay = Math.round(MATRIX_TWINKLE[idx] * (cycleMs / 16));
      } else if (variant === 'orbit') {
        const k = MATRIX_RING.indexOf(idx);
        if (k !== -1) {
          delay = Math.round(k * (cycleMs / 8));
        } else {
          steady = true;
        }
      } else if (variant === 'pulse') {
        const ring = MATRIX_INNER.includes(idx) ? 0 : 1;
        delay = Math.round(ring * (cycleMs * 0.16));
      }
    }

    return { idx, isGap, delay, steady };
  });

  return (
    <span
      className={cn('t-matrix', className)}
      data-variant={variant}
      data-rounded={rounded ? 'true' : 'false'}
      aria-hidden="true"
    >
      {dots.map((d) => (
        <i
          key={d.idx}
          className={d.isGap ? 'is-gap' : undefined}
          style={
            d.steady
              ? { animation: 'none' }
              : ({ '--d': d.delay } as React.CSSProperties)
          }
        />
      ))}
    </span>
  );
}

/* ==========================================================================
   #28 Thinking states (<ThinkingStateText>)
   Shimmers while holding a state, then exits upward with blur when text updates
   ========================================================================== */
export function ThinkingStateText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState(text);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter-start'>('idle');
  const spanRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (text === displayed) return;
    if (prefersReducedMotion()) {
      setDisplayed(text);
      setPhase('idle');
      return;
    }

    setPhase('exit');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDisplayed(text);
      setPhase('enter-start');
      requestAnimationFrame(() => {
        if (spanRef.current) {
          void spanRef.current.offsetHeight;
        }
        setPhase('idle');
      });
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, displayed]);

  return (
    <span className={cn('t-think', className)} role="status">
      <span
        ref={spanRef}
        data-text={displayed}
        className={cn(
          't-think-text',
          phase === 'exit' && 'is-exit',
          phase === 'enter-start' && 'is-enter-start',
        )}
      >
        {displayed}
      </span>
    </span>
  );
}

/* ==========================================================================
   #30 Streaming text (<StreamingText>)
   Resolves words sequentially through opacity + 1.5px blur when text changes
   ========================================================================== */
export function StreamingText({
  text,
  gapMs = 24,
  maxAnimatedWords = 45,
  className,
}: {
  text: string;
  gapMs?: number;
  maxAnimatedWords?: number;
  className?: string;
}) {
  const words = text.trim().split(/\s+/);
  const [visibleCount, setVisibleCount] = useState<number>(words.length);
  const prevTextRef = useRef<string>(text);

  useEffect(() => {
    if (prevTextRef.current === text) return;
    prevTextRef.current = text;

    if (prefersReducedMotion() || words.length === 0) {
      setVisibleCount(words.length);
      return;
    }

    setVisibleCount(0);
    let current = 0;
    const step = Math.max(1, Math.ceil(words.length / maxAnimatedWords));
    const interval = setInterval(() => {
      current += step;
      if (current >= words.length) {
        setVisibleCount(words.length);
        clearInterval(interval);
      } else {
        setVisibleCount(current);
      }
    }, gapMs);

    return () => clearInterval(interval);
  }, [text, words.length, gapMs, maxAnimatedWords]);

  return (
    <span className={cn('t-stream', className)}>
      {words.map((word, idx) => (
        <React.Fragment key={idx}>
          <span className={cn('t-stream-w', idx < visibleCount && 'is-in')}>
            {word}
          </span>
          {idx < words.length - 1 ? ' ' : ''}
        </React.Fragment>
      ))}
    </span>
  );
}

/* ==========================================================================
   #21 Accordion expand (<AccordionExpand> & <SymmetricChevron>)
   grid-template-rows: 0fr <-> 1fr + symmetric scaleY(-1) chevron flip
   ========================================================================== */
export function SymmetricChevron({
  open,
  className,
  size = 16,
}: {
  open: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn('t-acc-chevron', className)}
      data-open={open ? 'true' : 'false'}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6L8 10L12 6" />
      </svg>
    </span>
  );
}

export function AccordionExpand({
  open,
  children,
  className,
  innerClassName,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div
      className={cn('t-acc-panel', className)}
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
    >
      <div className={cn('t-acc-panel-inner', innerClassName)}>{children}</div>
    </div>
  );
}

/* ==========================================================================
   #19 Card hover tilt (<CardHoverTilt>)
   3D pointer tilt with cursor-tracked radial glare on an outer flat hit area
   ========================================================================== */
export function CardHoverTilt({
  children,
  maxTilt = 5,
  className,
  cardClassName,
  disabled = false,
}: {
  children: React.ReactNode;
  maxTilt?: number;
  className?: string;
  cardClassName?: string;
  disabled?: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || prefersReducedMotion()) return;
      const outer = outerRef.current;
      const card = cardRef.current;
      if (!outer || !card) return;
      const r = outer.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      outer.classList.add('is-hover');
      card.classList.add('is-tilting');
      card.style.setProperty('--tilt-ry', `${((px - 0.5) * maxTilt).toFixed(2)}deg`);
      card.style.setProperty('--tilt-rx', `${((0.5 - py) * maxTilt).toFixed(2)}deg`);
      card.style.setProperty('--tilt-gx', `${(px * 100).toFixed(1)}%`);
      card.style.setProperty('--tilt-gy', `${(py * 100).toFixed(1)}%`);
    },
    [disabled, maxTilt],
  );

  const handlePointerLeave = useCallback(() => {
    const outer = outerRef.current;
    const card = cardRef.current;
    if (!outer || !card) return;
    outer.classList.remove('is-hover');
    card.classList.remove('is-tilting');
    card.style.setProperty('--tilt-rx', '0deg');
    card.style.setProperty('--tilt-ry', '0deg');
  }, []);

  return (
    <div
      ref={outerRef}
      className={cn('t-tilt', className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerLeave}
    >
      <div ref={cardRef} className={cn('t-tilt-card', cardClassName)}>
        {children}
        <div className="t-tilt-glare" aria-hidden="true" />
      </div>
    </div>
  );
}

/* ==========================================================================
   #11 Avatar group hover (<AvatarGroupHover>)
   Distance-falloff lift with direction-aware spring easing
   ========================================================================== */
export function AvatarGroupHover({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const setShifts = useCallback((activeIdx: number | null, phase: 'in' | 'out') => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('.t-avatar'));
    const lift = -4;
    const falloff = 0.45;
    const scale = 1.05;
    const tf =
      phase === 'out'
        ? 'cubic-bezier(0.34, 3.85, 0.64, 1)'
        : 'cubic-bezier(0.22, 1, 0.36, 1)';

    items.forEach((el, i) => {
      el.style.transitionTimingFunction = tf;
      if (activeIdx === null) {
        el.style.setProperty('--shift', '0px');
        el.style.setProperty('--scale-active', '1');
        return;
      }
      const d = Math.abs(i - activeIdx);
      el.style.setProperty('--shift', `${(lift * Math.pow(falloff, d)).toFixed(2)}px`);
      el.style.setProperty('--scale-active', i === activeIdx ? String(scale) : '1');
    });
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn('t-avatar-group', className)}
      onMouseLeave={() => setShifts(null, 'out')}
    >
      {React.Children.map(children, (child, idx) => (
        <div
          key={idx}
          className="t-avatar inline-flex"
          onMouseEnter={() => setShifts(idx, 'in')}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   #24 Learn more hover (<LearnMoreChevron>)
   Trailing chevron that shifts right and spreads its two arms on parent .t-learn:hover
   ========================================================================== */
export function LearnMoreChevron({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn('t-learn-chevron', className)} aria-hidden="true">
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path className="t-learn-arm t-learn-arm-top" d="M6 4L10 8" />
        <path className="t-learn-arm t-learn-arm-bot" d="M10 8L6 12" />
      </svg>
    </span>
  );
}

/* ==========================================================================
   #25 Checkbox check (<AnimatedCheckbox>)
   Box fill + calibrated SVG stroke-dashoffset check draw
   ========================================================================== */
export function AnimatedCheckbox({
  checked,
  onChange,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useIsomorphicLayoutEffect(() => {
    const btn = btnRef.current;
    const path = pathRef.current;
    if (!btn || !path) return;
    try {
      if (typeof path.getTotalLength === 'function') {
        const len = Math.ceil(path.getTotalLength()) + 1;
        btn.style.setProperty('--check-len', String(len));
      }
    } catch {
      btn.style.setProperty('--check-len', '15');
    }
  }, []);

  return (
    <button
      ref={btnRef}
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        't-check inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-500 dark:border-emerald-500 dark:text-slate-950'
          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-transparent hover:border-emerald-500/60',
        className,
      )}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10.1668 10.1668"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path ref={pathRef} d="M1 5.52L3.92 9.17L9.17 1" />
      </svg>
    </button>
  );
}

/* ==========================================================================
   #35 Donut chart (<DonutChart>)
   Ring sectors with even parallel gaps & rounded corners that morph smoothly
   ========================================================================== */
function ringSectorPath(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  a0: number,
  a1: number,
  gap: number,
  cr: number,
): string {
  const Ro = ro - cr;
  const Ri = ri + cr;
  if (Ro <= Ri) return '';

  const pt = (r: number, a: number) =>
    `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;

  // Full-circle single segment (100%): draw a complete 360° closed ring with zero gap
  if (a1 - a0 >= Math.PI * 2 - 0.01) {
    const mid = a0 + Math.PI;
    return (
      `M${pt(Ro, a0)}A${Ro} ${Ro} 0 1 1 ${pt(Ro, mid)}A${Ro} ${Ro} 0 1 1 ${pt(Ro, a0)}Z` +
      `M${pt(Ri, a0)}A${Ri} ${Ri} 0 1 0 ${pt(Ri, mid)}A${Ri} ${Ri} 0 1 0 ${pt(Ri, a0)}Z`
    );
  }

  const h = gap / 2 + cr;
  const dO = Math.asin(Math.min(1, h / Ro));
  const dI = Math.asin(Math.min(1, h / Ri));
  const o0 = a0 + dO;
  const o1 = a1 - dO;
  const i0 = a0 + dI;
  const i1 = a1 - dI;
  if (i1 - i0 <= 0.001 || o1 - o0 <= 0.001) return '';

  const lo = o1 - o0 > Math.PI ? 1 : 0;
  const li = i1 - i0 > Math.PI ? 1 : 0;
  return (
    `M${pt(Ro, o0)}A${Ro} ${Ro} 0 ${lo} 1 ${pt(Ro, o1)}` +
    `L${pt(Ri, i1)}A${Ri} ${Ri} 0 ${li} 0 ${pt(Ri, i0)}Z`
  );
}

export function DonutChart({
  segments,
  size = 112,
  thickness = 12,
  centerContent,
  className,
}: {
  segments: Array<{ value: number; color: string; label?: string }>;
  size?: number;
  thickness?: number;
  centerContent?: React.ReactNode;
  className?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const ro = Math.min(cx, cy) - 2;
  const ri = ro - thickness;
  const nonZeroCount = segments.filter((s) => s.value > 0).length;
  const gap = nonZeroCount > 1 ? Math.min(2.5, size * 0.05) : 0;
  const cr = Math.min(1.75, thickness * 0.25);

  const total = segments.reduce((acc, s) => acc + Math.max(0, s.value), 0) || 1;
  let cursor = 0;

  return (
    <div
      className={cn('t-donut', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* Background track ring */}
        <circle
          cx={cx}
          cy={cy}
          r={(ro + ri) / 2}
          fill="none"
          stroke="currentColor"
          className="text-slate-200/70 dark:text-slate-800/80"
          strokeWidth={thickness}
        />
        {segments.map((seg, idx) => {
          const val = Math.max(0, seg.value);
          if (val <= 0) return null;
          const span = (val / total) * Math.PI * 2;
          const a0 = cursor;
          const a1 = cursor + span;
          cursor = a1;
          const d = ringSectorPath(cx, cy, ro, ri, a0, a1, gap, cr);
          if (!d) return null;
          return (
            <path
              key={idx}
              className="t-donut-seg"
              d={d}
              fill={seg.color}
              stroke={seg.color}
              strokeWidth={cr * 2}
            />
          );
        })}
      </svg>
      {centerContent && <div className="t-donut-center">{centerContent}</div>}
    </div>
  );
}

/* ==========================================================================
   #12 Error state shake hook (useErrorShake)
   Orthogonal .is-error and .is-shaking state management
   ========================================================================== */
export function useErrorShake(revertHoldMs = 3000) {
  const [isError, setIsError] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerError = useCallback(() => {
    setIsError(true);
    setIsShaking(false);
    requestAnimationFrame(() => {
      setIsShaking(true);
    });

    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => {
      setIsShaking(false);
    }, 300);

    if (revertHoldMs > 0) {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
      revertTimerRef.current = setTimeout(() => {
        setIsError(false);
      }, 300 + revertHoldMs);
    }
  }, [revertHoldMs]);

  const clearError = useCallback(() => {
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    setIsError(false);
    setIsShaking(false);
  }, []);

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, []);

  return { isError, isShaking, triggerError, clearError };
}

/* ==========================================================================
   #05/#06 Exit presence hook (useExitPresence)
   Retains mounted=true with phase="closing" for closeDurationMs (default 150ms)
   so CSS .is-closing exit animations complete before unmount
   ========================================================================== */
export function useExitPresence(open: boolean, closeDurationMs = 150) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'open' | 'closing' | 'closed'>(
    open ? 'open' : 'closed',
  );

  if (open && (!mounted || phase !== 'open')) {
    setMounted(true);
    setPhase('open');
  }

  useEffect(() => {
    if (open) {
      setMounted(true);
      setPhase('open');
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      setPhase('closed');
      return;
    }
    setPhase('closing');
    const timer = setTimeout(() => {
      setMounted(false);
      setPhase('closed');
    }, closeDurationMs);
    return () => clearTimeout(timer);
  }, [open, mounted, closeDurationMs]);

  if (open) {
    return { mounted: true, phase: 'open' as const };
  }
  if (prefersReducedMotion() || !mounted) {
    return { mounted: false, phase: 'closed' as const };
  }
  return {
    mounted: true,
    phase: phase === 'open' ? ('closing' as const) : phase,
  };
}

/* ==========================================================================
   #16 Sliding pill hook (useSlidingPill)
   Measures the active item inside a container and returns 120fps transform/size
   ========================================================================== */
export function useSlidingPill<T extends HTMLElement = HTMLDivElement>(
  activeKey: string | number,
) {
  const containerRef = useRef<T>(null);
  const [pillStyle, setPillStyle] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    ready: boolean;
    animate: boolean;
  }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
    animate: false,
  });
  const initializedRef = useRef(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(
      '[data-pill-active="true"], [aria-selected="true"]',
    );
    if (!activeEl) return;
    const width = activeEl.offsetWidth;
    const height = activeEl.offsetHeight;
    if (width === 0 || height === 0) return;
    const left = activeEl.offsetLeft;
    const top = activeEl.offsetTop;

    if (!initializedRef.current) {
      initializedRef.current = true;
      setPillStyle({
        left,
        top,
        width,
        height,
        ready: true,
        animate: false,
      });
      requestAnimationFrame(() => {
        setPillStyle((prev) => ({ ...prev, animate: true }));
      });
    } else {
      setPillStyle({
        left,
        top,
        width,
        height,
        ready: true,
        animate: true,
      });
    }
  }, []);

  useIsomorphicLayoutEffect(() => {
    measure();
  }, [activeKey, measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => measure())
        : null;
    if (ro) {
      ro.observe(container);
      const activeEl = container.querySelector<HTMLElement>(
        '[data-pill-active="true"], [aria-selected="true"]',
      );
      if (activeEl) ro.observe(activeEl);
    }
    if (typeof document !== 'undefined' && 'fonts' in document && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [activeKey, measure]);

  return { containerRef, pillStyle };
}

/* ==========================================================================
   #27 Tactile switch toggle (<TactileToggle>)
   Spring thumb travel (--toggle-ease) activated after initial render (.is-init)
   so pre-checked switches never bounce on mount
   ========================================================================== */
export function TactileToggle({
  checked,
  onChange,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'data-testid': testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'data-testid'?: string;
}) {
  const [initialized, setInitialized] = useState(false);
  const prevCheckedRef = useRef(checked);

  useEffect(() => {
    if (prevCheckedRef.current !== checked) {
      prevCheckedRef.current = checked;
      setInitialized(true);
    }
  }, [checked]);

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      data-testid={testId}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        setInitialized(true);
        onChange(!checked);
      }}
      className={cn(
        't-toggle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-50',
        initialized && 'is-init',
        className,
      )}
    >
      <span className="t-toggle-thumb" aria-hidden="true" />
    </button>
  );
}

/* ==========================================================================
   #29 Reasoning stream (<ReasoningStream>)
   Scrolling agent/pipeline telemetry viewport with top/bottom mask-image fades
   and seamless compositor translateY stepping
   ========================================================================== */
interface ReasoningLineEntry {
  id: number;
  text: string;
}

export function ReasoningStream({
  lines,
  visibleLines = 3,
  lineHeightPx = 22,
  stepMs = 400,
  className,
  lineClassName,
  'data-testid': testId,
}: {
  lines: string[];
  visibleLines?: number;
  lineHeightPx?: number;
  stepMs?: number;
  className?: string;
  lineClassName?: string;
  'data-testid'?: string;
}) {
  const linesKey = lines.length > 0 ? lines.join('\n') : '';
  const initialLines = linesKey ? linesKey.split('\n') : [''];
  const nextIdRef = useRef<number>(initialLines.length);
  const entriesRef = useRef<ReasoningLineEntry[]>(
    initialLines.map((text, i) => ({ id: i, text })),
  );
  const [windowItems, setWindowItems] = useState<ReasoningLineEntry[]>(() =>
    entriesRef.current.slice(-visibleLines),
  );
  const [stepping, setStepping] = useState(false);
  const [resetting, setResetting] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentLines = linesKey ? linesKey.split('\n') : [''];
    const prevEntries = entriesRef.current;

    // Reconcile prefix lines so surviving items preserve their monotonic entry.id (zero DOM remount / role="log" spam)
    const nextEntries: ReasoningLineEntry[] = currentLines.map((text, idx) => {
      if (idx < prevEntries.length && prevEntries[idx].text === text) {
        return prevEntries[idx];
      }
      const id = nextIdRef.current++;
      return { id, text };
    });

    const grew =
      nextEntries.length > prevEntries.length ||
      nextEntries[nextEntries.length - 1]?.id !==
        prevEntries[prevEntries.length - 1]?.id;
    entriesRef.current = nextEntries;

    const latestSlice = nextEntries.slice(-visibleLines);

    if (!grew || prefersReducedMotion() || nextEntries.length <= 1) {
      setWindowItems(latestSlice);
      setStepping(false);
      setResetting(true);
      return;
    }

    const withOutgoing = nextEntries.slice(-(visibleLines + 1));
    if (withOutgoing.length <= latestSlice.length) {
      setWindowItems(latestSlice);
      setStepping(false);
      setResetting(true);
      return;
    }

    setWindowItems(withOutgoing);
    setStepping(false);
    setResetting(true);

    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) {
        void scrollRef.current.offsetHeight;
      }
      setResetting(false);
      setStepping(true);
    });

    const timer = setTimeout(() => {
      setResetting(true);
      setStepping(false);
      setWindowItems(entriesRef.current.slice(-visibleLines));
    }, stepMs);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [linesKey, visibleLines, stepMs]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      data-testid={testId}
      style={
        {
          '--reason-lines': visibleLines,
          '--reason-line-h': `${lineHeightPx}px`,
          '--reason-step': `${stepMs}ms`,
        } as React.CSSProperties
      }
      className={cn('t-reason', className)}
    >
      <div className="t-reason-viewport">
        <div
          ref={scrollRef}
          className={cn('t-reason-scroll', resetting && 'is-reset')}
          style={{
            transform: stepping
              ? `translate3d(0, -${lineHeightPx}px, 0)`
              : 'translate3d(0, 0, 0)',
          }}
        >
          {windowItems.map((entry, idx) => {
            const isLatest = idx === windowItems.length - 1;
            return (
              <div
                key={entry.id}
                data-latest={isLatest ? 'true' : 'false'}
                className={cn('t-reason-line', lineClassName)}
              >
                {entry.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   #08 Enhanced Directional stage slide (<DirectionalStageSlide>)
   Causal horizontal slide (+distancePx when advancing, -distancePx when stepping back)
   using LazyMotion + AnimatePresence inside an overflow-x: clip viewport
   ========================================================================== */
export function DirectionalStageSlide({
  stageKey,
  direction,
  distancePx = 14,
  children,
  className,
  'data-testid': testId,
}: {
  stageKey: string | number;
  direction?: 1 | -1;
  distancePx?: number;
  children: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  const trackRef = useRef<{
    current: string | number;
    dir: 1 | -1;
  }>({
    current: stageKey,
    dir: direction ?? 1,
  });

  if (stageKey !== trackRef.current.current) {
    const prev = trackRef.current.current;
    let nextDir: 1 | -1;
    if (direction !== undefined) {
      nextDir = direction;
    } else if (typeof stageKey === 'number' && typeof prev === 'number') {
      nextDir = stageKey >= prev ? 1 : -1;
    } else {
      nextDir = String(stageKey) >= String(prev) ? 1 : -1;
    }
    trackRef.current = { current: stageKey, dir: nextDir };
  }

  const activeDir: 1 | -1 = direction ?? trackRef.current.dir;

  const stageVariants = {
    initial: (dir: 1 | -1) => ({ opacity: 0, x: dir * distancePx }),
    animate: { opacity: 1, x: 0, transition: TRANSITION_ENTER },
    exit: (dir: 1 | -1) => ({
      opacity: 0,
      x: -dir * Math.round(distancePx * 0.7),
      transition: TRANSITION_EXIT,
    }),
  };

  if (prefersReducedMotion()) {
    return (
      <div
        data-testid={testId}
        data-direction={activeDir}
        className={cn('t-stage-slide-viewport', className)}
      >
        <div key={stageKey}>{children}</div>
      </div>
    );
  }

  return (
    <div
      data-testid={testId}
      data-direction={activeDir}
      className={cn('t-stage-slide-viewport', className)}
    >
      <AnimatePresence mode="popLayout" initial={false} custom={activeDir}>
        <m.div
          key={stageKey}
          custom={activeDir}
          variants={stageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {children}
        </m.div>
      </AnimatePresence>
    </div>
  );
}

/* ==========================================================================
   transitions-ui-generation (<UIGenerationReveal>)
   Real DOM-measuring blueprint wireframe + dot-matrix ripple + reticle +
   horizontal scanline wipe ported from transitions.dev/ui-generation
   ========================================================================== */
export function UIGenerationReveal({
  children,
  steps = [
    'AGENT.GEN // TRACING AST',
    'AGENT.GEN // CALIBRATING S-BERT',
    'INSPECTOR READY · 120FPS',
  ],
  durationMs = 1450,
  replayKey,
  className,
}: {
  children: React.ReactNode;
  steps?: string[];
  durationMs?: number;
  replayKey?: string | number;
  className?: string;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'active' | 'done'>(() =>
    prefersReducedMotion() ? 'done' : 'active',
  );
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase('done');
      return;
    }

    const targetEl = targetRef.current;
    const svgEl = svgRef.current;
    if (!targetEl || !svgEl) {
      setPhase('done');
      return;
    }

    setPhase('active');
    setStepIdx(0);

    const run = runUIGeneration(targetEl, svgEl, canvasRef.current, {
      durationMs,
      stepsCount: steps.length,
      onStepChange: (idx) => setStepIdx(idx),
      onFinish: () => setPhase('done'),
    });

    return () => {
      run.cancel();
    };
  }, [replayKey, durationMs, steps.length]);

  return (
    <div className={cn('t-gen-wrap', className)} data-t-generate="skeleton">
      <div ref={targetRef} className="t-gen-target">
        {children}
      </div>
      <div
        className="t-gen"
        data-phase={phase}
        aria-hidden="true"
      >
        <div
          ref={canvasRef}
          className="t-gen-canvas"
          style={{ opacity: phase === 'done' ? 0 : 1 }}
        />
        <svg ref={svgRef} className="t-gen-svg" preserveAspectRatio="none" />
        {steps.length > 0 && phase !== 'done' && (
          <div className="t-gen-tag">
            <span className="t-gen-tag-dot" />
            <span>{steps[Math.min(stepIdx, steps.length - 1)]}</span>
          </div>
        )}
      </div>
    </div>
  );
}

