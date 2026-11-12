import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SolvaTwoToneHeading } from '@/components/landing/SolvaPrimitives';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import { LandingPage } from '@/pages/LandingPage';
import { APP_VERSION } from '@/version';

describe('Landing Page Vietnamese Typography & Sentient Font Integrity', () => {
  it('applies Vietnamese-tuned line-height and letter-spacing on SolvaTwoToneHeading when rendering Vietnamese text', () => {
    const { container } = render(
      <SolvaTwoToneHeading
        as="h1"
        size="h1"
        primary="Kiểm chứng trích dẫn học thuật."
        secondary="Phát hiện trích dẫn ảo bằng trí tuệ nhân tạo giải thích được."
      />
    );

    const heading = container.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(heading?.className).toContain('font-solva-serif');
    // Vietnamese headings with stacked diacritics need slightly relaxed leading and tracking
    expect(heading?.className).toContain('leading-[1.15]');
    expect(heading?.className).toContain('tracking-[-0.03em]');
  });

  it('preserves compact editorial line-height and tracking on SolvaTwoToneHeading for English text', () => {
    const { container } = render(
      <SolvaTwoToneHeading
        as="h1"
        size="h1"
        primary="Academic citation verification."
        secondary="Catch hallucinated references with explainable logic."
      />
    );

    const heading = container.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(heading?.className).toContain('leading-[1.06]');
    expect(heading?.className).toContain('tracking-[-0.05em]');
  });

  it('normalizes all rendered Vietnamese heading words to Unicode NFC so precomposed Sentient glyphs always match', async () => {
    await i18n.changeLanguage('vi');
    // Pass NFD-decomposed Vietnamese text to verify automatic NFC normalization
    const nfdPrimary = 'Kiê\u0309m chư\u0301ng tri\u0301ch dâ\u0303n ho\u0323c thuâ\u0323t.';
    const { container } = render(
      <SolvaTwoToneHeading as="h2" primary={nfdPrimary} />
    );
    const text = container.textContent ?? '';
    expect(text).toBe(nfdPrimary.normalize('NFC'));
  });

  it('does not reference external incomplete cdn.fontshare.com URLs in index.css @font-face declarations', () => {
    const cssPath = path.resolve(__dirname, '../index.css');
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain("url('/fonts/Sentient-Light.woff2')");
    expect(css).toContain("url('/fonts/Sentient-Regular.woff2')");
    expect(css).not.toContain('cdn.fontshare.com');
  });

  it('renders LandingPage in Vietnamese with NFC-normalized serif headings and Vietnamese typography classes across all sections', async () => {
    await i18n.changeLanguage('vi');
    const { container } = render(
      <ThemeProvider>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    const serifElements = container.querySelectorAll('.font-solva-serif');
    expect(serifElements.length).toBeGreaterThan(10);

    serifElements.forEach((el) => {
      const content = el.textContent ?? '';
      expect(content).toBe(content.normalize('NFC'));
    });

    const heroH1 = container.querySelector('h1.font-solva-serif');
    expect(heroH1).not.toBeNull();
    expect(heroH1?.className).toContain('leading-[1.15]');
    expect(heroH1?.className).toContain('tracking-[-0.03em]');
    expect(screen.getAllByText(/Kiểm chứng/i).length).toBeGreaterThan(0);
  });

  it('separates primary and secondary clauses with a single space in SolvaTwoToneHeading textContent', () => {
    const { container } = render(
      <SolvaTwoToneHeading
        as="h1"
        size="h1"
        primary="Academic integrity."
        secondary="Simple, predictable pricing."
      />
    );
    expect(container.textContent).toBe('Academic integrity. Simple, predictable pricing.');
  });

  it('preserves real word spaces in AuthSplitShell hero heading textContent and renders APP_VERSION', async () => {
    await i18n.changeLanguage('vi');
    const { container } = render(
      <ThemeProvider>
        <MemoryRouter>
          <AuthSplitShell>
            <div>Form slot</div>
          </AuthSplitShell>
        </MemoryRouter>
      </ThemeProvider>
    );

    const heroH2 = container.querySelector('h2.font-solva-serif');
    expect(heroH2).not.toBeNull();
    expect(heroH2?.textContent).toBe('Xác minh mọi trích dẫn. Truy vết mọi nguồn tài liệu.');
    expect(container.textContent).toContain(`SourceLogic v${APP_VERSION}`);
    expect(container.textContent).not.toContain('SourceLogic v2.3');
  });
});
