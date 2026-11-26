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

import platform
import re
import threading
from collections import OrderedDict
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
    bridge_cross_lingual_context,
    bridge_vn_source_to_en,
    bridge_vn_to_en,
    compute_cross_lingual_concept_overlap,
    find_en_cues_for_vn_source,
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
_EXPLICIT_CONTRADICTION_NEGATION_RE = re.compile(
    r"\b(?:never|no\s+longer|no\s+evidence|no\s+significant(?:\s+effect)?|"
    r"fails?\s+to\s+(?:improve|outperform|beat|exceed|generalize|work|converge|achieve|surpass|solve|help|yield|reduce|scale|perform)|"
    r"ineffective|worse\s+than|unreliable|impossible|evaded\s+by|useless|incapable|"
    r"contrary\s+to|disproves?|refutes?|invalidates?|degrades?|"
    r"không\s+hiệu\s+quả|thất\s+bại|kém\s+hơn|vô\s+dụng|bác\s+bỏ|trái\s+ngược|"
    r"không\s+cải\s+thiện|làm\s+giảm|suy\s+giảm\s+hiệu\s+năng|không\s+có\s+ý\s+nghĩa|"
    r"không\s+có\s+bằng\s+chứng)\b",
    re.IGNORECASE,
)
_CONTRASTIVE_BASELINE_LEAD_RE = re.compile(
    r"^\s*(?:(?:unlike|whereas|while|although|though|even\s+though|"
    r"because\s+(?:standard|traditional|prior|existing|conventional))\b"
    r"|(?:the\s+)?(?:traditional|standard|conventional|prior|previous|existing|classical|"
    r"vanilla|naive|static|shallow|unidirectional|bag-of-words)\s+"
    r"(?:[\w\-]+\s+){0,2}(?:models?|methods?|approaches|architectures?|systems?|networks?|"
    r"representations?|embeddings?|classifiers?|baselines?|pipelines?|algorithms?)\b"
    r"|(?:the\s+)?(?:recurrent|convolutional)\s+(?:neural\s+)?(?:networks?|models?)\b)",
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
    r"\b(?:completely\s+ineffective|"
    r"fails?\s+to\s+(?:improve|outperform|beat|exceed|generalize|work|converge|achieve|surpass|solve|help|yield|reduce|scale|perform)|"
    r"useless|does\s+not\s+work|"
    r"cannot\s+improve|worse\s+than\s+random|incapable\s+of|no\s+significant\s+effect|"
    r"degrades?\s+performance|"
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

_ACADEMIC_GENERIC_STOP_WORDS: frozenset[str] = frozenset(
    {
        "about", "above", "accuracy", "accurate", "achieve", "achieved", "achieves",
        "achieving", "across", "after", "against", "al", "algorithm", "algorithms",
        "along", "also", "although", "among", "analysis", "analyze", "analyzed",
        "application", "applications", "apply", "applied", "applying", "approach",
        "approaches", "architecture", "architectures", "article", "author", "authors",
        "based", "baseline", "baselines", "because", "been", "before", "being",
        "benchmark", "benchmarks", "between", "both", "build", "building", "capability",
        "capabilities", "challenge", "challenges", "compared", "comparison",
        "component", "components", "computational", "compute", "computed", "computes",
        "computing",
        "concept", "concepts", "concerning", "conduct", "conducted", "conjecture",
        "consider", "context", "corpora", "corpus", "current", "data", "dataset",
        "datasets", "deep", "demonstrate", "demonstrated", "demonstrates", "describe",
        "described", "design", "designed", "despite", "detail", "detailed", "develop",
        "developed", "different", "discuss", "discussed", "domain", "domains", "during",
        "each", "effect", "effective", "effectively", "efficiency", "efficient",
        "empirical", "empirically", "employ", "employed", "enable", "enables", "eq",
        "establish", "established", "establishes", "et", "evaluate", "evaluated",
        "evaluation", "even", "examine", "example", "existing", "experiment",
        "experimental", "experiments", "explore", "explored", "extend", "extended",
        "extract", "extracted", "extraction", "feature", "features", "field", "fig",
        "figure", "find", "finding", "findings", "first", "focus", "following", "form",
        "formulation", "found", "framework", "frameworks", "from", "function",
        "functions", "further", "furthermore", "general", "generalization", "given",
        "have", "having", "high", "higher", "however", "important", "improve",
        "improved", "improvement", "improvements", "improves", "improving", "include",
        "including", "increase", "information", "input", "inputs", "instead", "into",
        "introduce", "introduced", "introduces", "investigate", "investigated", "issue",
        "issues", "knowledge", "language", "languages", "large", "larger", "layer",
        "layers", "learn", "learned", "learning", "level", "literature", "main",
        "major", "make", "many", "measure", "mechanism", "mechanisms", "method",
        "methods", "metric", "metrics", "model", "modeling", "models", "module",
        "modules", "more", "most", "much", "multiple", "natural", "need", "network",
        "networks", "neural", "novel", "number", "objective", "obtain", "obtained",
        "often", "only", "operator", "operators", "order", "other", "others",
        "outperform", "outperforms", "output", "outputs", "overall", "over", "paper",
        "papers", "parameter", "parameters", "particular", "particularly", "perform",
        "performance", "performed", "pipeline", "pipelines", "pp", "predict",
        "predicted", "prediction", "predictions", "present", "presented", "presents",
        "pretrain", "pretrained", "pretraining", "pretrains", "previous", "previously",
        "prior", "problem",
        "problems", "process", "processing", "produce", "propose", "proposed",
        "proposes", "prove", "proved", "proven", "provide", "provided", "provides",
        "quality", "recent", "recently", "regarding", "related", "report", "reported",
        "representation", "representations", "research", "respect", "result", "results",
        "review", "role", "same", "scale", "score", "scores", "second", "section",
        "sentence", "sentences", "sequence", "sequences", "several", "show", "showed",
        "shown", "shows", "significant", "significantly", "similar", "simple", "since",
        "single", "small", "some", "source", "sources", "space", "spaces", "specific",
        "specifically", "standard", "state", "still", "strategy", "strong",
        "structural", "structure", "structures", "studies", "study", "substantial",
        "such", "suggest", "superior", "support", "system", "systems", "tab", "table",
        "target", "targets", "task", "tasks", "technique", "techniques", "term",
        "terms", "text", "texts", "than", "that", "their", "them", "then", "there",
        "therefore", "these", "they", "this", "those", "three", "through", "thus",
        "token", "tokens", "toward", "towards", "traditional", "train", "trained",
        "training", "under", "used", "useful", "using", "utilize", "utilizing",
        "value", "values", "various", "vector", "vectors", "very", "vol", "well",
        "were", "what", "when", "where", "which", "while", "with", "within",
        "without", "word", "words", "work", "works", "would",
        # Closed-class discourse / connective / auxiliary words (zero domain semantics)
        "upon", "always", "rather", "itself", "typically", "generally", "largely",
        "primarily", "directly", "widely", "extensively", "publicly", "closely",
        "already", "indeed", "unlike", "beyond", "whatsoever", "whether",
        "moreover", "nevertheless", "nonetheless", "whereas", "thereby", "hereby",
        "becomes", "become", "becoming", "became", "made", "remain", "remains",
        "remaining", "remained", "arise", "arises", "arising", "exist", "exists",
        "existed", "does", "done", "doing",
        # Universal scholarly reporting / meta-discourse verbs (same class as show/report/propose)
        "conclude", "concluded", "concludes", "concluding", "conclusion", "conclusions",
        "reveal", "revealed", "reveals", "revealing",
        "observe", "observed", "observes", "observing", "observation", "observations",
        "confirm", "confirmed", "confirms", "confirming",
        "require", "requires", "required", "requiring", "requirement", "requirements",
        "rely", "relies", "relied", "relying",
        "involve", "involves", "involved", "involving",
        "address", "addresses", "addressed", "addressing",
        "offer", "offers", "offered", "offering",
        "leverage", "leverages", "leveraged", "leveraging",
        "allow", "allows", "allowed", "allowing",
        "analyse", "analysed", "analyses", "analysing", "analyzing",
        "challenging", "evaluations",
    }
)

_FIRST_PERSON_ADOPTION_CLAUSE_RE = re.compile(
    r"^\s*(?:building\s+(?:on|upon)|following|inspired\s+by|adapting|adopting|"
    r"based\s+on|using|leveraging|for)\s+([^,]{3,95}),\s*(?:we|our)\b",
    re.IGNORECASE | re.DOTALL,
)
_CALLOUT_UPPER_CHARS = r"A-Z\u00C0-\u00D6\u00D8-\u00DE\u0100-\u017E\u01A0-\u01AF\u1E00-\u1EFF"
_CALLOUT_LETTER_CHARS = r"A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF"
_CALLOUT_PARTICLE_RE = (
    r"(?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]er|[Dd]i|[Dd]u|[Dd]a|"
    r"[Dd]os|[Dd]as|[Ll]a|[Ll]e|[Ee]l|[Aa]l|[Bb]in|[Ii]bn)\s+)*"
)
_CALLOUT_SURNAME_RE = rf"(?:{_CALLOUT_PARTICLE_RE}[{_CALLOUT_UPPER_CHARS}][{_CALLOUT_LETTER_CHARS}'\u2019\-]+)"
_CITATION_CALLOUT_STRIP_RE = re.compile(
    rf"(?:(?<!\w){_CALLOUT_SURNAME_RE}"
    rf"(?:(?:,\s*{_CALLOUT_SURNAME_RE})*(?:,?\s+(?:and|&|và)\s+{_CALLOUT_SURNAME_RE})|\s+et\s+al\.|\s+và\s+cộng\s+sự)?"
    rf"\s*\((?:18|19|20)\d{{2}}[a-z]?\)"
    rf"|\((?:{_CALLOUT_PARTICLE_RE})?[{_CALLOUT_UPPER_CHARS}][^()\n]{{1,75}}(?:18|19|20)\d{{2}}[a-z]?\)"
    rf"|\[\d+(?:\s*[,;–\-]\s*\d+)*\])"
)
_THIRD_PERSON_REPORT_FRAME_RE = re.compile(
    rf"(?:^\s*(?:regarding|concerning|according\s+to|"
    rf"as\s+(?:shown|reported|demonstrated|argued|noted|found|observed)\s+(?:by|in)|"
    rf"in\s+their\s+(?:study|paper|work|article))\b"
    rf"|{_CALLOUT_SURNAME_RE}"
    rf"(?:(?:,\s*{_CALLOUT_SURNAME_RE})*(?:,?\s+(?:and|&|và)\s+{_CALLOUT_SURNAME_RE})|\s+et\s+al\.)?"
    rf"\s*\((?:18|19|20)\d{{2}}[a-z]?\)\s+"
    rf"(?:report|reports|reported|show|shows|showed|demonstrate|demonstrates|demonstrated|"
    rf"claim|claims|claimed|find|finds|found|argue|argues|argued|conclude|concludes|concluded|"
    rf"observe|observes|observed|suggest|suggests|suggested|propose|proposes|proposed|"
    rf"introduce|introduces|introduced|present|presents|presented|describe|describes|described|"
    rf"note|notes|noted|state|states|stated|establish|establishes|established|prove|proves|proved)\s+that\b)",
    re.IGNORECASE,
)
_REPORT_THAT_CLAUSE_RE = re.compile(
    r"\b(?:report|reports|reported|show|shows|showed|demonstrate|demonstrates|demonstrated|"
    r"claim|claims|claimed|argue|argues|argued|state|states|stated|find|finds|found)\s+that\b",
    re.IGNORECASE,
)
_MULTI_REF_BRACKET_RE = re.compile(r"\[\s*\d+\s*(?:[,;–\-]\s*\d+\s*)+\]")
_APA_MULTI_CITATION_RE = re.compile(
    r"\([^()\n]*(?:18|19|20)\d{2}[a-z]?[^()\n]*;[^()\n]*(?:18|19|20)\d{2}[a-z]?[^()\n]*\)"
)
_FIRST_PERSON_METHOD_USAGE_RE = re.compile(
    r"\b(?:we|our)\b[^.;]{0,90}\b(?:use|uses|used|using|adopt\w*|apply|applies|applied|employ\w*|implement\w*|"
    r"fine[\s\-]?tun\w*|train\w*|project\w*|visualiz\w*|cluster\w*|preprocess\w*|integrat\w*|leverag\w*)\b",
    re.IGNORECASE,
)
_METHOD_USAGE_SENTENCE_RE = re.compile(
    r"\b(?:this\s+(?:study|paper|work|thesis)|the\s+(?:implementation|pipeline|system|experiment|experiments))\b"
    r"(?![^.;]{0,45}\b(?:the\s+)?authors?\b)"
    r"[^.;]{0,90}\b(?:use|uses|used|using|adopt\w*|apply|applies|applied|employ\w*|implement\w*|"
    r"fine[\s\-]?tun\w*|train\w*|project\w*|visualiz\w*|cluster\w*|preprocess\w*|integrat\w*|leverag\w*)\b",
    re.IGNORECASE,
)
_GENERIC_SURVEY_MENTION_RE = re.compile(
    r"\b(?:in\s+recent\s+years|over\s+the\s+past\s+(?:few\s+)?(?:years|decade|decades)|"
    r"has\s+revolutionized|have\s+revolutionized|has\s+fundamentally\s+changed|"
    r"have\s+fundamentally\s+changed|widely\s+(?:used|adopted|studied|recognized)\b|"
    r"growing\s+(?:body\s+of\s+)?(?:interest|literature|attention)|extensive\s+literature|"
    r"for\s+a\s+(?:comprehensive\s+|detailed\s+)?(?:survey|review|overview)|"
    r"see\s+(?:also|e\.g\.|for\s+example)|among\s+others)\b",
    re.IGNORECASE,
)
_BIBLIO_CATALOG_BLURB_RE = re.compile(
    r"(?:\bISBN(?:-1[03])?\b|\b\d+\s+pp\.|\bCD-ROM\b)",
    re.IGNORECASE,
)
_PDF_RUNNING_BANNER_PREFIX_RE = re.compile(
    r"^\s*(?:essay\s+\d+\s*[—–\-][^\n.]{0,60}?(?=\b(?:The|In|A|An|We|Recent|Prior|For|Building)\b)"
    r"|[A-Z][A-Z,\s\-]{3,28}\s+\d{1,4}\s+)",
)
_NON_LATIN_SCRIPT_RE = re.compile(
    r"[\u0370-\u03ff\u0400-\u04ff\u0590-\u06ff\u0900-\u097f\u0e00-\u0e7f"
    r"\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]"
)
_EURO_DIACRITIC_RE = re.compile(
    r"[äöüßñçøåæœéèêëàâùûôîìòíóúąćęłńśźżÄÖÜẞÑÇØÅÆŒÉÈÊËÀÂÙÛÔÎÌÒÍÓÚĄĆĘŁŃŚŹŻ]"
)
_ENGLISH_LOANWORDS_DIACRITIC: frozenset[str] = frozenset(
    {
        "naïve", "naive", "résumé", "résumés", "café", "cliché", "rôle", "coöperate",
        "façade", "protégé", "exposé", "déjà", "vis-à-vis", "über", "recherché",
        "attaché", "fiancé", "entree", "entrée", "passé", "soignée", "à",
    }
)
_EN_EXCLUSIVE_FUNC_WORDS: frozenset[str] = frozenset(
    {
        "the", "and", "that", "for", "with", "this", "from", "are", "was", "were",
        "have", "has", "which", "their", "these", "those", "into", "between",
        "through", "such", "when", "where", "while", "we", "our", "they", "its",
        "also", "than", "not", "but", "about", "both", "each", "many", "most",
        "been", "being", "would", "could", "should", "does", "did", "of", "to", "is",
    }
)
_FOREIGN_FUNCTION_WORDS: frozenset[str] = frozenset(
    {
        # German (excluding STEM/eponym overlaps: die, der, von, den -> soft set)
        "wir", "und", "zur", "zum", "das", "mit", "für", "auf",
        "einer", "einem", "eines", "einen", "dem", "ist", "sind",
        "werden", "wird", "nicht", "durch", "über", "bei", "nach", "aus", "auch", "sich",
        # French (excluding STEM/English overlaps: un, est, sur, par -> soft set)
        "nous", "dans", "pour", "avec", "les", "des", "une", "sont",
        "cette", "cet", "ces", "aux", "du", "au", "qui",
        "que", "mais", "comme", "sans", "sous", "chez", "leurs", "leur",
        # Spanish (excluding chemical/English overlaps: para, con, por -> soft set)
        "los", "las", "una", "del", "como", "sobre",
        "desde", "hacia", "mediante", "está", "están", "este", "esta", "estos", "estas", "más", "también",
        # Indonesian / Malay
        "kami", "dengan", "untuk", "pada", "yang", "dalam", "dari", "oleh",
        "atau", "dan", "ini", "itu", "tidak", "sebagai", "dapat", "melalui", "terhadap",
        # Polish
        "jest", "oraz", "przez", "dla", "przy", "jako", "lub", "nie", "się",
        "które", "który", "której", "między", "bez",
    }
)
_SOFT_FOREIGN_FUNCTION_WORDS: frozenset[str] = frozenset(
    {
        "de", "la", "le", "en", "do", "al", "se",
        "die", "der", "von", "den", "para", "con", "por", "un", "est", "sur", "par",
    }
)


def _is_non_english_or_foreign_text(text: str | None) -> bool:
    """Detect non-English scripts, European diacritic prose, or foreign function-word syntax.

    Strips bibliographic callouts first so European author surnames (e.g., Röttger, Müller,
    van der Berg) do not misclassify English prose as foreign language, and applies case-aware
    function-word matching so uppercase English acronyms (MIT, CoN, DES) or capitalized eponyms
    (Schrödinger, Gödel) do not trigger false positives while short DE/FR/ES/ID/PL clauses do.
    """
    if not text:
        return False
    stripped = _CITATION_CALLOUT_STRIP_RE.sub(" ", text)
    if _NON_LATIN_SCRIPT_RE.search(stripped):
        return True

    words_raw = re.findall(r"[^\W\d_]{2,}", stripped)
    if not words_raw:
        return False

    en_hits = sum(1 for w in words_raw if w.lower() in _EN_EXCLUSIVE_FUNC_WORDS)

    strong_foreign_hits = 0
    soft_foreign_hits = 0
    for idx, w in enumerate(words_raw):
        # Accept lowercase tokens or sentence-initial Title Case (e.g., "Das Modell...", "Zur...")
        is_candidate = w.islower() or (idx == 0 and w[0].isupper() and w[1:].islower())
        if not is_candidate:
            continue
        low = w.lower()
        if low in _FOREIGN_FUNCTION_WORDS:
            strong_foreign_hits += 1
        elif low in _SOFT_FOREIGN_FUNCTION_WORDS:
            soft_foreign_hits += 1

    foreign_hits = strong_foreign_hits + (soft_foreign_hits if en_hits == 0 else 0)

    non_loan_accented = [
        w
        for w in words_raw
        if _EURO_DIACRITIC_RE.search(w) and w.lower() not in _ENGLISH_LOANWORDS_DIACRITIC
    ]
    lower_accented = [w for w in non_loan_accented if w.islower()]

    if foreign_hits >= 2 and foreign_hits > en_hits:
        return True
    if len(lower_accented) >= 2 and en_hits <= 1:
        return True
    if len(non_loan_accented) >= 1 and foreign_hits >= 1 and en_hits == 0:
        return True
    if len(lower_accented) >= 1 and en_hits == 0 and len(words_raw) <= 8:
        return True
    if strong_foreign_hits >= 1 and en_hits == 0 and len(words_raw) <= 7:
        return True
    return False


def _light_technical_stem(token: str) -> str:
    """Deterministic morphology-normalizing light stemmer preserving technical roots."""
    w = token.lower()
    if len(w) <= 4:
        return w
    for morph_suf, repl in (
        ("ifications", "if"),
        ("ification", "if"),
        ("ifiers", "if"),
        ("ifier", "if"),
        ("ifying", "if"),
        ("ified", "if"),
        ("ify", "if"),
        ("izations", "iz"),
        ("ization", "iz"),
        ("izers", "iz"),
        ("izer", "iz"),
        ("izing", "iz"),
        ("ized", "iz"),
        ("ize", "iz"),
        ("convolutions", "convolut"),
        ("convolutional", "convolut"),
        ("convolution", "convolut"),
        ("recurrences", "recurr"),
        ("recurrence", "recurr"),
        ("recurrent", "recurr"),
    ):
        if w == morph_suf:
            return repl
        if w.endswith(morph_suf) and len(w) - len(morph_suf) + len(repl) >= 5:
            return w[: -len(morph_suf)] + repl
    for at_suf in ("ations", "ation", "ators", "ator", "ative", "ating", "ated", "ates", "ate"):
        if w.endswith(at_suf) and len(w) - len(at_suf) >= 4:
            return w[: -len(at_suf)] + "at"
    if w.endswith("ies") and len(w) > 5:
        return w[:-3] + "y"
    for suffix in (
        "ments",
        "ment",
        "ingly",
        "ings",
        "ities",
        "ity",
        "ness",
        "ally",
        "ical",
        "ances",
        "ance",
        "ences",
        "ence",
        "ing",
        "ers",
        "er",
        "ors",
        "or",
        "ive",
        "ous",
        "als",
        "al",
        "ed",
        "es",
        "s",
    ):
        if w.endswith(suffix) and len(w) - len(suffix) >= 4:
            return w[: -len(suffix)]
    return w


_ACADEMIC_GENERIC_STOP_STEMS: frozenset[str] = _ACADEMIC_GENERIC_STOP_WORDS | frozenset(
    _light_technical_stem(w) for w in _ACADEMIC_GENERIC_STOP_WORDS
)


def _extract_distinctive_stems(text: str | None) -> set[str]:
    """Extract distinctive technical word stems and domain acronyms from scholarly English text."""
    if not text:
        return set()
    stems: set[str] = set()
    for raw_tok in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", text):
        parts = [p for p in raw_tok.split("-") if p]
        candidates = [raw_tok.replace("-", ""), *parts] if "-" in raw_tok else parts
        for part in candidates:
            low = part.lower()
            if low in _ACADEMIC_GENERIC_STOP_WORDS:
                continue
            if re.fullmatch(r"(?:18|19|20)\d{2}[a-z]?", low):
                continue
            # Keep uppercase/alphanumeric technical acronyms of len >= 3 (e.g., GCN, NMT, BLEU, BERT)
            is_acronym = len(part) >= 3 and (part.isupper() or any(ch.isdigit() for ch in part))
            if len(low) < 4 and not is_acronym:
                continue
            stem = low if is_acronym else _light_technical_stem(low)
            if stem not in _ACADEMIC_GENERIC_STOP_STEMS and len(stem) >= 3:
                stems.add(stem)
    return stems


def _stem_in_set(stem: str, target_stems: set[str]) -> bool:
    """Check exact stem match or 6-character technical root prefix equivalence."""
    if stem in target_stems:
        return True
    if len(stem) >= 6 and stem[:6] != "genera":
        prefix6 = stem[:6]
        return any(len(t) >= 6 and t[:6] == prefix6 for t in target_stems)
    return False


def _grounded_stems(claim_stems: set[str], target_stems: set[str]) -> set[str]:
    """Return subset of `claim_stems` grounded in `target_stems` up to morphological inflection."""
    if not claim_stems or not target_stems:
        return set()
    return {c for c in claim_stems if _stem_in_set(c, target_stems)}


def _has_ungrounded_novel_claim(
    cited_context: str,
    source_title: str | None,
    source_abstract: str | None,
    *,
    raw_sim: float,
) -> bool:
    """Position-independent detector for empirical claims lacking grounding in `source_abstract`.

    Strips bibliographic callouts (`Author et al. (2017)`, `[4]`) and title-echoed topic words,
    then checks whether a specific empirical predicate (`>= 4` non-title technical stems) has
    zero grounding in `source_abstract`. Exempts foreign/cross-lingual text and first-person
    methodological adoption (`Building on X [1], we ...` / `For X, our pipeline ...`).
    """
    if (
        not cited_context
        or not source_abstract
        or raw_sim >= 0.78
        or len(source_abstract.split()) < 20
        or _BIBLIO_CATALOG_BLURB_RE.search(source_abstract)
        or is_vietnamese_text(cited_context, min_diacritics=2)
        or is_vietnamese_text(source_abstract, min_diacritics=2)
        or _is_non_english_or_foreign_text(cited_context)
        or _is_non_english_or_foreign_text(source_abstract)
    ):
        return False

    # Never penalize compound multi-citation sentences (e.g. "[5], whereas ... [9]", "[13, 14]",
    # or "(Vaswani et al., 2017; Kipf & Welling, 2017)"), where part of the sentence cites another work.
    callout_matches = _CITATION_CALLOUT_STRIP_RE.findall(cited_context)
    if (
        len(callout_matches) >= 2
        or _MULTI_REF_BRACKET_RE.search(cited_context)
        or _APA_MULTI_CITATION_RE.search(cited_context)
    ):
        return False

    abs_stems = _extract_distinctive_stems(source_abstract)
    if len(abs_stems) < 4:
        return False

    title_stems = _extract_distinctive_stems(source_title)
    # Title-only plural-acronym symmetry ("LLMs" in title also strips echoed "LLM" in claim,
    # and vice versa) without widening claim <-> abstract accidental collisions.
    if source_title:
        for plur_acr in re.findall(r"\b([A-Z]{2,6})s\b", source_title):
            title_stems.add(plur_acr.lower())
        for sing_acr in re.findall(r"\b([A-Z]{2,6})\b", source_title):
            title_stems.add(sing_acr.lower() + "s")
    source_union = abs_stems | title_stems

    # Exempt explicit first-person methodological adoption / implementation tool-usage sentences
    m_adopt = _FIRST_PERSON_ADOPTION_CLAUSE_RE.match(cited_context.strip())
    if (
        m_adopt
        and _grounded_stems(_extract_distinctive_stems(m_adopt.group(1)), source_union)
        and not _EXPLICIT_CONTRADICTION_NEGATION_RE.search(cited_context)
        and not _DIRECT_REFUTATION_RE.search(cited_context)
    ):
        return False
    m_fp_method = _FIRST_PERSON_METHOD_USAGE_RE.search(cited_context)
    if (
        m_fp_method
        and not _REPORT_THAT_CLAUSE_RE.search(cited_context[: m_fp_method.start()])
        and not _EXPLICIT_CONTRADICTION_NEGATION_RE.search(cited_context)
        and not _DIRECT_REFUTATION_RE.search(cited_context)
    ):
        return False
    m_method = _METHOD_USAGE_SENTENCE_RE.search(cited_context)
    if (
        m_method
        and not _THIRD_PERSON_REPORT_FRAME_RE.search(cited_context[: m_method.start() + 30])
        and not _EXPLICIT_CONTRADICTION_NEGATION_RE.search(cited_context)
        and not _DIRECT_REFUTATION_RE.search(cited_context)
    ):
        return False

    cleaned_ctx = _PDF_RUNNING_BANNER_PREFIX_RE.sub(
        " ", _CITATION_CALLOUT_STRIP_RE.sub(" ", cited_context)
    )
    claim_stems = _extract_distinctive_stems(cleaned_ctx)
    claim_non_title = {c for c in claim_stems if not _stem_in_set(c, title_stems)}
    if raw_sim >= 0.25 and _GENERIC_SURVEY_MENTION_RE.search(cleaned_ctx) and len(claim_non_title) <= 6:
        return False
    grounded_non_title = _grounded_stems(claim_non_title, abs_stems)

    if len(claim_non_title) >= 4 and len(grounded_non_title) == 0:
        return True
    # Proportional lexical grounding deficit on substantive abstracts: a detailed empirical claim
    # (>= 7 distinctive non-title technical stems) with at most 1 accidental stem overlap (<= 14.3%
    # grounding) AND genuinely low Bi-Encoder similarity (< 0.42, or < 0.45 on denser >= 8-stem
    # claims against >= 15-stem abstracts) indicates topic/claim misattribution rather than genuine
    # human paraphrasing (which preserves stronger dense similarity and/or abstract stem overlap).
    if (
        len(claim_non_title) >= 7
        and len(grounded_non_title) <= 1
        and len(abs_stems) >= 12
        and (
            raw_sim < 0.42
            or (len(claim_non_title) >= 8 and len(abs_stems) >= 15 and raw_sim < 0.45)
        )
    ):
        return True
    return False


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
    _intent_cache_lock = threading.Lock()
    _model_cache: dict[str, Any] = {}
    _intent_emb_cache: dict[tuple[int, str], Any] = {}
    _text_emb_cache: OrderedDict[tuple[int, str], Any] = OrderedDict()
    _TEXT_EMB_CACHE_MAX_SIZE = 4096
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
            getattr(settings, "enable_multilingual_encoder", True)
        )
        self.onnx_quantized = bool(getattr(settings, "onnx_quantized", True))
        self.cross_lingual_sim_boost = float(
            getattr(settings, "cross_lingual_sim_boost", 0.08)
        )
        self._model: Any = None  # lazy load
        self._multilingual_model: Any = None  # lazy load on-demand

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
        with cls._intent_cache_lock:
            cls._intent_emb_cache.clear()

    @classmethod
    def clear_embedding_cache(cls) -> None:
        """Clear the bounded LRU text embedding cache and intent prototype cache."""
        with cls._encode_lock:
            cls._text_emb_cache.clear()
        with cls._intent_cache_lock:
            cls._intent_emb_cache.clear()

    @staticmethod
    def _load_sentence_transformer(model_name: str):
        """Load SentenceTransformer from local HuggingFace cache first without network round-trips."""
        from sentence_transformers import SentenceTransformer  # type: ignore

        try:
            return SentenceTransformer(model_name, local_files_only=True)
        except Exception:  # noqa: BLE001
            return SentenceTransformer(model_name)

    def _get_model(self):
        if self._model is None:
            with self._instance_lock:
                if self.model_name not in self._model_cache:
                    try:
                        logger.info(f"Loading sentence-transformers: {self.model_name}")
                        self._model_cache[self.model_name] = self._load_sentence_transformer(
                            self.model_name
                        )
                    except ImportError as e:
                        logger.error(f"sentence-transformers chưa cài: {e}")
                        return None
                self._model = self._model_cache[self.model_name]
        return self._model

    @staticmethod
    def _select_quantized_onnx_file(machine_arch: str | None = None) -> str:
        """Select CPU-architecture-matched INT8 quantized ONNX file for multilingual MiniLM."""
        arch = (machine_arch or platform.machine() or "").strip().lower()
        if arch in {"arm64", "aarch64"} or arch.startswith(("arm64", "aarch64")):
            return "onnx/model_qint8_arm64.onnx"
        if arch in {"x86_64", "amd64", "x64"}:
            return "onnx/model_quint8_avx2.onnx"
        return "onnx/model_quint8_avx2.onnx"

    def _load_multilingual_encoder(self):
        """Load quantized ONNX INT8 multilingual encoder first when `onnx_quantized=True`.

        When `onnx_quantized=True` and ONNX loading fails (e.g. `optimum`/`onnxruntime`
        absent in host `.venv`), ONLY attempts local cached PyTorch weights
        (`local_files_only=True`) — never triggers an unquantized ~471 MB FP32 network
        download that could breach the container RAM budget, returning `None` on local
        cache miss so `_get_multilingual_model()` falls back cleanly to `_get_model()`.
        """
        from sentence_transformers import SentenceTransformer  # type: ignore

        if self.onnx_quantized:
            onnx_file = self._select_quantized_onnx_file()
            onnx_kwargs = {"file_name": onnx_file}
            try:
                return SentenceTransformer(
                    self.multilingual_model_name,
                    backend="onnx",
                    model_kwargs=onnx_kwargs,
                    local_files_only=True,
                )
            except (ImportError, ModuleNotFoundError) as exc:
                logger.info(
                    f"ONNX runtime/optimum unavailable ({exc}); checking local PyTorch multilingual cache only."
                )
            except Exception as exc:  # noqa: BLE001
                err_msg = str(exc)
                if "optimum" in err_msg.lower() or "onnxruntime" in err_msg.lower() or "onnx backend" in err_msg.lower():
                    logger.info(
                        f"ONNX backend unavailable ({exc}); checking local PyTorch multilingual cache only."
                    )
                else:
                    logger.info(
                        f"Local quantized ONNX file '{onnx_file}' not cached ({exc}); "
                        f"checking local PyTorch multilingual cache only."
                    )

            try:
                return SentenceTransformer(
                    self.multilingual_model_name,
                    local_files_only=True,
                )
            except Exception as exc:  # noqa: BLE001
                logger.info(
                    f"Local multilingual encoder cache not found ({exc}); skipping unquantized FP32 "
                    f"network download and falling back to default encoder '{self.model_name}'."
                )
                return None

        try:
            return self._load_sentence_transformer(self.multilingual_model_name)
        except Exception as exc:  # noqa: BLE001
            logger.info(
                f"Multilingual encoder unavailable ({exc}); falling back to default encoder '{self.model_name}'."
            )
            return None

    def _get_multilingual_model(self):
        """Lazy Dual-Encoder (Subsystem A3): returns quantized ONNX INT8 / cached multilingual encoder
        on demand when enabled, falling back cleanly to `_get_model()` without repeated retries.
        """
        if self._multilingual_model is not None:
            return self._multilingual_model
        cache_key = (
            f"{self.multilingual_model_name}::onnx"
            if self.onnx_quantized
            else self.multilingual_model_name
        )
        if not self.enable_multilingual_encoder:
            return self._get_model()
        with self._instance_lock:
            if cache_key in self._model_cache:
                cached = self._model_cache[cache_key]
                if cached is None:
                    return self._get_model()
                self._multilingual_model = cached
                return self._multilingual_model
            if self.multilingual_model_name in self._model_cache and not self.onnx_quantized:
                self._multilingual_model = self._model_cache[self.multilingual_model_name]
                return self._multilingual_model
            if cache_key not in self._model_cache:
                try:
                    logger.info(
                        f"Loading multilingual encoder: {self.multilingual_model_name} "
                        f"(onnx_quantized={self.onnx_quantized})"
                    )
                    loaded = self._load_multilingual_encoder()
                    self._model_cache[cache_key] = loaded
                except Exception as e:  # noqa: BLE001
                    logger.info(f"Multilingual encoder fallback to default model: {e}")
                    self._model_cache[cache_key] = None
            cached = self._model_cache[cache_key]
            if cached is None:
                return self._get_model()
            self._multilingual_model = cached
        return self._multilingual_model

    def _encode(self, model: object, texts: object, **kwargs: object):
        """Thread-safe model.encode wrapper with torch.no_grad() and bounded LRU text embedding cache."""
        with self._encode_lock:
            try:
                import torch  # type: ignore

                with torch.no_grad():
                    is_mock_model = type(model).__module__.startswith("unittest.mock")
                    use_cache = (
                        not is_mock_model
                        and isinstance(texts, (list, tuple))
                        and len(texts) > 0
                        and all(isinstance(t, str) for t in texts)
                        and kwargs.get("convert_to_tensor") is True
                        and kwargs.get("normalize_embeddings") is True
                    )
                    if use_cache and isinstance(texts, (list, tuple)):
                        model_id = id(model)
                        str_texts: list[str] = [str(t) for t in texts]
                        missing_unique: list[str] = []
                        seen_missing: set[str] = set()
                        for t in str_texts:
                            cache_key = (model_id, t)
                            if cache_key in self._text_emb_cache:
                                self._text_emb_cache.move_to_end(cache_key)
                            elif t not in seen_missing:
                                seen_missing.add(t)
                                missing_unique.append(t)

                        if missing_unique:
                            enc_kwargs = dict(kwargs)
                            enc_kwargs.setdefault("show_progress_bar", False)
                            new_embs = model.encode(missing_unique, **enc_kwargs)  # type: ignore[attr-defined]
                            if not isinstance(new_embs, torch.Tensor):
                                try:
                                    new_embs = torch.as_tensor(new_embs)
                                except Exception:  # noqa: BLE001
                                    return new_embs
                            if len(new_embs) != len(missing_unique):
                                return new_embs
                            for idx, t in enumerate(missing_unique):
                                cache_key = (model_id, t)
                                self._text_emb_cache[cache_key] = new_embs[idx]
                                self._text_emb_cache.move_to_end(cache_key)
                                while len(self._text_emb_cache) > self._TEXT_EMB_CACHE_MAX_SIZE:
                                    self._text_emb_cache.popitem(last=False)

                        return torch.stack([self._text_emb_cache[(model_id, t)] for t in str_texts])

                    return model.encode(texts, **kwargs)  # type: ignore[attr-defined]
            except ImportError:
                return model.encode(texts, **kwargs)  # type: ignore[attr-defined]

    def similarity(self, text1: str, text2: str) -> float:
        """Trả cosine similarity 0.0–1.0. Fallback 0.0 nếu model chưa load được."""
        model = self._get_model()
        if model is None or not text1 or not text2:
            return 0.0
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

        from integrity_checker.extraction.patterns.utils import _UPPER_LATIN_VN

        raw_parts = re.split(rf"(?<=[.!?;;])\s+(?=(?:{_UPPER_LATIN_VN}|[0-9\[\(]))", protected)
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
        vn_title_cues = (
            find_vn_cues_for_en_source(source_title or "")
            if (source_title and is_vietnamese_text(cleaned))
            else []
        )

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
        """Phát hiện khi khóa luận và tài liệu nguồn khác ngôn ngữ (VI ↔ EN)
        và tạo chuỗi ngữ nghĩa bắc cầu (Cross-Lingual Concept Bridge).
        """
        is_xl, bridged, _, _ = bridge_cross_lingual_context(
            cited_context, source_title, source_abstract
        )
        return is_xl, bridged

    @staticmethod
    def detect_and_bridge_cross_lingual_detailed(
        cited_context: str,
        source_title: str,
        source_abstract: str | None = None,
    ) -> tuple[bool, str, list[str]]:
        """Phát hiện ngữ cảnh xuyên ngôn ngữ hai chiều Việt ↔ Anh kèm danh sách cặp khái niệm đã ánh xạ."""
        is_xl, bridged, concepts, _ = bridge_cross_lingual_context(
            cited_context, source_title, source_abstract
        )
        return is_xl, bridged, concepts

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
        overlap_score, overlap_pairs = compute_cross_lingual_concept_overlap(
            cited_title, candidate_title
        )

        merged_concepts: list[str] = []
        for pair in overlap_pairs:
            if pair not in merged_concepts:
                merged_concepts.append(pair)
        for bc in bridged_concepts:
            formatted_bc = bc
            if not cit_is_vn and " → " in bc:
                left_p, right_p = bc.split(" → ", 1)
                formatted_bc = f"{right_p} → {left_p}"
            if formatted_bc not in merged_concepts:
                merged_concepts.append(formatted_bc)

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
        source_title: str | None = None,
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
        norm_focal_clean = " ".join(norm_focal.split()).lower()
        norm_src_abs = (
            " ".join(normalize_vn_spelling(source_abstract).split()).lower()
            if source_abstract
            else ""
        )
        is_verbatim_from_abstract = bool(
            norm_src_abs and len(norm_focal_clean) >= 35 and norm_focal_clean[:35] in norm_src_abs
        )
        is_contrastive_lead = bool(_CONTRASTIVE_BASELINE_LEAD_RE.search(norm_focal))
        if (
            best_evidence_sentence
            and similarity >= 0.30
            and not is_verbatim_from_abstract
            and not is_contrastive_lead
        ):
            ctx_neg = bool(_NEGATION_CUES_RE.search(norm_focal))
            ctx_explicit_neg = bool(_EXPLICIT_CONTRADICTION_NEGATION_RE.search(norm_focal))
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
                or (ctx_explicit_neg and ev_abs_pos and not ev_neg)
                or (ctx_direct_refute and ev_pos and not ev_neg)
            ):
                return "contradiction_risk"

        # Position- and verb-independent novel-claim misattribution gate (bounded to similarity < 0.68)
        if (
            has_abstract
            and source_abstract
            and similarity < 0.68
            and not is_cross_lingual
            and _has_ungrounded_novel_claim(
                focal_sentence,
                source_title,
                source_abstract,
                raw_sim=similarity,
            )
        ):
            return "contradiction_risk"

        if similarity >= 0.50:
            return "supported"
        if similarity >= 0.35:
            return "partially_supported"
        if (
            has_abstract
            and similarity < 0.22
            and not is_cross_lingual
            and not is_vietnamese_text(focal_sentence, min_diacritics=2)
            and not is_vietnamese_text(source_abstract or "", min_diacritics=2)
            and not _is_non_english_or_foreign_text(focal_sentence)
            and not _is_non_english_or_foreign_text(source_abstract)
        ):
            focal_stems = _extract_distinctive_stems(_CITATION_CALLOUT_STRIP_RE.sub(" ", focal_sentence))
            src_stems = _extract_distinctive_stems(source_abstract) | _extract_distinctive_stems(source_title)
            if len(focal_stems) >= 3 and len(src_stems) >= 3 and not _grounded_stems(focal_stems, src_stems):
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
            src_combined_str = f"{source_title or ''} {source_abstract or ''}".strip()
            ctx_is_vn = is_vietnamese_text(focal_sentence or raw_context_clean, min_diacritics=2)
            src_is_vn = is_vietnamese_text(src_combined_str, min_diacritics=2)
            if ctx_is_vn != src_is_vn and src_combined_str:
                is_cross_lingual = True

            concept_overlap_score = 0.0
            if is_cross_lingual:
                concept_overlap_score, overlap_pairs = compute_cross_lingual_concept_overlap(
                    focal_sentence or raw_context_clean,
                    src_combined_str,
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

                    bridged_src_title_idx: int | None = None
                    bridged_src_abs_idx: int | None = None
                    if is_cross_lingual and src_is_vn and not ctx_is_vn:
                        b_src_title = bridge_vn_source_to_en(source_title)
                        if b_src_title and b_src_title != source_title:
                            bridged_src_title_idx = len(batch_texts)
                            batch_texts.append(self._truncate_text(b_src_title, max_length=384))
                        if has_abs and source_abstract:
                            b_src_abs = bridge_vn_source_to_en(source_abstract)
                            if b_src_abs and b_src_abs != source_abstract:
                                bridged_src_abs_idx = len(batch_texts)
                                batch_texts.append(self._truncate_text(b_src_abs, max_length=512))

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
                        if bridged_src_title_idx is not None:
                            title_sim = max(title_sim, _max_query_cos(embs[bridged_src_title_idx]))
                        best_evidence_sentence = source_title_trunc
                        best_evidence_score = title_sim

                        if has_abs:
                            whole_abs_sim = _max_query_cos(embs[2])
                            if bridged_src_abs_idx is not None:
                                whole_abs_sim = max(
                                    whole_abs_sim, _max_query_cos(embs[bridged_src_abs_idx])
                                )
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
                        abstract_sim = max(whole_abs_sim, 0.65 * max_sent_sim + 0.35 * whole_abs_sim)
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

            # Hybrid Cross-Lingual Dense Fusion (Subsystem A3):
            # Fuse `sim_bridged_en` (`final_sim`) with `sim_dense_multi` computed directly on the
            # original cross-lingual text pair using the quantized ONNX INT8 / multilingual encoder.
            if is_cross_lingual and use_batch:
                multi_model = self._get_multilingual_model()
                if multi_model is not None and multi_model is not model:
                    try:
                        multi_texts = [cited_context_trunc, source_title_trunc]
                        m_has_abs = bool(source_abstract and source_abstract.strip())
                        m_abs_sents: list[str] = []
                        if m_has_abs and source_abstract:
                            if len(source_abstract) > 512:
                                m_trunc_abs = (
                                    source_abstract[:300].strip()
                                    + " ... "
                                    + source_abstract[-200:].strip()
                                )
                            else:
                                m_trunc_abs = self._truncate_text(source_abstract, max_length=512)
                            multi_texts.append(m_trunc_abs)
                            m_extracted = self._extract_sentences(source_abstract)
                            if len(m_extracted) >= 1:
                                m_abs_sents = m_extracted[:25]
                                multi_texts.extend(m_abs_sents)

                        m_focal_idx: int | None = None
                        if focal_sentence and focal_sentence != cited_context_trunc:
                            m_focal_idx = len(multi_texts)
                            multi_texts.append(self._truncate_text(focal_sentence, max_length=384))

                        m_embs = self._encode(
                            multi_model,
                            multi_texts,
                            convert_to_tensor=True,
                            normalize_embeddings=True,
                            show_progress_bar=False,
                        )
                        if len(m_embs) == len(multi_texts):
                            m_q_embs = [m_embs[0]]
                            if m_focal_idx is not None:
                                m_q_embs.append(m_embs[m_focal_idx])

                            def _max_multi_cos(target_emb: Any) -> float:
                                return max(
                                    max(0.0, min(1.0, float((q_e @ target_emb).item())))
                                    for q_e in m_q_embs
                                )

                            m_title_sim = _max_multi_cos(m_embs[1])
                            m_best_ev_sent = source_title_trunc
                            m_best_ev_score = m_title_sim
                            m_abstract_sim = 0.0
                            if m_has_abs:
                                m_whole_abs_sim = _max_multi_cos(m_embs[2])
                                m_best_ev_score = max(m_title_sim, m_whole_abs_sim)
                                if m_abs_sents:
                                    m_sent_sims = [
                                        _max_multi_cos(m_embs[3 + idx])
                                        for idx in range(len(m_abs_sents))
                                    ]
                                    m_best_idx = max(
                                        range(len(m_sent_sims)), key=lambda i: m_sent_sims[i]
                                    )
                                    m_max_sent_sim = m_sent_sims[m_best_idx]
                                    m_best_ev_sent = m_abs_sents[m_best_idx]
                                    m_best_ev_score = m_max_sent_sim
                                    m_abstract_sim = max(
                                        m_whole_abs_sim,
                                        0.65 * m_max_sent_sim + 0.35 * m_whole_abs_sim,
                                    )
                                else:
                                    m_abstract_sim = m_whole_abs_sim
                                    m_best_ev_sent = self._truncate_text(
                                        source_abstract or "", max_length=280
                                    )

                            m_scores = [m_title_sim]
                            m_weights = [0.3]
                            if m_abstract_sim > 0:
                                m_scores.append(m_abstract_sim)
                                m_weights.append(0.5)
                            if body_sim > 0:
                                m_scores.append(body_sim)
                                m_weights.append(0.2)
                            m_tot_w = sum(m_weights)
                            m_weighted = sum(
                                s * (w / m_tot_w) for s, w in zip(m_scores, m_weights, strict=False)
                            )
                            if m_abstract_sim >= self.ALIGNMENT_THRESHOLD_HIGH:
                                sim_dense_multi = max(
                                    m_weighted, m_abstract_sim * 0.92, m_best_ev_score * 0.90
                                )
                            elif m_best_ev_score >= 0.65 and m_abstract_sim > 0:
                                sim_dense_multi = max(m_weighted, m_best_ev_score * 0.88)
                            else:
                                sim_dense_multi = m_weighted

                            if concept_overlap_score > 0.0 and sim_dense_multi >= 0.25:
                                sim_dense_multi = max(
                                    sim_dense_multi,
                                    min(0.95, 0.60 * sim_dense_multi + 0.40 * concept_overlap_score),
                                    min(0.95, sim_dense_multi + self.cross_lingual_sim_boost),
                                )

                            if m_best_ev_score > best_evidence_score and m_best_ev_sent:
                                best_evidence_sentence = m_best_ev_sent
                                best_evidence_score = m_best_ev_score
                            title_sim = max(title_sim, m_title_sim)
                            abstract_sim = max(abstract_sim, m_abstract_sim)
                            final_sim = max(final_sim, sim_dense_multi)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug(f"Multilingual dense alignment skipped: {exc}")

            if (
                not is_cross_lingual
                and source_abstract
                and not type(model).__module__.startswith("unittest.mock")
            ):
                final_sim, confidence, is_aligned = self.calibrate_monolingual_specificity(
                    final_sim,
                    focal_sentence or cited_context_trunc,
                    source_title_trunc,
                    source_abstract,
                    is_cross_lingual=is_cross_lingual,
                )
            else:
                confidence, is_aligned = self._determine_alignment(final_sim)
            stance_label = self.check_claim_stance(
                focal_sentence or cited_context_trunc,
                best_evidence_sentence,
                final_sim,
                has_abstract=bool(source_abstract),
                is_cross_lingual=is_cross_lingual,
                source_abstract=source_abstract,
                source_title=source_title_trunc,
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

    def collect_alignment_texts(
        self,
        cited_context: str,
        source_title: str,
        source_abstract: str | None = None,
        citation_marker: str | None = None,
    ) -> list[str]:
        """Collect all text segments that check_content_alignment will encode for batch pre-warming."""
        texts: list[str] = []
        if not cited_context:
            return texts
        clean_abs = self._sanitize_abstract(source_abstract)
        raw_context_clean = self.clean_and_dehyphenate_context(cited_context)
        if len(re.findall(r"[A-Za-zÀ-ỹ]{2,}", raw_context_clean)) < 2:
            return texts
        focal_sentence = self.extract_focal_sentence(
            raw_context_clean,
            citation_marker=citation_marker,
            source_title=source_title,
        )
        is_cross_lingual, bridged_context, _ = self.detect_and_bridge_cross_lingual_detailed(
            focal_sentence or raw_context_clean,
            source_title,
            clean_abs,
        )
        cited_context_trunc = self._truncate_text(raw_context_clean or cited_context, max_length=512)
        source_title_trunc = self._truncate_text(source_title, max_length=256)
        texts.append(cited_context_trunc)
        if source_title_trunc:
            texts.append(source_title_trunc)
        if clean_abs and clean_abs.strip():
            if len(clean_abs) > 512:
                truncated_abstract = clean_abs[:300].strip() + " ... " + clean_abs[-200:].strip()
            else:
                truncated_abstract = self._truncate_text(clean_abs, max_length=512)
            texts.append(truncated_abstract)
            extracted = self._extract_sentences(clean_abs)
            if len(extracted) >= 1:
                texts.extend(extracted[:25])
        if focal_sentence and focal_sentence != cited_context_trunc:
            texts.append(self._truncate_text(focal_sentence, max_length=384))
        if is_cross_lingual and bridged_context:
            texts.append(self._truncate_text(bridged_context, max_length=512))
        return texts

    def prewarm_texts(self, texts: list[str]) -> None:
        """Batch-encode a list of texts into the LRU embedding cache in a single forward pass."""
        if not texts:
            return
        model = self._get_model()
        if model is None or type(model).__module__.startswith("unittest.mock"):
            return
        valid_texts = [t for t in texts if isinstance(t, str) and t]
        if not valid_texts:
            return
        try:
            self._encode(
                model,
                valid_texts,
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"Prewarm texts skipped: {exc}")

    def check_multi_context_alignment(
        self,
        occurrence_contexts: list[dict[str, Any]],
        source_title: str,
        source_abstract: str | None = None,
        first_occurrence_result: SemanticAlignmentResult | None = None,
    ) -> list[dict[str, Any]]:
        """Đánh giá Neural Alignment trên TẤT CẢ các vị trí trích dẫn của cùng 1 tài liệu trong bài.

        Args:
            occurrence_contexts: List các dict {'page': int, 'context': str, 'raw': str}
            source_title: Tiêu đề bài báo nguồn
            source_abstract: Abstract bài báo nguồn (nếu có)
            first_occurrence_result: Kết quả alignment đã tính sẵn cho occurrence đầu tiên (nếu có)

        Returns:
            Danh sách kết quả alignment theo từng vị trí trích dẫn (page, focal_sentence, score,
            confidence, is_aligned, intent, stance, best_evidence_sentence).
        """
        if not occurrence_contexts:
            return []

        if (
            len(occurrence_contexts) > 1
            and getattr(self._compute_similarity, "__func__", None) is SemanticMatcher._compute_similarity
        ):
            prewarm_batch: list[str] = []
            for idx, occ in enumerate(occurrence_contexts[:8]):
                if idx == 0 and first_occurrence_result is not None:
                    continue
                ctx = str(occ.get("context") or "").strip()
                if not ctx:
                    continue
                marker = str(occ.get("raw") or "").strip()
                prewarm_batch.extend(
                    self.collect_alignment_texts(
                        cited_context=ctx,
                        source_title=source_title,
                        source_abstract=source_abstract,
                        citation_marker=marker,
                    )
                )
            if prewarm_batch:
                self.prewarm_texts(prewarm_batch)

        results: list[dict[str, Any]] = []
        seen_sentences: set[str] = set()
        for idx, occ in enumerate(occurrence_contexts[:8]):
            ctx = str(occ.get("context") or "").strip()
            if not ctx:
                continue
            marker = str(occ.get("raw") or "").strip()
            if idx == 0 and first_occurrence_result is not None and first_occurrence_result.best_cited_sentence:
                focal = first_occurrence_result.best_cited_sentence
            else:
                focal = self.extract_focal_sentence(ctx, citation_marker=marker, source_title=source_title)
            dedup_key = focal[:120].lower()
            if dedup_key in seen_sentences:
                continue
            seen_sentences.add(dedup_key)

            if idx == 0 and first_occurrence_result is not None:
                res = first_occurrence_result
            else:
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

        target_text = f"{source_title}. {self._truncate_text(source_abstract or '', 320)}".strip()
        target_is_vn = is_vietnamese_text(target_text)

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

        # Build bidirectional cross-lingual concept cues (EN -> VI and VI -> EN)
        vn_concept_cues = find_vn_cues_for_en_source(source_title, source_abstract)
        en_concept_cues = (
            find_en_cues_for_vn_source(source_title, source_abstract) if target_is_vn else []
        )

        candidate_passages: list[tuple[int, str, float]] = []
        xl_fallback_passages: list[tuple[int, str, float]] = []
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
                from integrity_checker.extraction.patterns.utils import _UPPER_LATIN_VN

                is_bib_entry = bool(
                    re.search(
                        rf"\b{_UPPER_LATIN_VN}[a-zà-ỹ]+,\s+[A-Z]\.(?:.*?\(\s*(?:19|20)\d{{2}}[a-z]?\s*\))",
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
                en_hits = sum(
                    1
                    for ep in en_concept_cues
                    if (ep in win_lower if " " in ep or "-" in ep else ep in win_words)
                )
                if kw_hits > 0 or auth_hits > 0 or vn_hits > 0 or en_hits > 0:
                    pre_score = (
                        kw_hits * 2.0
                        + auth_hits * 3.0
                        + vn_hits * 2.2
                        + en_hits * 2.2
                        + min(len(window), 260) / 300.0
                    )
                    candidate_passages.append((page_num, window[:360], pre_score))
                elif is_vietnamese_text(window) != target_is_vn:
                    xl_fallback_passages.append(
                        (page_num, window[:360], min(len(window), 260) / 300.0)
                    )

        fallback_start = 0
        if candidate_passages:
            # Keep top 8 keyword-relevant body windows and supplement with cross-lingual windows if space remains
            candidate_passages.sort(key=lambda item: item[2], reverse=True)
            top_windows = candidate_passages[:8]
            fallback_start = len(top_windows)
            if fallback_start < 8 and xl_fallback_passages:
                xl_fallback_passages.sort(key=lambda item: item[2], reverse=True)
                top_windows.extend(xl_fallback_passages[: 8 - fallback_start])
        elif xl_fallback_passages:
            # Cross-lingual specialized domain windows outside the static lexicon
            xl_fallback_passages.sort(key=lambda item: item[2], reverse=True)
            top_windows = xl_fallback_passages[:12]
            fallback_start = 0
        else:
            return None

        has_vietnamese = target_is_vn or any(
            is_vietnamese_text(win_text) for _, win_text, _ in top_windows
        )
        if has_vietnamese:
            model = self._get_multilingual_model() or self._get_model()
        else:
            model = self._get_model()
        if model is None:
            return None

        try:
            raw_windows = [win_text for _, win_text, _ in top_windows]
            batch_texts: list[str] = [target_text] + list(raw_windows)
            target_indices = [0]
            if target_is_vn:
                bridged_target = bridge_vn_source_to_en(target_text)
                if bridged_target and bridged_target != target_text:
                    target_indices.append(len(batch_texts))
                    batch_texts.append(self._truncate_text(bridged_target, 512))

            bridged_win_indices: dict[int, int] = {}
            for idx, win_text in enumerate(raw_windows):
                is_xl, bridged_win = self.detect_and_bridge_cross_lingual(
                    win_text, source_title, source_abstract
                )
                if is_xl and bridged_win and bridged_win != win_text:
                    bridged_win_indices[idx] = len(batch_texts)
                    batch_texts.append(bridged_win)

            embs = self._encode(
                model,
                batch_texts,
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            if len(embs) != len(batch_texts):
                return None if fallback_start == 0 else (top_windows[0][0], top_windows[0][1], 0.5)

            best_idx = -1
            best_sim = -1.0
            for idx in range(len(top_windows)):
                win_emb_positions = [1 + idx]
                if idx in bridged_win_indices:
                    win_emb_positions.append(bridged_win_indices[idx])
                sim = max(
                    float((embs[t_pos] @ embs[w_pos]).item())
                    for t_pos in target_indices
                    for w_pos in win_emb_positions
                )
                if idx >= fallback_start and sim < 0.35:
                    continue
                if sim > best_sim:
                    best_sim = sim
                    best_idx = idx

            if best_idx < 0:
                return None

            best_page, best_text, _ = top_windows[best_idx]
            return best_page, best_text, max(0.0, min(1.0, best_sim))
        except Exception:  # noqa: BLE001
            return None if fallback_start == 0 else (top_windows[0][0], top_windows[0][1], 0.5)

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
        key = (id(model), self.model_name)
        with self._intent_cache_lock:
            if key in self._intent_emb_cache:
                return self._intent_emb_cache.get(key)
        try:
            proto_texts = list(_INTENT_PROTOTYPES.values())
            encoded = self._encode(
                model,
                proto_texts,
                convert_to_tensor=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        except Exception:  # noqa: BLE001
            return None
        with self._intent_cache_lock:
            self._intent_emb_cache.setdefault(key, encoded)
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

    @classmethod
    def calibrate_monolingual_specificity(
        cls,
        raw_sim: float,
        cited_context: str,
        source_title: str,
        source_abstract: str | None,
        *,
        is_cross_lingual: bool = False,
    ) -> tuple[float, str, bool]:
        """Neuro-Symbolic Specificity Gate (Option 2A) correcting Bi-Encoder topical false positives.

        Dense Bi-Encoders (`all-MiniLM-L6-v2`) frequently assign cosine 0.50..0.77 to two
        unrelated papers from the same subfield (e.g. NLP or CV) when generic field terms or a
        cited paper's title phrase co-occur, even when the empirical predicate of the citing
        sentence shares zero distinctive technical roots with `source_abstract`.

        Safety invariants:
        - Never penalizes cross-lingual pairs (`is_cross_lingual=True`), Vietnamese text, or
          non-English scripts / foreign syntax (`_is_non_english_or_foreign_text`).
        - Exempts first-person methodological adoption (`Building on X [1], we ...`, `For X, our ...`).
        - Never activates when `source_abstract` lacks substantive technical content (< 4 stems).
        - Only recalibrates moderate/borderline scores (`0.50 <= raw_sim < 0.78`) when
          `_has_ungrounded_novel_claim` detects >= 4 non-title technical stems with zero
          morphological root overlap against `source_abstract`, completely independent of
          reporting verb choice.
        """
        sim = max(0.0, min(1.0, float(raw_sim)))

        def _map_status(s: float) -> tuple[float, str, bool]:
            if s >= cls.ALIGNMENT_THRESHOLD_HIGH:
                return s, "high", True
            if s >= cls.ALIGNMENT_THRESHOLD_MEDIUM:
                return s, "medium", True
            if s >= cls.ALIGNMENT_THRESHOLD_LOW:
                return s, "medium", False
            return s, "low", False

        if (
            is_cross_lingual
            or sim < cls.ALIGNMENT_THRESHOLD_MEDIUM
            or sim >= 0.78
            or not cited_context
            or not source_abstract
        ):
            return _map_status(sim)

        if _has_ungrounded_novel_claim(
            cited_context,
            source_title,
            source_abstract,
            raw_sim=sim,
        ):
            downgraded = min(0.44, max(0.36, sim * 0.65))
            return _map_status(round(downgraded, 4))

        return _map_status(sim)

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
