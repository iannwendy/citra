/**
 * API client — v1.2 schema (2-layer: integrity mapping_status + source label).
 *
 * Base URL: import.meta.env.VITE_API_BASE_URL hoặc '/api' (Vite proxy).
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// --- Enums / Literal Types ---

export type CitationType =
  | 'in_text'
  | 'numeric'
  | 'reference_list'
  | 'doi'
  | 'url'
  | 'unknown';

export type ValidationLabel =
  | 'verified'
  | 'metadata_error'
  | 'suspected_hallucination'
  | 'unresolved'
  | 'resource';

export type CitationMappingStatus =
  | 'matched'
  | 'missing_reference'
  | 'uncited_reference'
  | 'in_text_mismatch'
  | 'duplicate_reference'
  | 'ambiguous_mapping'
  | 'style_inconsistent'
  | 'unresolved';

// --- Sub-types ---

export interface MappingMethod {
  type: 'doi' | 'numeric_index' | 'author_year' | 'fuzzy' | 'none';
  confidence: number;
}

export interface CitationLink {
  occurrence_id: string;
  reference_id: string;
  method: string;
  confidence: number;
}

export interface MatchedSource {
  source: string; // 'crossref' | 'openalex' | 'dblp' | 'arxiv' | 'openlibrary' | 'europepmc' | 'local_db' | 'known_papers'
  matched_fields: string[];
  checked_at: string;
  url?: string | null;
  doi?: string | null;
  title?: string | null;
  authors?: string[];
  year?: string | null;
  venue?: string | null;
  confidence?: number;
}

export interface StyleProfile {
  style: 'APA_LIKE' | 'IEEE_LIKE' | 'MIXED' | 'UNKNOWN';
  confidence: number;
  apa_count: number;
  ieee_count: number;
  mixed_count: number;
  features: Record<string, boolean | number>;
  ratios: Record<string, number>;
  explanation: string;
}

export interface MappingStatusSummary {
  matched: number;
  missing_reference: number;
  uncited_reference: number;
  in_text_mismatch: number;
  duplicate_reference: number;
  ambiguous_mapping: number;
  style_inconsistent: number;
  unresolved: number;
}

export interface OverrideRecord {
  overridden_at: string;
  previous_label?: ValidationLabel;
  previous_status?: CitationMappingStatus;
  new_label: ValidationLabel;
  new_status?: CitationMappingStatus;
  reason?: string;
  overridden_by?: string;
}

// --- Verdict (v1.2 — 2-layer) ---

export type UrlValidationStatus =
  | 'alive'
  | 'restricted_alive'
  | 'archived_alive'
  | 'dead_link'
  | 'fake_domain';

export interface Verdict {
  citation_id: string;
  citation_raw: string;
  citation_type?: CitationType;
  // NEW v1.5: surrounding sentence/paragraph context (from PDF extraction)
  // Optional — older cached reports may not have this field populated.
  context?: string;
  // Integrity layer (linking/)
  mapping_status: CitationMappingStatus;
  mapping_confidence: number;
  citation_links?: CitationLink[];
  /** First edge only — kept for older consumers; prefer `citation_links`. */
  citation_link?: CitationLink;
  style_penalty?: number;
  domain_exception?: boolean;
  // Source layer (retrieval/)
  label: ValidationLabel;
  confidence: number;
  reasoning: string;
  triggered_rules: string[];
  mismatched_fields: string[];
  /** May be absent for older cached reports — callers should default to []. */
  matched_sources: MatchedSource[];
  url_status?: UrlValidationStatus | null;
  url_status_code?: number | null;
  archive_url?: string | null;
  is_retracted?: boolean;
  features?: {
    title_sim_fuzzy?: number;
    title_sim_semantic?: number;
    author_jaccard?: number;
    year_distance?: number;
    doi_exact_match?: boolean;
    source_consensus?: number;
    venue_sim?: number;
    content_alignment_score?: number;
    content_alignment_confidence?: string;
    content_is_aligned?: boolean;
    title_context_sim?: number;
    abstract_context_sim?: number | null;
    best_evidence_sentence?: string | null;
    best_evidence_score?: number | null;
    best_cited_sentence?: string | null;
    citation_intent?: string | null;
    stance_label?: string | null;
    cross_lingual_detected?: boolean;
    bridged_concepts?: string[];
    cross_lingual_title_detected?: boolean;
    cross_lingual_title_sim?: number;
    context_source?: string | null;
    occurrence_alignments?: Array<{
      page: number;
      marker: string;
      focal_sentence: string;
      score: number;
      confidence: string;
      is_aligned: boolean;
      intent: string;
      stance: string;
      best_evidence_sentence?: string | null;
      cross_lingual_detected?: boolean;
      bridged_concepts?: string[];
    }>;
    url_status?: UrlValidationStatus | null;
    url_status_code?: number | null;
    archive_url?: string | null;
    is_retracted?: boolean;
    checked_url?: string | null;
    matched_sources?: MatchedSource[];
  };
  // Override / audit
  is_overridden: boolean;
  override_note?: string | null;
  override_record?: OverrideRecord;
}

// --- CIS ---

export interface CIS {
  score: number;
  components: Record<string, number>;
  weights_used: Record<string, number>;
  num_citations: number;
  num_unresolved: number;
  disclaimer: string;
}

// --- Full Report ---

export interface DocumentDiagnostics {
  is_scanned_pdf: boolean;
  scanned_pages_count: number;
  total_extractable_chars: number;
  avg_chars_per_page: number;
  warning_code?: string | null;
  warning_message?: string | null;
  parser_warnings?: string[];
}

export interface RevisionChangeItem {
  citation_raw: string;
  before_label: string;
  after_label: string;
  transition: string;
}

export interface RevisionDiffData {
  has_previous_revision: boolean;
  is_same_manuscript_family?: boolean;
  previous_essay_id?: number;
  previous_filename?: string;
  previous_uploaded_at?: string | null;
  current_essay_id: number;
  current_filename: string;
  current_uploaded_at?: string | null;
  cis_before?: number;
  cis_after?: number;
  cis_delta?: number;
  counts_before?: {
    total: number;
    verified: number;
    metadata_error: number;
    suspected_hallucination: number;
    unresolved: number;
  };
  counts_after?: {
    total: number;
    verified: number;
    metadata_error: number;
    suspected_hallucination: number;
    unresolved: number;
  };
  counts_delta?: {
    total: number;
    verified: number;
    metadata_error: number;
    suspected_hallucination: number;
    unresolved: number;
  };
  resolved_issues_count?: number;
  persisting_issues_count?: number;
  new_issues_count?: number;
  resolved_issues?: RevisionChangeItem[];
  persisting_issues?: RevisionChangeItem[];
  new_issues?: RevisionChangeItem[];
  citation_changes?: RevisionChangeItem[];
  available_revisions?: Array<{
    essay_id: number;
    filename: string;
    uploaded_at: string | null;
    cis_score: number;
    num_verdicts: number;
    is_same_stem: boolean;
  }>;
}

export interface SandboxAclPaperItem {
  index: number;
  paper_id?: number | null;
  title: string;
  authors: string[];
  authors_text: string;
  year: string;
  venue: string;
  doi: string;
  abstract?: string;
  source?: string;
  cite_in_text: boolean;
  include_in_references: boolean;
  in_text_year_override: string;
  in_text_context: string;
  mutation_preset?: string;
  preview_in_text_apa?: string;
  preview_reference?: string;
  original?: {
    title: string;
    authors_text: string;
    year: string;
    venue: string;
    doi: string;
  };
}

export interface SandboxAclSampleResponse {
  count: number;
  style: string;
  database_total_papers: number;
  items: SandboxAclPaperItem[];
}

export interface SandboxGeneratePdfResponse {
  essay_id: number;
  filename: string;
  num_pages: number;
  in_text_count: number;
  references_count: number;
  in_text_markers_preview: string[];
  references_preview: string[];
  pdf_base64: string;
  status: string;
}

export interface SandboxInstantVerdictItem {
  index: number;
  citation_raw: string;
  cited_title?: string | null;
  cited_authors?: string[];
  cited_year?: number | string | null;
  cited_venue?: string | null;
  cited_doi?: string | null;
  label: string;
  confidence: number;
  mapping_status: string;
  mapping_note: string;
  reasoning: string;
  triggered_rules: string[];
  mismatched_fields: string[];
  matched_source?: MatchedSource | null;
  sources_succeeded?: string[];
  used_local_db?: boolean;
}

export interface SandboxInstantVerifyResponse {
  elapsed_seconds: number;
  total: number;
  summary: {
    verified: number;
    metadata_error: number;
    suspected_hallucination: number;
    layer1_linking_issues: number;
  };
  results: SandboxInstantVerdictItem[];
  remediation?: RemediatedBibliographyResponse;
}

export interface AnalysisReport {
  essay_id: number;
  filename: string;
  num_pages: number;
  num_citations: number;
  num_references?: number;
  extracted_citations?: Citation[];
  // v1.2 new fields
  style_profile: StyleProfile;
  linking_summary: MappingStatusSummary;
  // Existing
  verdicts: Verdict[];
  references?: Citation[];
  cis: CIS;
  document_diagnostics?: DocumentDiagnostics;
  revision_diff?: RevisionDiffData | null;
  disclaimer: string;
}

// --- Progress snapshot (returned by GET /essays/{id}/status) ---

export interface EssayStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  step: string;          // one of the 8 step keys
  step_index: number;   // 0..7
  total_steps: number;
  message: string;
  citations_found: number;
  references_found: number;
  linked: number;
  /** Per-database status: 'ok' | 'partial' | 'failed:N' | 'pending' */
  sources_queried: Record<string, string>;
  elapsed_seconds: number;
  finished_at: number | null;
  error: string | null;
  document_diagnostics?: DocumentDiagnostics | null;
}

// --- Upload ---

export interface UploadResponse {
  essay_id: number;
  filename: string;
  num_pages: number;
  num_citations: number;
  citations: Citation[];
  summary: {
    cis_score: number | null;
    num_unresolved: number;
  };
}

export interface HealthResponse {
  status: string;
  version: string;
  disclaimer: string;
}

// --- Citation (from extraction) ---

export interface Citation {
  id?: number;
  raw_text: string;
  citation_type: CitationType;
  style: string;
  authors: string[];
  year?: string | null;
  title?: string | null;
  venue?: string | null;
  doi?: string | null;
  url?: string | null;
  page_num: number;
  confidence: number;
  // NEW v1.16 — surrounding PDF text of the citation, shown in the Document
  // Inspector. Optional — older reports have no context.
  context?: string | null;
  // NEW v1.7 — linking layer for Citations tab
  mapping_status?: CitationMappingStatus;
  mapping_confidence?: number;
  /**
   * NEW v1.9 — EVERY reference this occurrence cites. A single occurrence can
   * cite several at once ("[9, 10]" → ref-0009 AND ref-0010), so the scalar
   * ``citation_link`` below is only the first edge. Read this field; fall back
   * to ``[citation_link]`` for reports produced before v1.9.
   */
  citation_links?: CitationLink[];
  /** First edge only — kept for older consumers. Prefer ``citation_links``. */
  citation_link?: CitationLink;
  // NEW v1.8 — References tab: how often this reference entry is cited in
  // the body text (0 = never cited). ``cited_on_pages`` lists the 1-indexed
  // page numbers where those in-text occurrences were found.
  cited_in_text_count?: number;
  cited_on_pages?: number[];
}

// --- Override request ---

export interface OverrideRequest {
  verdict_id: string;
  new_label: ValidationLabel;
  new_mapping_status?: CitationMappingStatus;
  reason?: string;
}

// --- Essay list (matches backend /api/essays response) ---

export interface EssaySummary {
  id: number;
  filename: string;
  num_pages: number;
  uploaded_at: string;
  user_id: number;
  duplicate_ids?: number[];
  cis_score?: number | null;
  num_citations?: number;
  num_verdicts?: number;
  num_verified?: number;
}

// --- Aggregate essay stats (GET /essays/stats, contract C2) ---

export interface EssayStats {
  total_essays: number;
  total_citations: number;
  verified: number;
  metadata_error: number;
  suspected_hallucination: number;
  unresolved: number;
  resource: number;
}

// --- Cache stats (admin) ---

export interface CacheStats {
  total: number;
  by_source: Record<string, number>;
  total_hits: number;
  avg_hit_count: number;
}

export interface CacheClearResponse {
  deleted_count: number;
}

// --- Helpers ---

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.json();
}

/**
 * Auth-specific request helper that extracts human-readable FastAPI `detail`
 * messages instead of raw JSON strings.
 */
async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, init);
  if (!resp.ok) {
    let detail = `Request failed (HTTP ${resp.status})`;
    try {
      const contentType = resp.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const err = await resp.json();
        if (typeof err?.detail === 'string') {
          detail = err.detail;
        } else if (Array.isArray(err?.detail)) {
          detail =
            err.detail
              .map((d: { msg?: string }) => d?.msg)
              .filter(Boolean)
              .join('; ') || detail;
        } else if (typeof err?.message === 'string') {
          detail = err.message;
        }
      } else {
        const text = (await resp.text()).trim();
        if (text) detail = text;
      }
    } catch {
      // Keep fallback message
    }
    throw new Error(detail);
  }
  return resp.json();
}

/**
 * Fetch the analysis report, tolerating HTTP 425 (pipeline still running).
 * Returns null when the backend returns 425 so callers can detect "not ready yet".
 *
 * Accepts an optional `signal` (from AbortController) so polling callers can
 * cancel in-flight fetches on unmount or essayId change.
 */
async function getReportOrNull(
  id: number,
  options?: { signal?: AbortSignal },
): Promise<AnalysisReport | null> {
  const token = localStorage.getItem('token');
  const resp = await fetch(`${BASE_URL}/essays/${id}/report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: options?.signal,
  });
  if (resp.status === 425) {
    return null;  // still processing
  }
  if (!resp.ok) {
    throw new Error(`API ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

// --- Endpoints ---

// --- User types ---

export type PlanTier = 'basic' | 'pro' | 'ultra';
export type BillingCycle = 'monthly' | 'annual';

export interface UserQuota {
  monthly_uploads_used: number;
  monthly_uploads_limit: number;
  monthly_uploads_remaining: number;
  max_file_size_mb: number;
  max_pages_per_pdf: number;
  max_citations_per_essay: number;
  max_batch_files: number;
  allowed_export_formats: Array<'json' | 'csv' | 'pdf' | 'docx'>;
  allow_batch_upload: boolean;
  allow_deep_inspector: boolean;
  allow_serpapi_fallback: boolean;
  quota_reset_at: string;
}

export interface PlanCatalogItem {
  tier: PlanTier;
  name: string;
  tagline_en: string;
  tagline_vi: string;
  badge_en: string | null;
  badge_vi: string | null;
  highlighted: boolean;
  monthly_price_usd: number;
  annual_price_usd: number;
  annual_monthly_equiv_usd: number;
  annual_savings_usd: number;
  annual_discount_pct: number;
  max_uploads_per_month: number;
  max_file_size_mb: number;
  max_pages_per_pdf: number;
  max_citations_per_essay: number;
  max_batch_files: number;
  max_classes: number;
  history_retention_days: number;
  allowed_export_formats: string[];
  allow_batch_upload: boolean;
  allow_deep_inspector: boolean;
  allow_serpapi_fallback: boolean;
  priority_processing: boolean;
  features_en: string[];
  features_vi: string[];
  limitations_en: string[];
  limitations_vi: string[];
}

export interface SubscriptionSummary {
  plan_tier: PlanTier;
  plan_name: string;
  billing_cycle: BillingCycle | null;
  subscription_status: string;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  quota: UserQuota;
}

export type PaymentMethodType = 'card' | 'apple_pay' | 'google_pay' | 'vnpay';

export interface VNPayBankOption {
  code: string;
  name: string;
  type: 'qr' | 'atm' | 'intcard';
  logo_label?: string;
}

export interface VNPaySandboxTestCard {
  bank: string;
  card_number: string;
  card_holder: string;
  issue_date: string;
  otp: string;
  scenario: string;
  expected_response_code: string;
}

export interface VNPayCheckoutMetadata {
  enabled: boolean;
  version: string;
  tmn_code: string;
  curr_code: string;
  usd_to_vnd_rate: number;
  amount_vnd: number;
  vnp_amount: number;
  vnp_txn_ref: string | null;
  external_redirect?: boolean;
  supported_banks: VNPayBankOption[];
  sandbox_test_cards: VNPaySandboxTestCard[];
}

export interface VNPayPaymentUrlResponse {
  session_id: string;
  payment_url: string;
  vnp_txn_ref: string;
  vnp_amount: number;
  amount_vnd: number;
  amount_usd: number;
  usd_to_vnd_rate: number;
  bank_code: string | null;
  tmn_code: string;
  create_date: string;
  expire_date: string;
  order_info: string;
  external_redirect: boolean;
  vnp_params: Record<string, string>;
  supported_banks: VNPayBankOption[];
  sandbox_test_cards: VNPaySandboxTestCard[];
}

export interface VNPaySandboxAuthorizeResponse {
  status: string;
  is_verified: boolean;
  is_success: boolean;
  vnp_response_code: string;
  message_vi: string;
  message_en: string;
  vnp_txn_ref: string;
  vnp_transaction_no: string;
  vnp_bank_code: string;
  vnp_card_type: string;
  amount_vnd: number;
  vnp_params: Record<string, string>;
  return_url: string;
  transaction: BillingTransactionItem;
  subscription?: SubscriptionSummary;
  user?: User;
}

export interface BillingTransactionItem {
  id: number;
  user_id: number;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  plan_tier: PlanTier;
  plan_name: string;
  billing_cycle: BillingCycle;
  subtotal_usd?: number;
  discount_usd?: number;
  promo_code?: string | null;
  amount_usd: number;
  amount_vnd?: number;
  subtotal_vnd?: number;
  discount_vnd?: number;
  usd_to_vnd_rate?: number;
  currency: string;
  status: string;
  payment_mode: string;
  payment_method?: PaymentMethodType | string;
  card_brand: string | null;
  card_last4: string | null;
  billing_country?: string | null;
  billing_zip?: string | null;
  vnp_txn_ref?: string | null;
  vnp_transaction_no?: string | null;
  vnp_bank_code?: string | null;
  vnp_card_type?: string | null;
  vnp_response_code?: string | null;
  created_at: string | null;
  paid_at: string | null;
}

export interface CheckoutSessionResponse {
  session_id: string;
  checkout_url: string;
  mode: 'stripe_test' | 'stripe_demo';
  plan_tier: PlanTier;
  plan_name: string;
  billing_cycle: BillingCycle;
  subtotal_usd?: number;
  discount_usd?: number;
  promo_code?: string | null;
  amount_usd: number;
  amount_vnd?: number;
  usd_to_vnd_rate?: number;
  transaction_id: number;
}

export interface AppliedPromoDetails {
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_discount_usd: number | null;
  discount_usd: number;
}

export interface CheckoutSessionDetails {
  session_id: string;
  status: string;
  payment_mode: string;
  merchant_name: string;
  customer_email: string;
  customer_name: string;
  plan_tier: PlanTier;
  plan_name: string;
  billing_cycle: BillingCycle;
  subtotal_usd?: number;
  discount_usd?: number;
  promo_code?: string | null;
  promo_details?: AppliedPromoDetails | null;
  amount_usd: number;
  subtotal_vnd?: number;
  discount_vnd?: number;
  amount_vnd?: number;
  usd_to_vnd_rate?: number;
  monthly_equivalent_usd: number;
  annual_savings_usd: number;
  currency: string;
  supported_payment_methods?: string[];
  supported_card_brands?: string[];
  vnpay?: VNPayCheckoutMetadata;
  features_en: string[];
  features_vi: string[];
}

export interface PromoCodeItem {
  id: number;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_discount_usd: number | null;
  min_amount_usd: number;
  applicable_tiers: 'all' | 'pro' | 'ultra';
  applicable_cycles: 'all' | 'monthly' | 'annual';
  max_uses: number | null;
  max_uses_per_user: number;
  used_count: number;
  is_active: boolean;
  is_expired: boolean;
  is_exhausted: boolean;
  effective_status: 'active' | 'inactive' | 'expired' | 'exhausted';
  expires_at: string | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PromoSummaryStats {
  total_codes: number;
  active_codes: number;
  total_redemptions: number;
  total_discount_usd: number;
}

export interface PromoCodeCreatePayload {
  code?: string | null;
  description?: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  max_discount_usd?: number | null;
  min_amount_usd?: number;
  applicable_tiers?: 'all' | 'pro' | 'ultra';
  applicable_cycles?: 'all' | 'monthly' | 'annual';
  max_uses?: number | null;
  max_uses_per_user?: number;
  is_active?: boolean;
  expires_at?: string | null;
}

export interface PromoCodeUpdatePayload {
  description?: string | null;
  discount_type?: 'percent' | 'fixed';
  discount_value?: number;
  max_discount_usd?: number | null;
  min_amount_usd?: number;
  applicable_tiers?: 'all' | 'pro' | 'ultra';
  applicable_cycles?: 'all' | 'monthly' | 'annual';
  max_uses?: number | null;
  max_uses_per_user?: number;
  is_active?: boolean;
  expires_at?: string | null;
}

export interface User {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: 'user' | 'teacher' | 'admin';
  is_active: boolean;
  auth_provider?: string;
  google_linked?: boolean;
  has_password?: boolean;
  can_set_username?: boolean;
  needs_onboarding?: boolean;
  avatar_url: string | null;
  last_login_at: string | null;
  created_at: string | null;
  institution: string | null;
  can_override_verdicts: boolean;
  plan_tier?: PlanTier;
  billing_cycle?: BillingCycle | null;
  subscription_status?: string;
  cancel_at_period_end?: boolean;
  current_period_end?: string | null;
  quota?: UserQuota | null;
}

export interface GoogleConfigResponse {
  enabled: boolean;
  client_id: string | null;
}

export interface GoogleLoginPayload {
  credential?: string;
  access_token?: string;
  code?: string;
  redirect_uri?: string;
}

export interface UserCreate {
  username: string;
  password: string;
  email?: string | null;
  full_name?: string | null;
  role?: 'user' | 'teacher' | 'admin';
  is_active?: boolean;
  institution?: string | null;
  can_override_verdicts?: boolean;
}

export interface UserUpdate {
  username?: string | null;
  password?: string | null;
  email?: string | null;
  full_name?: string | null;
  role?: 'user' | 'teacher' | 'admin' | null;
  is_active?: boolean | null;
  institution?: string | null;
  can_override_verdicts?: boolean | null;
}

export interface UserSelfUpdate {
  username?: string | null;
  email?: string | null;
  full_name?: string | null;
  complete_onboarding?: boolean | null;
}

export interface PasswordChange {
  current_password?: string | null;
  new_password: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  full_name?: string;
  institution?: string;
  lang?: string;
}

export interface RegisterResponse {
  message: string;
  username: string;
  email: string;
  requires_activation: boolean;
  email_sent: boolean;
}

export interface ActivateAccountResponse {
  message: string;
  username: string;
  email: string;
  activated: boolean;
  already_active: boolean;
}

export interface VerifyResetTokenResponse {
  valid: boolean;
  username?: string | null;
  email?: string | null;
  reason?: string | null;
  message: string;
}

// --- Class types (v1.15 / Phase 3) ---

export interface Class {
  id: number;
  name: string;
  description: string | null;
  join_code?: string | null;
  teacher_id: number;
  teacher_username: string;
  created_at: string;
  student_count: number;
  essay_count: number;
}

export interface SharedHallucinationItem {
  citation_raw: string;
  label: string;
  student_count: number;
  occurrence_count: number;
  students: string[];
  essay_ids: number[];
  is_shared: boolean;
}

export interface TriggeredRuleStat {
  rule_id: string;
  count: number;
}

export interface ClassAnalytics {
  class_id: number;
  class_name: string;
  join_code?: string | null;
  total_students: number;
  total_essays: number;
  avg_cis: number;
  recency_5yr_ratio: number;
  cis_distribution: Record<string, number>;
  verdict_breakdown: Record<string, number>;
  top_triggered_rules: TriggeredRuleStat[];
  shared_hallucinations: SharedHallucinationItem[];
}

export interface ClassCreate {
  name: string;
  description?: string;
}

export interface ClassStudent {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
}

export interface ClassEssay {
  id: number;
  filename: string;
  uploaded_at: string;
  user_id: number | null;
  username: string | null;
  num_pages: number;
}

export interface TeacherDashboard {
  total_classes: number;
  total_students: number;
  total_essays: number;
  pending_reviews: number;
  classes: Class[];
}

// --- Phase 4: Teacher pending reviews + Admin system health/audit ---

export interface PendingVerdict {
  verdict_id: number;
  essay_id: number;
  filename: string;
  student_username: string | null;
  citation_raw?: string;
  label: string;
  confidence: number;
  reasoning: string;
  validated_at: string;
}

export interface SystemHealth {
  status: string;
  totals: {
    users: number;
    admins: number;
    teachers: number;
    students: number;
    essays: number;
    verdicts: number;
  };
  verdict_label_counts: Record<string, number>;
  cache_stats: Record<string, unknown>;
  /** Optional per-service status map (e.g. grobid: "ok" | "degraded" | "down"). */
  services?: Record<string, string | { status?: string; detail?: string }>;
}

export interface AuditLogEntry {
  id: number;
  verdict_id: number;
  /** Essay owning the verdict (newer backends); enables deep links to the report. */
  essay_id?: number | null;
  original_label: string;
  new_label: string;
  user: string;
  note: string | null;
  logged_at: string | null;
}

// --- Endpoints ---

export interface RemediatedBibliographyEntry {
  index: number;
  verdict_id: string;
  label: string;
  remediation_status?: 'verified' | 'repaired' | 'hallucination';
  is_error?: boolean;
  is_hallucination?: boolean;
  reasoning?: string;
  source_used: string | null;
  original_raw: string;
  remediated_text: string;
  apa: string;
  ieee: string;
  tdtu: string;
  bibtex: string;
  ris: string;
  diff_fields: string[];
  was_modified: boolean;
  canonical_metadata: {
    title: string;
    authors: string[];
    year: string;
    venue: string;
    doi: string;
    url: string;
  };
}

export interface RemediatedBibliographyResponse {
  essay_id: number;
  style: 'apa' | 'ieee' | 'tdtu' | 'bibtex' | 'ris';
  total_entries: number;
  remediated_count: number;
  hallucination_count?: number;
  error_count?: number;
  entries: RemediatedBibliographyEntry[];
  combined_text: string;
  combined_bibtex: string;
  combined_ris: string;
}

export const api = {
  // Public authentication flows (register, activate, forgot/reset password, google oauth)
  getGoogleConfig: () =>
    authRequest<GoogleConfigResponse>('/auth/google/config'),
  googleLogin: (data: GoogleLoginPayload) =>
    authRequest<{ token: string; user: User }>('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  register: (data: RegisterPayload) =>
    authRequest<RegisterResponse>('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  activateAccount: (token: string) =>
    authRequest<ActivateAccountResponse>('/auth/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  resendActivation: (identifier: string, lang: string = 'vi') =>
    authRequest<{ message: string }>('/auth/resend-activation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, lang }),
    }),
  forgotPassword: (email: string, lang: string = 'vi') =>
    authRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, lang }),
    }),
  verifyResetToken: (token: string) =>
    authRequest<VerifyResetTokenResponse>(
      `/auth/verify-reset-token?token=${encodeURIComponent(token)}`,
    ),
  resetPassword: (data: { token: string; new_password: string; lang?: string }) =>
    authRequest<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // User management (admin)
  listUsers: () => request<User[]>('/users'),
  createUser: (data: UserCreate) =>
    request<User>('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateUser: (id: number, data: UserUpdate) =>
    request<User>(`/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteUser: (id: number) =>
    request<{ message: string }>(`/users/${id}`, { method: 'DELETE' }),

  // Self-service
  updateMe: (data: UserSelfUpdate) =>
    request<User>('/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  uploadMyAvatar: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<User>('/users/me/avatar', { method: 'POST', body: fd });
  },
  deleteMyAvatar: () => request<User>('/users/me/avatar', { method: 'DELETE' }),
  changeMyPassword: async (data: PasswordChange) => {
    const res = await request<{ message: string; token?: string | null }>(
      '/users/me/password',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    );
    if (res?.token) {
      localStorage.setItem('token', res.token);
    }
    return res;
  },
  sendPasswordSetupEmail: (lang: string = 'vi') =>
    request<{ message: string }>('/users/me/password-setup-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    }),

  // Teacher (v1.15 / Phase 3) — requires teacher or admin role
  listMyClasses: () => request<Class[]>('/teacher/classes'),
  createClass: (data: ClassCreate) =>
    request<Class>('/teacher/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  regenerateClassCode: (classId: number) =>
    request<Class>(`/teacher/classes/${classId}/regenerate-code`, {
      method: 'POST',
    }),
  listEnrolledClasses: () => request<Class[]>('/teacher/enrolled-classes'),
  joinClassByCode: (joinCode: string) =>
    authRequest<Class>('/teacher/classes/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
      },
      body: JSON.stringify({ join_code: joinCode }),
    }),
  getClassAnalytics: (classId: number) =>
    request<ClassAnalytics>(`/teacher/classes/${classId}/analytics`),
  listStudents: (q?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (q && q.trim()) params.set('q', q.trim());
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return request<ClassStudent[]>(`/teacher/students${qs ? `?${qs}` : ''}`);
  },
  listAvailableStudents: (q?: string, limit?: number) =>
    api.listStudents(q, limit),
  listClassStudents: (classId: number) =>
    request<ClassStudent[]>(`/teacher/classes/${classId}/students`),
  addStudentToClass: (classId: number, studentId: number) =>
    request<{ message: string }>(`/teacher/classes/${classId}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId }),
    }),
  removeStudentFromClass: (classId: number, studentId: number) =>
    request<{ message: string }>(
      `/teacher/classes/${classId}/students/${studentId}`,
      { method: 'DELETE' },
    ),
  listClassEssays: (classId: number) =>
    request<ClassEssay[]>(`/teacher/classes/${classId}/essays`),
  getTeacherDashboard: () => request<TeacherDashboard>('/teacher/dashboard'),
  listPendingReviews: (classId: number) =>
    request<PendingVerdict[]>(`/teacher/classes/${classId}/pending-reviews`),
  getSystemHealth: () => request<SystemHealth>('/system/health'),
  listAuditLog: (
    params: { limit?: number; offset?: number; user?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    if (params.user) qs.set('user', params.user);
    return request<AuditLogEntry[]>(`/audit/log?${qs.toString()}`);
  },
  exportClassCSV: (classId: number) =>
    `${BASE_URL}/teacher/classes/${classId}/export.csv`,


  uploadEssay: (file: File, classId?: number | null) => {
    const fd = new FormData();
    fd.append('file', file);
    if (classId != null) {
      fd.append('class_id', String(classId));
    }
    return request<UploadResponse>('/essays', {
      method: 'POST',
      body: fd,
    });
  },

  /**
   * Fetch the analysis report. Returns null if the pipeline is still running
   * (HTTP 425) — callers should poll via getEssayStatus until this returns a
   * non-null value, then navigate to the report page.
   */
  getEssay: (id: number, options?: { signal?: AbortSignal }) =>
    getReportOrNull(id, options),

  /**
   * Real-time pipeline progress snapshot. Use this to drive the ProcessingScreen
   * stepper and per-source status tiles while the analysis runs.
   */
  getEssayStatus: (id: number, options?: { signal?: AbortSignal }) =>
    request<EssayStatus>(`/essays/${id}/status`, { signal: options?.signal }),

  // Essay list & delete (used by Dashboard, History)
  listEssays: () => request<EssaySummary[]>('/essays'),
  /** Server-side aggregate over every essay visible to the caller (contract C2). */
  getEssayStats: () => request<EssayStats>('/essays/stats'),
  deleteEssay: (id: number) =>
    request<{ message: string }>(`/essays/${id}`, { method: 'DELETE' }),

  // Cache management (admin)
  clearCache: () =>
    request<CacheClearResponse>('/cache', { method: 'DELETE' }),

  getRemediatedBibliography: (
    id: number,
    style: 'apa' | 'ieee' | 'tdtu' | 'bibtex' | 'ris' = 'apa',
  ) =>
    request<RemediatedBibliographyResponse>(
      `/essays/${id}/remediate?style=${encodeURIComponent(style)}`,
    ),

  fetchEssayPagePreviewUrl: async (
    id: number,
    pageNum: number,
    highlight?: string,
  ): Promise<string> => {
    const token = localStorage.getItem('token');
    const qs = highlight ? `?highlight=${encodeURIComponent(highlight)}` : '';
    const resp = await fetch(
      `${BASE_URL}/essays/${id}/page-preview/${Math.max(1, pageNum)}${qs}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${await resp.text()}`);
    }
    const blob = await resp.blob();
    return window.URL.createObjectURL(blob);
  },

  downloadReportFile: async (
    id: number,
    format: 'json' | 'csv' | 'pdf' | 'docx' = 'json',
    baseFilename?: string,
  ): Promise<void> => {
    const token = localStorage.getItem('token');
    const resp = await fetch(`${BASE_URL}/essays/${id}/report?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${await resp.text()}`);
    }
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cleanName = (baseFilename || `essay_${id}`).replace(/\.[^/.]+$/, '');
    link.href = url;
    link.download = `${cleanName}_report.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  downloadAutoHealedDocx: async (
    id: number,
    style: 'apa' | 'ieee' = 'apa',
    baseFilename?: string,
  ): Promise<void> => {
    const token = localStorage.getItem('token');
    const resp = await fetch(
      `${BASE_URL}/essays/${id}/export-healed-docx?style=${encodeURIComponent(style)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${await resp.text()}`);
    }
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cleanName = (baseFilename || `essay_${id}`).replace(/\.[^/.]+$/, '');
    link.href = url;
    link.download = `${cleanName}_auto_healed.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  getRevisionDiff: (id: number, compareWithId?: number) => {
    const qs = compareWithId ? `?compare_with=${compareWithId}` : '';
    return request<RevisionDiffData>(`/essays/${id}/revision-diff${qs}`);
  },

  sampleSandboxAclPapers: (count: number = 12, style: 'apa' | 'ieee' = 'apa') =>
    request<SandboxAclSampleResponse>(
      `/essays/sandbox/acl-sample?count=${count}&style=${encodeURIComponent(style)}`,
    ),

  generateSandboxPdfManuscript: (payload: {
    title?: string;
    author_name?: string;
    style?: 'apa' | 'ieee';
    items: SandboxAclPaperItem[];
    run_verification?: boolean;
    download_only?: boolean;
    filename?: string;
  }) =>
    request<SandboxGeneratePdfResponse>('/essays/sandbox/generate-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  downloadSandboxPdfManuscript: async (payload: {
    title?: string;
    author_name?: string;
    style?: 'apa' | 'ieee';
    items: SandboxAclPaperItem[];
    filename?: string;
  }): Promise<void> => {
    const token = localStorage.getItem('token');
    const resp = await fetch(`${BASE_URL}/essays/sandbox/generate-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...payload,
        download_only: true,
        run_verification: false,
      }),
    });
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${await resp.text()}`);
    }
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      payload.filename ||
      `CITRA_ACL_Sandbox_${(payload.style || 'apa').toUpperCase()}_${payload.items.length}refs.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  verifySandboxCitationsInstant: (payload: {
    style?: 'apa' | 'ieee';
    items?: SandboxAclPaperItem[];
    references_text?: string;
    claim_context?: string;
  }) =>
    request<SandboxInstantVerifyResponse>('/essays/sandbox/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  overrideVerdict: (id: number, body: OverrideRequest) =>
    request<Verdict>(`/essays/${id}/verdicts/${body.verdict_id}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Billing & Subscriptions (v2.2 / v2.4 Multi-Payment & Promo Codes)
  getBillingPlans: () =>
    request<{
      plans: PlanCatalogItem[];
      current_subscription: SubscriptionSummary | null;
    }>('/billing/plans'),
  getMySubscription: () =>
    request<{
      subscription: SubscriptionSummary;
      transactions: BillingTransactionItem[];
    }>('/billing/subscription'),
  createCheckoutSession: (data: {
    plan_tier: 'pro' | 'ultra';
    billing_cycle: BillingCycle;
    force_demo?: boolean;
    promo_code?: string | null;
  }) =>
    request<CheckoutSessionResponse>('/billing/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  getCheckoutSessionDetails: (sessionId: string) =>
    request<CheckoutSessionDetails>(
      `/billing/checkout-session/${encodeURIComponent(sessionId)}`,
    ),
  validatePromoCode: (data: {
    code: string;
    plan_tier: 'pro' | 'ultra';
    billing_cycle: BillingCycle;
  }) =>
    authRequest<{
      valid: boolean;
      code: string;
      description: string | null;
      discount_type: 'percent' | 'fixed';
      discount_value: number;
      max_discount_usd: number | null;
      subtotal_usd: number;
      discount_usd: number;
      final_amount_usd: number;
    }>('/billing/promo/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
      },
      body: JSON.stringify(data),
    }),
  applyCheckoutSessionPromo: (sessionId: string, code: string | null) =>
    authRequest<CheckoutSessionDetails>(
      `/billing/checkout-session/${encodeURIComponent(sessionId)}/promo`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('token')
            ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
            : {}),
        },
        body: JSON.stringify({ code }),
      },
    ),
  verifyCheckoutSession: (data: {
    session_id: string;
    payment_method?: PaymentMethodType;
    card_last4?: string;
    card_brand?: string;
    billing_country?: string;
    billing_zip?: string;
    promo_code?: string | null;
  }) =>
    request<{
      status: string;
      message: string;
      transaction: BillingTransactionItem;
      subscription: SubscriptionSummary;
      user: User;
    }>('/billing/verify-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  createVNPayPaymentUrl: (data: {
    session_id: string;
    bank_code?: string | null;
    locale?: 'vn' | 'en';
    return_url?: string | null;
  }) =>
    authRequest<VNPayPaymentUrlResponse>('/billing/vnpay/create-payment-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
      },
      body: JSON.stringify(data),
    }),
  authorizeVNPaySandbox: (data: {
    session_id: string;
    bank_code?: string;
    payment_channel?: 'atm' | 'qr' | 'intcard';
    card_number?: string;
    card_holder?: string;
    issue_date?: string;
    otp_code?: string;
    simulate_response_code?: string | null;
  }) =>
    authRequest<VNPaySandboxAuthorizeResponse>(
      '/billing/vnpay/sandbox-authorize',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localStorage.getItem('token')
            ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
            : {}),
        },
        body: JSON.stringify(data),
      },
    ),
  verifyVNPayReturn: (data: {
    vnp_params: Record<string, string>;
    session_id?: string | null;
  }) =>
    authRequest<{
      status: string;
      is_verified: boolean;
      is_success: boolean;
      vnp_response_code: string;
      message: string;
      message_vi: string;
      message_en: string;
      transaction: BillingTransactionItem;
      subscription: SubscriptionSummary;
      user: User;
    }>('/billing/vnpay/verify-return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
      },
      body: JSON.stringify(data),
    }),
  cancelSubscription: (immediate: boolean = false) =>
    request<{
      message: string;
      subscription: SubscriptionSummary;
      user: User;
    }>('/billing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate }),
    }),
  reactivateSubscription: () =>
    request<{
      message: string;
      subscription: SubscriptionSummary;
      user: User;
    }>('/billing/reactivate', {
      method: 'POST',
    }),

  // Admin Promo Code Management
  listAdminPromoCodes: () =>
    request<{
      stats: PromoSummaryStats;
      promos: PromoCodeItem[];
    }>('/billing/admin/promos'),
  generateAdminPromoCode: () =>
    request<{ code: string }>('/billing/admin/promos/generate-code'),
  createAdminPromoCode: (data: PromoCodeCreatePayload) =>
    authRequest<PromoCodeItem>('/billing/admin/promos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
      },
      body: JSON.stringify(data),
    }),
  updateAdminPromoCode: (id: number, data: PromoCodeUpdatePayload) =>
    authRequest<PromoCodeItem>(`/billing/admin/promos/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
      },
      body: JSON.stringify(data),
    }),
  deleteAdminPromoCode: (id: number) =>
    request<{ message: string; deleted_id: number; code: string }>(
      `/billing/admin/promos/${id}`,
      { method: 'DELETE' },
    ),
};
