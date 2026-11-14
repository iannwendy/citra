"""Text preprocessing — Unicode normalization, ligature, line-break fix."""

from __future__ import annotations

import re
import unicodedata

from integrity_checker.extraction.vn_encoding import VietnameseLegacyTranscoder


class TextPreprocessor:
    """Chuẩn hóa text trước khi regex match.

    Lý do cần:
        - PDF hay chứa ligature (ﬁ → fi, ﬂ → fl)
        - Xuống dòng trong citation có thể cắt giữa chừng
        - Whitespace không nhất quán
        - Unicode accents có thể bị tách (Naïve → Naiïve)
    """

    # Ligature map (mở rộng khi cần)
    LIGATURES = {
        "ﬁ": "fi",
        "ﬂ": "fl",
        "ﬀ": "ff",
        "ﬃ": "ffi",
        "ﬄ": "ffl",
        "ﬅ": "ft",
        "ﬆ": "st",
    }

    # Pattern thấy line-break giữa chữ thường → nối lại
    # Negative lookahead: KHÔNG nối khi dòng tiếp theo bắt đầu bằng particle
    # (van, de, von, der, ...) — đó thường là start of new reference entry
    # với multi-word last name (vd: "References\nvan der Berg").
    _LOWER_CHARS = r"[a-záàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]"
    _PARTICLES = (
        r"(?:van|de|von|der|del|den|la|le|di|da|du|el|al|"
        r"dos|das|af|op|te|ten|ter|y|san|santa)"
    )
    BROKEN_LINE_RE = re.compile(
        rf"({_LOWER_CHARS})\s*\n\s*(?!{_PARTICLES}\b)({_LOWER_CHARS})"
    )

    def __init__(self) -> None:
        self.last_detected_encoding: str | None = None

    def normalize(self, text: str, metadata: dict | None = None) -> str:
        """Pipeline normalize đầy đủ."""
        if not text:
            self.last_detected_encoding = None
            return ""
        text = self._fix_ligatures(text)
        text = self._normalize_unicode(text, metadata=metadata)
        text = self._fix_broken_lines(text)
        text = self._collapse_whitespace(text)
        return text.strip()

    def _fix_ligatures(self, text: str) -> str:
        for lig, expanded in self.LIGATURES.items():
            text = text.replace(lig, expanded)
        return text

    _LATEX_SPACING_ACCENTS = {
        "\u00b4": "\u0301",  # ´ acute
        "\u00a8": "\u0308",  # ¨ diaeresis / umlaut
        "\u02c6": "\u0302",  # ˆ circumflex
        "\u02dc": "\u0303",  # ˜ tilde
        "\u02c7": "\u030c",  # ˇ caron
        "\u02d8": "\u0306",  # ˘ breve
        "\u02d9": "\u0307",  # ˙ dot above
        "\u02dd": "\u030b",  # ˝ double acute
    }
    _LATEX_ACCENT_RE = re.compile(r"([\u00b4\u00a8\u02c6\u02dc\u02c7\u02d8\u02d9\u02dd])\s*([A-Za-z])")

    def _normalize_unicode(self, text: str, metadata: dict | None = None) -> str:
        # Decode legacy Vietnamese encodings (TCVN3 / VNI-Windows) before LaTeX spacing
        # accents so TCVN3 bytes such as '¨' (ă in "V¨n") and '´' are never misread.
        text, detected_enc = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(text)
        self.last_detected_encoding = detected_enc
        if detected_enc and isinstance(metadata, dict):
            if not metadata.get("legacy_encoding_detected"):
                metadata["legacy_encoding_detected"] = detected_enc
            if not metadata.get("legacy_encoding_pages_count"):
                metadata["legacy_encoding_pages_count"] = 1
        # Convert LaTeX Type1 spacing accents preceding a letter (e.g. "Kir´aly", "K¨uhn")
        text = self._LATEX_ACCENT_RE.sub(
            lambda m: m.group(2) + self._LATEX_SPACING_ACCENTS[m.group(1)], text
        )
        # NFC: chuẩn hóa ký tự có dấu về dạng precomposed
        return unicodedata.normalize("NFC", text)

    def _fix_broken_lines(self, text: str) -> str:
        # Nối các xuống dòng giữa chữ thường (vd: "machine\nlearning" → "machine learning")
        return self.BROKEN_LINE_RE.sub(r"\1 \2", text)

    def _collapse_whitespace(self, text: str) -> str:
        # Gộp nhiều space thành 1, giữ \n
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text

    def split_paragraphs(self, text: str) -> list[str]:
        """Tách text thành đoạn văn (heuristic)."""
        raw = re.split(r"\n\s*\n", text)
        return [p.strip() for p in raw if p.strip() and len(p.strip()) > 20]
