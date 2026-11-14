import type { ReactNode } from 'react';
import {
  LazyMotion,
  MotionConfig,
  AnimatePresence,
  domMax,
  type Transition,
} from 'motion/react';
import * as m from 'motion/react-m';

/**
 * Calibrated Solva Editorial × Forensic IDE transition tokens.
 * Paired with `transitions-dev.css` custom properties:
 * - High-frequency shared-layout pills use crisp, critically damped springs.
 * - Asymmetric enter/exit transitions dismiss ~30% faster than they enter.
 */
export const SPRING_PILL = {
  type: 'spring',
  stiffness: 460,
  damping: 36,
  mass: 0.72,
} as const satisfies Transition;

export const SPRING_LAYOUT = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.85,
} as const satisfies Transition;

export const TRANSITION_ENTER = {
  duration: 0.24,
  ease: [0.22, 1, 0.36, 1],
} as const satisfies Transition;

export const TRANSITION_EXIT = {
  duration: 0.15,
  ease: [0.4, 0, 1, 1],
} as const satisfies Transition;

export interface CitraMotionProviderProps {
  children: ReactNode;
}

/**
 * Global Motion provider enforcing:
 * 1. `reducedMotion="user"` so OS-level accessibility settings disable transform/layout animations automatically.
 * 2. `LazyMotion` with `domMax` + `strict` so only slim `m.*` components are used while supporting `layoutId` and `AnimatePresence`.
 */
export function CitraMotionProvider({
  children,
}: CitraMotionProviderProps): JSX.Element {
  return (
    <MotionConfig reducedMotion="user" transition={TRANSITION_ENTER}>
      <LazyMotion features={domMax} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

export { m, AnimatePresence };
