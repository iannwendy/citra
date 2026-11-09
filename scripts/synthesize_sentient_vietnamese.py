#!/usr/bin/env python3
"""
Synthesizes the 88 missing Vietnamese precomposed glyphs and 3 combining marks
(U+0309 hookabovecomb, U+031B horncomb, U+0323 dotbelowcomb) directly into
Sentient-Light.woff2 and Sentient-Regular.woff2 using Sentient's native contours,
stroke weights, and GPOS anchor coordinates.

Maintains 100% Sentient visual identity without substituting another typeface.
"""

from __future__ import annotations

import copy
import shutil
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphCoordinates


ROOT_DIR = Path(__file__).resolve().parent.parent
PUBLIC_FONTS_DIR = ROOT_DIR / "web" / "public" / "fonts"
DIST_FONTS_DIR = ROOT_DIR / "web" / "dist" / "fonts"


def extract_contour_slice(
    glyf_table, glyph_name: str, contour_indices: list[int] | None = None
) -> tuple[list[tuple[int, int]], list[int], bytearray]:
    """Extract selected contours (or all contours) from a simple glyph."""
    g = glyf_table[glyph_name]
    coords, end_pts, flags = g.getCoordinates(glyf_table)
    pts = [(int(round(x)), int(round(y))) for x, y in coords]
    if contour_indices is None:
        return pts, list(end_pts), bytearray(flags)

    out_pts: list[tuple[int, int]] = []
    out_ends: list[int] = []
    out_flags = bytearray()

    start = 0
    for ci, end in enumerate(end_pts):
        c_pts = pts[start : end + 1]
        c_flags = flags[start : end + 1]
        if ci in contour_indices:
            out_pts.extend(c_pts)
            out_flags.extend(c_flags)
            out_ends.append(len(out_pts) - 1)
        start = end + 1
    return out_pts, out_ends, out_flags


def transform_contour_data(
    pts: list[tuple[int, int]],
    end_pts: list[int],
    flags: bytearray,
    *,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    target_cx: float | None = None,
    target_min_x: float | None = None,
    target_min_y: float | None = None,
    dx: float = 0.0,
    dy: float = 0.0,
) -> tuple[list[tuple[int, int]], list[int], bytearray]:
    """Scale and translate contour points around their bounding box center."""
    if not pts:
        return [], [], bytearray()

    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0

    scaled = [((x - cx) * scale_x + cx, (y - cy) * scale_y + cy) for x, y in pts]

    s_xs = [p[0] for p in scaled]
    s_ys = [p[1] for p in scaled]
    shift_x = dx
    shift_y = dy
    if target_cx is not None:
        shift_x += target_cx - ((min(s_xs) + max(s_xs)) / 2.0)
    elif target_min_x is not None:
        shift_x += target_min_x - min(s_xs)

    if target_min_y is not None:
        shift_y += target_min_y - min(s_ys)

    final_pts = [(int(round(x + shift_x)), int(round(y + shift_y))) for x, y in scaled]
    return final_pts, list(end_pts), bytearray(flags)


def merge_contours(
    parts: list[tuple[list[tuple[int, int]], list[int], bytearray]],
) -> tuple[list[tuple[int, int]], list[int], bytearray]:
    """Combine multiple contour sets into a single simple glyph contour list."""
    all_pts: list[tuple[int, int]] = []
    all_ends: list[int] = []
    all_flags = bytearray()

    for pts, ends, flags in parts:
        if not pts:
            continue
        offset = len(all_pts)
        all_pts.extend(pts)
        all_flags.extend(flags)
        all_ends.extend(e + offset for e in ends)

    return all_pts, all_ends, all_flags


def build_simple_glyph(
    glyf_table,
    pts: list[tuple[int, int]],
    end_pts: list[int],
    flags: bytearray,
) -> Glyph:
    """Create a TrueType simple Glyph with recalculated bounding box."""
    g = Glyph()
    g.numberOfContours = len(end_pts)
    g.coordinates = GlyphCoordinates(pts)
    g.endPtsOfContours = list(end_pts)
    g.flags = bytearray(flags)
    g.program = copy.deepcopy(glyf_table["A"].program)
    g.program.fromBytecode(b"")
    g.recalcBounds(glyf_table)
    return g


def get_base_anchors(font: TTFont) -> dict[str, tuple[int, int]]:
    """Read GPOS MarkToBase top anchors (class 0) for each base vowel."""
    st = font["GPOS"].table.LookupList.Lookup[0].SubTable[0]
    anchors: dict[str, tuple[int, int]] = {}
    for i, gname in enumerate(st.BaseCoverage.glyphs):
        rec = st.BaseArray.BaseRecord[i]
        if rec.BaseAnchor and rec.BaseAnchor[0] is not None:
            anchors[gname] = (
                int(rec.BaseAnchor[0].XCoordinate),
                int(rec.BaseAnchor[0].YCoordinate),
            )
    return anchors


def synthesize_vietnamese_for_font(font_path: Path) -> int:
    font = TTFont(str(font_path))
    glyf = font["glyf"]
    hmtx = font["hmtx"].metrics
    cmap_table = font["cmap"]
    best_cmap = font.getBestCmap()
    glyph_order = list(font.getGlyphOrder())

    anchors = get_base_anchors(font)
    # MarkAnchor for class 0 in Sentient-Light is (0, 504), Sentient-Regular is (0, 509)
    st = font["GPOS"].table.LookupList.Lookup[0].SubTable[0]
    mark_ref_y = int(st.MarkArray.MarkRecord[14].MarkAnchor.YCoordinate)

    def register_glyph(
        gname: str,
        codepoint: int | None,
        glyph_obj: Glyph,
        advance_width: int,
        gdef_class: int = 1,
    ) -> None:
        glyf[gname] = glyph_obj
        lsb = int(glyph_obj.xMin) if glyph_obj.numberOfContours > 0 else 0
        hmtx[gname] = (int(advance_width), lsb)
        if gname not in glyph_order:
            glyph_order.append(gname)
        if codepoint is not None:
            for subtable in cmap_table.tables:
                if subtable.isUnicode():
                    subtable.cmap[codepoint] = gname
        if "GDEF" in font and font["GDEF"].table.GlyphClassDef is not None:
            font["GDEF"].table.GlyphClassDef.classDefs[gname] = gdef_class

    # 1. Build the 3 missing combining marks:
    #    - hookabovecomb (U+0309): weight-matched 1000-UPM editorial serif hook contour
    #    - dotbelowcomb (U+0323): Sentient's native 'dotaccentcomb' shifted below baseline
    #    - horncomb (U+031B): weight-matched 1000-UPM editorial serif Vietnamese horn contour
    is_light = "light" in font_path.name.lower()

    if is_light:
        hook_pts = [
            (-18, 556), (-24, 576), (9, 584), (38, 612), (38, 633),
            (38, 659), (5, 687), (-45, 695), (-39, 736), (21, 729),
            (73, 680), (73, 641), (73, 607), (25, 561),
        ]
    else:
        hook_pts = [
            (-19, 553), (-28, 584), (1, 590), (25, 615), (25, 632),
            (25, 653), (-13, 673), (-58, 680), (-48, 747), (13, 742),
            (74, 691), (74, 647), (74, 609), (25, 558),
        ]
    hook_ends = [13]
    hook_flags = bytearray([1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0])
    hook_glyph = build_simple_glyph(glyf, hook_pts, hook_ends, hook_flags)
    register_glyph("hookabovecomb", 0x0309, hook_glyph, 0, gdef_class=3)

    dot_pts, dot_ends, dot_flags = extract_contour_slice(glyf, "dotaccentcomb")
    dotbelow_pts, dotbelow_ends, dotbelow_flags = transform_contour_data(
        dot_pts,
        dot_ends,
        dot_flags,
        target_cx=0.0,
        target_min_y=-186.0,
    )
    dotbelow_glyph = build_simple_glyph(
        glyf, dotbelow_pts, dotbelow_ends, dotbelow_flags
    )
    register_glyph("dotbelowcomb", 0x0323, dotbelow_glyph, 0, gdef_class=3)

    if is_light:
        horn_pts = [
            (0, 472), (0, 493), (42, 499), (76, 549), (76, 580),
            (76, 604), (63, 633), (50, 655), (50, 667), (50, 677),
            (65, 692), (77, 692), (83, 692), (93, 689), (99, 685),
            (108, 670), (118, 635), (118, 612), (118, 579), (93, 517),
            (41, 476),
        ]
    else:
        horn_pts = [
            (0, 475), (0, 502), (34, 507), (65, 543), (65, 575),
            (65, 597), (53, 622), (41, 644), (41, 660), (41, 673),
            (61, 697), (80, 697), (87, 697), (105, 693), (115, 685),
            (123, 671), (129, 643), (129, 627), (129, 584), (95, 517),
            (37, 478),
        ]
    horn_ends = [20]
    horn_flags = bytearray(
        [1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0]
    )
    horn_glyph = build_simple_glyph(glyf, horn_pts, horn_ends, horn_flags)
    register_glyph("horncomb", 0x031B, horn_glyph, 0, gdef_class=3)

    # Extract standard combining marks at reference origin (x=0, y≈580..748)
    grave_raw = extract_contour_slice(glyf, "gravecomb")
    acute_raw = extract_contour_slice(glyf, "acutecomb")
    circum_raw = extract_contour_slice(glyf, "circumflexcomb")
    tilde_raw = extract_contour_slice(glyf, "tildecomb")
    breve_raw = extract_contour_slice(glyf, "brevecomb")
    hook_raw = (hook_pts, hook_ends, hook_flags)
    horn_raw = (horn_pts, horn_ends, horn_flags)
    dotbelow_raw = (dotbelow_pts, dotbelow_ends, dotbelow_flags)

    # 2. Build precomposed stacked mark templates at reference origin (0, mark_ref_y):
    #    A) Circumflex + Tone (classic asymmetric editorial layout with clear separation)
    circum_low = transform_contour_data(
        *circum_raw, scale_x=0.84, scale_y=0.70, target_cx=0.0, target_min_y=538.0
    )
    circum_acute = merge_contours(
        [
            circum_low,
            transform_contour_data(
                *acute_raw,
                scale_x=0.74,
                scale_y=0.70,
                target_cx=118.0,
                target_min_y=630.0,
            ),
        ]
    )
    circum_grave = merge_contours(
        [
            circum_low,
            transform_contour_data(
                *grave_raw,
                scale_x=0.74,
                scale_y=0.70,
                target_cx=-118.0,
                target_min_y=630.0,
            ),
        ]
    )
    circum_hook = merge_contours(
        [
            circum_low,
            transform_contour_data(
                *hook_raw,
                scale_x=0.76,
                scale_y=0.74,
                target_cx=112.0,
                target_min_y=624.0,
            ),
        ]
    )
    circum_tilde = merge_contours(
        [
            circum_low,
            transform_contour_data(
                *tilde_raw,
                scale_x=0.86,
                scale_y=0.82,
                target_cx=0.0,
                target_min_y=674.0,
            ),
        ]
    )

    #    B) Breve + Tone (clean separation above the concave bowl of the breve)
    breve_low = transform_contour_data(
        *breve_raw, scale_x=1.02, scale_y=0.76, target_cx=0.0, target_min_y=538.0
    )
    breve_acute = merge_contours(
        [
            breve_low,
            transform_contour_data(
                *acute_raw,
                scale_x=0.76,
                scale_y=0.72,
                target_cx=18.0,
                target_min_y=672.0,
            ),
        ]
    )
    breve_grave = merge_contours(
        [
            breve_low,
            transform_contour_data(
                *grave_raw,
                scale_x=0.76,
                scale_y=0.72,
                target_cx=-18.0,
                target_min_y=672.0,
            ),
        ]
    )
    breve_hook = merge_contours(
        [
            breve_low,
            transform_contour_data(
                *hook_raw,
                scale_x=0.78,
                scale_y=0.76,
                target_cx=8.0,
                target_min_y=670.0,
            ),
        ]
    )
    breve_tilde = merge_contours(
        [
            breve_low,
            transform_contour_data(
                *tilde_raw,
                scale_x=0.86,
                scale_y=0.82,
                target_cx=0.0,
                target_min_y=676.0,
            ),
        ]
    )

    # 3. Synthesize Ohorn (Ơ), ohorn (ơ), Uhorn (Ư), uhorn (ư)
    #    Attach horn smoothly onto the top-right shoulder/stem of O, o, U, u
    o_base = extract_contour_slice(glyf, "o")
    O_base = extract_contour_slice(glyf, "O")
    u_base = extract_contour_slice(glyf, "u")
    U_base = extract_contour_slice(glyf, "U")

    o_g = glyf["o"]
    O_g = glyf["O"]
    u_g = glyf["u"]
    U_g = glyf["U"]

    ohorn_data = merge_contours(
        [
            o_base,
            transform_contour_data(
                *horn_raw,
                scale_x=1.0,
                scale_y=1.0,
                target_min_x=float(o_g.xMax - 108),
                target_min_y=float(o_g.yMax - 96),
            ),
        ]
    )
    Ohorn_data = merge_contours(
        [
            O_base,
            transform_contour_data(
                *horn_raw,
                scale_x=1.08,
                scale_y=1.08,
                target_min_x=float(O_g.xMax - 120),
                target_min_y=float(O_g.yMax - 122),
            ),
        ]
    )
    uhorn_data = merge_contours(
        [
            u_base,
            transform_contour_data(
                *horn_raw,
                scale_x=1.0,
                scale_y=1.0,
                target_min_x=float(u_g.xMax - 124),
                target_min_y=float(u_g.yMax - 68),
            ),
        ]
    )
    Uhorn_data = merge_contours(
        [
            U_base,
            transform_contour_data(
                *horn_raw,
                scale_x=1.08,
                scale_y=1.08,
                target_min_x=float(U_g.xMax - 122),
                target_min_y=float(U_g.yMax - 92),
            ),
        ]
    )

    register_glyph(
        "Ohorn", 0x01A0, build_simple_glyph(glyf, *Ohorn_data), hmtx["O"][0]
    )
    register_glyph(
        "ohorn", 0x01A1, build_simple_glyph(glyf, *ohorn_data), hmtx["o"][0]
    )
    register_glyph(
        "Uhorn", 0x01AF, build_simple_glyph(glyf, *Uhorn_data), hmtx["U"][0]
    )
    register_glyph(
        "uhorn", 0x01B0, build_simple_glyph(glyf, *uhorn_data), hmtx["u"][0]
    )

    # Register anchors for Ohorn, ohorn, Uhorn, uhorn (slightly left of horn so top marks never touch horn)
    anchors["Ohorn"] = (anchors["O"][0] - 12, anchors["O"][1])
    anchors["ohorn"] = (anchors["o"][0] - 10, anchors["o"][1])
    anchors["Uhorn"] = (anchors["U"][0] - 14, anchors["U"][1])
    anchors["uhorn"] = (anchors["u"][0] - 12, anchors["u"][1])

    # Helper to compose a base glyph + mark contour shifted to the base's anchor
    def compose_top(base_gname: str, mark_data, anchor_src: str | None = None) -> Glyph:
        src = anchor_src or base_gname
        ax, ay = anchors[src]
        base_contours = extract_contour_slice(glyf, base_gname)
        shifted_mark = transform_contour_data(
            *mark_data, dx=float(ax), dy=float(ay - mark_ref_y)
        )
        return build_simple_glyph(glyf, *merge_contours([base_contours, shifted_mark]))

    def compose_dotbelow(
        base_gname: str, anchor_src: str | None = None, extra_dx: int = 0, extra_dy: int = 0
    ) -> Glyph:
        src = anchor_src or base_gname
        ax, _ = anchors[src]
        base_contours = extract_contour_slice(glyf, base_gname)
        shifted_dot = transform_contour_data(
            *dotbelow_raw, dx=float(ax + extra_dx), dy=float(extra_dy)
        )
        return build_simple_glyph(glyf, *merge_contours([base_contours, shifted_dot]))

    # 4. Complete specification of all 84 remaining precomposed Vietnamese characters
    #    (plus Ohorn/ohorn/Uhorn/uhorn above = 88 total)
    specs: list[tuple[int, str, str, Glyph]] = [
        # A / a: dotbelow & hook
        (0x1EA0, "Adotbelow", "A", compose_dotbelow("A")),
        (0x1EA1, "adotbelow", "a", compose_dotbelow("a")),
        (0x1EA2, "Ahookabove", "A", compose_top("A", hook_raw)),
        (0x1EA3, "ahookabove", "a", compose_top("a", hook_raw)),
        # Acircumflex / acircumflex + 5 tones
        (0x1EA4, "Acircumflexacute", "A", compose_top("A", circum_acute)),
        (0x1EA5, "acircumflexacute", "a", compose_top("a", circum_acute)),
        (0x1EA6, "Acircumflexgrave", "A", compose_top("A", circum_grave)),
        (0x1EA7, "acircumflexgrave", "a", compose_top("a", circum_grave)),
        (0x1EA8, "Acircumflexhookabove", "A", compose_top("A", circum_hook)),
        (0x1EA9, "acircumflexhookabove", "a", compose_top("a", circum_hook)),
        (0x1EAA, "Acircumflextilde", "A", compose_top("A", circum_tilde)),
        (0x1EAB, "acircumflextilde", "a", compose_top("a", circum_tilde)),
        (0x1EAC, "Acircumflexdotbelow", "A", compose_dotbelow("Acircumflex", "A")),
        (0x1EAD, "acircumflexdotbelow", "a", compose_dotbelow("acircumflex", "a")),
        # Abreve / abreve + 5 tones
        (0x1EAE, "Abreveacute", "A", compose_top("A", breve_acute)),
        (0x1EAF, "abreveacute", "a", compose_top("a", breve_acute)),
        (0x1EB0, "Abrevegrave", "A", compose_top("A", breve_grave)),
        (0x1EB1, "abrevegrave", "a", compose_top("a", breve_grave)),
        (0x1EB2, "Abrevehookabove", "A", compose_top("A", breve_hook)),
        (0x1EB3, "abrevehookabove", "a", compose_top("a", breve_hook)),
        (0x1EB4, "Abrevetilde", "A", compose_top("A", breve_tilde)),
        (0x1EB5, "abrevetilde", "a", compose_top("a", breve_tilde)),
        (0x1EB6, "Abrevedotbelow", "A", compose_dotbelow("Abreve", "A")),
        (0x1EB7, "abrevedotbelow", "a", compose_dotbelow("abreve", "a")),
        # E / e: dotbelow & hook (Note: Etilde 0x1EBC and etilde 0x1EBD already exist in Sentient)
        (0x1EB8, "Edotbelow", "E", compose_dotbelow("E")),
        (0x1EB9, "edotbelow", "e", compose_dotbelow("e")),
        (0x1EBA, "Ehookabove", "E", compose_top("E", hook_raw)),
        (0x1EBB, "ehookabove", "e", compose_top("e", hook_raw)),
        # Ecircumflex / ecircumflex + 5 tones
        (0x1EBE, "Ecircumflexacute", "E", compose_top("E", circum_acute)),
        (0x1EBF, "ecircumflexacute", "e", compose_top("e", circum_acute)),
        (0x1EC0, "Ecircumflexgrave", "E", compose_top("E", circum_grave)),
        (0x1EC1, "ecircumflexgrave", "e", compose_top("e", circum_grave)),
        (0x1EC2, "Ecircumflexhookabove", "E", compose_top("E", circum_hook)),
        (0x1EC3, "ecircumflexhookabove", "e", compose_top("e", circum_hook)),
        (0x1EC4, "Ecircumflextilde", "E", compose_top("E", circum_tilde)),
        (0x1EC5, "ecircumflextilde", "e", compose_top("e", circum_tilde)),
        (0x1EC6, "Ecircumflexdotbelow", "E", compose_dotbelow("Ecircumflex", "E")),
        (0x1EC7, "ecircumflexdotbelow", "e", compose_dotbelow("ecircumflex", "e")),
        # I / i: hook & dotbelow (lowercase ỉ uses dotlessi so top hook replaces i's dot; ị keeps i's top dot!)
        (0x1EC8, "Ihookabove", "I", compose_top("I", hook_raw)),
        (0x1EC9, "ihookabove", "i", compose_top("dotlessi", hook_raw, "dotlessi")),
        (0x1ECA, "Idotbelow", "I", compose_dotbelow("I")),
        (0x1ECB, "idotbelow", "i", compose_dotbelow("i", "dotlessi")),
        # O / o: dotbelow & hook
        (0x1ECC, "Odotbelow", "O", compose_dotbelow("O")),
        (0x1ECD, "odotbelow", "o", compose_dotbelow("o")),
        (0x1ECE, "Ohookabove", "O", compose_top("O", hook_raw)),
        (0x1ECF, "ohookabove", "o", compose_top("o", hook_raw)),
        # Ocircumflex / ocircumflex + 5 tones
        (0x1ED0, "Ocircumflexacute", "O", compose_top("O", circum_acute)),
        (0x1ED1, "ocircumflexacute", "o", compose_top("o", circum_acute)),
        (0x1ED2, "Ocircumflexgrave", "O", compose_top("O", circum_grave)),
        (0x1ED3, "ocircumflexgrave", "o", compose_top("o", circum_grave)),
        (0x1ED4, "Ocircumflexhookabove", "O", compose_top("O", circum_hook)),
        (0x1ED5, "ocircumflexhookabove", "o", compose_top("o", circum_hook)),
        (0x1ED6, "Ocircumflextilde", "O", compose_top("O", circum_tilde)),
        (0x1ED7, "ocircumflextilde", "o", compose_top("o", circum_tilde)),
        (0x1ED8, "Ocircumflexdotbelow", "O", compose_dotbelow("Ocircumflex", "O")),
        (0x1ED9, "ocircumflexdotbelow", "o", compose_dotbelow("ocircumflex", "o")),
        # Ohorn / ohorn + 5 tones
        (0x1EDA, "Ohornacute", "Ohorn", compose_top("Ohorn", acute_raw)),
        (0x1EDB, "ohornacute", "ohorn", compose_top("ohorn", acute_raw)),
        (0x1EDC, "Ohorngrave", "Ohorn", compose_top("Ohorn", grave_raw)),
        (0x1EDD, "ohorngrave", "ohorn", compose_top("ohorn", grave_raw)),
        (0x1EDE, "Ohornhookabove", "Ohorn", compose_top("Ohorn", hook_raw)),
        (0x1EDF, "ohornhookabove", "ohorn", compose_top("ohorn", hook_raw)),
        (0x1EE0, "Ohorntilde", "Ohorn", compose_top("Ohorn", tilde_raw)),
        (0x1EE1, "ohorntilde", "ohorn", compose_top("ohorn", tilde_raw)),
        (0x1EE2, "Ohorndotbelow", "Ohorn", compose_dotbelow("Ohorn", "O")),
        (0x1EE3, "ohorndotbelow", "ohorn", compose_dotbelow("ohorn", "o")),
        # U / u: dotbelow & hook
        (0x1EE4, "Udotbelow", "U", compose_dotbelow("U")),
        (0x1EE5, "udotbelow", "u", compose_dotbelow("u")),
        (0x1EE6, "Uhookabove", "U", compose_top("U", hook_raw)),
        (0x1EE7, "uhookabove", "u", compose_top("u", hook_raw)),
        # Uhorn / uhorn + 5 tones
        (0x1EE8, "Uhornacute", "Uhorn", compose_top("Uhorn", acute_raw)),
        (0x1EE9, "uhornacute", "uhorn", compose_top("uhorn", acute_raw)),
        (0x1EEA, "Uhorngrave", "Uhorn", compose_top("Uhorn", grave_raw)),
        (0x1EEB, "uhorngrave", "uhorn", compose_top("uhorn", grave_raw)),
        (0x1EEC, "Uhornhookabove", "Uhorn", compose_top("Uhorn", hook_raw)),
        (0x1EED, "uhornhookabove", "uhorn", compose_top("uhorn", hook_raw)),
        (0x1EEE, "Uhorntilde", "Uhorn", compose_top("Uhorn", tilde_raw)),
        (0x1EEF, "uhorntilde", "uhorn", compose_top("uhorn", tilde_raw)),
        (0x1EF0, "Uhorndotbelow", "Uhorn", compose_dotbelow("Uhorn", "U")),
        (0x1EF1, "uhorndotbelow", "uhorn", compose_dotbelow("uhorn", "u")),
        # Y / y: dotbelow & hook (Note: Ygrave/ygrave/Ytilde/ytilde already exist in Sentient)
        (0x1EF4, "Ydotbelow", "Y", compose_dotbelow("Y")),
        (
            0x1EF5,
            "ydotbelow",
            "y",
            compose_dotbelow("y", "y", extra_dx=62, extra_dy=-68),
        ),
        (0x1EF6, "Yhookabove", "Y", compose_top("Y", hook_raw)),
        (0x1EF7, "yhookabove", "y", compose_top("y", hook_raw)),
    ]

    added = 7  # 3 combining marks + 4 horn base vowels
    synthesized_names = [
        "hookabovecomb",
        "dotbelowcomb",
        "horncomb",
        "Ohorn",
        "ohorn",
        "Uhorn",
        "uhorn",
    ]
    for cp, gname, width_src, glyph_obj in specs:
        if cp not in best_cmap:
            added += 1
        register_glyph(gname, cp, glyph_obj, hmtx[width_src][0])
        synthesized_names.append(gname)

    font.setGlyphOrder(glyph_order)

    # Boolean-union overlapping contours (e.g., O+horn, U+horn) and normalize winding direction via skia-pathops
    removeOverlaps(font, glyphNames=synthesized_names, removeHinting=True)

    # Set OS/2 Unicode Range bit 38 (Latin Extended Additional U+1E00-U+1EFF) & CP1258 Vietnamese
    if "OS/2" in font:
        os2 = font["OS/2"]
        os2.ulUnicodeRange1 |= (1 << 2) | (1 << 6)  # Latin Ext-B (Ơ/Ư) & Combining Marks
        os2.ulUnicodeRange2 |= 1 << (38 - 32)  # Latin Extended Additional (U+1E00..U+1EFF)
        if hasattr(os2, "ulCodePageRange1"):
            os2.ulCodePageRange1 |= 1 << 27  # Windows-1258 Vietnamese

    font.save(str(font_path))
    return added


def qr_pts_tuple(pts, ends, flags):
    return pts, ends, flags


def main() -> None:
    for fname in ["Sentient-Light.woff2", "Sentient-Regular.woff2"]:
        src_path = PUBLIC_FONTS_DIR / fname
        added = synthesize_vietnamese_for_font(src_path)
        f = TTFont(str(src_path))
        print(
            f"[OK] {fname}: synthesized {added} Vietnamese glyphs -> total glyphs = {len(f.getGlyphOrder())} ({src_path.stat().st_size} bytes)"
        )
        if DIST_FONTS_DIR.exists():
            shutil.copy2(src_path, DIST_FONTS_DIR / fname)


if __name__ == "__main__":
    main()
