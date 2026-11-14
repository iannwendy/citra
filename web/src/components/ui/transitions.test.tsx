import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { CitraMotionProvider } from './motion-primitives';
import {
  NumberPopIn,
  TactileToggle,
  ReasoningStream,
  DirectionalStageSlide,
} from './transitions';

describe('Task 2: Core transitions.dev Primitives (#02, #27, #29, #08)', () => {
  beforeEach(() => {
    (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__ = true;
  });

  afterEach(() => {
    delete (globalThis as { __CITRA_ENABLE_TEST_MOTION__?: boolean }).__CITRA_ENABLE_TEST_MOTION__;
    vi.useRealTimers();
  });

  describe('#02 NumberPopIn per-character diffing & textContent purity', () => {
    it('keeps unchanged prefix/digits stationary with data-same and preserves pure synchronous textContent during animation', () => {
      const { rerender, container } = render(
        <NumberPopIn value="$20" data-testid="price-num" />,
      );
      const priceEl = screen.getByTestId('price-num');
      expect(priceEl.textContent).toBe('$20');

      const initialSlots = container.querySelectorAll('.t-digit-slot');
      expect(initialSlots.length).toBe(3);

      // Update from $20 -> $16
      rerender(<NumberPopIn value="$16" data-testid="price-num" />);

      // CRITICAL INVARIANT: textContent must immediately be "$16" (never "$1260" or "$20$16")
      expect(priceEl.textContent).toBe('$16');

      const slots = container.querySelectorAll('.t-digit-slot');
      expect(slots.length).toBe(3);

      // Slot 0 ('$') did not change -> marked data-same and has NO .t-digit-old
      const dollarDigit = slots[0].querySelector('.t-digit');
      expect(dollarDigit?.textContent).toBe('$');
      expect(dollarDigit?.hasAttribute('data-same')).toBe(true);
      expect(slots[0].querySelector('.t-digit-old')).toBeNull();

      // Slots 1 ('2' -> '1') and 2 ('0' -> '6') changed -> .t-digit-old uses data-char with empty textContent
      const oldDigit1 = slots[1].querySelector('.t-digit-old');
      const oldDigit2 = slots[2].querySelector('.t-digit-old');
      expect(oldDigit1).not.toBeNull();
      expect(oldDigit1?.getAttribute('data-char')).toBe('2');
      expect(oldDigit1?.textContent).toBe('');

      expect(oldDigit2).not.toBeNull();
      expect(oldDigit2?.getAttribute('data-char')).toBe('0');
      expect(oldDigit2?.textContent).toBe('');
      expect(oldDigit2?.getAttribute('data-stagger')).toBe('1');
    });

    it('keeps both leading "$" and trailing "0" stationary when toggling "$200" -> "$160"', () => {
      const { rerender, container } = render(
        <NumberPopIn value="$200" data-testid="ultra-num" />,
      );
      rerender(<NumberPopIn value="$160" data-testid="ultra-num" />);

      expect(screen.getByTestId('ultra-num').textContent).toBe('$160');
      const slots = container.querySelectorAll('.t-digit-slot');
      expect(slots.length).toBe(4);
      expect(slots[0].querySelector('.t-digit')?.hasAttribute('data-same')).toBe(true);
      expect(slots[1].querySelector('.t-digit')?.hasAttribute('data-same')).toBe(false);
      expect(slots[2].querySelector('.t-digit')?.hasAttribute('data-same')).toBe(false);
      expect(slots[3].querySelector('.t-digit')?.hasAttribute('data-same')).toBe(true);
    });
  });

  describe('#27 TactileToggle', () => {
    it('suppresses spring transition on initial mount (no .is-init) and activates .is-init on user interaction', () => {
      function ToggleHarness() {
        const [checked, setChecked] = useState(true);
        return (
          <TactileToggle
            checked={checked}
            onChange={setChecked}
            aria-label="Annual billing"
            data-testid="billing-switch"
          />
        );
      }

      render(<ToggleHarness />);
      const sw = screen.getByTestId('billing-switch');
      expect(sw.getAttribute('role')).toBe('switch');
      expect(sw.getAttribute('aria-checked')).toBe('true');
      expect(sw.classList.contains('is-init')).toBe(false);

      fireEvent.click(sw);
      expect(sw.getAttribute('aria-checked')).toBe('false');
      expect(sw.classList.contains('is-init')).toBe(true);
    });
  });

  describe('#29 ReasoningStream', () => {
    it('renders viewport with edge mask class and steps smoothly when new live telemetry lines arrive', () => {
      vi.useFakeTimers();
      const initialLines = [
        '[00.4s] Extracting PDF layout & sections',
        '[01.2s] Detected 18 in-text citations',
        '[02.1s] Cross-matching 16 bibliography entries',
      ];

      const { rerender, container } = render(
        <ReasoningStream
          lines={initialLines}
          visibleLines={3}
          data-testid="reason-stream"
        />,
      );

      const stream = screen.getByTestId('reason-stream');
      expect(stream.classList.contains('t-reason')).toBe(true);
      expect(container.querySelector('.t-reason-viewport')).not.toBeNull();
      expect(stream.textContent).toContain('Cross-matching 16 bibliography entries');

      // Append a new live SSE telemetry line
      const updatedLines = [
        ...initialLines,
        '[03.4s] Querying Crossref, OpenAlex & Semantic Scholar',
      ];
      rerender(
        <ReasoningStream
          lines={updatedLines}
          visibleLines={3}
          data-testid="reason-stream"
        />,
      );

      expect(stream.textContent).toContain('Querying Crossref, OpenAlex & Semantic Scholar');

      // Advance past step duration (450ms) and ensure scroll settles back cleanly to latest 3 lines
      act(() => {
        vi.advanceTimersByTime(450);
      });

      const renderedLines = container.querySelectorAll('.t-reason-line');
      expect(renderedLines.length).toBe(3);
      expect(renderedLines[renderedLines.length - 1].getAttribute('data-latest')).toBe('true');
    });
  });

  describe('#08 DirectionalStageSlide', () => {
    it('tracks forward (+1) and backward (-1) stage transitions and swaps content cleanly', async () => {
      function StageHarness() {
        const [stage, setStage] = useState(0);
        return (
          <CitraMotionProvider>
            <button type="button" onClick={() => setStage(2)}>
              jump-forward
            </button>
            <button type="button" onClick={() => setStage(1)}>
              step-back
            </button>
            <DirectionalStageSlide stageKey={stage} data-testid="stage-viewport">
              <div data-testid="stage-body">Stage {stage}</div>
            </DirectionalStageSlide>
          </CitraMotionProvider>
        );
      }

      render(<StageHarness />);
      expect(screen.getByTestId('stage-body').textContent).toBe('Stage 0');

      fireEvent.click(screen.getByText('jump-forward'));
      expect(screen.getByTestId('stage-viewport').getAttribute('data-direction')).toBe('1');
      await waitFor(() => {
        expect(screen.getByTestId('stage-body').textContent).toBe('Stage 2');
      });

      fireEvent.click(screen.getByText('step-back'));
      expect(screen.getByTestId('stage-viewport').getAttribute('data-direction')).toBe('-1');
      await waitFor(() => {
        expect(screen.getByTestId('stage-body').textContent).toBe('Stage 1');
      });
    });
  });
});
