import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import {
  getPlainVerdictLabel,
  getPlainMappingLabel,
} from '@/lib/verdictExplanation';
import {
  FeatureCardWidget,
  StickyCardWidget,
} from '@/components/landing/SolvaMockupWidgets';
import { ScholarlySourceLogo } from '@/components/landing/ScholarlySourceLogos';
import { LandingPage } from '@/pages/LandingPage';

describe('Task 2.1 — Human-First Copywriting & Collapsible Progressive Disclosure (EN & VI)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  function renderLanding() {
    return render(
      <CitraMotionProvider>
        <ThemeProvider defaultTheme="light">
          <MemoryRouter initialEntries={['/']}>
            <LandingPage />
          </MemoryRouter>
        </ThemeProvider>
      </CitraMotionProvider>,
    );
  }

  it('1. renders approachable human-first Navbar, Dropdown, and Mobile Drawer labels in EN and VI instead of bare Inspector / Pipeline / Taxonomy', async () => {
    await i18n.changeLanguage('en');
    const { container: enContainer, unmount: unmountEn } = renderLanding();

    const desktopNavEn = enContainer.querySelector(
      'header nav[aria-label="Primary Navigation"]',
    ) as HTMLElement;
    expect(desktopNavEn).not.toBeNull();

    const topItemsEn = Array.from(
      desktopNavEn.querySelectorAll(':scope > a, :scope > div > button'),
    ).map((el) => el.textContent?.trim());

    expect(topItemsEn).toContain('Platform');
    expect(topItemsEn).toContain('How It Works');
    expect(topItemsEn).toContain('Live Check');
    expect(topItemsEn).toContain('For Whom');
    expect(topItemsEn).toContain('Accuracy');
    expect(topItemsEn).toContain('Pricing');
    expect(topItemsEn).not.toContain('Inspector');
    expect(topItemsEn).not.toContain('Pipeline');
    expect(topItemsEn).not.toContain('120K Benchmark');
    expect(topItemsEn).not.toContain('Taxonomy');

    expect(desktopNavEn.querySelector(':scope > a[href="#how-it-works"]')?.textContent?.trim()).toBe(
      'How It Works',
    );
    expect(
      desktopNavEn.querySelector(':scope > a[href="#interactive-demo"]')?.textContent?.trim(),
    ).toBe('Live Check');
    expect(desktopNavEn.querySelector(':scope > a[href="#workspaces"]')?.textContent?.trim()).toBe(
      'For Whom',
    );
    expect(
      desktopNavEn.querySelector(':scope > a[href="#benchmark-120k"]')?.textContent?.trim(),
    ).toBe('Accuracy');

    // Dropdown items are free of unexplained ML/XML acronyms
    fireEvent.click(within(desktopNavEn).getByRole('button', { name: /Platform/i }));
    expect(desktopNavEn.textContent).not.toMatch(/GROBID|TEI|ONNX|INT8|OOD|ECE/i);

    unmountEn();

    await i18n.changeLanguage('vi');
    const { container: viContainer, unmount: unmountVi } = renderLanding();

    const desktopNavVi = viContainer.querySelector(
      'header nav[aria-label="Primary Navigation"]',
    ) as HTMLElement;
    const topItemsVi = Array.from(
      desktopNavVi.querySelectorAll(':scope > a, :scope > div > button'),
    ).map((el) => el.textContent?.trim());

    expect(topItemsVi).toContain('Nền tảng');
    expect(topItemsVi).toContain('Cách hoạt động');
    expect(topItemsVi).toContain('Kiểm tra thử');
    expect(topItemsVi).toContain('Dành cho ai');
    expect(topItemsVi).toContain('Độ tin cậy');
    expect(topItemsVi).toContain('Bảng giá');
    expect(topItemsVi).not.toContain('Trình thẩm định');
    expect(topItemsVi).not.toContain('Quy trình');
    expect(topItemsVi).not.toContain('Thực nghiệm 120K');
    expect(topItemsVi).not.toContain('Gói dịch vụ');

    fireEvent.click(within(desktopNavVi).getByRole('button', { name: /Nền tảng/i }));
    expect(desktopNavVi.textContent).not.toMatch(/GROBID|TEI|ONNX|INT8|OOD|ECE|Mapping/i);

    // Mobile drawer in VI is also jargon-free
    fireEvent.click(screen.getByRole('button', { name: /toggle navigation menu/i }));
    const mobileNavVi = screen.getByRole('navigation', { name: /mobile navigation/i });
    expect(mobileNavVi.textContent).not.toMatch(/GROBID|TEI|ONNX|INT8|OOD|ECE/i);

    unmountVi();
  });

  it('2. renders approachable Hero copy in EN and VI speaking to theses/papers with verified references and zero unexplained ML/XML/OOD acronyms', async () => {
    await i18n.changeLanguage('en');
    const { container: enContainer, unmount: unmountEn } = renderLanding();
    const heroEn = enContainer.querySelector('#hero') as HTMLElement;
    expect(heroEn).not.toBeNull();

    const h1En = heroEn.querySelector('h1');
    expect(h1En?.textContent).toMatch(/thesis|paper|manuscript/i);
    expect(h1En?.textContent).toMatch(/citation|reference|verif/i);

    const heroEnText = heroEn.textContent ?? '';
    expect(heroEnText).not.toMatch(
      /\bOOD\b|GROBID|TEI-XML|\bTEI\b|ONNX|INT8|S-BERT|SQLite|FTS5|SUSPECTED_HALLUCINATION|METADATA_ERROR/,
    );
    expect(heroEn.querySelector('a[href="#interactive-demo"]')).not.toBeNull();
    expect(enContainer.querySelector('#try-instant')).toBeNull();
    expect(enContainer.textContent ?? '').not.toContain(
      'Instant Check · No Account Required',
    );
    unmountEn();

    await i18n.changeLanguage('vi');
    const { container: viContainer, unmount: unmountVi } = renderLanding();
    const heroVi = viContainer.querySelector('#hero') as HTMLElement;
    expect(heroVi).not.toBeNull();

    const h1Vi = heroVi.querySelector('h1');
    expect(h1Vi?.textContent).toMatch(/Kiểm chứng/i);
    expect(h1Vi?.textContent).toMatch(/trích dẫn/i);
    expect(screen.getAllByText(/Kiểm chứng/i).length).toBeGreaterThan(0);

    const heroViText = heroVi.textContent ?? '';
    expect(heroViText).not.toMatch(
      /\bOOD\b|GROBID|TEI-XML|\bTEI\b|ONNX|INT8|S-BERT|SQLite|FTS5|SUSPECTED_HALLUCINATION|METADATA_ERROR|MATCHED/,
    );
    expect(heroVi.querySelector('a[href="#interactive-demo"]')).not.toBeNull();
    expect(viContainer.querySelector('#try-instant')).toBeNull();
    expect(viContainer.textContent ?? '').not.toContain(
      'Kiểm tra tức thì · Không cần tài khoản',
    );
    unmountVi();
  });

  it('3. renders plain-language verdict/mapping labels in #interactive-demo with zero raw enums or boolean formulas by default, and expands R01–R30 trace via debugger-technical-trace-toggle', async () => {
    const rawEnums = [
      'SUSPECTED_HALLUCINATION',
      'METADATA_ERROR',
      'MISSING_REFERENCE',
      'IN_TEXT_MISMATCH',
      'UNCITED_REFERENCE',
      'MATCHED',
    ];

    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = renderLanding();
      const demo = container.querySelector('#interactive-demo') as HTMLElement;
      expect(demo).not.toBeNull();

      const traceToggle = within(demo).getByTestId('debugger-technical-trace-toggle');
      expect(traceToggle.getAttribute('aria-expanded')).toBe('false');

      // Verify plain-language labels across all 4 sample citations in collapsed default state
      const options = within(demo).getAllByRole('option');
      expect(options).toHaveLength(4);

      const expectedPairs = [
        { verdict: 'VERIFIED', mapping: 'MATCHED' },
        { verdict: 'METADATA_ERROR', mapping: 'MATCHED' },
        { verdict: 'SUSPECTED_HALLUCINATION', mapping: 'MATCHED' },
        { verdict: 'UNRESOLVED', mapping: 'MISSING_REFERENCE' },
      ] as const;

      expectedPairs.forEach((pair, idx) => {
        fireEvent.click(options[idx]);
        const plainVerdict = getPlainVerdictLabel(pair.verdict, lang);
        const plainMapping = getPlainMappingLabel(pair.mapping, lang);

        expect(demo.textContent).toContain(plainVerdict.label);
        expect(demo.textContent).toContain(plainMapping.label);

        // Even when switching to the Rules tab, default collapsed state has zero raw enums or boolean code formulas
        const rulesTab = within(demo).getAllByRole('tab')[1];
        fireEvent.click(rulesTab);

        const collapsedText = demo.textContent ?? '';
        for (const raw of rawEnums) {
          expect(collapsedText).not.toContain(raw);
        }
        expect(collapsedText).not.toMatch(/==|!=|>=|biblStruct|R01_EXACT_DOI|R12_GHOST_DOI/);
      });

      // Click technical trace toggle -> reveals R01-R30 rule codes, boolean condition expressions & canonical enums
      fireEvent.click(options[2]); // Citation [3]: SUSPECTED_HALLUCINATION
      fireEvent.click(traceToggle);
      expect(traceToggle.getAttribute('aria-expanded')).toBe('true');

      const tracePanel = within(demo).getByTestId('debugger-technical-trace-panel');
      expect(tracePanel.textContent).toContain('SUSPECTED_HALLUCINATION');
      expect(tracePanel.textContent).toContain('MATCHED');
      expect(tracePanel.textContent).toContain('R12_GHOST_DOI');
      expect(tracePanel.textContent).toContain('max_similarity(title, all_candidates)');

      // Switch to Citation [4] while expanded -> reveals L1_MISSING_BIB_ENTRY & biblStruct condition
      fireEvent.click(options[3]);
      expect(tracePanel.textContent).toContain('MISSING_REFERENCE');
      expect(tracePanel.textContent).toContain('has no matching biblStruct');

      // Collapse again -> raw enum & formulas disappear cleanly
      fireEvent.click(traceToggle);
      expect(traceToggle.getAttribute('aria-expanded')).toBe('false');
      expect(within(demo).queryByTestId('debugger-technical-trace-panel')).toBeNull();

      unmount();
    }
  });

  it('4. shows a human-readable extracted citation card instead of raw <biblStruct> XML by default, with optional xml-schema-preview-toggle', async () => {
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = renderLanding();

      const fullDefaultText = container.textContent ?? '';
      expect(fullDefaultText).not.toContain('<biblStruct');
      expect(fullDefaultText).not.toContain('</biblStruct>');
      expect(fullDefaultText).not.toContain('<idno');

      // Clean extracted preview still displays paper title & DOI
      expect(fullDefaultText).toContain('Deep Residual Learning');
      expect(fullDefaultText).toContain('10.1109/CVPR.2016.90');

      const xmlToggle = screen.getByTestId('xml-schema-preview-toggle');
      expect(xmlToggle.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(xmlToggle);
      expect(xmlToggle.getAttribute('aria-expanded')).toBe('true');
      expect(container.textContent).toContain('<biblStruct');
      expect(container.textContent).toContain('</biblStruct>');

      unmount();
    }
  });

  it('5. leads #benchmark-120k with a plain-language 3-pillar summary, tucks ML ablation/Platt tables behind benchmark-technical-details-toggle, and formats all VI thousands with dots (120.000)', async () => {
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = renderLanding();

      const bench = container.querySelector('#benchmark-120k') as HTMLElement;
      expect(bench).not.toBeNull();

      const benchToggle = within(bench).getByTestId('benchmark-technical-details-toggle');
      expect(benchToggle.getAttribute('aria-expanded')).toBe('false');
      expect(benchToggle.textContent).toContain(
        lang === 'vi'
          ? 'Xem chi tiết phương pháp & bảng số liệu kỹ thuật'
          : 'View Full Technical Methodology & Benchmark Tables',
      );

      // Default collapsed state shows 120,000 / 120.000 & 99.20% / 99,20% with zero Platt ECE / OOD / HybridMLScorer / raw enum tables
      const collapsedBenchText = bench.textContent ?? '';
      expect(collapsedBenchText).toContain(lang === 'vi' ? '120.000' : '120,000');
      expect(collapsedBenchText).toContain(lang === 'vi' ? '99,20%' : '99.20%');
      expect(collapsedBenchText).not.toMatch(
        /Platt|\bECE\b|\bOOD\b|HybridMLScorer|SUSPECTED_HALLUCINATION|np\.clip|McNemar/,
      );

      // Default LandingPage surface (excluding locked EN Pro pricing subtitle) has zero surviving GROBID / TEI-XML / ONNX INT8 / SQLite FTS5
      const nonPricingSectionsText = Array.from(
        container.querySelectorAll('header, main > section:not(#pricing-plans), footer'),
      )
        .map((el) => el.textContent ?? '')
        .join(' ');
      expect(nonPricingSectionsText).not.toMatch(
        /GROBID|TEI-XML|ONNX|INT8|SQLite|FTS5|\(Override\)/i,
      );

      if (lang === 'vi') {
        const entireViDefaultText = container.textContent ?? '';
        expect(entireViDefaultText).toContain('120.000');
        expect(entireViDefaultText).toContain('4.380');
        expect(entireViDefaultText).toContain('2.400');
        // Zero English comma thousand separators anywhere in VI default view
        expect(entireViDefaultText).not.toMatch(/\b\d{1,3},\d{3}\b/);
      }

      // Expand technical benchmark methodology & tables
      fireEvent.click(benchToggle);
      expect(benchToggle.getAttribute('aria-expanded')).toBe('true');
      expect(bench.textContent).toMatch(/B5 · HybridMLScorer/i);

      const classesTab = within(bench).getByRole('tab', {
        name: /4 classes & 15 sub-taxonomies|4 nhãn & 15 nhóm lỗi/i,
      });
      fireEvent.click(classesTab);
      expect(bench.textContent).toContain('SUSPECTED_HALLUCINATION');

      const calibrationTab = within(bench).getByRole('tab', {
        name: /platt calibration & 95% ci|hiệu chỉnh platt & bootstrap 95% ci/i,
      });
      fireEvent.click(calibrationTab);
      expect(bench.textContent).toContain('0.0411');

      if (lang === 'vi') {
        // Even with technical drawers expanded in VI, thousand separators strictly use dots
        expect(container.textContent ?? '').not.toMatch(/\b\d{1,3},\d{3}\b/);
      }

      unmount();
    }
  });

  it('6. wires aria-controls + matching DOM id on all 3 progressive-disclosure toggles, avoids citra-nowrap-tail + inline-flex cascade, localizes StickyCardWidget(1) rules in VI, styles Citation [4] verdict badge, and renders an OpenLibrary book icon', async () => {
    const cssSource = fs.readFileSync(
      path.resolve(__dirname, '../index.css'),
      'utf-8',
    );

    // A. OpenLibrary renders a dedicated open-book SVG rather than the SQLite cylinder fallback (<ellipse>)
    const { container: openLibIcon } = render(
      <ScholarlySourceLogo name="OpenLibrary" size={18} />,
    );
    expect(openLibIcon.querySelector('svg')).not.toBeNull();
    expect(openLibIcon.querySelector('ellipse')).toBeNull();

    // B. Status dots inside FeatureCardWidget & StickyCardWidget parents never pair .citra-nowrap-tail with inline-flex / flex
    for (const lang of ['en', 'vi'] as const) {
      const { container: widgetsC, unmount: unmountW } = render(
        <div>
          <FeatureCardWidget index={0} lang={lang} />
          <FeatureCardWidget index={1} lang={lang} />
          <FeatureCardWidget index={2} lang={lang} />
          <StickyCardWidget index={0} lang={lang} />
          <StickyCardWidget index={1} lang={lang} />
          <StickyCardWidget index={2} lang={lang} />
        </div>,
      );

      widgetsC.querySelectorAll('.citra-nowrap-tail').forEach((el) => {
        expect(el.className).not.toMatch(/\b(inline-flex|flex)\b/);
        expect(el.tagName.toLowerCase()).not.toBe('button');
      });

      unmountW();
    }

    // C. StickyCardWidget(1) in VI contains zero R01_DOI_EXACT or R05_YEAR_DRIFT strings (while preserving them in EN)
    const { container: sticky1Vi, unmount: unmountStickyVi } = render(
      <StickyCardWidget index={1} lang="vi" />,
    );
    expect(sticky1Vi.textContent).not.toContain('R01_DOI_EXACT');
    expect(sticky1Vi.textContent).not.toContain('R05_YEAR_DRIFT');
    expect(sticky1Vi.textContent).toContain('Đối chiếu mã DOI chính thức');
    expect(sticky1Vi.textContent).toContain('So sánh năm bản nháp & năm công bố');
    unmountStickyVi();

    const { container: sticky1En, unmount: unmountStickyEn } = render(
      <StickyCardWidget index={1} lang="en" />,
    );
    expect(sticky1En.textContent).toContain('R01_DOI_EXACT');
    expect(sticky1En.textContent).toContain('R05_YEAR_DRIFT');
    unmountStickyEn();

    // D. All 3 progressive-disclosure toggles carry aria-controls pointing to a real DOM id, and Citation [4] uses a defined .verdict-badge-* rule in index.css
    for (const lang of ['en', 'vi'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = renderLanding();

      // Ensure desktop navbar uses xl:flex (1280px+) and hamburger/drawer use xl:hidden so 1024px VI never collides
      const desktopNav = container.querySelector(
        'header nav[aria-label="Primary Navigation"]',
      ) as HTMLElement;
      expect(desktopNav.className).toContain('xl:flex');
      expect(desktopNav.className).not.toContain('lg:flex');

      const hamburgerBtn = screen.getByRole('button', {
        name: /toggle navigation menu/i,
      });
      expect(hamburgerBtn.className).toContain('xl:hidden');
      expect(hamburgerBtn.className).not.toContain('lg:hidden');

      // Zero .citra-nowrap-tail paired with inline-flex anywhere on LandingPage
      container.querySelectorAll('.citra-nowrap-tail').forEach((el) => {
        expect(el.className).not.toMatch(/\b(inline-flex|flex)\b/);
      });

      // Toggle 1: benchmark-technical-details-toggle -> benchmark-technical-details-panel
      const benchToggle = screen.getByTestId('benchmark-technical-details-toggle');
      const benchControlsId = benchToggle.getAttribute('aria-controls');
      expect(benchControlsId).toBe('benchmark-technical-details-panel');
      fireEvent.click(benchToggle);
      expect(container.querySelector(`#${benchControlsId}`)).not.toBeNull();

      // Toggle 2: debugger-technical-trace-toggle -> debugger-technical-trace-panel + min-h-[44px] + "Optional:" / "Tùy chọn:"
      const traceToggle = screen.getByTestId('debugger-technical-trace-toggle');
      expect(traceToggle.className).toContain('min-h-[44px]');
      expect(traceToggle.textContent).toContain(
        lang === 'vi' ? 'Tùy chọn:' : 'Optional:',
      );
      const traceControlsId = traceToggle.getAttribute('aria-controls');
      expect(traceControlsId).toBe('debugger-technical-trace-panel');
      fireEvent.click(traceToggle);
      expect(container.querySelector(`#${traceControlsId}`)).not.toBeNull();

      // Toggle 3: xml-schema-preview-toggle -> xml-schema-preview-panel (present both collapsed and expanded)
      const xmlToggle = screen.getByTestId('xml-schema-preview-toggle');
      const xmlControlsId = xmlToggle.getAttribute('aria-controls');
      expect(xmlControlsId).toBe('xml-schema-preview-panel');
      expect(container.querySelector(`#${xmlControlsId}`)).not.toBeNull();
      fireEvent.click(xmlToggle);
      expect(container.querySelector(`#${xmlControlsId}`)).not.toBeNull();

      // Citation [4] ([4] Smith et al. (2021)) verdict badge uses a defined .verdict-badge-* CSS class in index.css
      const demo = container.querySelector('#interactive-demo') as HTMLElement;
      const citation4Option = within(demo).getAllByRole('option')[3];
      const verdictBadgeEl = citation4Option.querySelector('.verdict-badge') as HTMLElement;
      expect(verdictBadgeEl).not.toBeNull();
      const variantClass = Array.from(verdictBadgeEl.classList).find((cls) =>
        cls.startsWith('verdict-badge-'),
      );
      expect(variantClass).toBeDefined();
      expect(cssSource).toMatch(new RegExp(`\\.${variantClass}\\b`));
      expect(cssSource).toMatch(new RegExp(`\\.dark\\s+[^{]*\\.${variantClass}\\b`));

      unmount();
    }
  });
});
