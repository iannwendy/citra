import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { api, type SystemHealth } from '@/api/client';
import {
  formatLocalizedDateTime,
  formatUserError,
  getCisBand,
} from '@/lib/academicTaxonomy';
import { getVerdictExplanation } from '@/lib/verdictExplanation';
import {
  fireEvent,
  makeUser,
  renderWithProviders,
  screen,
  waitFor,
} from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { HelpModal } from '@/components/HelpModal';
import { EvidenceGraph } from '@/components/CitationGraph/EvidenceGraph';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';
import { OverrideControls } from '@/components/OverrideControls';
import {
  FeatureCardWidget,
  HeroVerificationMockup,
  PipelineStageVisual,
  StickyCardWidget,
} from '@/components/landing/SolvaMockupWidgets';
import { EssayPage } from '@/pages/EssayPage';
import { IssuesPage } from '@/pages/IssuesPage';
import { SharedReportPage } from '@/pages/SharedReportPage';
import { SystemHealthPage } from '@/pages/SystemHealthPage';
import { StripeDemoCheckoutPage } from '@/pages/StripeDemoCheckoutPage';
import { BillingSuccessPage } from '@/pages/BillingSuccessPage';
import { PendingReviewsPage } from '@/pages/PendingReviewsPage';
import { PromoManagementPage } from '@/pages/PromoManagementPage';

const WEB_ROOT = path.resolve(__dirname, '../..');

function readWebFile(relPath: string): string {
  return fs.readFileSync(path.join(WEB_ROOT, relPath), 'utf-8');
}

describe('Human-Language Audit — Anti-Jargon, Error Translation & Grammar Regression Suite', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  // ---------------------------------------------------------------------------
  // 1. Canonical 4-Band CIS Parity (85–100, 70–84, 50–69, < 50) in VI & EN
  // ---------------------------------------------------------------------------
  it('1. getCisBand() enforces exact 4-band boundaries (85–100, 70–84, 50–69, < 50) in VI & EN and aligns with HelpModal', async () => {
    const cases: Array<{
      score: number;
      key: 'excellent' | 'good' | 'review' | 'critical';
      en: string;
      vi: string;
    }> = [
      { score: 100, key: 'excellent', en: 'Excellent', vi: 'Xuất sắc' },
      { score: 85, key: 'excellent', en: 'Excellent', vi: 'Xuất sắc' },
      { score: 84.9, key: 'good', en: 'Good', vi: 'Khá tốt' },
      { score: 70, key: 'good', en: 'Good', vi: 'Khá tốt' },
      { score: 69.9, key: 'review', en: 'Needs Review', vi: 'Cần rà soát' },
      { score: 50, key: 'review', en: 'Needs Review', vi: 'Cần rà soát' },
      { score: 49.9, key: 'critical', en: 'Needs Careful Review', vi: 'Cần kiểm tra kỹ' },
      { score: 0, key: 'critical', en: 'Needs Careful Review', vi: 'Cần kiểm tra kỹ' },
    ];

    for (const c of cases) {
      const enBand = getCisBand(c.score, 'en');
      const viBand = getCisBand(c.score, 'vi');
      expect(enBand.key).toBe(c.key);
      expect(viBand.key).toBe(c.key);
      expect(enBand.label).toBe(c.en);
      expect(viBand.label).toBe(c.vi);
    }

    // Clamping & NaN resilience
    expect(getCisBand(140, 'en').key).toBe('excellent');
    expect(getCisBand(-15, 'vi').key).toBe('critical');
    expect(getCisBand(Number.NaN, 'en').key).toBe('critical');

    // HelpModal renders all 4 canonical bands in EN & VI
    await i18n.changeLanguage('en');
    const { unmount: uEn } = renderWithProviders(
      <HelpModal isOpen={true} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Understanding Results/i }));
    expect(screen.getByText('Excellent')).toBeDefined();
    expect(screen.getByText('Good')).toBeDefined();
    expect(screen.getByText('Needs Review')).toBeDefined();
    expect(screen.getByText('Needs Careful Review')).toBeDefined();
    uEn();

    await i18n.changeLanguage('vi');
    renderWithProviders(<HelpModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiểu về kết quả/i }));
    expect(screen.getByText('Xuất sắc')).toBeDefined();
    expect(screen.getByText('Khá tốt')).toBeDefined();
    expect(screen.getByText('Cần rà soát')).toBeDefined();
    expect(screen.getByText('Cần kiểm tra kỹ')).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 2. formatUserError() Comprehensive Backend Error Translation (VI & EN)
  // ---------------------------------------------------------------------------
  it('2. formatUserError() translates all newly mapped backend errors in VI & EN and strips API 400: prefixes', () => {
    const samples: Array<{
      raw: string;
      expectedEn: RegExp;
      expectedVi: RegExp;
      forbidden: string[];
    }> = [
      {
        raw: 'API 403: ACCOUNT_NOT_ACTIVATED: Account is not activated yet.',
        expectedEn: /not activated|isn't activated/i,
        expectedVi: /chưa được kích hoạt/i,
        forbidden: ['ACCOUNT_NOT_ACTIVATED', 'API 403:'],
      },
      {
        raw: 'API 403: API_KEY_REQUIRES_PRO: Upgrade to Pro to create API keys.',
        expectedEn: /Pro plans/i,
        expectedVi: /gói Pro/i,
        forbidden: ['API_KEY_REQUIRES_PRO', 'API 403:'],
      },
      {
        raw: 'API 400: Invalid PDF upload: missing %PDF- header',
        expectedEn: /damaged|valid document format/i,
        expectedVi: /không đúng định dạng chuẩn|bị lỗi/i,
        forbidden: ['%PDF-', 'API 400:'],
      },
      {
        raw: 'API 400: Password exceeds bcrypt ceiling of 72 UTF-8 bytes',
        expectedEn: /too long|shorter password/i,
        expectedVi: /Mật khẩu hơi dài|ngắn hơn/i,
        forbidden: ['72 UTF-8 bytes', 'bcrypt', 'API 400:'],
      },
      {
        raw: 'API 410: Share token has expired',
        expectedEn: /share link is invalid or has expired/i,
        expectedVi: /Liên kết chia sẻ không hợp lệ hoặc đã hết hạn/i,
        forbidden: ['API 410:'],
      },
      {
        raw: 'API 400: Invalid share token structure',
        expectedEn: /share link is invalid or has expired/i,
        expectedVi: /Liên kết chia sẻ không hợp lệ hoặc đã hết hạn/i,
        forbidden: ['token structure', 'API 400:'],
      },
      {
        raw: 'API 409: {"detail":"Username already exists"}',
        expectedEn: /username is already taken/i,
        expectedVi: /Tên đăng nhập này đã có người sử dụng/i,
        forbidden: ['{"detail"', 'API 409:'],
      },
      {
        raw: 'API 409: Promo code SUMMER26 already exists',
        expectedEn: /promo code already exists/i,
        expectedVi: /Mã khuyến mãi này đã tồn tại/i,
        forbidden: ['API 409:'],
      },
      {
        raw: 'API 400: vnp_TxnRef mismatch with vnp_SecureHash',
        expectedEn: /Payment could not be completed/i,
        expectedVi: /Giao dịch thanh toán chưa hoàn tất/i,
        forbidden: ['vnp_TxnRef', 'vnp_SecureHash', 'API 400:'],
      },
    ];

    for (const s of samples) {
      const enMsg = formatUserError(new Error(s.raw), 'en');
      const viMsg = formatUserError(new Error(s.raw), 'vi');

      expect(enMsg).toMatch(s.expectedEn);
      expect(viMsg).toMatch(s.expectedVi);

      for (const bad of s.forbidden) {
        expect(enMsg, `EN leaked ${bad}`).not.toContain(bad);
        expect(viMsg, `VI leaked ${bad}`).not.toContain(bad);
      }
    }

    // Generic unmapped API 400: error still strips raw HTTP status prefix cleanly
    expect(formatUserError('API 400: Citation text cannot be empty', 'en')).toBe(
      'Citation text cannot be empty',
    );
    expect(formatUserError('API 400: Nội dung trích dẫn không được để trống', 'vi')).toBe(
      'Nội dung trích dẫn không được để trống',
    );
  });

  // ---------------------------------------------------------------------------
  // 3. Locale Files (vi.json & en.json) Anti-Jargon & Tenant Hygiene
  // ---------------------------------------------------------------------------
  it('3. vi.json & en.json contain zero legacy env-var, university-domain, dev-jargon, or mistranslated strings', () => {
    const forbiddenTokens = [
      'GOOGLE_CLIENT_ID',
      'tdtu.edu.vn',
      'Đăng nhập Không gian',
      'Export Audit Artifact',
      'Auto-Healed',
      'Show toast notifications',
      'HMAC-SHA256',
      'Ghi đè phán quyết',
    ];

    for (const localeFile of ['src/i18n/locales/vi.json', 'src/i18n/locales/en.json']) {
      const raw = readWebFile(localeFile);
      for (const token of forbiddenTokens) {
        expect(raw, `${localeFile} must not contain "${token}"`).not.toContain(token);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 4. verdictExplanation.ts EN Singular / Plural Grammar & Neutral Citation Rules
  // ---------------------------------------------------------------------------
  it('4. verdictExplanation.ts produces grammatically sound EN singular/plural sentences and neutral academic citation rules', () => {
    const singleTitleVerified = makeVerdict({
      label: 'verified',
      matched_sources: [
        {
          source: 'crossref',
          title: 'Attention Is All You Need',
          matched_fields: ['title'],
          checked_at: '2026-11-01T00:00:00Z',
        },
      ],
    });
    expect(getVerdictExplanation(singleTitleVerified, 'en')).toContain(
      'The title is consistent with the citation.',
    );

    const singleYearMismatch = makeVerdict({
      label: 'metadata_error',
      mismatched_fields: ['year'],
      matched_sources: [
        {
          source: 'crossref',
          title: 'Attention Is All You Need',
          matched_fields: ['title'],
          checked_at: '2026-11-01T00:00:00Z',
        },
      ],
    });
    const yearMismatchText = getVerdictExplanation(singleYearMismatch, 'en');
    expect(yearMismatchText).toContain('the publication year does not match the citation.');
    expect(yearMismatchText).toContain('Please review this detail.');
    expect(yearMismatchText).not.toContain('the publication year do not match');

    const pluralAuthorsMismatch = makeVerdict({
      label: 'metadata_error',
      mismatched_fields: ['authors'],
      matched_sources: [
        {
          source: 'openalex',
          title: 'Deep Residual Learning',
          matched_fields: ['title', 'year'],
          checked_at: '2026-11-01T00:00:00Z',
        },
      ],
    });
    const authorsMismatchText = getVerdictExplanation(pluralAuthorsMismatch, 'en');
    expect(authorsMismatchText).toContain('the authors do not match the citation.');
    expect(authorsMismatchText).toContain('Please review these details.');

    const multiFieldsVerified = makeVerdict({
      label: 'verified',
      matched_sources: [
        {
          source: 'openalex',
          title: 'BERT',
          matched_fields: ['title', 'year'],
          checked_at: '2026-11-01T00:00:00Z',
        },
      ],
    });
    expect(getVerdictExplanation(multiFieldsVerified, 'en')).toContain(
      'The title and the publication year are consistent with the citation.',
    );
  });

  // ---------------------------------------------------------------------------
  // 5. EssayPage, IssuesPage & SharedReportPage Static Anti-Jargon Invariants
  // ---------------------------------------------------------------------------
  it('5. EssayPage.tsx, IssuesPage.tsx, and SharedReportPage.tsx contain zero raw similarity equations, concept-bridge jargon, or VL monogram', () => {
    const reportFiles = [
      'src/pages/EssayPage.tsx',
      'src/pages/IssuesPage.tsx',
      'src/pages/SharedReportPage.tsx',
    ];
    const forbidden = [
      'title similarity =',
      'độ tương đồng tiêu đề =',
      'ACADEMIC CONCEPT BRIDGE',
      'CẦU NỐI KHÁI NIỆM HỌC THUẬT',
    ];

    for (const rel of reportFiles) {
      const src = readWebFile(rel);
      for (const token of forbidden) {
        expect(src, `${rel} must not contain "${token}"`).not.toContain(token);
      }
    }

    const issuesSrc = readWebFile('src/pages/IssuesPage.tsx');
    expect(issuesSrc, 'IssuesPage.tsx must not render "VL" monogram').not.toMatch(
      /\bVL\b/,
    );
    expect(issuesSrc).not.toContain('R-HALLUCINATED-SOURCE');
    expect(readWebFile('src/pages/SharedReportPage.tsx')).not.toContain(
      'R-HALLUCINATED-SOURCE',
    );
  });

  // ---------------------------------------------------------------------------
  // 6. IssuesPage Live Render — Zero VL Monogram, Zero Raw Similarity Formulas
  // ---------------------------------------------------------------------------
  it('6. IssuesPage live render in VI & EN avoids VL monogram and raw title similarity / R-HALLUCINATED-SOURCE leaks', async () => {
    const report = makeReport({
      essay_id: 71,
      filename: 'KLTN_2026.pdf',
      verdicts: [
        makeVerdict({
          citation_id: 'cit-1',
          citation_raw: 'Nguyen, A. (2025). Nonexistent Neural Method.',
          label: 'suspected_hallucination',
          confidence: 0.25,
          reasoning: 'title similarity = 0.21; độ tương đồng tiêu đề = 21%',
          triggered_rules: ['R-HALLUCINATED-SOURCE'],
          matched_sources: [
            {
              source: 'vn_legal_registry',
              title: 'Luật Giáo dục Đại học',
              authors: ['Quốc hội'],
              year: '2018',
              matched_fields: ['title'],
              checked_at: '2026-11-20T00:00:00Z',
            },
          ],
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    await i18n.changeLanguage('vi');
    const { container: viContainer, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
      </Routes>,
      { user: makeUser('user', 'pro'), initialRoute: '/verification/report/71/issues' },
    );

    const expandVi = await screen.findByLabelText(/Mở rộng chi tiết/i);
    fireEvent.click(expandVi);
    const viText = viContainer.textContent ?? '';
    expect(viText).not.toMatch(/\bVL\b/);
    expect(viText).not.toContain('title similarity =');
    expect(viText).not.toContain('độ tương đồng tiêu đề =');
    expect(viText).not.toContain('R-HALLUCINATED-SOURCE');
    unmount();

    await i18n.changeLanguage('en');
    const { container: enContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
      </Routes>,
      { user: makeUser('user', 'pro'), initialRoute: '/verification/report/71/issues' },
    );
    const expandEn = await screen.findByLabelText(/Expand details/i);
    fireEvent.click(expandEn);
    const enText = enContainer.textContent ?? '';
    expect(enText).not.toMatch(/\bVL\b/);
    expect(enText).not.toContain('title similarity =');
    expect(enText).not.toContain('R-HALLUCINATED-SOURCE');
  });

  // ---------------------------------------------------------------------------
  // 7. SharedReportPage Live Render — Clean Bilingual Output Without Jargon
  // ---------------------------------------------------------------------------
  it('7. SharedReportPage live render in VI & EN omits ACADEMIC CONCEPT BRIDGE, CẦU NỐI KHÁI NIỆM HỌC THUẬT, and raw similarity equations', async () => {
    const baseReport = makeReport({
      essay_id: 90,
      filename: 'Shared_Capstone.pdf',
      num_pages: 24,
      verdicts: [
        makeVerdict({
          citation_id: 'cit-s1',
          citation_raw: 'Vaswani et al. (2017). Sự chú ý là tất cả những gì bạn cần.',
          label: 'metadata_error',
          confidence: 0.88,
          reasoning:
            'Translated title detected [Neural: title_sim=0.25, author_sim=0.90] R-CROSS-LINGUAL-TITLE-MATCH',
          triggered_rules: ['R-CROSS-LINGUAL-TITLE-MATCH'],
          mismatched_fields: ['title'],
          features: {
            title_sim_fuzzy: 0.25,
            title_sim_semantic: 0.91,
            cross_lingual_detected: true,
            cross_lingual_title_detected: true,
            cross_lingual_title_sim: 0.91,
            bridged_concepts: ['học sâu → deep learning'],
          },
        }),
      ],
    });
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: baseReport.essay_id,
      filename: baseReport.filename,
      created_at: '2026-11-26T08:00:00Z',
      num_pages: baseReport.num_pages,
      num_citations: 1,
      cis: baseReport.cis,
      style_profile: baseReport.style_profile,
      receipt_id: 'CITRA-2026-90',
      verified_at: '2026-11-26T08:00:00Z',
      expires_at: '2026-12-31T00:00:00Z',
      disclaimer: 'Decision support tool',
      verdict_counts: {
        verified: 0,
        metadata_error: 1,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 0,
      },
      verdicts: baseReport.verdicts.map((v, idx) => ({
        ...v,
        reference_id: `ref-${idx + 1}`,
        raw_text: v.citation_raw,
        explanation: v.reasoning,
      })),
    });

    await i18n.changeLanguage('vi');
    const { container: viContainer, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { user: null, initialRoute: '/verify/share/valid-token-123' },
    );

    await waitFor(() =>
      expect(viContainer.textContent).toContain('Shared_Capstone.pdf'),
    );
    const viText = viContainer.textContent ?? '';
    expect(viText).not.toContain('ACADEMIC CONCEPT BRIDGE');
    expect(viText).not.toContain('CẦU NỐI KHÁI NIỆM HỌC THUẬT');
    expect(viText).not.toContain('title similarity =');
    expect(viText).not.toContain('độ tương đồng tiêu đề =');
    unmount();

    await i18n.changeLanguage('en');
    const { container: enContainer } = renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { user: null, initialRoute: '/verify/share/valid-token-123' },
    );
    await waitFor(() =>
      expect(enContainer.textContent).toContain('Shared_Capstone.pdf'),
    );
    const enText = enContainer.textContent ?? '';
    expect(enText).not.toContain('ACADEMIC CONCEPT BRIDGE');
    expect(enText).not.toContain('title similarity =');
    expect(enText).not.toContain('title_sim=');
    expect(enText).not.toContain('[Neural:');
    expect(enText).not.toContain('R-CROSS-LINGUAL-TITLE-MATCH');
  });

  // ---------------------------------------------------------------------------
  // 8. EvidenceGraph.tsx Static + Live Render Anti-Jargon Audit
  // ---------------------------------------------------------------------------
  it('8. EvidenceGraph.tsx omits Neuro-Symbolic DAG, MiniLM model IDs, Tác giả Jaccard, and R-HALLUCINATED-SOURCE in source & rendered DOM', async () => {
    const src = readWebFile('src/components/CitationGraph/EvidenceGraph.tsx');
    const forbidden = [
      'Đồ Thị Bằng Chứng Neuro-Symbolic',
      'TRUY VẾT DAG',
      'paraphrase-multilingual-MiniLM-L12-v2',
      'Tác giả Jaccard',
      'R-HALLUCINATED-SOURCE',
      'ACADEMIC CONCEPT BRIDGE',
      'CẦU NỐI KHÁI NIỆM HỌC THUẬT',
    ];
    for (const token of forbidden) {
      expect(src, `EvidenceGraph.tsx must not contain "${token}"`).not.toContain(token);
    }

    const richVerdict = makeVerdict({
      citation_id: 'cit-eg-1',
      citation_raw: 'Nguyen, T. (2025). Nghiên cứu mô hình ảo giác trích dẫn.',
      label: 'suspected_hallucination',
      confidence: 0.22,
      triggered_rules: ['R-HALLUCINATED-SOURCE'],
      mismatched_fields: ['title', 'authors'],
      matched_sources: [],
      features: {
        title_sim_fuzzy: 0.18,
        title_sim_semantic: 0.34,
        author_jaccard: 0.0,
        year_distance: 2,
        cross_lingual_detected: true,
        bridged_concepts: ['học sâu → deep learning'],
      },
    });

    await i18n.changeLanguage('vi');
    const { container: viContainer, unmount } = renderWithProviders(
      <EvidenceGraph verdict={richVerdict} />,
    );
    const viText = viContainer.textContent ?? '';
    expect(viText).toContain('Thư viện học thuật');
    expect(viText).toContain('So sánh nội dung');
    for (const token of forbidden) {
      expect(viText).not.toContain(token);
    }
    unmount();

    await i18n.changeLanguage('en');
    const { container: enContainer } = renderWithProviders(
      <EvidenceGraph verdict={richVerdict} />,
    );
    const enText = enContainer.textContent ?? '';
    expect(enText).toContain('Academic Libraries');
    expect(enText).toContain('Content Comparison');
    for (const token of forbidden) {
      expect(enText).not.toContain(token);
    }
  });

  // ---------------------------------------------------------------------------
  // 9. LiveCitationSandbox Static + Live Render — Zero "HTTP 403 OK"
  // ---------------------------------------------------------------------------
  it('9. LiveCitationSandbox.tsx never renders contradictory "HTTP 403 OK" in source or restricted_alive output', async () => {
    const src = readWebFile('src/components/LiveCitationSandbox.tsx');
    expect(src).not.toContain('HTTP 403 OK');

    vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue({
      elapsed_seconds: 0.9,
      total: 1,
      summary: {
        verified: 1,
        metadata_error: 0,
        incomplete_metadata: 0,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 0,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw: 'Vaswani, A. (2017). Attention Is All You Need. https://ieee.org/paywalled',
          label: 'verified',
          confidence: 0.95,
          mapping_status: 'matched',
          mapping_note: '',
          mismatched_fields: [],
          triggered_rules: ['R-WELL-LINKED'],
          url_status: 'restricted_alive',
          url_status_code: 403,
          matched_sources: [],
          reasoning: 'Matched.',
        },
      ],
    });

    const { container } = renderWithProviders(<LiveCitationSandbox lang="en" />);
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));
    const statusPill = await screen.findByTestId('sandbox-url-status-1');
    expect(statusPill.textContent).toContain('Site restricts automated checks');
    expect(container.textContent).not.toContain('HTTP 403 OK');
  });

  // ---------------------------------------------------------------------------
  // 10. Billing & Checkout Static Audit — Zero Double Currency / VNPay Internal Tokens
  // ---------------------------------------------------------------------------
  it('10. StripeDemoCheckoutPage.tsx, BillingSuccessPage.tsx JSX, and PromoManagementPage.tsx have zero double VND currency or VNPay sandbox protocol strings', () => {
    const checkoutSrc = readWebFile('src/pages/StripeDemoCheckoutPage.tsx');
    const billingSuccessSrc = readWebFile('src/pages/BillingSuccessPage.tsx');
    const promoSrc = readWebFile('src/pages/PromoManagementPage.tsx');

    // Inspect BillingSuccessPage rendered JSX portion (after `if (loading)`) so legitimate
    // URL query parameter parsing (`vnpParams.vnp_TxnRef`) is not confused with rendered UI copy
    const billingJsxPart = billingSuccessSrc.slice(
      billingSuccessSrc.indexOf('if (loading)'),
    );
    expect(billingJsxPart.length).toBeGreaterThan(200);

    for (const [name, content] of [
      ['StripeDemoCheckoutPage.tsx', checkoutSrc],
      ['BillingSuccessPage.tsx (JSX)', billingJsxPart],
      ['PromoManagementPage.tsx', promoSrc],
    ] as const) {
      expect(content, `${name} must not contain 4.800.000 ₫ VND`).not.toContain(
        '4.800.000 ₫ VND',
      );
      expect(content, `${name} must not append VND after formatVnd()`).not.toMatch(
        /formatVnd\([^)]*\)\s*VND/,
      );
      expect(content, `${name} must not contain VNPAY Sandbox v2.1.0`).not.toContain(
        'VNPAY Sandbox v2.1.0',
      );
      expect(content, `${name} must not render vnp_TxnRef`).not.toContain('vnp_TxnRef');
      expect(content, `${name} must not render vnp_SecureHash`).not.toContain(
        'vnp_SecureHash',
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 11. StripeDemoCheckoutPage & BillingSuccessPage Live Render in VI
  // ---------------------------------------------------------------------------
  it('11. StripeDemoCheckoutPage and BillingSuccessPage render clean VND currency without "₫ VND" or VNPay internal params', async () => {
    await i18n.changeLanguage('vi');

    vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
      session_id: 'cs_annual_pro',
      status: 'open',
      payment_mode: 'stripe_demo',
      merchant_name: 'CITRA',
      customer_email: 'linh@university.edu',
      customer_name: 'Nguyễn Linh',
      plan_tier: 'pro',
      plan_name: 'CITRA Pro',
      billing_cycle: 'annual',
      amount_usd: 192,
      amount_vnd: 4800000,
      usd_to_vnd_rate: 25000,
      monthly_equivalent_usd: 16,
      annual_savings_usd: 48,
      currency: 'usd',
      features_en: ['50 checks / month'],
      features_vi: ['50 lượt kiểm tra / tháng'],
    });

    const { container: checkoutContainer, unmount: uCheckout } = renderWithProviders(
      <Routes>
        <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
      </Routes>,
      {
        user: makeUser('user', 'basic'),
        initialRoute: '/billing/checkout?session_id=cs_annual_pro',
      },
    );

    await waitFor(() =>
      expect(checkoutContainer.textContent).toContain('4.800.000 ₫'),
    );
    const checkoutText = checkoutContainer.textContent ?? '';
    expect(checkoutText).not.toContain('₫ VND');
    expect(checkoutText).not.toContain('VNPAY Sandbox v2.1.0');
    expect(checkoutText).not.toContain('vnp_TxnRef');
    expect(checkoutText).not.toContain('vnp_SecureHash');
    uCheckout();

    const proUser = makeUser('user', 'pro');
    vi.spyOn(api, 'verifyCheckoutSession').mockResolvedValue({
      status: 'succeeded',
      message: 'Verified',
      user: proUser,
      subscription: {
        plan_tier: 'pro',
        plan_name: 'CITRA Pro',
        billing_cycle: 'annual',
        subscription_status: 'active',
        cancel_at_period_end: false,
        current_period_start: '2026-11-27T00:00:00Z',
        current_period_end: '2027-11-27T00:00:00Z',
        quota: proUser.quota!,
      },
      transaction: {
        id: 11,
        user_id: proUser.id,
        stripe_session_id: 'cs_annual_pro',
        stripe_payment_intent_id: 'pi_annual_pro',
        plan_tier: 'pro',
        plan_name: 'CITRA Pro',
        billing_cycle: 'annual',
        amount_usd: 192,
        amount_vnd: 4800000,
        currency: 'vnd',
        status: 'succeeded',
        payment_mode: 'vnpay_sandbox',
        payment_method: 'vnpay',
        card_brand: 'vnpay',
        card_last4: '2198',
        vnp_bank_code: 'NCB',
        vnp_txn_ref: 'CITRA20261127001',
        vnp_transaction_no: '14582910',
        created_at: '2026-11-27T00:00:00Z',
        paid_at: '2026-11-27T00:00:05Z',
      },
    });

    const { container: successContainer } = renderWithProviders(
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
      </Routes>,
      {
        user: makeUser('user', 'pro'),
        initialRoute: '/billing/success?session_id=cs_annual_pro',
      },
    );

    const amountPaidEl = await screen.findByTestId('receipt-amount-paid');
    expect(amountPaidEl.textContent).toContain('4.800.000 ₫');
    expect(amountPaidEl.textContent).not.toContain('₫ VND');
    const successText = successContainer.textContent ?? '';
    expect(successText).toContain('Mã tham chiếu giao dịch:');
    expect(successText).not.toContain('₫ VND');
    expect(successText).not.toContain('VNPAY Sandbox v2.1.0');
    expect(successText).not.toContain('vnp_TxnRef');
    expect(successText).not.toContain('vnp_SecureHash');
  });

  // ---------------------------------------------------------------------------
  // 12. SystemHealthPage Static + Live Render — Zero Infra Jargon
  // ---------------------------------------------------------------------------
  it('12. SystemHealthPage.tsx omits (B1 Singleflight), Wave-0, local_papers.db, and Ngắt Mạch Tự Động in source & live VI/EN renders', async () => {
    const src = readWebFile('src/pages/SystemHealthPage.tsx');
    const forbidden = [
      '(B1 Singleflight)',
      'Wave-0',
      'local_papers.db',
      'Ngắt Mạch Tự Động',
    ];
    for (const token of forbidden) {
      expect(src, `SystemHealthPage.tsx must not contain "${token}"`).not.toContain(
        token,
      );
    }

    const richHealth: SystemHealth = {
      status: 'ok',
      totals: { users: 10, admins: 1, teachers: 2, students: 7, essays: 30, verdicts: 400 },
      verdict_label_counts: { verified: 350, metadata_error: 50 },
      sqlite_wal: {
        app_db: { journal_mode: 'wal', synchronous: 1, busy_timeout_ms: 5000 },
        local_papers_db: { available: true, mode: 'ro_immutable_wal' },
      },
      cache_stats: {
        total: 128100,
        persistent_entries: 100,
        persistent_hits: 320,
        local_papers_count: 128000,
        session_hit_rate_percent: 82,
        wave0_entries: 34,
        singleflight_coalesced: 19,
        negative_cache_entries: 7,
      },
      upstream_sources: {
        crossref: {
          state: 'closed',
          consecutive_failures: 0,
          total_calls: 20,
          success_count: 20,
          timeout_count: 0,
          http_429_count: 0,
          http_5xx_count: 0,
          ema_latency_ms: 150,
          open_remaining_seconds: 0,
        },
      },
    };

    for (const lang of ['vi', 'en'] as const) {
      await i18n.changeLanguage(lang);
      vi.spyOn(api, 'getSystemHealth').mockResolvedValue(richHealth);
      const { container, unmount } = renderWithProviders(<SystemHealthPage />, {
        user: makeUser('admin', 'ultra'),
      });
      const toggleBtn = await screen.findByTestId('toggle-advanced-diagnostics-btn');
      fireEvent.click(toggleBtn);

      const text = container.textContent ?? '';
      for (const token of forbidden) {
        expect(text, `SystemHealthPage (${lang}) leaked "${token}"`).not.toContain(
          token,
        );
      }
      unmount();
    }
  });

  // ---------------------------------------------------------------------------
  // 13. Teacher Pages & OverrideControls Static Audit — Zero Bot/Override/Double-TZ Jargon
  // ---------------------------------------------------------------------------
  it('13. PendingReviewsPage.tsx, OverrideControls.tsx, and ClassDetailPage.tsx omit Trang chặn bot, Ghi đè trích dẫn, and ((GMT+7))', () => {
    const teacherFiles = [
      'src/pages/PendingReviewsPage.tsx',
      'src/components/OverrideControls.tsx',
      'src/pages/ClassDetailPage.tsx',
    ];
    const forbidden = [
      'Trang chặn bot',
      'Ghi đè trích dẫn',
      'Ghi đè phán quyết',
      '((GMT+7))',
    ];

    for (const rel of teacherFiles) {
      const src = readWebFile(rel);
      for (const token of forbidden) {
        expect(src, `${rel} must not contain "${token}"`).not.toContain(token);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 14. PendingReviewsPage & OverrideControls Live Render in VI
  // ---------------------------------------------------------------------------
  it('14. PendingReviewsPage & OverrideControls render calm Vietnamese phrasing without Trang chặn bot, Ghi đè trích dẫn, or ((GMT+7))', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      {
        id: 1,
        name: 'KLTN 2026',
        description: '',
        join_code: 'CITRA26',
        teacher_id: 1,
        teacher_username: 'gv_lan',
        created_at: '2026-11-01T00:00:00Z',
        student_count: 10,
        essay_count: 5,
      },
    ]);
    vi.spyOn(api, 'listPendingReviews').mockResolvedValue([
      {
        verdict_id: 901,
        essay_id: 42,
        filename: 'BaoCao_AI.pdf',
        student_username: 'sv_an',
        student_name: 'Nguyễn Văn An',
        citation_raw: 'Smith (2024). Restricted Journal Article. https://publisher.org/paper',
        label: 'unresolved',
        confidence: 0.48,
        reasoning: 'Paywalled page.',
        validated_at: '2026-11-27T05:30:00Z',
        url_status: 'restricted_alive',
      },
    ]);

    const { container: pendingContainer, unmount: uPending } = renderWithProviders(
      <PendingReviewsPage />,
      { user: makeUser('teacher', 'pro') },
    );
    const pill = await screen.findByTestId('pending-url-status-901');
    expect(pill.textContent).toContain('Trang web hạn chế truy cập tự động');
    const pendingText = pendingContainer.textContent ?? '';
    expect(pendingText).not.toContain('Trang chặn bot');
    expect(pendingText).not.toContain('Ghi đè trích dẫn');
    expect(pendingText).not.toContain('((GMT+7))');
    uPending();

    const overridden = makeVerdict({
      citation_id: 'cit-902',
      label: 'verified',
      is_overridden: true,
      overridden_by: 'gv_lan',
      override_note: 'Đã kiểm tra sách in',
      overridden_at: '2026-11-27T05:30:00Z',
    });
    const { container: ovContainer } = renderWithProviders(
      <OverrideControls verdict={overridden} onOverride={vi.fn().mockResolvedValue(undefined)} />,
      { user: makeUser('teacher', 'pro') },
    );
    expect(ovContainer.textContent).toContain('(GMT+7)');
    expect(ovContainer.textContent).not.toContain('((GMT+7))');
    expect(ovContainer.textContent).not.toContain('Ghi đè trích dẫn');
    fireEvent.click(screen.getByTestId('override-badge'));
    const dialogText = screen.getByRole('dialog').textContent ?? '';
    expect(dialogText).not.toContain('Ghi đè trích dẫn');
    expect(dialogText).not.toContain('Ghi đè phán quyết');
  });

  // ---------------------------------------------------------------------------
  // 15. Landing Mockups (SolvaMockupWidgets.tsx) Static + Live Render Audit
  // ---------------------------------------------------------------------------
  it('15. SolvaMockupWidgets.tsx omits Sách & Mở, R01_DOI_EXACT, R05_YEAR_DRIFT, and <biblStruct> in source & rendered widgets', () => {
    const src = readWebFile('src/components/landing/SolvaMockupWidgets.tsx');
    const forbidden = ['Sách & Mở', 'R01_DOI_EXACT', 'R05_YEAR_DRIFT', '<biblStruct>'];

    for (const token of forbidden) {
      expect(src, `SolvaMockupWidgets.tsx must not contain "${token}"`).not.toContain(
        token,
      );
    }

    for (const lang of ['vi', 'en'] as const) {
      const { container, unmount } = renderWithProviders(
        <div>
          <HeroVerificationMockup lang={lang} activeStep={0} />
          <FeatureCardWidget index={0} lang={lang} />
          <FeatureCardWidget index={1} lang={lang} />
          <FeatureCardWidget index={2} lang={lang} />
          <StickyCardWidget index={0} lang={lang} />
          <StickyCardWidget index={1} lang={lang} />
          <StickyCardWidget index={2} lang={lang} />
          <PipelineStageVisual tabIndex={0} lang={lang} />
          <PipelineStageVisual tabIndex={1} lang={lang} />
          <PipelineStageVisual tabIndex={2} lang={lang} />
        </div>,
      );

      const text = container.textContent ?? '';
      for (const token of forbidden) {
        expect(text, `SolvaMockupWidgets (${lang}) rendered "${token}"`).not.toContain(
          token,
        );
      }
      unmount();
    }
  });

  // ---------------------------------------------------------------------------
  // 16. PromoManagementPage Live Render & formatLocalizedDateTime Timezone Hygiene
  // ---------------------------------------------------------------------------
  it('16. PromoManagementPage & formatLocalizedDateTime never emit double-parenthesis ((GMT+7)) or ₫ VND', async () => {
    const formattedVi = formatLocalizedDateTime('2026-11-27T05:30:00Z', 'vi');
    expect(formattedVi).toBe('27/11/2026 · 12:30 (GMT+7)');
    expect(formattedVi).not.toContain('((GMT+7))');

    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listAdminPromoCodes').mockResolvedValue({
      stats: {
        total_codes: 1,
        active_codes: 1,
        total_redemptions: 5,
        total_discount_usd: 100,
      },
      promos: [
        {
          id: 1,
          code: 'CITRA6',
          description: 'Ưu đãi học kỳ mới',
          discount_type: 'percent',
          discount_value: 20,
          max_discount_usd: 50,
          min_amount_usd: 0,
          applicable_tiers: 'all',
          applicable_cycles: 'all',
          max_uses: 100,
          used_count: 5,
          max_uses_per_user: 1,
          expires_at: '2026-12-31T16:59:00Z',
          is_active: true,
          is_expired: false,
          is_exhausted: false,
          effective_status: 'active',
          created_by: 1,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
      ],
    });

    const { container } = renderWithProviders(<PromoManagementPage />, {
      user: makeUser('admin', 'ultra'),
      initialRoute: '/admin/promos',
    });

    await waitFor(() => expect(screen.getByTestId('promo-row-CITRA6')).toBeDefined());
    const text = container.textContent ?? '';
    expect(text).not.toContain('((GMT+7))');
    expect(text).not.toContain('₫ VND');
  });

  // ---------------------------------------------------------------------------
  // 17. EssayPage Live Render — Zero Raw Rule Codes or Similarity Equations
  // ---------------------------------------------------------------------------
  it('17. EssayPage live render translates R-HALLUCINATED-SOURCE and cross-lingual features cleanly without raw equations or concept-bridge jargon', async () => {
    const report = makeReport({
      essay_id: 77,
      filename: 'Thesis_Human_Audit.pdf',
      verdicts: [
        makeVerdict({
          citation_id: 'cit-h1',
          citation_raw: 'Phantom, A. (2025). Phương pháp mạng nơ-ron không tồn tại.',
          label: 'suspected_hallucination',
          confidence: 0.19,
          reasoning: 'title similarity = 0.19; độ tương đồng tiêu đề = 19%',
          triggered_rules: ['R-HALLUCINATED-SOURCE'],
          mismatched_fields: ['title', 'authors'],
          matched_sources: [],
          features: {
            title_sim_fuzzy: 0.19,
            title_sim_semantic: 0.28,
            author_jaccard: 0.0,
            cross_lingual_detected: true,
            bridged_concepts: ['mạng nơ-ron → neural network'],
          },
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    for (const lang of ['vi', 'en'] as const) {
      await i18n.changeLanguage(lang);
      const { container, unmount } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        {
          user: makeUser('user', 'pro'),
          initialRoute: '/verification/report/77',
        },
      );

      await waitFor(() =>
        expect(container.textContent).toContain('Thesis_Human_Audit.pdf'),
      );
      const text = container.textContent ?? '';
      expect(text).not.toContain('R-HALLUCINATED-SOURCE');
      expect(text).not.toContain('title similarity =');
      expect(text).not.toContain('độ tương đồng tiêu đề =');
      expect(text).not.toContain('ACADEMIC CONCEPT BRIDGE');
      expect(text).not.toContain('CẦU NỐI KHÁI NIỆM HỌC THUẬT');
      expect(text).not.toContain('Đồ Thị Bằng Chứng Neuro-Symbolic');
      expect(text).not.toContain('TRUY VẾT DAG');
      unmount();
    }
  });
});
