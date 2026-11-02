"""Semantic similarity & Deep Neural Verification Layer with sentence-transformers.

Module này cung cấp Neural layer toàn diện cho hệ thống Neuro-Symbolic (CITRA v2.1):
1. Title Semantic Similarity: Bi-Encoder dense vector cosine similarity cho tiêu đề.
2. Focal Sentence & Multi-Granular Abstract Alignment: Tách câu trọng tâm (focal sentence)
   khỏi nhiễu cửa sổ văn bản PDF, khử gạch nối xuống dòng (de-hyphenation), và đối sánh
   cấp độ câu (sentence-level pooling) với toàn bộ Abstract của bài báo nguồn.
3. Neural Evidence Sentence Extraction: Trích xuất chính xác câu bằng chứng (Evidence Sentence)
   trong Abstract của bài báo gốc khớp ngữ nghĩa nhất với câu trích dẫn của sinh viên.
4. Neural Citation Intent Classification: Phân loại mục đích trích dẫn theo chuẩn SciCite/ACL-ARC
   ('background', 'methodology', 'result_comparison') bằng Zero-Shot Neural Prototypes + tín hiệu cú pháp.
5. Neural Claim Stance & Polarity Verification: Kiểm tra tính nhất quán khẳng định/phủ định
   ('supported', 'partially_supported', 'neutral', 'contradiction_risk').
6. Cross-Lingual Semantic Bridging (Việt ↔ Anh): Tự động phát hiện ngữ cảnh khóa luận tiếng Việt
   trích dẫn ấn phẩm tiếng Anh và ánh xạ khái niệm học thuật song ngữ vào không gian vector.
7. Multi-Occurrence & Implicit Passage Discovery: Kiểm tra đồng thời mọi vị trí trích dẫn trong bài
   và tự động dò tìm đoạn văn nội dung (body passage) liên quan nhất khi thiếu marker trực tiếp.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.matching.vn_en_academic_bridge import (
    VN_DIACRITIC_RE as _VN_DIACRITIC_RE,  # noqa: F401  re-export (legacy private alias)
)
from integrity_checker.matching.vn_en_academic_bridge import (
    VN_EN_ACADEMIC_BRIDGE as _VN_EN_ACADEMIC_BRIDGE,  # noqa: F401  re-export (used by tests)
)
from integrity_checker.matching.vn_en_academic_bridge import (
    bridge_vn_to_en,
    compute_cross_lingual_concept_overlap,
    find_vn_cues_for_en_source,
    is_vietnamese_text,
    normalize_vn_spelling,
)

logger = get_logger(__name__)

# Canonical Zero-Shot Neural Intent Prototypes (SciCite / ACL-ARC taxonomy)
_INTENT_PROTOTYPES: dict[str, str] = {
    "methodology": (
        "We use, implement, adopt, or build upon this tool, software library, algorithm, "
        "neural network architecture, parser, API, or mathematical method in our system pipeline."
    ),
    "result_comparison": (
        "Experimental evaluation, quantitative metric, benchmark accuracy, F1 score, calibration error, "
        "performance comparison, empirical baseline, or statistical validation of results."
    ),
    "background": (
        "Prior literature, historical background, general domain overview, related work survey, "
        "theoretical definition, and foundational concepts established in earlier studies."
    ),
}

_METHODOLOGY_CUES_RE = re.compile(
    r"\b(?:used\s+by|we\s+use|implemented\s+in|built\s+on|based\s+on|adopted|employs|"
    r"extractor|parser|library|framework|pipeline|module|architecture|algorithm|"
    r"following\s+[A-Z]|sử\s+dụng|áp\s+dụng|triển\s+khai|xây\s+dựng\s+trên|"
    r"kế\s+thừa|dựa\s+trên|huấn\s+luyện|tiền\s+xử\s+lý|tích\s+hợp|kiến\s+trúc|thuật\s+toán)\b",
    re.IGNORECASE,
)
_RESULT_CUES_RE = re.compile(
    r"\b(?:accuracy|precision|recall|f1|brier\s+score|calibration\s+error|ece|outperforms|"
    r"compared\s+with|benchmark|evaluation|measured\s+by|agreement|kappa|alpha|"
    r"achieved|9\d%|8\d%|0\.\d+|kết\s+quả|độ\s+chính\s+xác|so\s+sánh|thực\s+nghiệm|"
    r"vượt\s+trội|cải\s+thiện|đạt\s+được|cao\s+hơn|thấp\s+hơn|sai\s+số|hiệu\s+năng)\b",
    re.IGNORECASE,
)

_NEGATION_CUES_RE = re.compile(
    r"\b(?:not|never|no\s+longer|no\s+evidence|fails?\s+to|cannot|ineffective|insufficient|weak|"
    r"worse\s+than|unreliable|impossible|evaded\s+by|lack\s+of|useless|incapable|"
    r"contrary\s+to|disproves?|refutes?|invalidates?|degrades?|no\s+significant|"
    r"không\s+thể|không\s+hiệu\s+quả|thất\s+bại|kém\s+hơn|vô\s+dụng|bác\s+bỏ|trái\s+ngược|"
    r"không\s+cải\s+thiện|làm\s+giảm|suy\s+giảm\s+hiệu\s+năng|không\s+có\s+ý\s+nghĩa|"
    r"không\s+có\s+bằng\s+chứng)\b",
    re.IGNORECASE,
)
_STRONG_POSITIVE_CLAIM_RE = re.compile(
    r"\b(?:always\s+correct|completely\s+solves|100%\s+accurate|guarantees|perfectly|"
    r"never\s+fails|eliminates\s+all|surprisingly\s+effective|highly\s+effective|"
    r"superior\s+in\s+quality|significantly\s+outperforms|significantly\s+improves|"
    r"hoàn\s+toàn\s+chính\s+xác|luôn\s+đúng|rất\s+hiệu\s+quả|tối\s+ưu\s+tuyệt\s+đối|"
    r"cải\s+thiện\s+đáng\s+kể|tăng\s+đáng\s+kể|nâng\s+cao\s+đáng\s+kể|chứng\s+minh\s+rõ\s+ràng|"
    r"vượt\s+trội\s+hoàn\s+toàn|giải\s+quyết\s+triệt\s+để|hiệu\s+quả\s+vượt\s+trội)\b",
    re.IGNORECASE,
)
_DIRECT_REFUTATION_RE = re.compile(
    r"\b(?:completely\s+ineffective|fails?\s+to\s+\w+|useless|does\s+not\s+work|"
    r"cannot\s+improve|worse\s+than\s+random|incapable\s+of|no\s+significant\s+effect|"
    r"degrades?\s+performance|fails?\s+to\s+improve|"
    r"hoàn\s+toàn\s+thất\s+bại|không\s+có\s+tác\s+dụng|hoàn\s+toàn\s+vô\s+dụng|không\s+mang\s+lại\s+hiệu\s+quả|"
    r"không\s+thể\s+cải\s+thiện|làm\s+giảm\s+độ\s+chính\s+xác|kém\s+hơn\s+ngẫu\s+nhiên)\b",
    re.IGNORECASE,
)
_POSITIVE_EVIDENCE_RE = re.compile(
    r"\b(?:state-of-the-art|outperforms?|effective|improves?|achieves?|successfully|"
    r"we\s+introduce|we\s+present|we\s+propose|we\s+demonstrate|we\s+show|"
    r"superior|accurate|robust|significant\s+improvement|"
    r"cải\s+thiện|vượt\s+trội|hiệu\s+quả|độ\s+chính\s+xác\s+cao|thành\s+công)\b",
    re.IGNORECASE,
)


@dataclass
class SemanticAlignmentResult:
    """Kết quả semantic alignment check (Neural Layer v2.4).

    Attributes:
        similarity: Cosine similarity score tổng hợp (0.0-1.0)
        confidence: Confidence level ('high', 'medium', 'low')
        is_aligned: True nếu content có semantic alignment
        compared_texts: Dict chứa các text đã so sánh (để debug)
        title_context_sim: Cosine similarity giữa cited context và source title
        abstract_context_sim: Cosine similarity giữa cited context và source abstract
        best_evidence_sentence: Câu bằng chứng khớp nhất trích từ source abstract
        best_evidence_score: Điểm similarity của câu bằng chứng tốt nhất
        best_cited_sentence: Câu trọng tâm (focal sentence) đã làm sạch trong bài viết
        citation_intent: Mục đích trích dẫn ('background', 'methodology', 'result_comparison')
        stance_label: Trạng thái đồng thuận ('supported', 'partially_supported', 'neutral', 'contradiction_risk')
        cross_lingual_detected: True nếu phát hiện và bắc cầu ngữ nghĩa Việt ↔ Anh
        bridged_concepts: Danh sách các cặp thuật ngữ học thuật Việt ↔ Anh đã bắc cầu
        occurrence_alignments: Danh sách kết quả neural cho từng vị trí trích dẫn trong bài
    """

    similarity: float
    confidence: str
    is_aligned: bool
    compared_texts: dict[str, Any]
    title_context_sim: float = 0.0
    abstract_context_sim: float = 0.0
    best_evidence_sentence: str = ""
    best_evidence_score: float = 0.0
    best_cited_sentence: str = ""
    citation_intent: str = ""
    stance_label: str = "supported"
    cross_lingual_detected: bool = False
    bridged_concepts: list[str] = field(default_factory=list)
    occurrence_alignments: list[dict[str, Any]] = field(default_factory=list)


class SemanticMatcher:
    """Deep Neural Semantic & Evidence Matcher dùng sentence-transformers."""

    _instance_lock = threading.Lock()
    _encode_lock = threading.Lock()
    _model_cache: dict[str, object] = {}
    _intent_emb_cache: dict[str, Any] = {}
    _singleton: SemanticMatcher | None = None

    # Thresholds cho content alignment
    ALIGNMENT_THRESHOLD_HIGH = 0.70  # High confidence alignment
    ALIGNMENT_THRESHOLD_MEDIUM = 0.50  # Medium confidence alignment
    ALIGNMENT_THRESHOLD_LOW = 0.30  # Low confidence, likely mismatch

    def __init__(self, model_name: str | None = None) -> None:
        settings = get_settings().matching
        self.model_name = model_name or settings.embedding_model
        self.multilingual_model_name = getattr(
            settings,
            "multilingual_embedding_model",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        self.enable_multilingual_encoder = bool(
            getattr(settings, "enable_multilingual_encoder", False)
        )
        self.cross_lingual_sim_boost = float(
            getattr(settings, "cross_lingual_sim_boost", 0.08)
        )
        self._model = None  # lazy load
        self._multilingual_model = None  # lazy load on-demand

    @classmethod
    def get_instance(cls, model_name: str | None = None) -> SemanticMatcher:
        """Get singleton instance -- model loads only once per process."""
        if cls._singleton is None:
            with cls._instance_lock:
                if cls._singleton is None:
                    cls._singleton = cls(model_name)
                    logger.info(f"SemanticMatcher singleton created with model: {cls._singleton.model_name}")
        return cls._singleton

    @classmethod
    def reset_instance(cls) -> None:
        """Reset singleton -- for testing only."""
        with cls._instance_lock:
            cls._singleton = None

    def _get_model(self):
        if self._model is None:
            with self._instance_lock:
                if self.model_name not in self._model_cache:
                    try:
                        from sentence_transformers import SentenceTransformer  # type: ignore

                        logger.info(f"Loading sentence-transformers: {self.model_name}")
                        self._model_cache[self.model_name] = SentenceTransformer(self.model_name)
                    except ImportError as e:
                        logger.error(f"sentence-transformers chưa cài: {e}")
                        return None
                self._model = self._model_cache[self.model_name]
        return self._model

    def _get_multilingual_model(self):
        """Lazy Dual-Encoder (Phương án A): trả về multilingual encoder nếu được bật hoặc đã nạp trong cache,
        ngược lại fallback tức thì về encoder mặc định.
        """
        if self._multilingual_model is not None:
            return self._multilingual_model
        if self.multilingual_model_name in self._model_cache:
            self._multilingual_model = self._model_cache[self.multilingual_model_name]
            return self._multilingual_model
        if not self.enable_multilingual_encoder:
            return self._get_model()
        with self._instance_lock:
            if self.multilingual_model_name not in self._model_cache:
                try:
                    from sentence_transformers import SentenceTransformer  # type: ignore

                    logger.info(f"Loading multilingual sentence-transformers: {self.multilingual_model_name}")
                    self._model_cache[self.multilingual_model_name] = SentenceTransformer(
                        self.multilingual_model_name
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"Multilingual encoder fallback to default model: {e}")
                    return self._get_model()
            self._multilingual_model = self._model_cache[self.multilingual_model_name]
        return self._multilingual_model

    def _encode(self, model: object, texts: object, **kwargs: object):
        """Thread-safe model.encode wrapper with torch.no_grad()."""
        with self._encode_lock:
            try:
                import torch  # type: ignore

                with torch.no_grad():
                    return model.encode(texts, **kwargs)
            except ImportError:
                return model.encode(texts, **kwargs)

    def similarity(self, text1: str, text2: str) -> float:
        """Trả cosine similarity 0.0–1.0. Fallback 0.0 nếu model chưa load được."""
        model = self._get_model()
        if model is None or not text1 or not text2:
            return 0.0
        try:
            embs = self._encode(model, [text1, text2], convert_to_tensor=True, normalize_embeddings=True)
            cos = (embs[0] @ embs[1]).item()
            return max(0.0, min(1.0, float(cos)))
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Semantic similarity error: {e}")
            return 0.0

    # === TEXT CLEANING, DE-HYPHENATION & FOCAL SENTENCE EXTRACTION ===

    @staticmethod
    def clean_and_dehyphenate_context(text: str) -> str:
        """Khử gạch nối ngắt dòng PDF (ví dụ 'cal- ibration' -> 'calibration', 'HDB- SCAN' -> 'HDBSCAN')
        và dọn dẹp mảnh từ bị cắt cụt ở 2 đầu cửa sổ ký tự.
        """
        if not text:
            return ""
        cleaned = " ".join(text.split())
        # Normalize special Greek question mark / PDF punctuation artefacts (e.g. ';' -> ';')
        cleaned = cleaned.replace("\u037e", ";").replace("\xad", "")
        # Rejoin known split uppercase acronyms like "HDB- SCAN" -> "HDBSCAN", "TF- IDF" -> "TF-IDF"
        cleaned = re.sub(r"\bHDB-\s+SCAN\b", "HDBSCAN", cleaned)
        cleaned = re.sub(r"\bTF-\s+IDF\b", "TF-IDF", cleaned)
        # Rejoin lowercase line-wrap hyphenations: "cal- ibration" -> "calibration", "pro- gram" -> "program"
        # Preserve legitimate compound prefixes like "pre-trained", "self-attention", "co-occurrence", "non-linear"
        _keep_hyphen_prefixes = {
            "pre", "post", "self", "non", "co", "multi", "cross", "sub", "inter", "intra",
            "semi", "quasi", "meta", "micro", "macro", "high", "low", "well", "real", "open",
            "two", "three", "four", "five", "one", "single", "double", "full", "end", "fine",
            "class", "word", "page", "line", "user", "data", "time", "zero", "few", "over", "under",
        }

        def _rejoin_hyphen(m: re.Match[str]) -> str:
            left = m.group(1)
            right = m.group(2)
            if left.lower() in _keep_hyphen_prefixes:
                return f"{left}-{right}"
            return f"{left}{right}"

        cleaned = re.sub(r"\b([A-Za-zÀ-ỹ]{2,})-\s+([a-zà-ỹ]{2,})\b", _rejoin_hyphen, cleaned)
        return cleaned.strip()

    @classmethod
    def extract_focal_sentence(
        cls,
        cited_context: str,
        citation_marker: str | None = None,
        source_title: str | None = None,
    ) -> str:
        """Tách câu trọng tâm (focal sentence) chứa trích dẫn từ đoạn context 200-400 ký tự.

        Khi cửa sổ ký tự cắt ngang qua nhiều câu khác chủ đề (ví dụ câu trước nói về Chương 5,
        câu sau mới nói về PyMuPDF [2]), hàm này cô lập đúng câu chứa marker hoặc câu có
        mức độ liên quan cao nhất tới tài liệu được trích dẫn.
        """
        cleaned = cls.clean_and_dehyphenate_context(cited_context)
        if not cleaned:
            return ""

        # Trim leading/trailing half-cut lowercase fragments from fixed character slicing
        # e.g., "ormalising them into fields..." or "guous to a human reader..."
        trimmed = re.sub(r"^[a-z]{1,8}\s+(?=[a-z])", "", cleaned)
        if len(trimmed) >= 40:
            cleaned = trimmed

        # Protect common scholarly abbreviations before splitting into sentences
        protected = cls._protect_abbreviations(cleaned)

        raw_parts = re.split(r"(?<=[.!?;;])\s+(?=[A-ZÀ-Ỹ0-9\[\(])", protected)
        sentences = [
            p.replace("<DOT>", ".").strip()
            for p in raw_parts
            if len(p.replace("<DOT>", ".").strip()) >= 20
        ]
        if not sentences:
            return cleaned

        # 1. If explicit citation marker (e.g. "[2]", "(Vaswani et al., 2017)") is present, find its sentence
        marker_clean = (citation_marker or "").strip()
        if marker_clean and len(marker_clean) <= 60:
            for idx, sent in enumerate(sentences):
                if cls._sentence_matches_marker(sent, marker_clean):
                    if len(sent) < 55 and len(sentences) > 1:
                        neighbor = sentences[idx + 1] if idx + 1 < len(sentences) else sentences[idx - 1]
                        return f"{sent} {neighbor}".strip()
                    return sent

        # 2. Check for bracketed numeric markers like [12] or (Author, YYYY) inside sentences
        # and score sentences by keyword overlap with source_title + presence of citation markers
        title_words = {
            w.lower()
            for w in re.findall(r"[A-Za-zÀ-ỹ0-9]{3,}", source_title or "")
            if w.lower() not in {"the", "and", "for", "with", "from", "using", "based", "study", "analysis"}
        }
        vn_title_cues = find_vn_cues_for_en_source(source_title or "") if source_title else []

        best_sent = sentences[0]
        best_score = -1.0
        for idx, sent in enumerate(sentences):
            sent_lower = normalize_vn_spelling(sent).lower()
            sent_words = {w.lower() for w in re.findall(r"[A-Za-zÀ-ỹ0-9]{3,}", sent)}
            overlap = len(title_words & sent_words)
            vn_cue_hits = sum(1 for vc in vn_title_cues if vc in sent_lower)
            has_marker = bool(re.search(r"\[\d+(?:\s*[,–-]\s*\d+)*\]|\([A-Za-zÀ-ỹ][^)]*(?:19|20)\d{2}[a-z]?\)", sent))
            # Prefer middle complete sentences over chopped boundary fragments
            is_boundary_fragment = (idx == 0 and sent[0].islower()) or (idx == len(sentences) - 1 and not sent.endswith((".", "!", "?", ")")))
            score = (
                overlap * 2.5
                + vn_cue_hits * 2.2
                + (2.0 if has_marker else 0.0)
                + (0.5 if not is_boundary_fragment else -0.5)
                + min(len(sent), 180) / 300.0
            )
            if score > best_score:
                best_score = score
                best_sent = sent

        return best_sent

    @staticmethod
    def _protect_abbreviations(text: str) -> str:
        """Protect scholarly abbreviations, initials, and decimals from sentence splitting."""
        if not text:
            return ""
        protected = text
        protected = protected.replace("...", "<DOT><DOT><DOT>")
        protected = re.sub(r"\bet\s+al\.", "et al<DOT>", protected, flags=re.IGNORECASE)
        protected = re.sub(r"\be\.g\.", "e<DOT>g<DOT>", protected, flags=re.IGNORECASE)
        protected = re.sub(r"\bi\.e\.", "i<DOT>e<DOT>", protected, flags=re.IGNORECASE)
        protected = re.sub(
            r"\b(Fig|Figs|Table|Tab|Eq|Eqs|Sec|Secs|Ch|Vol|Iss|No|Nos|pp|Dr|Prof|Mr|Mrs|Ms|Jr|Sr|Inc|Ltd|Co|Corp|vs|cf|viz|approx|est|dept|univ|proc|intl|conf)\.",
            r"\1<DOT>",
            protected,
            flags=re.IGNORECASE,
        )
        # Protect single uppercase initial before a capitalized name (e.g. "J. Devlin")
        protected = re.sub(r"\b([A-Z])\.(?=\s+[A-Z])", r"\1<DOT>", protected)
        # Protect decimal numbers / versions (e.g. "94.5%", "Sec. 4.2")
        protected = re.sub(r"(\d)\.(\d)", r"\1<DOT>\2", protected)
        return protected

    @staticmethod
    def _sentence_matches_marker(sent: str, marker_clean: str) -> bool:
        """Check if sentence contains the exact citation marker OR a multi-citation cluster containing it."""
        if not sent or not marker_clean:
            return False
        sent_lower = sent.lower()
        marker_lower = marker_clean.lower()
        if marker_lower in sent_lower:
            return True

        # Handle numeric bracket marker [N] inside multi-citation clusters like [1, 2] or [1-4]
        num_match = re.fullmatch(r"\[(\d+)\]", marker_clean)
        if num_match:
            target_num = int(num_match.group(1))
            for bracket_inner in re.findall(r"\[([^\]]+)\]", sent):
                # Direct number match in comma list: [1, 2, 5]
                if re.search(rf"\b{target_num}\b", bracket_inner):
                    return True
                # Range match: [1-4] or [1–4]
                for rng in re.finditer(r"(\d+)\s*[-–—]\s*(\d+)", bracket_inner):
                    start_n, end_n = int(rng.group(1)), int(rng.group(2))
                    if start_n <= target_num <= end_n:
                        return True

        # Handle author-year marker (Surname et al., YYYY) inside multi-citation parentheses
        year_match = re.search(r"\b((?:19|20)\d{2}[a-z]?)\b", marker_clean)
        author_match = re.search(r"([A-Za-zÀ-ỹ]{3,})", marker_clean)
        if year_match and author_match:
            yr = year_match.group(1).lower()
            surname = author_match.group(1).lower()
            if surname in sent_lower and yr in sent_lower:
                return True

        return False

    @staticmethod
    def detect_and_bridge_cross_lingual(
        cited_context: str,
        source_title: str,
        source_abstract: str | None = None,
    ) -> tuple[bool, str]:
        """Phát hiện khi khóa luận viết bằng tiếng Việt nhưng trích dẫn tài liệu tiếng Anh,
        và tạo chuỗi ngữ nghĩa bắc cầu (Cross-Lingual Concept Bridge).
        """
        is_xl, bridged, _ = bridge_vn_to_en(cited_context, source_title, source_abstract)
        return is_xl, bridged

    @staticmethod
    def detect_and_bridge_cross_lingual_detailed(
        cited_context: str,
        source_title: str,
        source_abstract: str | None = None,
    ) -> tuple[bool, str, list[str]]:
        """Phát hiện ngữ cảnh xuyên ngôn ngữ Việt ↔ Anh kèm danh sách cặp khái niệm đã ánh xạ."""
        return bridge_vn_to_en(cited_context, source_title, source_abstract)

    def cross_lingual_title_similarity(
        self,
        cited_title: str,
        candidate_title: str,
    ) -> tuple[bool, float, list[str]]:
        """Kiểm tra và tính điểm căn chỉnh ngữ nghĩa xuyên ngôn ngữ cho cặp tiêu đề (Việt ↔ Anh).

        Dùng khi sinh viên dịch tiêu đề bài báo/sách tiếng Anh sang tiếng Việt (hoặc ngược lại).

        Returns:
            Tuple (is_cross_lingual_title, xl_title_sim, bridged_concepts)
        """
        if not cited_title or not candidate_title:
            return False, 0.0, []

        cit_is_vn = is_vietnamese_text(cited_title, min_diacritics=2)
        cand_is_vn = is_vietnamese_text(candidate_title, min_diacritics=2)
        if cit_is_vn == cand_is_vn:
            return False, 0.0, []

        vn_title = cited_title if cit_is_vn else candidate_title
        en_title = candidate_title if cit_is_vn else cited_title

        _, bridged_vn_title, bridged_concepts = bridge_vn_to_en(vn_title, en_title, None)
        overlap_score, overlap_pairs = compute_cross_lingual_concept_overlap(vn_title, en_title)

        merged_concepts = list(bridged_concepts)
        for pair in overlap_pairs:
            if pair not in merged_concepts:
                merged_concepts.append(pair)

        # Extract translated English portion inside bridged_vn_title "(...)" for clean SBERT comparison
        en_bridge_only = ""
        m_paren = re.search(r"\(([^()]+)\)\s*$", bridged_vn_title)
        if m_paren:
            en_bridge_only = m_paren.group(1).strip()

        dense_sim = self.similarity(bridged_vn_title or vn_title, en_title)
        if en_bridge_only:
            dense_sim = max(dense_sim, self.similarity(en_bridge_only, en_title))

        # Optional multilingual encoder boost when enabled/cached
        multi_model = self._get_multilingual_model()
        if multi_model is not None and multi_model is not self._get_model():
            multi_sim = self._compute_similarity(multi_model, vn_title, en_title)
            dense_sim = max(dense_sim, multi_sim)

        if overlap_score > 0.0:
            combined_sim = max(dense_sim, 0.45 * dense_sim + 0.55 * overlap_score)
        else:
            combined_sim = dense_sim

        return True, round(min(1.0, max(0.0, combined_sim)), 4), merged_concepts

    @classmethod
    def classify_citation_intent(
        cls,
        focal_sentence: str,
        ctx_emb: Any = None,
        intent_embs: Any = None,
    ) -> str:
        """Phân loại mục đích trích dẫn (Citation Intent) theo chuẩn học thuật SciCite:
        - 'methodology': Sử dụng công cụ, thuật toán, mô hình, bộ dữ liệu
        - 'result_comparison': So sánh kết quả thực nghiệm, độ đo, hiệu năng
        - 'background': Giới thiệu bối cảnh, lý thuyết nền tảng, tổng quan tài liệu
        """
        if not focal_sentence:
            return "background"

        scores = {
            "methodology": 0.0,
            "result_comparison": 0.0,
            "background": 0.05,  # slight prior for general background citations
        }

        # Neural prototype similarity when embeddings are available
        if ctx_emb is not None and intent_embs is not None:
            try:
                intent_keys = list(_INTENT_PROTOTYPES.keys())
                for idx, key in enumerate(intent_keys):
                    sim = float((ctx_emb @ intent_embs[idx]).item())
                    scores[key] += max(0.0, sim)
            except Exception:  # noqa: BLE001
                pass

        # Syntactic / lexical scholarly cues (normalized for Vietnamese spelling variants)
        norm_focal = normalize_vn_spelling(focal_sentence)
        if _METHODOLOGY_CUES_RE.search(norm_focal):
            scores["methodology"] += 0.22
        if _RESULT_CUES_RE.search(norm_focal):
            scores["result_comparison"] += 0.24

        return max(scores, key=lambda k: scores[k])

    @staticmethod
    def check_claim_stance(
        focal_sentence: str,
        best_evidence_sentence: str,
        similarity: float,
        has_abstract: bool,
        is_cross_lingual: bool = False,
        source_abstract: str | None = None,
    ) -> str:
        """Kiểm tra tính đồng thuận / mâu thuẫn ngữ nghĩa (Stance & Polarity Verification).

        Trả về:
            - 'supported': Nội dung trích dẫn khớp và nhất quán với bài báo gốc
            - 'partially_supported': Có liên quan chủ đề ở mức trung bình
            - 'neutral': Trích dẫn đề cập chung, không đủ bằng chứng sâu
            - 'contradiction_risk': Cảnh báo nguy cơ trích dẫn sai lệch kết luận hoặc lạc đề nghiêm trọng
        """
        if not focal_sentence:
            return "neutral"

        norm_focal = normalize_vn_spelling(focal_sentence)
        norm_ev = normalize_vn_spelling(best_evidence_sentence) if best_evidence_sentence else ""

        # Check for severe polarity inversion when discussing the same technical concept
        if best_evidence_sentence and similarity >= 0.30:
            ctx_neg = bool(_NEGATION_CUES_RE.search(norm_focal))
            ev_neg = bool(_NEGATION_CUES_RE.search(norm_ev))
            ctx_abs_pos = bool(_STRONG_POSITIVE_CLAIM_RE.search(norm_focal))
            ev_abs_pos = bool(_STRONG_POSITIVE_CLAIM_RE.search(norm_ev))
            ctx_direct_refute = bool(_DIRECT_REFUTATION_RE.search(norm_focal))
            ev_pos = bool(
                _POSITIVE_EVIDENCE_RE.search(norm_ev)
                or (source_abstract and _POSITIVE_EVIDENCE_RE.search(source_abstract))
            )
            if (
                (ctx_abs_pos and ev_neg and not ctx_neg)
                or (ctx_neg and ev_abs_pos and not ev_neg)
                or (ctx_direct_refute and ev_pos and not ev_neg)
            ):
                return "contradiction_risk"

        if similarity >= 0.50:
            return "supported"
        if similarity >= 0.35:
            return "partially_supported"
        if has_abstract and similarity < 0.22 and not is_cross_lingual:
            return "contradiction_risk"
        return "neutral"

    # === NEURAL LAYER: Content-Context Alignment (v2.4) ===

    def check_content_alignment(
        self,
        cited_context: str,
        source_title: str,
        source_abstract: str | None = None,
        source_body: str | None = None,
        citation_marker: str | None = None,
    ) -> SemanticAlignmentResult:
        """Kiểm tra semantic alignment đa tầng giữa đoạn văn trích dẫn và bài báo nguồn.

        Kết hợp:
        - Cả đoạn văn (window context) VÀ câu trọng tâm (focal sentence) đã khử gạch nối PDF.
        - Bắc cầu ngữ nghĩa Việt ↔ Anh (nếu văn bản trích dẫn là tiếng Việt) kèm danh sách `bridged_concepts`.
        - So khớp đa cấp độ: Title + Toàn bộ Abstract + Từng câu trong Abstract (Sentence-level Max Pooling).
        - Trích xuất câu bằng chứng cụ thể (`best_evidence_sentence`) từ Abstract.
        - Phân loại mục đích trích dẫn (`citation_intent`) và kiểm tra Stance (`stance_label`).
        """
        model = self._get_model()
        if model is None:
            return SemanticAlignmentResult(
                similarity=0.0,
                confidence="low",
                is_aligned=False,
                compared_texts={"cited_context": cited_context, "source": source_title},
            )

        try:
            source_abstract = self._sanitize_abstract(source_abstract)
            raw_context_clean = self.clean_and_dehyphenate_context(cited_context)
            if len(re.findall(r"[A-Za-zÀ-ỹ]{2,}", raw_context_clean)) < 2:
                return SemanticAlignmentResult(
                    similarity=0.0,
                    confidence="low",
                    is_aligned=False,
                    compared_texts={
                        "cited_context": cited_context,
                        "source_title": source_title,
                        "has_abstract": bool(source_abstract),
                        "has_body": bool(source_body),
                    },
                    stance_label="neutral",
                )
            focal_sentence = self.extract_focal_sentence(
                raw_context_clean,
                citation_marker=citation_marker,
                source_title=source_title,
            )
            is_cross_lingual, bridged_context, bridged_concepts = (
                self.detect_and_bridge_cross_lingual_detailed(
                    focal_sentence or raw_context_clean,
                    source_title,
                    source_abstract,
                )
            )
            concept_overlap_score = 0.0
            if is_cross_lingual:
                concept_overlap_score, overlap_pairs = compute_cross_lingual_concept_overlap(
                    focal_sentence or raw_context_clean,
                    f"{source_title or ''} {source_abstract or ''}",
                )
                for pair in overlap_pairs:
                    if pair not in bridged_concepts:
                        bridged_concepts.append(pair)

            cited_context_trunc = self._truncate_text(raw_context_clean or cited_context, max_length=512)
            source_title_trunc = self._truncate_text(source_title, max_length=256)

            # Fast batched encoding when _compute_similarity is not mocked by unit tests
            use_batch = (
                getattr(self._compute_similarity, "__func__", None)
                is SemanticMatcher._compute_similarity
            )
            batch_done = False
            title_sim = 0.0
            abstract_sim = 0.0
            best_evidence_sentence = ""
            best_evidence_score = 0.0
            citation_intent = "background"

            if use_batch:
                try:
                    batch_texts = [cited_context_trunc, source_title_trunc]
                    has_abs = bool(source_abstract and source_abstract.strip())
                    abs_sents: list[str] = []
                    if has_abs and source_abstract:
                        if len(source_abstract) > 512:
                            truncated_abstract = (
                                source_abstract[:300].strip() + " ... " + source_abstract[-200:].strip()
                            )
                        else:
                            truncated_abstract = self._truncate_text(source_abstract, max_length=512)
                        batch_texts.append(truncated_abstract)
                        extracted = self._extract_sentences(source_abstract)
                        if len(extracted) >= 1:
                            abs_sents = extracted[:25]
                            batch_texts.extend(abs_sents)

                    # Append focal_sentence and optional cross-lingual bridged context
                    focal_idx: int | None = None
                    if focal_sentence and focal_sentence != cited_context_trunc:
                        focal_idx = len(batch_texts)
                        batch_texts.append(self._truncate_text(focal_sentence, max_length=384))

                    bridged_idx: int | None = None
                    if is_cross_lingual and bridged_context:
                        bridged_idx = len(batch_texts)
                        batch_texts.append(self._truncate_text(bridged_context, max_length=512))

                    embs = self._encode(
                        model,
                        batch_texts,
                        convert_to_tensor=True,
                        normalize_embeddings=True,
                        show_progress_bar=False,
                    )
                    if len(embs) == len(batch_texts):
                        # Collect candidate query embeddings for the student's citation context
                        query_embs = [embs[0]]
                        if focal_idx is not None:
                            query_embs.append(embs[focal_idx])
                        if bridged_idx is not None:
                            query_embs.append(embs[bridged_idx])

                        def _max_query_cos(target_emb: Any) -> float:
                            return max(
                                max(0.0, min(1.0, float((q_emb @ target_emb).item())))
                                for q_emb in query_embs
                            )

                        title_sim = _max_query_cos(embs[1])
                        best_evidence_sentence = source_title_trunc
                        best_evidence_score = title_sim

                        if has_abs:
                            whole_abs_sim = _max_query_cos(embs[2])
                            best_evidence_score = max(title_sim, whole_abs_sim)
                            if abs_sents:
                                sent_sims = [
                                    _max_query_cos(embs[3 + idx])
                                    for idx in range(len(abs_sents))
                                ]
                                best_sent_idx = max(range(len(sent_sims)), key=lambda i: sent_sims[i])
                                max_sent_sim = sent_sims[best_sent_idx]
                                best_evidence_sentence = abs_sents[best_sent_idx]
                                best_evidence_score = max_sent_sim
                                abstract_sim = max(
                                    whole_abs_sim,
                                    0.65 * max_sent_sim + 0.35 * whole_abs_sim,
                                )
                            else:
                                abstract_sim = whole_abs_sim
                                best_evidence_sentence = self._truncate_text(source_abstract or "", max_length=280)

                        # Classify citation intent using cached prototype embeddings (use bridged embedding for VI->EN)
                        intent_embs = self._get_intent_embeddings(model)
                        primary_q_emb = (
                            embs[bridged_idx]
                            if bridged_idx is not None
                            else (embs[focal_idx] if focal_idx is not None else embs[0])
                        )
                        citation_intent = self.classify_citation_intent(
                            focal_sentence or cited_context_trunc,
                            ctx_emb=primary_q_emb,
                            intent_embs=intent_embs,
                        )
                        batch_done = True
                except Exception:  # noqa: BLE001
                    batch_done = False

            if not batch_done:
                # Fallback path (also used by unit tests mocking _compute_similarity or MagicMock encode)
                title_sim = self._compute_similarity(model, cited_context_trunc, source_title_trunc)
                best_evidence_sentence = source_title_trunc
                best_evidence_score = title_sim

                abstract_sim = 0.0
                if source_abstract:
                    if len(source_abstract) > 512:
                        truncated_abstract = (
                            source_abstract[:300].strip() + " ... " + source_abstract[-200:].strip()
                        )
                    else:
                        truncated_abstract = self._truncate_text(source_abstract, max_length=512)
                    whole_abs_sim = self._compute_similarity(model, cited_context_trunc, truncated_abstract)
                    abs_sentences = self._extract_sentences(source_abstract)
                    if len(abs_sentences) >= 2:
                        sent_sims = [
                            self._compute_similarity(model, cited_context_trunc, sent)
                            for sent in abs_sentences[:25]
                        ]
                        if sent_sims:
                            best_idx = max(range(len(sent_sims)), key=lambda i: sent_sims[i])
                            max_sent_sim = sent_sims[best_idx]
                            best_evidence_sentence = abs_sentences[best_idx]
                            best_evidence_score = max_sent_sim
                        else:
                            max_sent_sim = whole_abs_sim
                        abstract_sim = max(whole_abs_sim, 0.6 * max_sent_sim + 0.4 * whole_abs_sim)
                    else:
                        abstract_sim = whole_abs_sim
                        best_evidence_sentence = truncated_abstract
                        best_evidence_score = whole_abs_sim

                citation_intent = self.classify_citation_intent(focal_sentence or cited_context_trunc)

            # Strategy 3: Compare with source body (if available, using segment sampling)
            body_sim = 0.0
            if source_body:
                body_sim = self._compute_similarity_with_long_text(
                    model, cited_context_trunc, source_body, max_sample_length=512
                )

            # Combine scores with higher weight on abstract when available
            scores = [title_sim]
            weights = [0.3]  # Title weight

            if abstract_sim > 0:
                scores.append(abstract_sim)
                weights.append(0.5)  # Abstract weight

            if body_sim > 0:
                scores.append(body_sim)
                weights.append(0.2)  # Body weight

            total_weight = sum(weights)
            normalized_weights = [w / total_weight for w in weights]
            weighted_similarity = sum(s * w for s, w in zip(scores, normalized_weights, strict=False))

            # Preserve strong abstract or sentence-level evidence alignment even when title is metaphorical
            if abstract_sim >= self.ALIGNMENT_THRESHOLD_HIGH:
                final_sim = max(weighted_similarity, abstract_sim * 0.92, best_evidence_score * 0.90)
            elif best_evidence_score >= 0.65 and abstract_sim > 0:
                final_sim = max(weighted_similarity, best_evidence_score * 0.88)
            else:
                final_sim = weighted_similarity if scores else 0.0

            # Cross-Lingual Score Calibration (when real tensor batch succeeded and concept overlap exists)
            if is_cross_lingual and batch_done and concept_overlap_score > 0.0 and final_sim >= 0.25:
                calibrated_xl = max(
                    final_sim,
                    min(0.95, 0.60 * final_sim + 0.40 * concept_overlap_score),
                    min(0.95, final_sim + self.cross_lingual_sim_boost),
                )
                final_sim = calibrated_xl

            confidence, is_aligned = self._determine_alignment(final_sim)
            stance_label = self.check_claim_stance(
                focal_sentence or cited_context_trunc,
                best_evidence_sentence,
                final_sim,
                has_abstract=bool(source_abstract),
                is_cross_lingual=is_cross_lingual,
                source_abstract=source_abstract,
            )
            if stance_label == "contradiction_risk":
                is_aligned = False

            return SemanticAlignmentResult(
                similarity=round(final_sim, 4),
                confidence=confidence,
                is_aligned=is_aligned,
                compared_texts={
                    "cited_context": cited_context[:100] + "..." if len(cited_context) > 100 else cited_context,
                    "source_title": source_title,
                    "has_abstract": bool(source_abstract),
                    "has_body": bool(source_body),
                },
                title_context_sim=round(title_sim, 4),
                abstract_context_sim=round(abstract_sim, 4),
                best_evidence_sentence=best_evidence_sentence,
                best_evidence_score=round(best_evidence_score, 4),
                best_cited_sentence=focal_sentence or cited_context_trunc,
                citation_intent=citation_intent,
                stance_label=stance_label,
                cross_lingual_detected=is_cross_lingual,
                bridged_concepts=bridged_concepts,
            )

        except Exception as e:  # noqa: BLE001
            logger.warning(f"Content alignment check failed: {e}")
            return SemanticAlignmentResult(
                similarity=0.0,
                confidence="low",
                is_aligned=False,
                compared_texts={"cited_context": cited_context, "source": source_title},
            )

    def check_multi_context_alignment(
        self,
        occurrence_contexts: list[dict[str, Any]],
        source_title: str,
        source_abstract: str | None = None,
    ) -> list[dict[str, Any]]:
        """Đánh giá Neural Alignment trên TẤT CẢ các vị trí trích dẫn của cùng 1 tài liệu trong bài.

        Args:
            occurrence_contexts: List các dict {'page': int, 'context': str, 'raw': str}
            source_title: Tiêu đề bài báo nguồn
            source_abstract: Abstract bài báo nguồn (nếu có)

        Returns:
            Danh sách kết quả alignment theo từng vị trí trích dẫn (page, focal_sentence, score,
            confidence, is_aligned, intent, stance, best_evidence_sentence).
        """
        if not occurrence_contexts:
            return []

        results: list[dict[str, Any]] = []
        seen_sentences: set[str] = set()
        for occ in occurrence_contexts[:8]:
            ctx = str(occ.get("context") or "").strip()
            if not ctx:
                continue
            marker = str(occ.get("raw") or "").strip()
            focal = self.extract_focal_sentence(ctx, citation_marker=marker, source_title=source_title)
            dedup_key = focal[:120].lower()
            if dedup_key in seen_sentences:
                continue
            seen_sentences.add(dedup_key)

            res = self.check_content_alignment(
                cited_context=ctx,
                source_title=source_title,
                source_abstract=source_abstract,
                citation_marker=marker,
            )
            results.append(
                {
                    "page": int(occ.get("page") or 0),
                    "marker": marker,
                    "focal_sentence": res.best_cited_sentence or focal,
                    "score": res.similarity,
                    "confidence": res.confidence,
                    "is_aligned": res.is_aligned,
                    "intent": res.citation_intent,
                    "stance": res.stance_label,
                    "best_evidence_sentence": res.best_evidence_sentence,
                    "cross_lingual_detected": res.cross_lingual_detected,
                    "bridged_concepts": res.bridged_concepts,
                }
            )
        return results

    def discover_implicit_body_context(
        self,
        body_pages: list[tuple[int, str]],
        source_title: str,
        source_abstract: str | None = None,
        source_authors: list[str] | None = None,
    ) -> tuple[int, str, float] | None:
        """Tự động dò tìm đoạn văn trong phần thân bài (Body Pages) khớp ngữ nghĩa nhất với
        tài liệu tham khảo khi sinh viên quên đặt marker trích dẫn trực tiếp trong bài.

        Returns:
            Tuple (page_num, best_passage, similarity_score) hoặc None.
        """
        if not body_pages or not source_title:
            return None

        model = self._get_model()
        if model is None:
            return None

        title_tokens = {
            w.lower()
            for w in re.findall(r"[A-Za-zÀ-ỹ0-9]{3,}", source_title)
            if w.lower()
            not in {
                "the", "and", "for", "with", "from", "using", "based", "edition",
                "guide", "definitive", "introduction", "learning", "pro", "good", "parts",
                "techniques", "development", "theory", "study", "analysis",
            }
        }
        author_surnames = {
            re.sub(r"[^a-zA-ZÀ-ỹ]", "", a.split(",")[0].split()[0]).lower()
            for a in (source_authors or [])
            if a and len(a.strip()) >= 3
        }

        norm_title_sub = re.sub(r"\s+", " ", source_title.lower().strip())[:35]

        # Build reverse Vietnamese concept cues for English references (so Vietnamese body paragraphs
        # discussing an English paper's concept without English keywords are also discovered)
        vn_concept_cues = find_vn_cues_for_en_source(source_title, source_abstract)

        candidate_passages: list[tuple[int, str, float]] = []
        for page_num, page_text in body_pages:
            if not page_text or len(page_text.strip()) < 60:
                continue
            # Skip Table of Contents / List of Figures pages
            if "......" in page_text or "TABLE OF CONTENTS" in page_text.upper():
                continue

            cleaned_page = self.clean_and_dehyphenate_context(page_text)
            sents = self._extract_sentences(cleaned_page)
            # Group into 2-sentence windows
            for i in range(len(sents)):
                window = " ".join(sents[i : i + 2]).strip()
                if len(window) < 45:
                    continue
                win_lower = window.lower()
                # Skip windows that are themselves bibliography entries on an unfiltered reference page
                is_bib_entry = bool(
                    re.search(
                        r"\b[A-ZÀ-Ỹ][a-zà-ỹ]+,\s+[A-Z]\.(?:.*?\(\s*(?:19|20)\d{2}[a-z]?\s*\))",
                        window,
                    )
                    or (len(norm_title_sub) >= 12 and norm_title_sub in win_lower and re.search(r"\b(?:19|20)\d{2}\b", win_lower))
                )
                if (
                    "in proceedings of" in win_lower
                    or "https://doi.org/" in win_lower
                    or "arxiv preprint" in win_lower
                    or (len(norm_title_sub) >= 24 and norm_title_sub in win_lower)
                    or is_bib_entry
                ):
                    continue
                win_words = set(re.findall(r"[a-zA-ZÀ-ỹ0-9]{3,}", win_lower))
                kw_hits = len(title_tokens & win_words)
                auth_hits = len(author_surnames & win_words)
                vn_hits = sum(1 for vp in vn_concept_cues if vp in win_lower)
                if kw_hits > 0 or auth_hits > 0 or vn_hits > 0:
                    pre_score = (
                        kw_hits * 2.0
                        + auth_hits * 3.0
                        + vn_hits * 2.2
                        + min(len(window), 260) / 300.0
                    )
                    candidate_passages.append((page_num, window[:360], pre_score))

        if not candidate_passages:
            return None

        # Keep top 8 keyword-relevant body windows and rank them with Sentence-BERT against title + abstract
        candidate_passages.sort(key=lambda item: item[2], reverse=True)
        top_windows = candidate_passages[:8]

        try:
            target_text = f"{source_title}. {self._truncate_text(source_abstract or '', 320)}".strip()
            encoded_windows: list[str] = []
            for _, win_text, _ in top_windows:
                is_xl, bridged_win = self.detect_and_bridge_cross_lingual(
                    win_text, source_title, source_abstract
                )
                encoded_windows.append(bridged_win if (is_xl and bridged_win) else win_text)

            batch_texts = [target_text] + encoded_windows
            embs = self._encode(
                model,
                batch_texts,
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            if len(embs) != len(batch_texts):
                return top_windows[0][0], top_windows[0][1], 0.5

            target_emb = embs[0]
            best_idx = 0
            best_sim = -1.0
            for idx in range(len(top_windows)):
                sim = float((target_emb @ embs[1 + idx]).item())
                if sim > best_sim:
                    best_sim = sim
                    best_idx = idx

            best_page, best_text, _ = top_windows[best_idx]
            return best_page, best_text, max(0.0, min(1.0, best_sim))
        except Exception:  # noqa: BLE001
            return top_windows[0][0], top_windows[0][1], 0.5

    @staticmethod
    def _sanitize_abstract(text: str | None) -> str | None:
        """Clean XML/JATS/HTML tags, entities, and leading 'Abstract:' prefix from source abstracts."""
        if not text or not isinstance(text, str):
            return None
        import html

        cleaned = re.sub(r"<[^>]+>", " ", text)
        cleaned = html.unescape(cleaned)
        cleaned = " ".join(cleaned.split()).strip()
        cleaned = re.sub(r"^(?:abstract|summary)\s*[:.\-—]?\s+", "", cleaned, flags=re.IGNORECASE)
        return cleaned if cleaned else None

    def _get_intent_embeddings(self, model: object) -> Any:
        """Lazy-compute and cache embeddings for the 3 citation intent prototypes."""
        key = self.model_name
        if key not in self._intent_emb_cache:
            try:
                proto_texts = list(_INTENT_PROTOTYPES.values())
                self._intent_emb_cache[key] = self._encode(
                    model,
                    proto_texts,
                    convert_to_tensor=True,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                )
            except Exception:  # noqa: BLE001
                return None
        return self._intent_emb_cache.get(key)

    def _compute_similarity(
        self,
        model: object,
        text1: str,
        text2: str,
    ) -> float:
        """Compute cosine similarity giữa 2 texts."""
        try:
            embs = self._encode(
                model,
                [text1, text2],
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            cos = (embs[0] @ embs[1]).item()
            return max(0.0, min(1.0, float(cos)))
        except Exception:  # noqa: BLE001
            return 0.0

    def _compute_similarity_with_long_text(
        self,
        model: object,
        short_text: str,
        long_text: str,
        max_sample_length: int = 512,
    ) -> float:
        """So sánh short text với long text bằng cách sample segments."""
        try:
            segments = self._split_into_segments(long_text, max_sample_length)
            if not segments:
                return 0.0

            short_emb = self._encode(
                model,
                short_text,
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )

            similarities = []
            for segment in segments[:5]:
                seg_emb = self._encode(
                    model,
                    segment,
                    convert_to_tensor=True,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                )
                sim = (short_emb @ seg_emb).item()
                similarities.append(sim)

            return max(similarities) if similarities else 0.0

        except Exception:  # noqa: BLE001
            return 0.0

    def _extract_sentences(self, text: str) -> list[str]:
        """Split abstract/text into individual substantive sentences for sentence-level alignment."""
        if not text:
            return []
        protected = self._protect_abbreviations(text)
        raw_sentences = re.split(r"[.!?]+(?:\s+|$)|\n+", protected)
        return [
            s.replace("<DOT>", ".").strip()
            for s in raw_sentences
            if len(s.replace("<DOT>", ".").strip()) >= 25
        ]

    def _split_into_segments(self, text: str, max_length: int) -> list[str]:
        """Split text thành các segments có độ dài ~max_length."""
        if len(text) <= max_length:
            return [text]

        sentences = re.split(r"[.!?]+", text)
        segments = []
        current_segment = ""

        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue

            if len(current_segment) + len(sentence) + 1 <= max_length:
                current_segment += ". " + sentence if current_segment else sentence
            else:
                if current_segment:
                    segments.append(current_segment)
                current_segment = sentence

        if current_segment:
            segments.append(current_segment)

        return segments

    def _truncate_text(self, text: str, max_length: int = 512) -> str:
        """Truncate text to max length."""
        if not text:
            return ""
        text = text.strip()
        if len(text) <= max_length:
            return text
        return text[: max_length - 3] + "..."

    def _determine_alignment(self, similarity: float) -> tuple[str, bool]:
        """Determine confidence level và alignment status từ similarity score."""
        if similarity >= self.ALIGNMENT_THRESHOLD_HIGH:
            return "high", True
        elif similarity >= self.ALIGNMENT_THRESHOLD_MEDIUM:
            return "medium", True
        elif similarity >= self.ALIGNMENT_THRESHOLD_LOW:
            return "medium", False
        else:
            return "low", False

    # === Utility methods ===

    def batch_similarity(self, text_pairs: list[tuple[str, str]]) -> list[float]:
        """Compute similarity cho nhiều text pairs cùng lúc (optimized)."""
        if not text_pairs:
            return []

        model = self._get_model()
        if model is None:
            return [0.0] * len(text_pairs)

        try:
            texts = []
            for t1, t2 in text_pairs:
                texts.extend([self._truncate_text(t1), self._truncate_text(t2)])

            embs = self._encode(
                model,
                texts,
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
                batch_size=32,
            )

            similarities = []
            for i in range(0, len(texts), 2):
                cos = (embs[i] @ embs[i + 1]).item()
                similarities.append(max(0.0, min(1.0, float(cos))))

            return similarities

        except Exception as e:  # noqa: BLE001
            logger.warning(f"Batch similarity failed: {e}")
            return [0.0] * len(text_pairs)
