/**
 * Canonical bilingual copywriting, pipeline topology, Loupe bounds, and empirical v3.75.2
 * metrics shared across all 13 scenes and validated by automated unit tests.
 */

export type SceneCopyDef = {
  id: string;
  index?: string;
  eyebrow: string;
  headlinesEn: readonly string[];
  captionVi: string;
  tagVi?: string;
};

export const ACT1_SCENES = {
  hook: {
    id: 'hook',
    eyebrow: 'THE GENERATIVE CITATION CRISIS',
    headlinesEn: [
      'AI writes fluent citations in seconds.',
      'Some of them *never *existed.',
      'So who verifies the *truth?',
    ],
    captionVi:
      'AI tạo hàng chục trích dẫn trôi chảy trong tích tắc — nhưng nhiều nguồn hoàn toàn hư cấu hoặc đã bị rút bỏ.',
    tagVi: 'THỰC TRẠNG HỌC THUẬT',
  },
  reveal: {
    id: 'reveal',
    eyebrow: 'CITRA v3.75.2 · NEURO-SYMBOLIC AI',
    headlinesEn: ['Verify every citation. *Trace *every *source.'],
    captionVi:
      'Nền tảng Kiểm chứng & Truy vết Trích dẫn Học thuật Neuro-Symbolic có Giải thích.',
    tagVi: 'KIẾN TRÚC v3.75.2',
  },
} as const satisfies Record<string, SceneCopyDef>;

export const ACT2_SCENES = {
  ingest: {
    id: 'ingest',
    index: '01',
    eyebrow: 'DOCUMENT INGESTION & LAYER 1 LINKING',
    headlinesEn: ['Drop any manuscript. *Link *every *reference.'],
    captionVi:
      'Bóc tách PDF hai cột, DOCX, BibTeX · Đối sánh hai chiều trích dẫn qua 12 chuẩn quốc tế & văn bản pháp luật Việt Nam.',
    tagVi: 'GROBID TEI-XML · 12 CHUẨN',
  },
  architecture: {
    id: 'architecture',
    index: '02',
    eyebrow: 'FEDERATED NEURO-SYMBOLIC ARCHITECTURE',
    headlinesEn: ['8-stage pipeline. *15+ *global *scholarly *indexes.'],
    captionVi:
      'Định tuyến đa luồng theo lĩnh vực qua 15+ CSDL học thuật quốc tế, kho 128K+ bài báo nội bộ & bắc cầu ngữ nghĩa Đa ngữ.',
    tagVi: '8-STAGE SSE · 128,717 LOCAL FTS5',
  },
} as const satisfies Record<string, SceneCopyDef>;

export type PipelineStageNode = {
  step: string;
  code: string;
  detail: string;
  color: string;
};

export const PIPELINE_STAGES: readonly PipelineStageNode[] = [
  { step: '01', code: 'GROBID TEI', detail: '2-Col PDF · DOCX · OCR', color: '#3CE09B' },
  { step: '02', code: '12-Style Lock', detail: 'APA · IEEE · VN Legal', color: '#3CE09B' },
  { step: '03', code: 'L1 Linker', detail: 'Bipartite In-Text ⇄ Bib', color: '#38BDF8' },
  { step: '04', code: '15+ API Router', detail: 'Domain-Aware Async', color: '#38BDF8' },
  { step: '05', code: 'SBERT + VI↔EN', detail: 'Cross-Lingual ONNX', color: '#9B7BFF' },
  { step: '06', code: 'R01–R30 Rules', detail: '30 Symbolic Families', color: '#F6AD3C' },
  { step: '07', code: '16D HybridML', detail: 'Gradient-Boosted Fusion', color: '#9B7BFF' },
  { step: '08', code: 'Platt Verdict', detail: 'ECE 0.0433 Calibrated', color: '#3CE09B' },
];

export type ScholarlyApiNode = {
  name: string;
  domain: string;
  ring: 'inner' | 'outer';
  angleDeg: number;
  accent: string;
};

export const SCHOLARLY_APIS: readonly ScholarlyApiNode[] = [
  // Inner Ring (6 Core High-Throughput Hubs)
  { name: '128K+ Local FTS5', domain: '128,717 Offline Papers', ring: 'inner', angleDeg: -90, accent: '#3CE09B' },
  { name: 'Crossref', domain: '150M+ DOI Records', ring: 'inner', angleDeg: -30, accent: '#38BDF8' },
  { name: 'OpenAlex', domain: '250M+ Works Graph', ring: 'inner', angleDeg: 30, accent: '#3CE09B' },
  { name: 'Semantic / SBERT', domain: 'Abstract NLI Bridge', ring: 'inner', angleDeg: 90, accent: '#9B7BFF' },
  { name: 'Retraction Watch', domain: '50K+ Retracted DOIs', ring: 'inner', angleDeg: 150, accent: '#F25549' },
  { name: 'arXiv + DBLP', domain: 'CS · Physics · Math', ring: 'inner', angleDeg: 210, accent: '#38BDF8' },
  // Outer Ring (10 Specialized Domain & Archival Indexes => 16 total nodes = Local + 15+ External)
  { name: 'OpenLibrary', domain: 'ISBN Monographs', ring: 'outer', angleDeg: -168, accent: '#9B7BFF' },
  { name: 'PubMed / NCBI', domain: 'Biomedical', ring: 'outer', angleDeg: -138, accent: '#3CE09B' },
  { name: 'Europe PMC', domain: 'Life Sciences', ring: 'outer', angleDeg: -108, accent: '#38BDF8' },
  { name: 'DataCite', domain: 'Research Datasets', ring: 'outer', angleDeg: -72, accent: '#38BDF8' },
  { name: 'DOAJ', domain: 'Open Access Journals', ring: 'outer', angleDeg: -40, accent: '#3CE09B' },
  { name: 'OpenAIRE / HAL', domain: 'EU & FR Repositories', ring: 'outer', angleDeg: -8, accent: '#9B7BFF' },
  { name: 'HuggingFace', domain: 'ML Papers & Models', ring: 'outer', angleDeg: 24, accent: '#F6AD3C' },
  { name: 'VN Legal Corpus', domain: 'Luật · Nghị định · TCVN', ring: 'outer', angleDeg: 78, accent: '#3CE09B' },
  { name: 'IETF RFC', domain: 'Network Standards', ring: 'outer', angleDeg: 114, accent: '#38BDF8' },
  { name: 'Wayback Machine', domain: 'CDX Link Preservation', ring: 'outer', angleDeg: 146, accent: '#F6AD3C' },
];

export const ACT3_SCENES = {
  hallucination: {
    id: 'hallucination',
    index: '03',
    eyebrow: 'AI HALLUCINATION & CHIMERIC FORENSICS',
    headlinesEn: ['Expose AI hallucinations with *zero *guesswork.'],
    captionVi:
      'Bắt trọn DOI giả mạo & trích dẫn ghép nối tinh vi (Chimeric LLM) bằng đối chứng đa nguồn.',
    tagVi: '0 / 15+ CSDL · R-FABRICATED-DOI',
  },
  retraction: {
    id: 'retraction',
    index: '04',
    eyebrow: 'RETRACTION WATCH & LINK PRESERVATION',
    headlinesEn: ['Retracted papers & \\n link rot, *caught *instantly.'],
    captionVi:
      'Cảnh báo bài báo bị rút (Retraction Watch) & phân biệt thông minh link hỏng thật với bản lưu Wayback Machine.',
    tagVi: 'RETRACTION WATCH · WAYBACK CDX',
  },
  trace: {
    id: 'trace',
    index: '05',
    eyebrow: 'EXPLAINABLE NEURO-SYMBOLIC XAI',
    headlinesEn: ['No black box. *Every *verdict *explained.'],
    captionVi:
      'Giải thích tường minh từng bước suy diễn R01–R30, độ tương đồng ngữ nghĩa Abstract và cây bằng chứng DAG.',
    tagVi: '5-STAGE TRACE · EVIDENCE DAG',
  },
  autofix: {
    id: 'autofix',
    index: '06',
    eyebrow: '1-CLICK REMEDIATION & TAMPER-EVIDENT SEAL',
    headlinesEn: ['One-click remediation. *Tamper-evident *export.'],
    captionVi:
      'Tự động chuẩn hóa danh mục tài liệu tham khảo, xuất file Word đã sửa lỗi kèm chứng thực số QR chống giả mạo.',
    tagVi: 'AUTO-HEALED .DOCX · ISO QR RECEIPT',
  },
} as const satisfies Record<string, SceneCopyDef>;

export type RegisteredLoupe = {
  sceneId: string;
  rect: [number, number, number, number];
  badge: string;
  captionVi: string;
};

export const ACT3_LOUPES: readonly RegisteredLoupe[] = [
  {
    sceneId: 'hallucination',
    rect: [0.552, 0.575, 0.405, 0.148],
    badge: '0 / 15+ DATABASES MATCHED',
    captionVi: 'Đối chiếu đồng thời 15+ CSDL quốc tế & 128K+ bài nội bộ: 0 bản ghi tồn tại.',
  },
  {
    sceneId: 'hallucination',
    rect: [0.552, 0.828, 0.405, 0.088],
    badge: 'RULE R-FABRICATED-DOI · TRIGGERED',
    captionVi: 'Kích hoạt luật hình thức R-FABRICATED-DOI: Tiền tố 10.9999/* giả mạo.',
  },
  {
    sceneId: 'retraction',
    rect: [0.555, 0.315, 0.4, 0.075],
    badge: '⚠ OFFICIALLY RETRACTED · THE LANCET',
    captionVi: 'Cảnh báo đỏ từ Retraction Watch dù tiêu đề và tác giả khớp 100%.',
  },
  {
    sceneId: 'autofix',
    rect: [0.525, 0.208, 0.305, 0.085],
    badge: '✓ AUTO-REPAIRED CANONICAL APA 7TH',
    captionVi: 'Tự động điền đầy đủ Metadata chuẩn xác từ Crossref & OpenAlex.',
  },
];

export const ACT4_SCENES = {
  educator: {
    id: 'educator',
    index: '07',
    eyebrow: 'EDUCATOR & COMMITTEE COMMAND CENTER',
    headlinesEn: ['Cohort-wide radar for *committees *& *educators.'],
    captionVi:
      'Radar phát hiện ảo giác AI trùng lặp toàn khóa, hàng đợi thẩm định cho giảng viên & nhật ký kiểm toán bất biến.',
    tagVi: 'COHORT RADAR · FACULTY OVERRIDE',
  },
  ecosystem: {
    id: 'ecosystem',
    index: '08',
    eyebrow: 'UNIFIED PRODUCTION ECOSYSTEM',
    headlinesEn: ['One unified workspace. *Built *for *production.'],
    captionVi:
      'Từ Live Sandbox thử nghiệm tức thì, kiểm chứng hàng loạt khóa luận 100+ trang đến giám sát vận hành thời gian thực.',
    tagVi: '8 LIVE WORKSPACES · SANDBOX TO ADMIN',
  },
} as const satisfies Record<string, SceneCopyDef>;

export const ACT5_SCENES = {
  ablation: {
    id: 'ablation',
    index: '09',
    eyebrow: 'EMPIRICAL BENCHMARK & ABLATION STUDY',
    headlinesEn: ['Proven on *120,000 *papers. Zero false accusations.'],
    captionVi:
      'Kiểm định độc lập không rò rỉ dữ liệu: vượt xa thuần SBERT +33.7%, đạt 100% F1 bắt ảo giác và 0% kết oan bài thật.',
    tagVi: '0% DATA LEAKAGE · HELD-OUT N = 18,000',
  },
  scale: {
    id: 'scale',
    index: '10',
    eyebrow: 'SOFTWARE ENGINEERING & AUDIT SCALE',
    headlinesEn: ['Engineered at *research *& *production *scale.'],
    captionVi:
      'Kiểm toán thực chiến trên 1.064 tệp PDF đa chuẩn, vận hành trên 228.000+ dòng mã nguồn & 2.205+ bài test tự động.',
    tagVi: '1,064 REAL PDFS · 228K+ LOC · 2,205+ TESTS',
  },
  endcard: {
    id: 'endcard',
    eyebrow: 'CITRA v3.75.2 · ACADEMIC INTEGRITY PLATFORM',
    headlinesEn: ['Verify every citation. *Trace *every *source.'],
    captionVi: 'Kiểm chứng mọi trích dẫn. Truy vết mọi nguồn học thuật.',
    tagVi: 'TON DUC THANG UNIVERSITY · 2026',
  },
} as const satisfies Record<string, SceneCopyDef>;

export type BentoTileSpec = {
  code: string;
  src: string;
  title: string;
  subtitleVi: string;
  url: string;
  cx: number;
  cy: number;
  w: number;
};

export const BENTO_TILES: readonly BentoTileSpec[] = [
  {
    code: '01',
    src: 'sandbox-loaded',
    title: 'Live ACL Citation Sandbox',
    subtitleVi: 'Tạo & tiêm lỗi kiểm thử tức thì từ 128K+ bài ACL',
    url: 'citra.io.vn/sandbox',
    cx: 0.58,
    cy: 0.44,
    w: 0.82,
  },
  {
    code: '02',
    src: 'report-thesis',
    title: '100-Page Thesis Inspector',
    subtitleVi: 'Thẩm định khóa luận 100 trang · 46 trích dẫn',
    url: 'citra.io.vn/report/14',
    cx: 0.58,
    cy: 0.46,
    w: 0.82,
  },
  {
    code: '03',
    src: 'report-document',
    title: 'In-Place Manuscript Viewer',
    subtitleVi: 'Đối chiếu trực tiếp ngữ cảnh trích dẫn trong bài',
    url: 'citra.io.vn/report/33/document',
    cx: 0.58,
    cy: 0.48,
    w: 0.82,
  },
  {
    code: '04',
    src: 'report-issues',
    title: 'Diagnostic Issue Triage',
    subtitleVi: 'Phân loại mức độ nghiêm trọng theo luật R01–R30',
    url: 'citra.io.vn/report/33/issues',
    cx: 0.58,
    cy: 0.46,
    w: 0.82,
  },
  {
    code: '05',
    src: 'batch',
    title: 'Batch Cohort Verification',
    subtitleVi: 'Xử lý song song hàng chục đồ án cùng lúc',
    url: 'citra.io.vn/batch-upload',
    cx: 0.58,
    cy: 0.48,
    w: 0.82,
  },
  {
    code: '06',
    src: 'dashboard',
    title: 'Analytics Workspace',
    subtitleVi: 'Theo dõi chỉ số toàn vẹn CIS theo thời gian',
    url: 'citra.io.vn/dashboard',
    cx: 0.58,
    cy: 0.45,
    w: 0.82,
  },
  {
    code: '07',
    src: 'admin-system',
    title: 'System Health & Circuit Breakers',
    subtitleVi: 'Giám sát độ trễ 15+ API & trạng thái GROBID',
    url: 'citra.io.vn/admin/system',
    cx: 0.58,
    cy: 0.45,
    w: 0.82,
  },
  {
    code: '08',
    src: 'pricing',
    title: 'University & Research Tiers',
    subtitleVi: ' Triển khai linh hoạt cho sinh viên, khoa & trường',
    url: 'citra.io.vn/pricing',
    cx: 0.52,
    cy: 0.46,
    w: 0.88,
  },
];

export const ABLATION_BENCHMARK = {
  totalPapers: 120000,
  trainPapers: 84000,
  valPapers: 18000,
  heldOutTest: 18000,
  neuroSymbolicAcc: 98.58,
  hybridMlAcc: 99.86,
  pureSbertAcc: 64.85,
  hallucinationF1: 100.0,
  hallucinationCaught: '5,400 / 5,400',
  falseAccusations: 0,
  plattEce: 0.0433,
  uncalibratedEce: 0.2124,
  bars: [
    {
      code: 'B0',
      label: 'DOI-Only Exact Lookup',
      note: 'Misses untagged & preprint citations',
      acc: 30.19,
      color: '#52605A',
      hero: false,
    },
    {
      code: 'B3',
      label: 'Pure Sentence-BERT (Neural Only)',
      note: 'Fooled by plausible-sounding AI hallucinations',
      acc: 64.85,
      color: '#8B7AE8',
      hero: false,
    },
    {
      code: 'B1',
      label: 'Single-Source Crossref REST',
      note: 'Blind to arXiv, DBLP, Books & VN Legal',
      acc: 69.66,
      color: '#3898EC',
      hero: false,
    },
    {
      code: 'B2',
      label: 'Lexical Title + Author Fuzzy',
      note: 'Fragile on chimeric author/year swaps',
      acc: 78.28,
      color: '#38BDF8',
      hero: false,
    },
    {
      code: 'NS',
      label: 'CITRA Neuro-Symbolic (R01–R30 + SBERT)',
      note: '+33.73% over Pure SBERT · Deterministic XAI',
      acc: 98.58,
      color: '#3CE09B',
      hero: true,
    },
    {
      code: 'ML',
      label: 'CITRA 16D HybridML Fusion',
      note: 'Gradient-Boosted 16-Feature Neuro-Symbolic SOTA',
      acc: 99.86,
      color: '#3CE09B',
      hero: true,
    },
  ],
} as const;

export const ENGINEERING_SCALE = {
  auditedPdfs: 1064,
  auditedRefs: 38317,
  locThousands: 228,
  automatedTests: 2205,
  ruleRange: 'R01–R30',
  ruleFamilies: 30,
  diagnosticCodes: '55+',
  citationStyles: 12,
  localPapers: '128K+',
} as const;
