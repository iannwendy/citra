import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { cn } from '@/lib/utils';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function prefersReducedMotion(): boolean {
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
    return true;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h =
          entry.borderBoxSize?.[0]?.blockSize ??
          inner.getBoundingClientRect().height;
        if (!initialized) {
          initialized = true;
          outer.style.height = `${h}px`;
          requestAnimationFrame(() => {
            outer.style.height = 'auto';
          });
          return;
        }
        outer.style.height = `${h}px`;
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={cn('t-card-resize', className)}>
      <div ref={innerRef} className={innerClassName}>
        {children}
      </div>
    </div>
  );
}

/* ==========================================================================
   #02 Number pop-in (<NumberPopIn>)
   3D drum digit pop-in for counters, prices, and stat cards
   ========================================================================== */
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
  const prevRef = useRef<string>(str);
  const groupRef = useRef<HTMLSpanElement>(null);
  const [oldStr, setOldStr] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === str) return;
    prevRef.current = str;

    if (prefersReducedMotion()) {
      setOldStr(null);
      setAnimating(false);
      return;
    }

    setOldStr(prev);
    setAnimating(false);
    const raf = requestAnimationFrame(() => {
      if (groupRef.current) {
        void groupRef.current.offsetHeight;
      }
      setAnimating(true);
    });
    const timer = setTimeout(() => {
      setOldStr(null);
      setAnimating(false);
    }, 360);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [str]);

  return (
    <span
      ref={groupRef}
      aria-label={str}
      data-testid={testId}
      className={cn('t-digit-group', animating && 'is-animating', className)}
    >
      <span className="t-digit-slot">
        {oldStr !== null && (
          <span className="t-digit-old" aria-hidden="true">
            {oldStr}
          </span>
        )}
        <span className="t-digit">{str}</span>
      </span>
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
  const prevStrRef = useRef(str);
  const prevNumRef = useRef(numVal);
  const containerRef = useRef<HTMLSpanElement>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [animating, setAnimating] = useState(false);
  const [oldStr, setOldStr] = useState<string | null>(null);

  useEffect(() => {
    const prevStr = prevStrRef.current;
    if (prevStr === str) return;

    const nextDir: 1 | -1 = numVal >= prevNumRef.current ? 1 : -1;
    prevStrRef.current = str;
    prevNumRef.current = numVal;
    setDir(nextDir);

    if (prefersReducedMotion()) {
      setOldStr(null);
      setAnimating(false);
      return;
    }

    setOldStr(prevStr);
    setAnimating(false);
    const raf = requestAnimationFrame(() => {
      if (containerRef.current) {
        void containerRef.current.offsetHeight;
      }
      setAnimating(true);
    });
    const timer = setTimeout(() => {
      setOldStr(null);
      setAnimating(false);
    }, 240);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [str, numVal]);

  return (
    <span
      ref={containerRef}
      aria-label={str}
      style={{ '--subtle-dir': dir } as React.CSSProperties}
      className={cn('t-subtle-number', animating && 'is-animating', className)}
    >
      <span className="t-subtle-slot">
        {oldStr !== null && (
          <span className="t-subtle-old" aria-hidden="true">
            {oldStr}
          </span>
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
  const [prevText, setPrevText] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState(text);
  const [swapping, setSwapping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (text === currentText) return;
    if (prefersReducedMotion()) {
      setCurrentText(text);
      setPrevText(null);
      setSwapping(false);
      return;
    }

    setPrevText(currentText);
    setCurrentText(text);
    setSwapping(false);

    const raf = requestAnimationFrame(() => {
      setSwapping(true);
    });

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSwapping(false);
      setPrevText(null);
    }, 260);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [text, currentText]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      style={{ '--text-soft-align': align } as React.CSSProperties}
      className={cn('t-text-soft', swapping && 'is-swapping', className)}
    >
      {prevText !== null && (
        <span className="t-text-soft-old" aria-hidden="true">
          {prevText}
        </span>
      )}
      <span className={prevText !== null ? 't-text-soft-new' : undefined}>
        {currentText}
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
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

  return { containerRef, pillStyle };
}

/* ==========================================================================
   transitions-ui-generation (<UIGenerationReveal>)
   Dotted wireframe + laser scanline + agent step tag overlay on mount/view
   ========================================================================== */
export function UIGenerationReveal({
  children,
  steps = [
    'AGENT.GEN // TRACING AST',
    'AGENT.GEN // CALIBRATING S-BERT',
    'INSPECTOR READY · 120FPS',
  ],
  durationMs = 1350,
  replayKey,
  className,
}: {
  children: React.ReactNode;
  steps?: string[];
  durationMs?: number;
  replayKey?: string | number;
  className?: string;
}) {
  const [phase, setPhase] = useState<'active' | 'done'>('active');
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase('done');
      return;
    }
    setPhase('active');
    setStepIdx(0);

    const stepInterval = Math.max(
      220,
      Math.floor(durationMs / Math.max(1, steps.length)),
    );
    const t1 = setTimeout(() => {
      if (steps.length > 1) setStepIdx(1);
    }, stepInterval);
    const t2 = setTimeout(() => {
      if (steps.length > 2) setStepIdx(steps.length - 1);
    }, stepInterval * 2);
    const tDone = setTimeout(() => {
      setPhase('done');
    }, durationMs);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(tDone);
    };
  }, [replayKey, durationMs, steps.length]);

  return (
    <div className={cn('t-gen-wrap', className)} data-t-generate="skeleton">
      {children}
      <div
        className="t-gen"
        data-phase={phase}
        aria-hidden="true"
      >
        <svg className="t-gen-svg" preserveAspectRatio="none">
          <rect
            className="t-gen-wire"
            x="2"
            y="2"
            width="calc(100% - 4px)"
            height="calc(100% - 4px)"
            rx="12"
            ry="12"
          />
          <line
            className="t-gen-wire"
            x1="12"
            y1="44"
            x2="calc(100% - 12px)"
            y2="44"
          />
        </svg>
        <div key={String(replayKey ?? 'init')} className="t-gen-scanline" />
        <span className="t-gen-handle" style={{ top: 4, left: 4 }} />
        <span className="t-gen-handle" style={{ top: 4, right: 4 }} />
        <span className="t-gen-handle" style={{ bottom: 4, left: 4 }} />
        <span className="t-gen-handle" style={{ bottom: 4, right: 4 }} />
        {steps.length > 0 && (
          <div className="t-gen-tag">
            <span className="t-gen-tag-dot" />
            <span>{steps[Math.min(stepIdx, steps.length - 1)]}</span>
          </div>
        )}
      </div>
    </div>
  );
}

