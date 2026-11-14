import { Fragment, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/* ============================================================
   SOLVA EDITORIAL PRIMITIVES — CITRA (SourceLogic)
   Exact 1:1 Visual, Scroll-Linked & Interactive Building Blocks
   ============================================================ */

export type Lang = 'en' | 'vi';

/* ------------------------------------------------------------
   120FPS TWO-PHASE (READ -> WRITE) RAF SCROLL ENGINE
   + VIEWPORT-PROXIMITY INTERSECTION CULLING
   Eliminates forced synchronous reflows (layout thrashing) so all
   scroll-linked reveals, parallax paintings & sticky cards run
   well within the 8.33ms frame budget of 120Hz ProMotion displays.
   ------------------------------------------------------------ */
type WriteCallback = () => void;
type ScrollTask = (
  vh: number,
  vw: number,
  scheduleWrite: (writeFn: WriteCallback) => void
) => void;

interface ScrollEntry {
  el: Element | null;
  task: ScrollTask;
  isNear: boolean;
  needsSync: boolean;
  alwaysActive: boolean;
}

const scrollEntries = new Set<ScrollEntry>();
const elementToEntry = new WeakMap<Element, ScrollEntry>();
const writeQueue: WriteCallback[] = [];
let rafId: number | null = null;
let listenersAttached = false;
let forceFullSync = true;
let lastScrollY = 0;
let sharedObserver: IntersectionObserver | null = null;

function scheduleWrite(fn: WriteCallback) {
  writeQueue.push(fn);
}

function flushScrollSubscribers() {
  rafId = null;
  if (typeof window === 'undefined') return;

  const vh = window.innerHeight || 900;
  const vw = window.innerWidth || 1440;
  const currentScrollY = window.scrollY || window.pageYOffset || 0;
  const isLargeJump = Math.abs(currentScrollY - lastScrollY) > vh * 0.55;
  lastScrollY = currentScrollY;

  const runAll = forceFullSync || isLargeJump;
  forceFullSync = false;

  // PHASE 1: Batch all DOM geometry reads (getBoundingClientRect) while layout tree is clean
  scrollEntries.forEach((entry) => {
    if (!runAll && !entry.alwaysActive && !entry.isNear && !entry.needsSync) return;
    entry.needsSync = false;
    entry.task(vh, vw, scheduleWrite);
  });

  // PHASE 2: Batch all DOM style mutations & React state transitions after reads finish
  for (let i = 0; i < writeQueue.length; i += 1) {
    writeQueue[i]();
  }
  writeQueue.length = 0;
}

function requestScrollFrame(fullSync = false) {
  if (fullSync) {
    forceFullSync = true;
  }
  if (rafId === null && typeof window !== 'undefined') {
    rafId = window.requestAnimationFrame(flushScrollSubscribers);
  }
}

function handleGlobalScroll() {
  requestScrollFrame(false);
}

function handleGlobalResize() {
  requestScrollFrame(true);
}

function getSharedObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return null;
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (ioEntries) => {
        let shouldTick = false;
        for (let i = 0; i < ioEntries.length; i += 1) {
          const ioEntry = ioEntries[i];
          const sub = elementToEntry.get(ioEntry.target);
          if (!sub) continue;
          if (ioEntry.isIntersecting) {
            sub.isNear = true;
            sub.needsSync = true;
            shouldTick = true;
          } else {
            sub.isNear = false;
            // Perform one final sync so off-screen 'below'/'above' state is exact
            sub.needsSync = true;
            shouldTick = true;
          }
        }
        if (shouldTick) {
          requestScrollFrame(false);
        }
      },
      { rootMargin: '320px 0px 320px 0px', threshold: 0 }
    );
  }
  return sharedObserver;
}

function subscribeToScroll(
  el: Element | null,
  task: ScrollTask,
  alwaysActive = false
): () => void {
  const entry: ScrollEntry = {
    el,
    task,
    isNear: true,
    needsSync: true,
    alwaysActive,
  };
  scrollEntries.add(entry);

  const observer = el ? getSharedObserver() : null;
  if (observer && el) {
    elementToEntry.set(el, entry);
    observer.observe(el);
  }

  if (!listenersAttached && typeof window !== 'undefined') {
    listenersAttached = true;
    lastScrollY = window.scrollY || window.pageYOffset || 0;
    window.addEventListener('scroll', handleGlobalScroll, { passive: true });
    window.addEventListener('resize', handleGlobalResize, { passive: true });
  }

  requestScrollFrame(false);

  return () => {
    if (observer && el) {
      observer.unobserve(el);
      elementToEntry.delete(el);
    }
    scrollEntries.delete(entry);
    if (scrollEntries.size === 0 && listenersAttached && typeof window !== 'undefined') {
      listenersAttached = false;
      window.removeEventListener('scroll', handleGlobalScroll);
      window.removeEventListener('resize', handleGlobalResize);
    }
  };
}

function isOSReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * 0. Editorial Scroll Reveal Wrapper (`SolvaScrollReveal`)
 * - Latches permanently on first viewport entry (`reversible = false` by default) so
 *   reading back up never re-blurs or hides editorial copy, and unsubscribes from the
 *   scroll loop + releases compositor memory (`will-change: auto`) once settled.
 */
export function SolvaScrollReveal({
  children,
  delayMs = 0,
  yOffset = 32,
  scaleFrom = 0.985,
  blurPx = 3.5,
  triggerRatio = 0.91,
  reversible = false,
  className = '',
}: {
  children: ReactNode;
  delayMs?: number;
  yOffset?: number;
  scaleFrom?: number;
  blurPx?: number;
  triggerRatio?: number;
  reversible?: boolean;
  className?: string;
}) {
  const reduced = isOSReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<'visible' | 'below' | 'above'>(reduced ? 'visible' : 'below');
  const latchedRef = useRef<boolean>(reduced);
  const [phase, setPhase] = useState<'visible' | 'below' | 'above'>(
    reduced ? 'visible' : 'below'
  );
  const [settled, setSettled] = useState<boolean>(reduced);

  useEffect(() => {
    if (reduced) {
      setPhase('visible');
      setSettled(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (!reversible && latchedRef.current) return;

    let unsub: (() => void) | null = null;
    unsub = subscribeToScroll(el, (vh, _vw, schedule) => {
      if (!reversible && latchedRef.current) return;
      const rect = el.getBoundingClientRect();

      if (!reversible) {
        if (rect.top <= vh * triggerRatio) {
          latchedRef.current = true;
          phaseRef.current = 'visible';
          schedule(() => {
            setPhase('visible');
            unsub?.();
          });
        }
        return;
      }

      let nextPhase: 'visible' | 'below' | 'above';
      if (rect.top > vh * triggerRatio) {
        nextPhase = 'below';
      } else if (rect.bottom < 48) {
        nextPhase = 'above';
      } else {
        nextPhase = 'visible';
      }

      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase;
        schedule(() => setPhase(nextPhase));
      }
    });
    return () => {
      unsub?.();
    };
  }, [triggerRatio, reversible, reduced]);

  const isVisible = phase === 'visible';

  useEffect(() => {
    if (reduced) return;
    if (!isVisible) {
      setSettled(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSettled(true);
    }, delayMs + 720);
    return () => window.clearTimeout(timer);
  }, [isVisible, delayMs, reduced]);

  const translateY = phase === 'below' ? yOffset : phase === 'above' ? -16 : 0;
  const currentScale = isVisible ? 1 : scaleFrom;
  const currentOpacity = isVisible ? 1 : 0.001;
  const currentBlur = isVisible ? 0 : blurPx;
  const activeDelay = isVisible ? delayMs : 0;

  return (
    <div
      ref={ref}
      style={{
        opacity: currentOpacity,
        transform: settled ? 'none' : `translate3d(0, ${translateY}px, 0) scale(${currentScale})`,
        filter: currentBlur > 0 ? `blur(${currentBlur}px)` : 'none',
        transitionProperty: reduced ? 'none' : 'opacity, transform, filter',
        transitionDuration: isVisible ? '700ms' : '420ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        transitionDelay: `${activeDelay}ms`,
        willChange: settled ? 'auto' : 'transform, opacity, filter',
      }}
      className={className}
    >
      {children}
    </div>
  );
}

/**
 * 1. Eyebrow Component (`[data-framer-name="Default"]`)
 * Left indicator: 10px x 5px horizontal pill dot (#56524A)
 * Right label: Onest 15px regular (#56524A)
 */
export function SolvaEyebrow({
  children,
  centered = false,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <SolvaScrollReveal yOffset={20} blurPx={2.5} scaleFrom={0.99}>
      <div
        className={`inline-flex items-center gap-[6px] pl-[2px] font-solva-sans ${
          centered ? 'justify-center' : ''
        }`}
      >
        <span
          className="w-[10px] h-[5px] rounded-[50px] shrink-0"
          style={{ backgroundColor: 'var(--solva-muted)' }}
        />
        <span
          className="text-[15px] font-normal leading-[19.5px]"
          style={{ color: 'var(--solva-muted)' }}
        >
          {children}
        </span>
      </div>
    </SolvaScrollReveal>
  );
}

/**
 * 2. Two-Tone Editorial Split Heading (H1 / H2) with Reversible Word-by-Word Scroll Reveal
 * Replicates Framer's word-by-word `<span style="opacity:0.001; filter:blur(3px); transform:translateY(32px)">`
 * staggered entrance and reversible scroll-up fade out.
 * Uses Sentient Light (font-weight: 300), line-height: 1.06, letter-spacing: -0.05em.
 * Clause 1: #1C1A15 (--solva-ink)
 * Clause 2: #56524A (--solva-muted)
 */
export function SolvaTwoToneHeading({
  as: Tag = 'h2',
  primary,
  secondary,
  size = 'h2',
  centered = false,
  delayMs = 0,
  reversible = false,
  className = '',
}: {
  as?: 'h1' | 'h2';
  primary: string;
  secondary?: string;
  size?: 'h1' | 'h2';
  centered?: boolean;
  delayMs?: number;
  reversible?: boolean;
  className?: string;
}) {
  const reduced = isOSReducedMotion();
  const ref = useRef<HTMLHeadingElement>(null);
  const phaseRef = useRef<'visible' | 'below' | 'above'>(reduced ? 'visible' : 'below');
  const latchedRef = useRef<boolean>(reduced);
  const [phase, setPhase] = useState<'visible' | 'below' | 'above'>(
    reduced ? 'visible' : 'below'
  );
  const [wordsSettled, setWordsSettled] = useState<boolean>(reduced);

  useEffect(() => {
    if (reduced) {
      setPhase('visible');
      setWordsSettled(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (!reversible && latchedRef.current) return;

    let unsub: (() => void) | null = null;
    unsub = subscribeToScroll(el, (vh, _vw, schedule) => {
      if (!reversible && latchedRef.current) return;
      const rect = el.getBoundingClientRect();

      if (!reversible) {
        if (rect.top <= vh * 0.91) {
          latchedRef.current = true;
          phaseRef.current = 'visible';
          schedule(() => {
            setPhase('visible');
            unsub?.();
          });
        }
        return;
      }

      let nextPhase: 'visible' | 'below' | 'above';
      if (rect.top > vh * 0.91) {
        nextPhase = 'below';
      } else if (rect.bottom < 44) {
        nextPhase = 'above';
      } else {
        nextPhase = 'visible';
      }

      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase;
        schedule(() => setPhase(nextPhase));
      }
    });
    return () => {
      unsub?.();
    };
  }, [reversible, reduced]);

  const normalizedPrimary = primary.normalize('NFC');
  const normalizedSecondary = secondary ? secondary.normalize('NFC') : undefined;
  const hasVietnamese =
    /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/.test(
      normalizedPrimary
    ) ||
    (normalizedSecondary
      ? /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/.test(
          normalizedSecondary
        )
      : false);

  const leadingTrackingClass = hasVietnamese
    ? 'leading-[1.15] tracking-[-0.03em]'
    : 'leading-[1.06] tracking-[-0.05em]';

  const sizeClass =
    size === 'h1'
      ? `text-[40px] sm:text-[48px] xl:text-[56px] ${leadingTrackingClass}`
      : `text-[34px] sm:text-[40px] xl:text-[48px] ${leadingTrackingClass}`;

  const primaryWords = normalizedPrimary.trim().split(/\s+/);
  const secondaryWords = normalizedSecondary ? normalizedSecondary.trim().split(/\s+/) : [];
  const isVisible = phase === 'visible';
  const wordY = phase === 'below' ? 28 : phase === 'above' ? -14 : 0;

  useEffect(() => {
    if (reduced) return;
    if (!isVisible) {
      setWordsSettled(false);
      return;
    }
    const totalWords = primaryWords.length + secondaryWords.length;
    const maxDelay = delayMs + Math.min(totalWords * 34, 420) + 660;
    const timer = window.setTimeout(() => {
      setWordsSettled(true);
    }, maxDelay);
    return () => window.clearTimeout(timer);
  }, [isVisible, delayMs, primaryWords.length, secondaryWords.length, reduced]);

  const renderAnimatedWords = (words: string[], startIndex: number) =>
    words.map((word, idx) => {
      const globalIdx = startIndex + idx;
      const delay = isVisible ? delayMs + Math.min(globalIdx * 34, 420) : 0;
      return (
        <Fragment key={`${word}-${idx}`}>
          <span
            className="inline-block"
            style={{
              opacity: isVisible ? 1 : 0.001,
              transform: wordsSettled ? 'none' : `translate3d(0, ${wordY}px, 0)`,
              filter: isVisible ? 'none' : 'blur(4px)',
              transitionProperty: reduced ? 'none' : 'opacity, transform, filter',
              transitionDuration: isVisible ? '640ms' : '360ms',
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              transitionDelay: `${delay}ms`,
              willChange: wordsSettled ? 'auto' : 'transform, opacity, filter',
            }}
          >
            {word}
          </span>
          {idx < words.length - 1 ? ' ' : ''}
        </Fragment>
      );
    });

  return (
    <Tag
      ref={ref}
      className={`font-solva-serif font-light ${sizeClass} ${
        centered ? 'text-center mx-auto' : ''
      } ${className}`}
    >
      <span className="block" style={{ color: 'var(--solva-ink)' }}>
        {renderAnimatedWords(primaryWords, 0)}
      </span>
      {secondary && (
        <>
          {' '}
          <span className="block" style={{ color: 'var(--solva-muted)' }}>
            {renderAnimatedWords(secondaryWords, primaryWords.length)}
          </span>
        </>
      )}
    </Tag>
  );
}

/**
 * 3. Double-Text Vertical Slot-Roll Button (`Primary` & `Outline Black`)
 * Height: 44px, padding: 1px 16px 0px, border-radius: 10px, Onest 14px Medium (line-height: 21px).
 * On hover, inner 21px text window slides vertically (-21px) with cubic-bezier(0.22, 1, 0.36, 1).
 */
export function SolvaButton({
  children,
  to,
  href,
  variant = 'primary',
  fullWidth = false,
  onClick,
  className = '',
  testId,
}: {
  children: ReactNode;
  to?: string;
  href?: string;
  variant?: 'primary' | 'outline' | 'ghost';
  fullWidth?: boolean;
  onClick?: () => void;
  className?: string;
  testId?: string;
}) {
  const baseClasses = `group relative inline-flex items-center justify-center h-[44px] px-[16px] pt-[1px] rounded-[10px] font-solva-sans text-[14px] font-medium leading-[21px] transition-[background-color,border-color,color,opacity,box-shadow] duration-200 cursor-pointer select-none ${
    fullWidth ? 'w-full' : ''
  } ${className}`;

  const variantStyle =
    variant === 'primary'
      ? {
          backgroundColor: 'var(--solva-btn-bg)',
          color: 'var(--solva-btn-fg)',
        }
      : variant === 'outline'
        ? {
            backgroundColor: 'transparent',
            color: 'var(--solva-ink)',
            border: '1px solid var(--solva-border)',
          }
        : {
            backgroundColor: 'transparent',
            color: 'var(--solva-muted)',
          };

  const innerContent = (
    <span className="relative h-[21px] overflow-hidden flex flex-col items-center">
      <span className="flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-[21px]">
        <span className="h-[21px] flex items-center justify-center whitespace-nowrap gap-1.5">
          {children}
        </span>
        <span
          className="h-[21px] flex items-center justify-center whitespace-nowrap gap-1.5"
          aria-hidden="true"
        >
          {children}
        </span>
      </span>
    </span>
  );

  if (to) {
    return (
      <Link
        to={to}
        onClick={onClick}
        style={variantStyle}
        data-testid={testId}
        className={baseClasses}
      >
        {innerContent}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        style={variantStyle}
        data-testid={testId}
        className={baseClasses}
      >
        {innerContent}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={variantStyle}
      data-testid={testId}
      className={baseClasses}
    >
      {innerContent}
    </button>
  );
}

/**
 * 4. Painterly Frame + Film Grain Noise Overlay (opacity: 0.05, 160px tile)
 * Includes continuous scroll-linked parallax on the oil painting and floating inner widget.
 * Uses direct DOM ref transforms (zero React re-renders during scroll) and skips off-screen work.
 */
export function SolvaPainterlyFrame({
  paintingSrc,
  alt = '',
  children,
  className = '',
  radiusClass = 'rounded-[16px]',
  priority = false,
}: {
  paintingSrc: string;
  alt?: string;
  children: ReactNode;
  className?: string;
  radiusClass?: string;
  priority?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const lastParallaxRef = useRef<number>(999);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    return subscribeToScroll(el, (vh, _vw, schedule) => {
      const rect = el.getBoundingClientRect();
      // Skip DOM updates when the frame is outside the active viewport band
      if (rect.bottom < -120 || rect.top > vh + 120) return;

      const centerOffset = (rect.top + rect.height / 2 - vh / 2) / (vh / 2);
      const clamped = Math.max(-1.2, Math.min(1.2, centerOffset));
      if (Math.abs(clamped - lastParallaxRef.current) < 0.0008) return;
      lastParallaxRef.current = clamped;

      const imgY = (clamped * -10).toFixed(2);
      const innerY = (clamped * 8).toFixed(2);

      schedule(() => {
        if (imgRef.current) {
          imgRef.current.style.transform = `translate3d(0, ${imgY}px, 0) scale3d(1.06, 1.06, 1)`;
        }
        if (innerRef.current) {
          innerRef.current.style.transform = `translate3d(0, ${innerY}px, 0)`;
        }
      });
    });
  }, []);

  return (
    <div
      ref={frameRef}
      style={{ contain: 'layout paint' }}
      className={`relative overflow-hidden ${radiusClass} ${className}`}
    >
      <img
        ref={imgRef}
        src={paintingSrc}
        alt={alt}
        loading="eager"
        decoding="async"
        {...({ fetchpriority: priority ? 'high' : 'low' } as Record<string, string>)}
        style={{
          transform: 'translate3d(0, 0px, 0) scale3d(1.06, 1.06, 1)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
      />
      <div className="solva-noise-overlay" aria-hidden="true" />
      <div
        ref={innerRef}
        style={{
          transform: 'translate3d(0, 0px, 0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
        className="relative z-10 w-full h-full"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 5. Scroll-Linked Playing-Card Shuffle / Climb Stack (`SolvaStickyStackCard`)
 * Exclusive to Section 3 ("Why CITRA"):
 * - No fade-in animation (`opacity: 1`, `filter: none`).
 * - Each card pins via `position: sticky` while subsequent cards climb up on top of it
 *   with a tactile 3D playing-card shuffle/deal arc (`rotateZ`, `rotateX`, `translate3d`,
 *   mid-climb lift, and dynamic deck shadow), pushing underlying cards back into a fanned stack.
 * - Outer `stickyWrapperRef` stays untransformed so `getBoundingClientRect()` has zero feedback loop.
 */
export function SolvaStickyStackCard({
  index,
  total,
  children,
}: {
  index: number;
  total: number;
  children: ReactNode;
}) {
  const stickyWrapperRef = useRef<HTMLDivElement>(null);
  const cardInnerRef = useRef<HTMLDivElement>(null);
  const lastTransformRef = useRef<string>('');
  const lastFilterRef = useRef<string>('');
  const lastShadowRef = useRef<string>('');
  const lastLayoutKeyRef = useRef<string>('');

  useEffect(() => {
    const wrapperEl = stickyWrapperRef.current;
    if (!wrapperEl) return;

    return subscribeToScroll(
      wrapperEl,
      (viewportH, viewportW, schedule) => {
        const parent = wrapperEl.parentElement;
        if (parent) {
          const parentRect = parent.getBoundingClientRect();
          if (parentRect.bottom < -240 || parentRect.top > viewportH + 240) {
            return;
          }
        }

        const isDesktop = viewportW >= 1024;
        const baseTop = isDesktop ? 92 : 76;
        const stepOffset = isDesktop ? 28 : 18;
        const myStickyTop = baseTop + index * stepOffset;
        const myMarginBottom = (total - 1 - index) * stepOffset;
        const layoutKey = `${myStickyTop}:${myMarginBottom}`;

        const myRect = wrapperEl.getBoundingClientRect();

        // Phase A: Playing-card shuffle climb as Card `index` (index > 0) rises onto Card `index - 1`
        let climbX = 0;
        let climbY = 0;
        let climbScale = 1;
        let climbRotateX = 0;
        let climbRotateZ = 0;
        let climbLiftShadow = 0;

        if (index > 0) {
          const climbStartY = viewportH * 0.94;
          const climbSpan = Math.max(1, climbStartY - myStickyTop);
          const rawClimb = Math.max(
            0,
            Math.min(1, (climbStartY - myRect.top) / climbSpan)
          );
          const rem = Math.pow(1 - rawClimb, 2);
          const midArc = Math.sin(Math.PI * rawClimb) * (1 - rawClimb);
          const shuffleDir = index % 2 === 1 ? -1 : 1;
          const xScale = isDesktop ? 1 : 0.55;

          climbX = shuffleDir * (rem * 40 + midArc * 26) * xScale;
          climbY = (rem * 24 - midArc * 18) * xScale;
          climbScale = 1 - rem * 0.045 + midArc * 0.032;
          climbRotateX = rem * 7.5 + midArc * 5;
          climbRotateZ = shuffleDir * (rem * 4.5 + midArc * 2.6) * (isDesktop ? 1 : 0.7);
          climbLiftShadow = Math.max(rem * 0.7, midArc * 1.35);
        }

        // Phase B: Deck compression & fan-out as lower cards (index + 1, index + 2) climb on top of this card
        let p1 = 0;
        let p2 = 0;
        const coverStartY = viewportH * 0.9;

        if (parent && index < total - 1) {
          const nextEl = parent.children[index + 1] as HTMLElement | undefined;
          if (nextEl) {
            const nextRect = nextEl.getBoundingClientRect();
            const nextStickyTop = baseTop + (index + 1) * stepOffset;
            p1 = Math.max(
              0,
              Math.min(1, (coverStartY - nextRect.top) / Math.max(1, coverStartY - nextStickyTop))
            );
          }

          if (index === 0 && total > 2) {
            const thirdEl = parent.children[2] as HTMLElement | undefined;
            if (thirdEl) {
              const thirdRect = thirdEl.getBoundingClientRect();
              const thirdStickyTop = baseTop + 2 * stepOffset;
              p2 = Math.max(
                0,
                Math.min(
                  1,
                  (coverStartY - thirdRect.top) / Math.max(1, coverStartY - thirdStickyTop)
                )
              );
            }
          }
        }

        const recoil = Math.sin(Math.PI * p1);
        const deckFanDir = index === 0 ? -1 : 1;
        const underScale = 1 - p1 * 0.068 - p2 * 0.052;
        const underY = -p1 * 16 - p2 * 14 + recoil * 6;
        const underX = deckFanDir * (p1 * 12 + p2 * 8 + recoil * 10) * (isDesktop ? 1 : 0.55);
        const underRotateZ =
          deckFanDir * (p1 * 1.9 + p2 * 0.9 + recoil * 1.1) * (isDesktop ? 1 : 0.65);
        const underRotateX = -p1 * 4.5 - p2 * 3.0;
        const brightness = 1 - p1 * 0.08 - p2 * 0.07;

        const totalX = climbX + underX;
        const totalY = climbY + underY;
        const totalScale = climbScale * underScale;
        const totalRotateX = climbRotateX + underRotateX;
        const totalRotateZ = climbRotateZ + underRotateZ;

        const nextTransform = `translate3d(${totalX.toFixed(2)}px, ${totalY.toFixed(2)}px, 0px) scale3d(${totalScale.toFixed(4)}, ${totalScale.toFixed(4)}, 1) rotateX(${totalRotateX.toFixed(2)}deg) rotateZ(${totalRotateZ.toFixed(2)}deg)`;
        const nextFilter =
          brightness < 0.998 ? `brightness(${brightness.toFixed(3)})` : 'none';

        const shadowStrength =
          index > 0 ? Math.max(0.5, climbLiftShadow) : p1 > 0.01 ? 0.38 : 0.2;
        const contactAlpha = index > 0 ? (0.06 + 0.05 * shadowStrength).toFixed(3) : '0.020';
        const upAlpha = (0.16 * shadowStrength + (index > 0 ? 0.07 : 0)).toFixed(3);
        const downAlpha = (0.2 * shadowStrength + (index > 0 ? 0.07 : 0.04)).toFixed(3);
        const nextShadow = `0 -3px 10px 0 rgba(28, 26, 21, ${contactAlpha}), 0 -22px 46px -8px rgba(28, 26, 21, ${upAlpha}), 0 26px 54px -12px rgba(28, 26, 21, ${downAlpha}), inset 0 1px 0 rgba(255, 255, 255, 0.65)`;

        const needsUpdate =
          nextTransform !== lastTransformRef.current ||
          nextFilter !== lastFilterRef.current ||
          nextShadow !== lastShadowRef.current ||
          layoutKey !== lastLayoutKeyRef.current;

        if (needsUpdate) {
          lastTransformRef.current = nextTransform;
          lastFilterRef.current = nextFilter;
          lastShadowRef.current = nextShadow;
          const layoutChanged = layoutKey !== lastLayoutKeyRef.current;
          lastLayoutKeyRef.current = layoutKey;

          schedule(() => {
            if (layoutChanged) {
              wrapperEl.style.top = `${myStickyTop}px`;
              wrapperEl.style.marginBottom = `${myMarginBottom}px`;
            }
            const innerEl = cardInnerRef.current;
            if (innerEl) {
              innerEl.style.transform = nextTransform;
              innerEl.style.filter = nextFilter;
              innerEl.style.boxShadow = nextShadow;
            }
          });
        }
      },
      true
    );
  }, [index, total]);

  const initialTop = 92 + index * 28;
  const initialMarginBottom = (total - 1 - index) * 28;

  return (
    <div
      ref={stickyWrapperRef}
      data-testid={`solva-sticky-card-${index}`}
      style={{
        position: 'sticky',
        top: `${initialTop}px`,
        marginBottom: `${initialMarginBottom}px`,
        zIndex: (index + 1) * 10,
        perspective: '1400px',
      }}
      className="w-full"
    >
      <div
        ref={cardInnerRef}
        data-testid={`solva-sticky-card-inner-${index}`}
        style={{
          opacity: 1,
          transform: 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1) rotateX(0deg) rotateZ(0deg)',
          transformOrigin: 'top center',
          transformStyle: 'preserve-3d',
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
          boxShadow:
            index > 0
              ? '0 -18px 42px -10px rgba(28, 26, 21, 0.14), 0 24px 52px -12px rgba(28, 26, 21, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.55)'
              : '0 14px 36px -12px rgba(28, 26, 21, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.55)',
          willChange: 'transform, filter',
          backfaceVisibility: 'hidden',
        }}
        className="w-full rounded-[16px] p-[12px] border"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 6. One-Shot Scroll-Triggered Animated Count-Up Metric (`Sentient` 40px Light)
 * Counts up once on first viewport entry and latches permanently without periodic zero-resets.
 * Updates DOM textContent directly during RAF ticks (zero React re-renders per frame).
 */
export function SolvaAnimatedMetric({
  targetValue,
  suffix = '',
  prefix = '',
  decimals = 0,
  label,
}: {
  targetValue: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  label: string;
}) {
  const reduced = isOSReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState<boolean>(reduced);
  const hasAnimated = useRef<boolean>(reduced);
  const animRafRef = useRef<number | null>(null);

  const formatMetric = useCallback(
    (val: number) => {
      const safeVal = Math.abs(val) < 1e-9 ? 0 : val;
      return `${prefix}${safeVal.toFixed(decimals)}${suffix}`;
    },
    [prefix, decimals, suffix]
  );

  useEffect(() => {
    const clock = () => Date.now();
    const runCountAnimation = (fromVal: number, toVal: number, durationMs: number) => {
      if (animRafRef.current !== null) {
        cancelAnimationFrame(animRafRef.current);
      }
      let startTime: number | null = null;
      let lastText = '';
      const tick = () => {
        const now = clock();
        if (startTime === null) {
          startTime = now;
        }
        const elapsed = Math.max(0, now - startTime);
        const progress = Math.max(0, Math.min(1, elapsed / durationMs));
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = fromVal + (toVal - fromVal) * eased;
        const nextText = formatMetric(progress < 1 ? current : toVal);
        if (numRef.current && nextText !== lastText) {
          lastText = nextText;
          numRef.current.textContent = nextText;
        }
        if (progress < 1) {
          animRafRef.current = requestAnimationFrame(tick);
        } else {
          animRafRef.current = null;
        }
      };
      animRafRef.current = requestAnimationFrame(tick);
    };

    if (reduced) {
      hasAnimated.current = true;
      setIsVisible(true);
      if (numRef.current) {
        numRef.current.textContent = formatMetric(targetValue);
      }
      return;
    }

    const el = ref.current;
    if (!el) return;
    if (hasAnimated.current) {
      if (numRef.current) {
        numRef.current.textContent = formatMetric(targetValue);
      }
      return;
    }

    let unsub: (() => void) | null = null;
    unsub = subscribeToScroll(el, (vh, _vw, schedule) => {
      if (hasAnimated.current) return;
      const rect = el.getBoundingClientRect();
      if (rect.top <= vh * 0.93) {
        hasAnimated.current = true;
        schedule(() => {
          setIsVisible(true);
          runCountAnimation(0, targetValue, 1500);
          unsub?.();
        });
      }
    });

    return () => {
      unsub?.();
      if (animRafRef.current !== null) {
        cancelAnimationFrame(animRafRef.current);
      }
    };
  }, [targetValue, formatMetric, reduced]);

  return (
    <div
      ref={ref}
      style={{
        opacity: isVisible ? 1 : 0.001,
        transform: isVisible ? 'none' : 'translate3d(0, 20px, 0)',
        filter: isVisible ? 'none' : 'blur(3px)',
        transition: reduced
          ? 'none'
          : 'opacity 560ms cubic-bezier(0.22, 1, 0.36, 1), transform 580ms cubic-bezier(0.22, 1, 0.36, 1), filter 480ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className="flex flex-col gap-[4px]"
    >
      <div
        ref={numRef}
        className="font-solva-serif font-light text-[32px] sm:text-[40px] leading-[1.2] tracking-[-0.05em] tabular-nums"
        style={{ color: 'var(--solva-ink)' }}
      >
        {formatMetric(targetValue)}
      </div>
      <div
        className="font-solva-sans text-[14px] leading-[21px]"
        style={{ color: 'var(--solva-muted)' }}
      >
        {label}
      </div>
    </div>
  );
}
