"""
Tests for Vietnamese glyph coverage and contour integrity in self-hosted Sentient WOFF2 fonts.
Ensures all 134 precomposed Vietnamese characters and combining marks exist in Sentient-Light.woff2
and Sentient-Regular.woff2 with valid TrueType simple contours and accurate horizontal metrics.
"""

from pathlib import Path

import pytest
from fontTools.ttLib import TTFont

ROOT_DIR = Path(__file__).resolve().parent.parent
FONT_PATHS = [
    ROOT_DIR / "web" / "public" / "fonts" / "Sentient-Light.woff2",
    ROOT_DIR / "web" / "public" / "fonts" / "Sentient-Regular.woff2",
]

VI_LOWER = "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ"
VI_UPPER = "ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ"
ALL_VI_CHARS = VI_LOWER + VI_UPPER

COMBINING_MARKS = [
    0x0300,  # gravecomb (huyền)
    0x0301,  # acutecomb (sắc)
    0x0302,  # circumflexcomb (mũ)
    0x0303,  # tildecomb (ngã)
    0x0306,  # brevecomb (trăng)
    0x0309,  # hookabovecomb (hỏi)
    0x031B,  # horncomb (móc ơ/ư)
    0x0323,  # dotbelowcomb (nặng)
]


@pytest.mark.parametrize("font_path", FONT_PATHS, ids=lambda p: p.name)
def test_sentient_font_contains_all_134_vietnamese_precomposed_chars(font_path: Path):
    assert font_path.exists(), f"Font file not found: {font_path}"
    font = TTFont(str(font_path))
    cmap = font.getBestCmap()
    assert cmap is not None

    missing = [ch for ch in ALL_VI_CHARS if ord(ch) not in cmap]
    assert not missing, (
        f"{font_path.name} is missing {len(missing)}/{len(ALL_VI_CHARS)} Vietnamese chars: "
        f"{''.join(missing)}"
    )


@pytest.mark.parametrize("font_path", FONT_PATHS, ids=lambda p: p.name)
def test_sentient_font_contains_all_vietnamese_combining_marks(font_path: Path):
    font = TTFont(str(font_path))
    cmap = font.getBestCmap()
    missing = [hex(cp) for cp in COMBINING_MARKS if cp not in cmap]
    assert not missing, f"{font_path.name} is missing combining marks: {missing}"


@pytest.mark.parametrize("font_path", FONT_PATHS, ids=lambda p: p.name)
def test_sentient_vietnamese_glyphs_have_valid_contours_and_metrics(font_path: Path):
    font = TTFont(str(font_path))
    cmap = font.getBestCmap()
    glyf = font["glyf"]
    hmtx = font["hmtx"].metrics

    for ch in ALL_VI_CHARS:
        cp = ord(ch)
        assert cp in cmap, f"Missing char {ch} (U+{cp:04X})"
        gname = cmap[cp]
        assert gname in glyf, f"Glyph {gname} for {ch} missing from glyf table"
        g = glyf[gname]
        assert g.numberOfContours > 0, f"Glyph {gname} ({ch}) has no contours"
        assert g.xMax > g.xMin, f"Glyph {gname} ({ch}) has invalid x bounds: {g.xMin}..{g.xMax}"
        assert g.yMax > g.yMin, f"Glyph {gname} ({ch}) has invalid y bounds: {g.yMin}..{g.yMax}"
        width, lsb = hmtx[gname]
        assert width > 200, f"Glyph {gname} ({ch}) has suspiciously small advance width: {width}"


@pytest.mark.parametrize("font_path", FONT_PATHS, ids=lambda p: p.name)
def test_sentient_stacked_vietnamese_glyphs_have_clean_separated_contours(font_path: Path):
    """Stacked circumflex+tone and breve+tone must not weld/collide into a single contour."""
    font = TTFont(str(font_path))
    cmap = font.getBestCmap()
    glyf = font["glyf"]

    stacked_groups = {
        "a": "ằắẳẵầấẩẫ",
        "A": "ẰẮẲẴẦẤẨẪ",
        "e": "ềếểễ",
        "E": "ỀẾỂỄ",
        "o": "ồốổỗ",
        "O": "ỒỐỔỖ",
    }
    for base_ch, stacked_chars in stacked_groups.items():
        base_contours = glyf[cmap[ord(base_ch)]].numberOfContours
        for ch in stacked_chars:
            gname = cmap[ord(ch)]
            actual_contours = glyf[gname].numberOfContours
            assert actual_contours == base_contours + 2, (
                f"{font_path.name} {ch} ({gname}): expected {base_contours + 2} separated contours "
                f"(base={base_contours} + 2 diacritics), got {actual_contours}"
            )

