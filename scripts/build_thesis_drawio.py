#!/usr/bin/env python3
"""Build all 12 print-legible (W=760-800px, font>=13px -> >=7.2pt on A4) Q1 Draw.io diagrams
for CITRA English (FinalReport_TDTU) and Vietnamese (FinalReport_TDTU_VN) graduation reports.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
ICONS: dict[str, str] = json.loads((REPO_ROOT / "scripts" / "drawio_official_icons.json").read_text(encoding="utf-8"))

FONT = "Helvetica"


class DiagramBuilder:
    """Clean uncompressed mxGraphModel builder enforcing Q1 geometry & A4 print legibility."""

    def __init__(self, page_id: str, name: str, width: int = 780, height: int = 600) -> None:
        self.page_id = page_id
        self.name = name
        self.width = width
        self.height = height
        self._seq = 10
        self.cells: list[ET.Element] = []
        self._coords: dict[str, tuple[float, float, float, float]] = {}

    def _nid(self, prefix: str = "c") -> str:
        self._seq += 1
        return f"{prefix}_{self._seq}"

    def box(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        value: str = "",
        *,
        fill: str = "#FFFFFF",
        stroke: str = "#334155",
        sw: float = 1.4,
        font_size: int = 13,
        font_color: str = "#0F172A",
        bold: bool = False,
        rounded: int = 1,
        arc: int = 10,
        align: str = "center",
        valign: str = "middle",
        dashed: int = 0,
        extra: str = "",
        cid: str | None = None,
    ) -> str:
        assert font_size >= 13 or not value, f"{self.name}: font_size={font_size} < 13 violates A4 legibility"
        cid = cid or self._nid("b")
        fstyle = 1 if bold else 0
        style = (
            f"rounded={rounded};arcSize={arc};whiteSpace=wrap;html=1;"
            f"fillColor={fill};strokeColor={stroke};strokeWidth={sw};dashed={dashed};"
            f"fontFamily={FONT};fontSize={font_size};fontColor={font_color};fontStyle={fstyle};"
            f"align={align};verticalAlign={valign};spacing=4;{extra}"
        )
        el = ET.Element("mxCell", id=cid, value=value, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def text(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        value: str,
        *,
        font_size: int = 13,
        font_color: str = "#0F172A",
        bold: bool = False,
        align: str = "center",
        valign: str = "middle",
        fill: str = "none",
        stroke: str = "none",
        extra: str = "",
        cid: str | None = None,
    ) -> str:
        assert font_size >= 13, f"{self.name}: text font_size={font_size} < 13"
        cid = cid or self._nid("t")
        fstyle = 1 if bold else 0
        style = (
            f"text;html=1;whiteSpace=wrap;fillColor={fill};strokeColor={stroke};"
            f"fontFamily={FONT};fontSize={font_size};fontColor={font_color};fontStyle={fstyle};"
            f"align={align};verticalAlign={valign};spacing=2;{extra}"
        )
        el = ET.Element("mxCell", id=cid, value=value, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def icon(self, icon_key: str, x: float, y: float, w: float = 30, h: float = 30, cid: str | None = None) -> str:
        uri = ICONS[icon_key]
        assert ";base64" not in uri
        cid = cid or self._nid("ic")
        style = f"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;aspect=fixed;imageAspect=0;image={uri};"
        el = ET.Element("mxCell", id=cid, value="", style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def card(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        subtitle: str = "",
        *,
        icon_key: str | None = None,
        icon_size: float = 28,
        fill: str = "#FFFFFF",
        stroke: str = "#334155",
        sw: float = 1.4,
        title_color: str = "#0F172A",
        sub_color: str = "#334155",
        cid: str | None = None,
    ) -> str:
        """Clean Q1 card with optional left official SVG icon, 14px bold title, and <=2 lines of 13px detail."""
        pad_left = int(icon_size + 14) if icon_key else 8
        html_val = f"<b><font color='{title_color}' style='font-size:14px'>{title}</font></b>"
        if subtitle:
            html_val += f"<br/><font color='{sub_color}' style='font-size:13px'>{subtitle}</font>"
        bid = self.box(
            x,
            y,
            w,
            h,
            html_val,
            fill=fill,
            stroke=stroke,
            sw=sw,
            font_size=13,
            align="left" if icon_key else "center",
            valign="middle",
            extra=f"spacingLeft={pad_left};spacingRight=6;",
            cid=cid,
        )
        if icon_key:
            self.icon(icon_key, x + 8, y + (h - icon_size) / 2, icon_size, icon_size)
        return bid

    def ellipse(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        value: str,
        *,
        fill: str = "#EFF6FF",
        stroke: str = "#1E3A8A",
        sw: float = 1.4,
        font_size: int = 13,
        bold: bool = False,
        cid: str | None = None,
    ) -> str:
        assert font_size >= 13
        cid = cid or self._nid("el")
        fstyle = 1 if bold else 0
        style = (
            f"ellipse;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth={sw};"
            f"fontFamily={FONT};fontSize={font_size};fontColor=#0F172A;fontStyle={fstyle};spacing=4;"
        )
        el = ET.Element("mxCell", id=cid, value=value, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def diamond(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        value: str,
        *,
        fill: str = "#FEFCE8",
        stroke: str = "#B45309",
        sw: float = 1.6,
        font_size: int = 13,
        cid: str | None = None,
    ) -> str:
        assert font_size >= 13
        cid = cid or self._nid("dm")
        style = (
            f"rhombus;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth={sw};"
            f"fontFamily={FONT};fontSize={font_size};fontColor=#0F172A;fontStyle=1;spacing=2;"
        )
        el = ET.Element("mxCell", id=cid, value=value, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def cube(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        *,
        fill: str = "#F8FAFC",
        stroke: str = "#1E3A8A",
        sw: float = 1.6,
        size: int = 14,
        cid: str | None = None,
    ) -> str:
        """True UML 2.5 3D Deployment Node Cube."""
        cid = cid or self._nid("cb")
        style = (
            f"shape=cube;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;darkOpacity=0.06;darkOpacity2=0.12;"
            f"size={size};fillColor={fill};strokeColor={stroke};strokeWidth={sw};"
            f"fontFamily={FONT};fontSize=14;fontStyle=1;fontColor=#0F172A;align=left;verticalAlign=top;"
            f"spacingTop=6;spacingLeft=10;spacingRight=18;"
        )
        el = ET.Element("mxCell", id=cid, value=title, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def cylinder(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        value: str,
        *,
        fill: str = "#ECFDF5",
        stroke: str = "#047857",
        sw: float = 1.5,
        size: int = 10,
        cid: str | None = None,
    ) -> str:
        cid = cid or self._nid("cy")
        style = (
            f"shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size={size};"
            f"fillColor={fill};strokeColor={stroke};strokeWidth={sw};"
            f"fontFamily={FONT};fontSize=13;fontColor=#0F172A;align=center;verticalAlign=middle;spacingTop=10;"
        )
        el = ET.Element("mxCell", id=cid, value=value, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def note(self, x: float, y: float, w: float, h: float, value: str, cid: str | None = None) -> str:
        cid = cid or self._nid("nt")
        style = (
            f"shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=14;"
            f"fillColor=#FEF9C3;strokeColor=#CA8A04;strokeWidth=1.3;"
            f"fontFamily={FONT};fontSize=13;fontColor=#422006;align=left;verticalAlign=middle;spacingLeft=8;"
        )
        el = ET.Element("mxCell", id=cid, value=value, style=style, vertex="1", parent="1")
        ET.SubElement(el, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
        self.cells.append(el)
        self._coords[cid] = (x, y, w, h)
        return cid

    def erd_table(
        self,
        x: float,
        y: float,
        w: float,
        title: str,
        cols: list[str],
        *,
        hdr_fill: str = "#1E3A8A",
        hdr_color: str = "#FFFFFF",
        body_fill: str = "#FFFFFF",
        stroke: str = "#1E3A8A",
        cid: str | None = None,
    ) -> str:
        """Compact, print-legible (13px) ERD entity box with edge-to-edge colored header bar."""
        row_h = 18
        h = 28 + len(cols) * row_h + 6
        body_html = "<br/>".join(cols)
        html_val = (
            f"<table style='width:100%;height:100%;border-collapse:collapse;font-family:{FONT};'>"
            f"<tr><td style='background:{hdr_fill};color:{hdr_color};font-weight:bold;font-size:13px;"
            f"padding:4px 7px;text-align:left;border-bottom:1px solid {stroke};'>{title}</td></tr>"
            f"<tr><td style='padding:4px 7px;text-align:left;vertical-align:top;font-size:13px;"
            f"line-height:1.25;color:#0F172A;'>{body_html}</td></tr></table>"
        )
        return self.box(
            x,
            y,
            w,
            h,
            html_val,
            fill=body_fill,
            stroke=stroke,
            sw=1.4,
            font_size=13,
            rounded=0,
            arc=0,
            align="left",
            valign="top",
            extra="spacing=0;overflow=fill;",
            cid=cid,
        )

    def edge(
        self,
        src: str | None,
        dst: str | None,
        label: str = "",
        *,
        stroke: str = "#334155",
        sw: float = 1.5,
        dashed: int = 0,
        orth: bool = True,
        end_arrow: str = "classic",
        end_fill: int = 1,
        start_arrow: str = "none",
        start_fill: int = 0,
        ex: float | None = None,
        ey: float | None = None,
        nx: float | None = None,
        ny: float | None = None,
        pts: list[tuple[float, float]] | None = None,
        src_pt: tuple[float, float] | None = None,
        dst_pt: tuple[float, float] | None = None,
        ox: float = 0.0,
        oy: float = 0.0,
        rel_pos: float = 0.0,
        font_size: int = 13,
        font_color: str = "#0F172A",
        bold: bool = False,
        extra: str = "",
        cid: str | None = None,
    ) -> str:
        assert font_size >= 13 or not label, f"{self.name}: edge font_size={font_size} < 13"
        cid = cid or self._nid("e")
        # Guarantee zero strict-validator warnings on labeled horizontal orthogonal edges
        if label and orth and ey == 0.5 and ny == 0.5 and ox == 0.0 and oy == 0.0:
            oy = -14.0
        parts = [
            f"strokeColor={stroke}",
            f"strokeWidth={sw}",
            f"dashed={dashed}",
            f"endArrow={end_arrow}",
            f"endFill={end_fill}",
            f"startArrow={start_arrow}",
            f"startFill={start_fill}",
            f"fontFamily={FONT}",
            f"fontSize={font_size}",
            f"fontColor={font_color}",
            f"fontStyle={1 if bold else 0}",
            "html=1",
            "rounded=0",
        ]
        if orth:
            parts.extend(["edgeStyle=orthogonalEdgeStyle", "jumpStyle=arc", "jumpSize=7"])
        else:
            parts.extend(["exitPerimeter=0", "entryPerimeter=0"])
        if ex is not None:
            parts.append(f"exitX={ex}")
        if ey is not None:
            parts.append(f"exitY={ey}")
        if nx is not None:
            parts.append(f"entryX={nx}")
        if ny is not None:
            parts.append(f"entryY={ny}")
        if label:
            parts.append("labelBackgroundColor=#FFFFFF")
        if extra:
            parts.append(extra.rstrip(";"))
        style = ";".join(parts) + ";"

        attrs: dict[str, str] = {"id": cid, "value": label, "style": style, "edge": "1", "parent": "1"}
        if src:
            attrs["source"] = src
        if dst:
            attrs["target"] = dst
        el = ET.Element("mxCell", **attrs)
        g_attrs: dict[str, str] = {"relative": "1", "as": "geometry"}
        if label and rel_pos != 0.0:
            g_attrs["x"] = str(rel_pos)
        geom = ET.SubElement(el, "mxGeometry", **g_attrs)
        if src_pt:
            ET.SubElement(geom, "mxPoint", x=str(src_pt[0]), y=str(src_pt[1]), **{"as": "sourcePoint"})
        if dst_pt:
            ET.SubElement(geom, "mxPoint", x=str(dst_pt[0]), y=str(dst_pt[1]), **{"as": "targetPoint"})
        if pts:
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                minor = min(abs(x2 - x1), abs(y2 - y1))
                assert not (0.05 < minor < 3.0), f"{self.name} edge {cid}: near-orthogonal kink {x1,y1}->{x2,y2}"
            arr = ET.SubElement(geom, "Array", **{"as": "points"})
            for px, py in pts:
                ET.SubElement(arr, "mxPoint", x=str(px), y=str(py))
        if label and (ox != 0.0 or oy != 0.0):
            ET.SubElement(geom, "mxPoint", x=str(ox), y=str(oy), **{"as": "offset"})
        self.cells.append(el)
        return cid

    def to_diagram_element(self) -> ET.Element:
        diag = ET.Element("diagram", id=self.page_id, name=self.name)
        model = ET.SubElement(
            diag,
            "mxGraphModel",
            dx="1200",
            dy="900",
            grid="1",
            gridSize="10",
            guides="1",
            tooltips="1",
            connect="1",
            arrows="1",
            fold="1",
            page="1",
            pageScale="1",
            pageWidth=str(self.width),
            pageHeight=str(self.height),
            background="#FFFFFF",
            math="0",
            shadow="0",
        )
        root = ET.SubElement(model, "root")
        ET.SubElement(root, "mxCell", id="0")
        ET.SubElement(root, "mxCell", id="1", parent="0")
        for c in self.cells:
            root.append(c)
        return diag


# =============================================================================
# 12 DIAGRAM BUILDERS (100% BILINGUAL EN & VN)
# =============================================================================


def build_fig2_1(vn: bool) -> DiagramBuilder:
    d = DiagramBuilder("p21", "fig2_1_verification_paradigm", 800, 576)
    t = lambda en, vi: vi if vn else en

    # Top Input Strip
    inp = d.card(
        196,
        14,
        420,
        54,
        t("Submitted Academic Manuscript", "Bản thảo học thuật đầu vào"),
        t("PDF / DOCX / BibTeX / RIS  ·  Inline + Bibliography", "PDF / DOCX / BibTeX / RIS · Nội văn + Danh mục TLTK"),
        icon_key="doc_pdf",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )

    # Band A: Paradigms 1 & 2 (shifted right x=46 so left corridor x=22 stays 100% clear!)
    d.box(46, 104, 740, 144, "", fill="#FFF1F2", stroke="#E11D48", sw=1.4, dashed=1)
    d.text(
        58,
        110,
        716,
        24,
        t("Paradigms 1–2: Surface Stylometry & Neural AI-Text Detectors (Fragile)", "Hướng 1–2: Phân tích văn phong & Bộ phát hiện văn bản AI (Kém ổn định)"),
        font_size=14,
        font_color="#9F1239",
        bold=True,
        align="left",
    )
    a1 = d.card(
        60,
        144,
        212,
        88,
        t("Token Stylometry", "Đặc trưng văn phong"),
        t("Perplexity &amp; burstiness<br/>Ignores factual ground truth", "Perplexity &amp; độ đột biến<br/>Bỏ qua thực chứng nguồn"),
        icon_key="eye_off",
        fill="#FFFFFF",
        stroke="#E11D48",
        title_color="#9F1239",
    )
    a2 = d.card(
        310,
        144,
        212,
        88,
        t("Black-Box P(AI)", "Mô hình hộp đen P(AI)"),
        t("Brittle to paraphrasing;<br/>bias on non-native prose", "Sụp đổ khi diễn giải lại;<br/>thiên vị tác giả không bản ngữ"),
        icon_key="brain",
        fill="#FFFFFF",
        stroke="#E11D48",
        title_color="#9F1239",
    )
    a3 = d.card(
        560,
        144,
        212,
        88,
        t("Unverifiable Flag", "Cảnh báo thiếu chứng cứ"),
        t("High false-accusation risk;<br/>zero bibliographic proof", "Rủi ro cáo buộc sai cao;<br/>không dẫn chứng thư mục"),
        icon_key="alert_red",
        fill="#FFE4E6",
        stroke="#BE123C",
        title_color="#881337",
    )
    d.edge(a1, a2, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#E11D48")
    d.edge(a2, a3, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#E11D48")

    # Band B: Paradigm 3 (CITRA Evidence-Backed Neuro-Symbolic Verification)
    d.box(46, 276, 740, 286, "", fill="#F0FDF4", stroke="#059669", sw=1.6)
    d.text(
        58,
        282,
        716,
        24,
        t("Paradigm 3: CITRA Evidence-Backed Neuro-Symbolic Verification", "Hướng 3: CITRA — Xác minh trích dẫn thực chứng Neuro-Symbolic"),
        font_size=14,
        font_color="#065F46",
        bold=True,
        align="left",
    )
    b1 = d.card(
        60,
        316,
        212,
        98,
        t("1. Parse &amp; Link", "1. Trích xuất &amp; Liên kết"),
        t("GROBID TEI + PyMuPDF<br/>11 styles + VN Legal", "GROBID TEI + PyMuPDF<br/>11 chuẩn + Luật VN"),
        icon_key="tei",
        fill="#FFFFFF",
        stroke="#059669",
        title_color="#065F46",
    )
    b2 = d.card(
        310,
        316,
        212,
        98,
        t("2. 15+ Open Registries", "2. 15+ Nguồn mở"),
        t("FTS5 + Crossref, OpenAlex,<br/>arXiv, DBLP, Wayback", "FTS5 + Crossref, OpenAlex,<br/>arXiv, DBLP, Wayback"),
        icon_key="crossref",
        fill="#FFFFFF",
        stroke="#059669",
        title_color="#065F46",
    )
    b3 = d.card(
        560,
        316,
        212,
        98,
        t("3. Rules + 16D + Platt", "3. Luật + 16D + Platt"),
        t("68 symbolic guardrails;<br/>calibrated confidence", "68 rào chắn ký hiệu;<br/>độ tin cậy hiệu chỉnh"),
        icon_key="platt_clean",
        fill="#FFFFFF",
        stroke="#059669",
        title_color="#065F46",
    )
    d.edge(b1, b2, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#059669")
    d.edge(b2, b3, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#059669")

    # Three explicitly separated epistemic outcomes: Verify vs Refute vs Abstain
    o1 = d.card(
        60,
        456,
        212,
        88,
        t("Verify (Supported)", "Xác nhận (Hợp lệ)"),
        t("VERIFIED / RESOURCE<br/>Canonical proof &amp; CIS", "VERIFIED / RESOURCE<br/>Chứng cứ chuẩn &amp; CIS"),
        icon_key="shield_ok",
        fill="#DCFCE7",
        stroke="#047857",
        title_color="#065F46",
    )
    o2 = d.card(
        310,
        456,
        212,
        88,
        t("Refute (Flagged)", "Bác bỏ (Cảnh báo)"),
        t("HALLUCINATION / META<br/>Audit trace &amp; repair", "ẢO GIÁC / LỖI SDL<br/>Vết luật &amp; đề xuất sửa"),
        icon_key="scale",
        fill="#FEF3C7",
        stroke="#B45309",
        title_color="#92400E",
    )
    o3 = d.card(
        560,
        456,
        212,
        88,
        t("Abstain (Review)", "Từ chối phán quyết"),
        t("UNRESOLVED (429/low)<br/>Instructor override", "CHƯA XĐ (429/thấp)<br/>Giảng viên hậu kiểm"),
        icon_key="teacher",
        fill="#EFF6FF",
        stroke="#1D4ED8",
        title_color="#1E3A8A",
    )

    # Clean non-crossing arrows: Red goes straight down to Band A; Green routes outside left corridor x=20 into b1 left edge!
    d.edge(
        inp,
        a2,
        t("Prose only", "Chỉ văn bản"),
        ex=0.52,
        ey=1,
        nx=0.5,
        ny=0,
        orth=False,
        stroke="#E11D48",
        ox=54,
        oy=-18,
        font_color="#9F1239",
        bold=True,
    )
    d.edge(
        inp,
        b1,
        "",
        ex=0,
        ey=0.5,
        nx=0,
        ny=0.5,
        pts=[(20, 41), (20, 365)],
        stroke="#059669",
        sw=1.7,
    )
    # Crisp pill label on the top horizontal green leg (100% clear of all boxes!)
    d.box(34, 24, 146, 26, t("<b>Full structure</b>", "<b>Cấu trúc đầy đủ</b>"), fill="#ECFDF5", stroke="#059669", sw=1.1, font_size=13, font_color="#065F46", arc=6)

    # Outcomes branched cleanly from b3
    d.edge(b3, o3, ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1D4ED8")
    d.edge(b3, o2, ex=0.3, ey=1, nx=0.5, ny=0, pts=[(624, 434), (416, 434)], stroke="#B45309")
    d.edge(b3, o1, ex=0.15, ey=1, nx=0.5, ny=0, pts=[(592, 428), (166, 428)], stroke="#047857")
    return d


def build_fig3_1(vn: bool) -> DiagramBuilder:
    """True UML 2.5 Use Case Diagram with hollow-triangle generalizations, Guest, Public Verifier, Billing/Erasure & UML Note."""
    d = DiagramBuilder("p31", "fig3_1_roles", 800, 740)
    t = lambda en, vi: vi if vn else en

    # System Boundary
    d.box(164, 14, 446, 712, "", fill="#F8FAFC", stroke="#1E3A8A", sw=1.8, rounded=1, arc=4)
    d.text(
        174,
        20,
        426,
        26,
        t("CITRA Verification Platform (v3.90.9)", "Nền tảng xác minh trích dẫn CITRA (v3.90.9)"),
        font_size=15,
        font_color="#1E3A8A",
        bold=True,
    )

    # Left Primary Actors (UML stick figures + bold 13px labels)
    def actor(ax: float, ay: float, label: str, ikey: str = "actor_navy") -> str:
        aid = d.box(ax, ay, 122, 76, "", fill="none", stroke="none", sw=0)
        d.icon(ikey, ax + 43, ay + 2, 36, 46)
        d.text(ax, ay + 48, 122, 28, label, font_size=13, bold=True, font_color="#0F172A")
        return aid

    act_auth = actor(22, 80, t("Authenticated\nUser", "Người dùng\nđã xác thực"), "actor_navy")
    act_stu = actor(22, 246, t("Student", "Sinh viên"), "actor_teal")
    act_tea = actor(22, 392, t("Teacher", "Giảng viên"), "actor_amber")
    act_adm = actor(22, 526, t("Admin", "Quản trị viên"), "actor_navy")
    act_gst = actor(22, 640, t("Guest", "Khách vãng lai"), "actor_slate")

    # True UML 2.5 Hollow-Triangle Generalizations (NO «inherits» label!)
    d.edge(act_stu, act_auth, "", ex=0.5, ey=0, nx=0.5, ny=1, orth=False, end_arrow="block", end_fill=0, stroke="#1E3A8A", sw=1.6)
    d.edge(
        act_tea,
        act_auth,
        "",
        ex=0,
        ey=0.5,
        nx=0,
        ny=0.5,
        pts=[(10, 430), (10, 118)],
        end_arrow="block",
        end_fill=0,
        stroke="#1E3A8A",
        sw=1.6,
    )
    d.edge(act_adm, act_tea, "", ex=0.5, ey=0, nx=0.5, ny=1, orth=False, end_arrow="block", end_fill=0, stroke="#1E3A8A", sw=1.6)

    # Use Cases inside System Boundary — clean 2-col spacing so «include» sits in open air!
    uc1 = d.ellipse(178, 56, 186, 56, t("UC-01: Upload &amp;\nStream SSE", "UC-01: Tải lên &amp;\nLuồng SSE"), fill="#EFF6FF", stroke="#1D4ED8")
    uc_core = d.ellipse(444, 56, 152, 56, t("Parse, Retrieve &amp;\nVerify (8 Layers)", "Trích xuất, Truy hồi\n&amp; Xác minh"), fill="#E0F2FE", stroke="#0369A1")
    uc2 = d.ellipse(178, 122, 206, 52, t("UC-02: Inspect Evidence\n&amp; Export (PDF/BibTeX)", "UC-02: Xem chứng cứ\n&amp; Xuất (PDF/BibTeX)"), fill="#EFF6FF", stroke="#1D4ED8")
    uc8 = d.ellipse(178, 184, 214, 52, t("UC-08: Billing, Plan &amp;\nErasure (Law 91/2025)", "UC-08: Thanh toán &\nXóa dữ liệu (Luật 91)"), fill="#F5F3FF", stroke="#6D28D9")

    uc3 = d.ellipse(178, 250, 214, 52, t("UC-03: Batch Upload &amp;\nJoin Classrooms", "UC-03: Tải hàng loạt &\nTham gia lớp học"), fill="#ECFDF5", stroke="#047857")
    uc4 = d.ellipse(178, 312, 214, 50, t("UC-04: Share Report Link\n&amp; Draft History", "UC-04: Chia sẻ báo cáo &\nLịch sử bản nháp"), fill="#ECFDF5", stroke="#047857")

    uc5 = d.ellipse(178, 384, 188, 58, t("UC-05: Override Verdict\n&amp; Recalculate CIS", "UC-05: Ghi đè nhãn\n&amp; Tính lại CIS"), fill="#FFFBEB", stroke="#B45309", bold=True)
    uc_aud = d.ellipse(446, 386, 150, 54, t("Write Immutable\nAudit Log", "Ghi nhật ký\nkiểm toán"), fill="#FEF3C7", stroke="#B45309")
    uc6 = d.ellipse(178, 454, 214, 52, t("UC-06: Manage Classes\n&amp; Cohort Analytics", "UC-06: Quản lý lớp học\n&amp; Thống kê lớp"), fill="#FFFBEB", stroke="#B45309")

    uc7 = d.ellipse(178, 534, 232, 54, t("UC-07: Monitor 15+ APIs,\nUsers &amp; Promo Codes", "UC-07: Giám sát 15+ API,\nNgười dùng &amp; Mã ưu đãi"), fill="#EEF2FF", stroke="#3730A3")

    uc0 = d.ellipse(178, 646, 232, 58, t("UC-00: Sandbox Check &amp;\nPublic Share View", "UC-00: Kiểm thử mẫu &\nXem liên kết chia sẻ"), fill="#F1F5F9", stroke="#475569")

    # UML Note attached cleanly above UC-05
    nt = d.note(432, 286, 162, 68, t("<b>RBAC Guard:</b><br/>{can_override_<br/>verdicts = true}", "<b>Ràng buộc RBAC:</b><br/>{can_override_<br/>verdicts = true}"))
    d.edge(nt, uc5, "", ex=0.35, ey=1, nx=0.85, ny=0, orth=False, dashed=1, end_arrow="none", stroke="#CA8A04")

    # «include» relationships cleanly in 80px wide gaps!
    d.edge(uc1, uc_core, "«include»", ex=1, ey=0.5, nx=0, ny=0.5, dashed=1, end_arrow="open", end_fill=0, stroke="#0369A1", oy=-14)
    d.edge(uc5, uc_aud, "«include»", ex=1, ey=0.5, nx=0, ny=0.5, dashed=1, end_arrow="open", end_fill=0, stroke="#B45309", oy=-14)

    # Actor -> Use Case Associations (zero crossings!)
    for src, dst in [
        (act_auth, uc1),
        (act_auth, uc2),
        (act_auth, uc8),
        (act_stu, uc3),
        (act_stu, uc4),
        (act_tea, uc5),
        (act_tea, uc6),
        (act_adm, uc7),
        (act_gst, uc0),
    ]:
        d.edge(src, dst, "", ex=1, ey=0.5, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#475569", sw=1.3)

    # Right Secondary Actors («actor» system boxes + Public Verifier)
    s_grobid = d.card(636, 46, 152, 72, "«actor» GROBID", "0.9.1-crf (TEI)", icon_key="tei", fill="#FFFFFF", stroke="#047857", title_color="#065F46")
    s_apis = d.card(636, 134, 152, 86, t("«actor» 15+ APIs", "«actor» 15+ API"), "Crossref, OpenAlex,\narXiv, Wayback", icon_key="crossref", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    s_pay = d.card(636, 240, 152, 72, t("«actor» Gateways", "«actor» Cổng TT"), "Stripe / VNPay", icon_key="payment", fill="#FFFFFF", stroke="#6D28D9", title_color="#5B21B6")
    act_pub = actor(650, 636, t("Public\nVerifier", "Người xem\ncông khai"), "actor_slate")

    d.edge(uc_core, s_grobid, "", ex=1, ey=0.4, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#047857", sw=1.3)
    d.edge(uc_core, s_apis, "", ex=1, ey=0.8, nx=0, ny=0.35, orth=False, end_arrow="none", stroke="#1D4ED8", sw=1.3)
    d.edge(uc8, s_pay, "", ex=1, ey=0.5, nx=0, ny=0.5, pts=[(618, 210), (618, 276)], end_arrow="none", stroke="#6D28D9", sw=1.3)
    d.edge(uc0, act_pub, "", ex=1, ey=0.5, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#475569", sw=1.3)
    d.edge(uc7, s_apis, "", ex=1, ey=0.5, nx=0.5, ny=1, pts=[(624, 561), (624, 228), (712, 228)], end_arrow="none", stroke="#3730A3", sw=1.2)
    return d


def build_fig3_2(vn: bool) -> DiagramBuilder:
    """True UML 2.5 Sequence Diagram with 6 separated lifelines + Panels (a) Async SSE & (b) Override Tx."""
    d = DiagramBuilder("p32", "fig3_2_workflow", 800, 760)
    t = lambda en, vi: vi if vn else en

    # 6 lifeline centers
    xs = [68, 198, 330, 464, 598, 728]
    hdr_y = 14
    hdr_h = 54
    bot_y = 740

    # 1. Background UML Combined Fragment frames
    d.box(12, 82, 776, 484, "", fill="#F8FAFC", stroke="#1E3A8A", sw=1.5, rounded=1, arc=3)
    d.box(24, 200, 752, 238, "", fill="#EFF6FF", stroke="#2563EB", sw=1.3, rounded=0)
    d.box(274, 266, 492, 160, "", fill="#FFFFFF", stroke="#059669", sw=1.2, dashed=1, rounded=0)
    d.box(24, 448, 752, 108, "", fill="#FEF2F2", stroke="#DC2626", sw=1.3, rounded=0)
    d.box(12, 578, 776, 156, "", fill="#FFFBEB", stroke="#B45309", sw=1.5, rounded=1, arc=3)

    # 2. Vertical dashed lifelines
    for lx in xs:
        d.edge(None, None, "", src_pt=(lx, hdr_y + hdr_h), dst_pt=(lx, bot_y), orth=False, dashed=1, end_arrow="none", stroke="#64748B", sw=1.2)

    # 3. Opaque Lifeline Header Boxes + Fragment Pills (drawn AFTER dashed lifelines to mask cleanly!)
    headers = [
        (t("User /\nBrowser", "Người dùng /\nTrình duyệt"), "#EFF6FF", "#1E3A8A"),
        ("CITRA SPA\n(React 18)", "#ECFEFF", "#0E7490"),
        ("FastAPI +\nQueue", "#ECFDF5", "#047857"),
        ("Integrity\nPipeline", "#F0FDF4", "#15803D"),
        ("GROBID +\n15 APIs", "#FEF3C7", "#B45309"),
        ("SQLite WAL\n(app.db)", "#F5F3FF", "#6D28D9"),
    ]
    for lx, (hlbl, hfill, hstr) in zip(xs, headers):
        d.box(lx - 56, hdr_y, 112, hdr_h, hlbl, fill=hfill, stroke=hstr, sw=1.5, font_size=13, bold=True)

    d.box(16, 86, 410, 26, t("<b>(a) Async Upload, Background Queue &amp; SSE (UC-01)</b>", "<b>(a) Tải lên bất đồng bộ, Hàng đợi &amp; SSE (UC-01)</b>"), fill="#DBEAFE", stroke="#1E3A8A", sw=1.1, font_size=13, align="left", arc=4)
    d.box(28, 204, 240, 24, t("<b>par</b> [Stream SSE || Run Pipeline]", "<b>par</b> [Luồng SSE || Chạy Pipeline]"), fill="#DBEAFE", stroke="#2563EB", sw=1.0, font_size=13, align="left", arc=3)
    d.box(278, 270, 240, 24, t("<b>loop</b> [Stages 0..7 + Progress]", "<b>loop</b> [Chặng 0..7 + Tiến độ]"), fill="#DCFCE7", stroke="#059669", sw=1.0, font_size=13, align="left", arc=3)
    d.box(28, 452, 412, 24, t("<b>alt</b> [Corrupt PDF / HTTP 429 / Worker Crash → CAS Refund]", "<b>alt</b> [PDF lỗi / HTTP 429 / Lỗi tiến trình → Hoàn hạn mức CAS]"), fill="#FEE2E2", stroke="#DC2626", sw=1.0, font_size=13, align="left", arc=3)
    d.box(16, 582, 434, 26, t("<b>(b) critical</b> [Atomic Instructor Override &amp; CIS Recalc (UC-05)]", "<b>(b) critical</b> [Ghi đè nguyên tử &amp; Tính lại CIS (UC-05)]"), fill="#FEF3C7", stroke="#B45309", sw=1.1, font_size=13, align="left", arc=4)

    d.edge(None, None, "", src_pt=(24, 258), dst_pt=(776, 258), orth=False, dashed=1, end_arrow="none", stroke="#2563EB", sw=1.1)

    def msg(i_from: int, i_to: int, y: float, text: str, *, dashed: int = 0, stroke: str = "#0F172A", open_arrow: bool = False) -> None:
        d.edge(
            None,
            None,
            text,
            src_pt=(xs[i_from], y),
            dst_pt=(xs[i_to], y),
            orth=False,
            dashed=dashed,
            end_arrow="open" if open_arrow else "classic",
            end_fill=0 if open_arrow else 1,
            stroke=stroke,
            sw=1.5,
            oy=-13,
            font_size=13,
            bold=not dashed,
        )

    msg(0, 1, 140, t("1. Upload PDF", "1. Tải PDF"), stroke="#1E3A8A")
    msg(1, 2, 140, "POST /api/essays", stroke="#1E3A8A")
    msg(2, 5, 164, t("2. Atomic CAS quota + INSERT essay", "2. Giữ hạn mức CAS + lưu bài viết"), stroke="#6D28D9")
    msg(2, 1, 188, t("3. HTTP 202 (essay_id) + spawn BackgroundTasks", "3. HTTP 202 (essay_id) + khởi chạy nền"), dashed=1, stroke="#047857", open_arrow=True)

    msg(1, 2, 248, "4. GET /api/essays/{id}/stream (fetch ReadableStream SSE)", stroke="#2563EB")

    msg(2, 3, 314, t("5. Acquire admission slot (≤3)", "5. Cấp khe hàng đợi (≤3)"), stroke="#047857")
    msg(3, 4, 342, t("6. TEI parse + 15 APIs (SSRF guard)", "6. GROBID + 15 API (chặn SSRF)"), stroke="#B45309")
    msg(4, 3, 368, t("7. Candidates + HTML/Wayback meta", "7. Ứng viên + siêu dữ liệu web"), dashed=1, stroke="#B45309", open_arrow=True)
    msg(3, 1, 394, t("8. ProgressTracker SSE stage frames", "8. Đẩy khung tiến độ SSE"), dashed=1, stroke="#2563EB", open_arrow=True)
    msg(3, 5, 418, t("9. Persist verdicts, CIS &amp; done status", "9. Lưu phán quyết, CIS &amp; hoàn tất"), stroke="#6D28D9")

    msg(3, 5, 502, t("Refund CAS: monthly_uploads_used − 1", "Hoàn CAS: monthly_uploads_used − 1"), stroke="#DC2626")
    msg(2, 0, 536, t("HTTP 400 (corrupt) or SSE error frame + clear banner", "HTTP 400 (tệp hỏng) hoặc khung lỗi SSE + thông báo"), dashed=1, stroke="#DC2626", open_arrow=True)

    msg(0, 2, 634, t("10. PATCH /api/verdicts/{id} (teacher/admin RBAC)", "10. PATCH /api/verdicts/{id} (quyền GV/Admin)"), stroke="#B45309")
    msg(2, 5, 668, t("11. Update verdict (manual_review) + recalc CIS + audit_logs", "11. Cập nhật phán quyết + tính lại CIS + audit_logs"), stroke="#6D28D9")
    msg(5, 2, 696, t("12. COMMIT atomic SQLite WAL tx", "12. Xác nhận giao dịch WAL nguyên tử"), dashed=1, stroke="#6D28D9", open_arrow=True)
    msg(2, 0, 720, t("13. HTTP 200 (updated verdict + recalculated CIS)", "13. HTTP 200 (nhãn mới + CIS đã tính lại)"), dashed=1, stroke="#047857", open_arrow=True)
    return d


def build_fig3_3(vn: bool) -> DiagramBuilder:
    """Complete 15-Table Crow's Foot ERD (app.db, migrations 0001..0013) + FTS5 local_papers.db + In-Memory _KNOWN_PAPERS."""
    d = DiagramBuilder("p33", "fig3_3_data_model", 808, 844)
    t = lambda en, vi: vi if vn else en

    # Band 1: Identity, Auth, Billing & Audit (6 tables) — shifted right x=22 so left corridor x=10 is clean!
    d.box(22, 8, 774, 314, "", fill="#F8FAFC", stroke="#1E3A8A", sw=1.4, dashed=1)
    d.text(30, 12, 758, 22, t("app.db (SQLite WAL, Migrations 0001–0013) — Band 1: Identity, Auth, Billing &amp; Audit (6 Tables)", "app.db (SQLite WAL, 0001–0013) — Khối 1: Định danh, Xác thực, Thanh toán &amp; Kiểm toán (6 bảng)"), font_size=13, font_color="#1E3A8A", bold=True, align="left")

    t_users = d.erd_table(32, 42, 210, "1. users", ["<b>PK</b> id · email (UQ)", "google_id · role · plan", "monthly_uploads_used", "usage_reset_at"], hdr_fill="#1E3A8A", stroke="#1E3A8A")
    t_sess = d.erd_table(300, 42, 206, "2. sessions", ["<b>PK</b> id · <b>FK</b> user_id", "token (UQ, opaque)", "expires_at"], hdr_fill="#1D4ED8", stroke="#1D4ED8")
    t_audit = d.erd_table(566, 42, 218, "3. audit_logs (Append-Only*)", ["<b>PK</b> id · <b>FK</b> actor_user_id", "action · target_type/id", "*API append-only; CASCADE"], hdr_fill="#B45309", stroke="#B45309")

    t_bill = d.erd_table(32, 188, 210, "4. billing_transactions", ["<b>PK</b> id · <b>FK</b> user_id", "provider · transaction_id", "amount_vnd · status", "<b>FK</b> promo_code_id"], hdr_fill="#6D28D9", stroke="#6D28D9")
    t_promo = d.erd_table(300, 188, 206, "5. promo_codes", ["<b>PK</b> id · code (UQ)", "discount_pct · max_uses", "used_count · active"], hdr_fill="#6D28D9", stroke="#6D28D9")
    t_red = d.erd_table(566, 188, 218, "6. promo_redemptions", ["<b>PK</b> id · <b>FK</b> promo_code_id", "<b>FK</b> user_id", "redeemed_at"], hdr_fill="#7C3AED", stroke="#7C3AED")

    d.edge(t_users, t_sess, "1 : N", ex=1, ey=0.45, nx=0, ny=0.5, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#1D4ED8", oy=-13)
    d.edge(t_users, t_bill, "1 : N", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#6D28D9", ox=26)
    d.edge(t_promo, t_bill, "0..1 : N", ex=0, ey=0.5, nx=1, ny=0.5, start_arrow="ERzeroToOne", end_arrow="ERzeroToMany", stroke="#6D28D9", oy=-13)
    d.edge(t_promo, t_red, "1 : N", ex=1, ey=0.5, nx=0, ny=0.5, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#7C3AED", oy=-13)
    d.edge(t_users, t_audit, "", ex=1, ey=0.18, nx=0, ny=0.22, pts=[(264, 61), (264, 34), (540, 34), (540, 62)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#B45309")

    # Band 2: Verification, Classrooms & Ops (9 remaining app.db tables = 15 TOTAL!)
    d.box(22, 336, 774, 372, "", fill="#F0FDF4", stroke="#047857", sw=1.4, dashed=1)
    d.text(30, 340, 758, 22, t("app.db — Band 2: Verification, Classrooms, Cache &amp; Operations (9 Tables → 15 Total)", "app.db — Khối 2: Xác minh, Lớp học, Bộ đệm &amp; Vận hành (9 bảng → Tổng 15 bảng)"), font_size=13, font_color="#065F46", bold=True, align="left")

    t_essays = d.erd_table(32, 368, 210, "7. essays", ["<b>PK</b> id · <b>FK</b> user_id", "<b>FK</b> class_id · filename", "cis_score · job_status", "result_json"], hdr_fill="#047857", stroke="#047857")
    t_verd = d.erd_table(300, 368, 206, "8. verdicts", ["<b>PK</b> id · <b>FK</b> essay_id", "label · original_label", "confidence · rules_json", "overridden_by"], hdr_fill="#059669", stroke="#059669")
    t_cls = d.erd_table(566, 368, 218, "9. classes", ["<b>PK</b> id · <b>FK</b> teacher_id", "name · join_code (UQ)", "created_at"], hdr_fill="#0F766E", stroke="#0F766E")

    # Generous 48px gap between 10. assignments and 11. submissions so Crow's Foot markers never collide!
    t_asgn = d.erd_table(32, 508, 160, "10. assignments", ["<b>PK</b> id · <b>FK</b> class_id", "title · due_date", "min_cis"], hdr_fill="#0F766E", stroke="#0F766E")
    t_subm = d.erd_table(240, 508, 174, "11. submissions", ["<b>PK</b> id · <b>FK</b> assign_id", "<b>FK</b> essay_id, student_id", "submitted_at"], hdr_fill="#0F766E", stroke="#0F766E")
    t_mem = d.erd_table(434, 508, 158, "12. class_members", ["<b>PK</b> id · <b>FK</b> class_id", "<b>FK</b> student_id", "joined_at"], hdr_fill="#0F766E", stroke="#0F766E")
    t_cache = d.erd_table(608, 498, 176, "13. citation_cache", ["<b>PK</b> key (doi:/arxiv:/url:)", "source_name · ttl", "payload_json"], hdr_fill="#0369A1", stroke="#0369A1")

    t_fb = d.erd_table(32, 616, 364, "14. feedback", ["<b>PK</b> id · <b>FK</b> user_id · category · message · status"], hdr_fill="#475569", stroke="#475569")
    t_mig = d.erd_table(420, 616, 364, "15. schema_migrations", ["<b>PK</b> version (0001..0013) · applied_at"], hdr_fill="#475569", stroke="#475569")

    d.edge(t_essays, t_verd, "1 : N", ex=1, ey=0.5, nx=0, ny=0.5, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#059669", oy=-13)
    d.edge(t_asgn, t_subm, "1 : N", ex=1, ey=0.5, nx=0, ny=0.5, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#0F766E", oy=-13)
    d.edge(t_essays, t_subm, "", ex=0.75, ey=1, nx=0.35, ny=0, pts=[(190, 488), (301, 488)], start_arrow="ERmandOne", end_arrow="ERzeroToOne", stroke="#047857")
    d.edge(t_cls, t_mem, "1 : N", ex=0.2, ey=1, nx=0.8, ny=0, pts=[(610, 484), (560, 484)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#0F766E", ox=-24)
    # Left corridor users -> essays completely outside both dashed boxes (x=10 -> left side of essays!)
    d.edge(t_users, t_essays, "", ex=0, ey=0.5, nx=0, ny=0.5, pts=[(10, 95), (10, 421)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#047857")

    # Band 3: Offline Retrieval Stores
    d.box(22, 720, 774, 114, "", fill="#EFF6FF", stroke="#1D4ED8", sw=1.4)
    d.text(30, 724, 758, 22, t("Offline Tier-0 Retrieval Stores (Separate Read-Only Artifacts — Outside app.db)", "Kho truy hồi ngoại tuyến Tầng 0 (Tách biệt chỉ đọc — Ngoài app.db)"), font_size=13, font_color="#1E3A8A", bold=True, align="left")

    d.cylinder(
        34,
        750,
        364,
        74,
        t("<b>local_papers.db</b> (SQLite FTS5 BM25)<br/>129,137 records (98.42% ACL Anthology) · &lt;25 ms", "<b>local_papers.db</b> (SQLite FTS5 BM25)<br/>129,137 bản ghi (98.42% ACL Anthology) · &lt;25 ms"),
        fill="#DCFCE7",
        stroke="#047857",
        size=8,
    )
    d.icon("sqlite", 42, 776, 26, 26)
    d.icon("acl", 364, 776, 26, 26)

    d.card(
        420,
        752,
        364,
        70,
        t("In-Memory _KNOWN_PAPERS (Python Dict)", "Từ điển bộ nhớ _KNOWN_PAPERS (Python Dict)"),
        t("101 foundational CS/AI/Law entries · &lt;1 ms<br/>Non-DB static memory structure (not SQLite)", "101 công trình kinh điển KHMT/Luật · &lt;1 ms<br/>Cấu trúc bộ nhớ tĩnh (không phải CSDL)"),
        icon_key="python",
        fill="#FFFFFF",
        stroke="#1D4ED8",
        title_color="#1E3A8A",
    )
    return d


def build_fig3_4(vn: bool) -> DiagramBuilder:
    """True UML 2.5 Deployment Diagram with 3D Node Cubes & Pinned-IP SSRF Egress Guard INSIDE integrity-api."""
    d = DiagramBuilder("p34", "fig3_4_deployment", 808, 690)
    t = lambda en, vi: vi if vn else en

    # 1. Left Node: Client Device (all inner elements clear 14px left/top bevel!)
    c_cli = d.cube(12, 168, 160, 174, t("«device»\nClient Browser", "«device»\nTrình duyệt"), fill="#EFF6FF", stroke="#1E3A8A")
    d.icon("browser", 36, 236, 28, 28)
    d.icon("tls", 72, 236, 28, 28)
    d.text(32, 272, 128, 62, t("HTTPS TLS 1.2/1.3<br/>fetch() Stream SSE", "HTTPS TLS 1.2/1.3<br/>fetch() Stream SSE"), font_size=13, align="left")

    # 2. Center Host Cube: Docker Engine on GCE (Docker icon placed cleanly on right-bottom of header strip with spacingRight=50)
    d.cube(
        200,
        12,
        402,
        666,
        t("«executionEnvironment»\nDocker Host (GCE · 2 vCPU · 5.8 GiB)", "«executionEnvironment»\nMáy chủ Docker (GCE · 2 vCPU · 5.8 GiB)"),
        fill="#F8FAFC",
        stroke="#0F172A",
        sw=1.8,
    )
    d.icon("docker", 554, 34, 32, 32)

    # Container 1: citra-web
    n_web = d.cube(222, 82, 356, 114, "«container» citra-web (Nginx 1.27 + SPA)", fill="#ECFEFF", stroke="#0E7490")
    d.icon("nginx", 242, 126, 26, 26)
    d.icon("react", 274, 126, 26, 26)
    d.icon("letsencrypt", 306, 126, 26, 26)
    d.text(340, 122, 226, 66, t("Ports :80/:443 TLS · Leaky-bucket<br/>rate limit · Proxy /api/* → :8000", "Cổng :80/:443 TLS · Leaky-bucket<br/>Proxy /api/* → :8000"), font_size=13, align="left")

    # Container 2: integrity-api (with nested Pinned-IP SSRF Egress Guard INSIDE!)
    n_api = d.cube(222, 224, 356, 250, "«container» integrity-api (FastAPI)", fill="#F0FDF4", stroke="#047857")
    d.icon("fastapi", 242, 268, 26, 26)
    d.icon("python", 274, 268, 26, 26)
    d.icon("onnx", 306, 268, 26, 26)
    d.text(
        340,
        262,
        226,
        82,
        t("Uvicorn --workers 1 · 0.0.0.0:8000<br/>(host 127.0.0.1:8000) · ≤2 jobs<br/>ONNX SBERT · SQLite WAL mount", "Uvicorn --workers 1 · 0.0.0.0:8000<br/>(máy chủ 127.0.0.1) · ≤2 tác vụ<br/>ONNX SBERT · SQLite WAL"),
        font_size=13,
        align="left",
    )
    n_ssrf = d.card(
        242,
        356,
        318,
        104,
        t("Pinned-IP SSRF Egress Guard", "Lớp chặn SSRF ghim IP đầu ra"),
        t("SSRFSafeAsyncNetworkBackend:<br/>DNS pin · Block RFC 1918/6598<br/>TLS SNI · follow_redirects=False", "SSRFSafeAsyncNetworkBackend:<br/>Ghim DNS · Chặn RFC 1918/6598<br/>TLS SNI · Chặn chuyển hướng"),
        icon_key="ssrf_shield",
        fill="#FEF2F2",
        stroke="#DC2626",
        sw=1.5,
        title_color="#991B1B",
    )

    # Container 3: grobid
    n_grob = d.cube(222, 506, 356, 150, "«container» grobid (0.9.1-crf)", fill="#FFFBEB", stroke="#B45309")
    d.icon("tei", 242, 550, 26, 26)
    d.icon("java_duke", 274, 550, 26, 26)
    d.text(
        310,
        544,
        256,
        100,
        t("Internal bind 0.0.0.0:8070 (private)<br/><b>4 GiB limit · -Xmx768m</b><br/>~3.1 GiB native Wapiti · worker_only<br/>concurrency=2 · 0 B swap", "Nội bộ 0.0.0.0:8070 (không mở ngoài)<br/><b>Giới hạn 4 GiB · -Xmx768m</b><br/>~3.1 GiB Wapiti · worker_only<br/>concurrency=2 · 0 B swap"),
        font_size=13,
        align="left",
    )

    # 3. Right External Services (inner content strictly >= x + 22 and clear of cube top bevel!)
    ex_apis = d.cube(628, 224, 168, 248, t("«external»\n15+ APIs", "«external»\n15+ API"), fill="#EFF6FF", stroke="#1D4ED8")
    for idx_i, ik in enumerate(["crossref", "openalex", "arxiv", "dblp", "epmc", "wayback"]):
        row, col = divmod(idx_i, 3)
        d.icon(ik, 650 + col * 44, 294 + row * 40, 28, 28)
    d.text(648, 382, 138, 76, t("Crossref, OpenAlex,<br/>arXiv, DBLP, EPMC,<br/>Wayback CDX", "Crossref, OpenAlex,<br/>arXiv, DBLP, EPMC,<br/>Wayback CDX"), font_size=13, align="left")

    ex_pay = d.cube(628, 504, 168, 136, t("«external»\nPayments", "«external»\nThanh toán"), fill="#F5F3FF", stroke="#6D28D9")
    d.icon("payment", 650, 570, 28, 28)
    d.text(684, 562, 102, 66, "Stripe REST\nVNPay\nHMAC-512", font_size=13, align="left")

    # Connections
    d.edge(c_cli, n_web, "HTTPS / SSE", ex=1, ey=0.35, nx=0, ny=0.5, pts=[(186, 229), (186, 139)], stroke="#0E7490", ox=0, oy=-14, bold=True)
    d.edge(n_web, n_api, "HTTP :8000", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#047857", ox=50, bold=True)
    d.edge(n_api, n_grob, "TEI :8070", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#B45309", ox=48, bold=True)
    d.edge(n_ssrf, ex_apis, "HTTPS", ex=1, ey=0.4, nx=0, ny=0.5, stroke="#DC2626", sw=1.7, oy=-14, bold=True)
    d.edge(n_ssrf, ex_pay, "HTTPS", ex=1, ey=0.8, nx=0, ny=0.5, pts=[(612, 439), (612, 572)], stroke="#6D28D9", ox=0, oy=-14, bold=True)
    return d


def build_fig4_1(vn: bool) -> DiagramBuilder:
    """8-Layer Pipeline Architecture (S-curve 4+4 spacious layout, exact layer boundaries, zero Ch.5 leaks)."""
    d = DiagramBuilder("p41", "fig4_1_architecture", 800, 650)
    t = lambda en, vi: vi if vn else en

    inp = d.card(
        180,
        14,
        440,
        54,
        t("Manuscript Input (PDF / DOCX / BibTeX / RIS)", "Tài liệu đầu vào (PDF / DOCX / BibTeX / RIS)"),
        t("Uploaded via Multipart REST or Sandbox Endpoint", "Tải lên qua REST đa phần hoặc cổng thử nghiệm"),
        icon_key="doc_pdf",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )

    d.box(12, 92, 776, 176, "", fill="#F8FAFC", stroke="#2563EB", sw=1.3, dashed=1)
    d.text(22, 96, 750, 22, t("Phase I: Ingestion, Structural Linking &amp; Multi-Registry Retrieval (Layers 1–4)", "Giai đoạn I: Trích xuất, Liên kết cấu trúc &amp; Truy hồi đa nguồn (Tầng 1–4)"), font_size=13, font_color="#1E3A8A", bold=True, align="left")

    l1 = d.card(22, 126, 174, 128, t("L1. Parsing", "T1. Trích xuất"), t("GROBID TEI +<br/>PyMuPDF + OCR<br/>11 Styles + VN Law", "GROBID TEI +<br/>PyMuPDF + OCR<br/>11 chuẩn + Luật VN"), icon_key="tei", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l2 = d.card(216, 126, 174, 128, t("L2. Merging", "T2. Hợp nhất"), t("Donor URL repair,<br/>deduplication &amp;<br/>style consensus", "Sửa URL, khử trùng<br/>&amp; bỏ phiếu chuẩn<br/>trích dẫn"), icon_key="merge", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l3 = d.card(410, 126, 174, 128, t("L3. Linking", "T3. Liên kết"), t("Bidirectional 7-tier<br/>cascade (tei_link<br/>.. no_keys)", "Liên kết hai chiều<br/>7 bậc (tei_link<br/>.. no_keys)"), icon_key="link", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l4 = d.card(604, 126, 174, 128, t("L4. Retrieval", "T4. Truy hồi"), t("Tier 0–3 (15+ APIs),<br/>SSRF Link/Wayback<br/>&amp; Abstract Enrich", "Tầng 0–3 (15+ API),<br/>SSRF/Wayback &amp;<br/>Bổ sung tóm tắt"), icon_key="globe", fill="#FFFFFF", stroke="#047857", title_color="#065F46")

    d.edge(inp, l1, "", ex=0.25, ey=1, nx=0.5, ny=0, pts=[(290, 80), (109, 80)], stroke="#1E3A8A")
    d.edge(l1, l2, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8")
    d.edge(l2, l3, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8")
    d.edge(l3, l4, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#047857")

    d.box(12, 316, 776, 218, "", fill="#F0FDF4", stroke="#059669", sw=1.3, dashed=1)
    d.text(22, 320, 750, 22, t("Phase II: Multimodal Matching, Neuro-Symbolic Verification, Scoring &amp; Delivery (Layers 5–8)", "Giai đoạn II: So khớp đa phương thức, Xác minh Neuro-Symbolic, Chấm điểm &amp; Giao diện (Tầng 5–8)"), font_size=13, font_color="#065F46", bold=True, align="left")

    l5 = d.card(22, 364, 170, 152, t("L5. Matching", "T5. So khớp"), t("RapidFuzz + SBERT<br/>Author 1-to-1 +<br/>Venue + Context<br/>→ <b>MatchFeatures</b>", "RapidFuzz + SBERT<br/>Tác giả 1-1 + Nơi CB<br/>+ Ngữ cảnh<br/>→ <b>MatchFeatures</b>"), icon_key="neural", fill="#FFFFFF", stroke="#059669", title_color="#065F46")
    l6 = d.card(224, 364, 174, 152, t("L6. Verify", "T6. Xác minh"), t("68 Symbolic Rules<br/>+ 16D MLR (α=0.72)<br/>+ Platt Calibration<br/>→ <b>CitationVerdict</b>", "68 Luật ký hiệu<br/>+ 16D MLR (α=0.72)<br/>+ Hiệu chỉnh Platt<br/>→ <b>Phán quyết</b>"), icon_key="scale", fill="#FFFFFF", stroke="#B45309", title_color="#92400E")
    l7 = d.card(422, 364, 170, 152, t("L7. CIS &amp; Fix", "T7. CIS &amp; Sửa"), t("5-Component Rubric<br/><b>CIS [0–100]</b> +<br/>BibTeX / DOI<br/>Auto-Repair", "5 thành phần điểm<br/><b>CIS [0–100]</b> +<br/>Tự đề xuất sửa<br/>BibTeX / DOI"), icon_key="cis_clean", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l8 = d.card(614, 364, 164, 152, t("L8. API &amp; UI", "T8. API &amp; UI"), t("FastAPI REST +<br/>ReadableStream<br/>SSE + React 18<br/>(EN / VI)", "FastAPI REST +<br/>ReadableStream<br/>SSE + React 18<br/>(EN / VI)"), icon_key="fastapi", fill="#FFFFFF", stroke="#0E7490", title_color="#0E7490")

    d.edge(
        l4,
        l5,
        t("SourceResult (candidates + abstracts)", "Kết quả nguồn (ứng viên + tóm tắt)"),
        ex=0.5,
        ey=1,
        nx=0.5,
        ny=0,
        pts=[(691, 292), (107, 292)],
        stroke="#047857",
        sw=1.7,
        oy=-14,
        bold=True,
        font_color="#065F46",
    )
    d.edge(l5, l6, "", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#059669", sw=1.6)
    # Crisp pill sitting cleanly ABOVE the L5->L6 gap with zero border collision!
    d.box(156, 344, 108, 22, "<b>MatchFeatures</b>", fill="#ECFDF5", stroke="#059669", sw=1.0, font_size=13, font_color="#065F46", arc=6)
    d.edge(l6, l7, "", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#B45309")
    d.edge(l7, l8, "", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8")

    out = d.card(
        130,
        566,
        540,
        68,
        t("Auditable Verification Report &amp; Classroom Analytics", "Báo cáo xác minh truy vết được &amp; Phân tích lớp học"),
        t("CIS [0–100] · 5-Class Verdicts · Rule Trace · PDF / JSON / BibTeX Exports", "CIS [0–100] · 5 nhãn phán quyết · Vết luật · Xuất PDF / JSON / BibTeX"),
        icon_key="shield_ok",
        fill="#DCFCE7",
        stroke="#047857",
        sw=1.6,
        title_color="#065F46",
    )
    d.edge(l8, out, "", ex=0.5, ey=1, nx=1, ny=0.5, pts=[(696, 600)], stroke="#047857", sw=1.6)
    return d


def build_fig4_2(vn: bool) -> DiagramBuilder:
    """Layer 1 & 2 Ingestion & Extraction (11 CitationFormat subclasses separate from VN Legal Helper; real DOI; Ho/Hồ)."""
    d = DiagramBuilder("p42", "fig4_2_extraction", 780, 560)
    t = lambda en, vi: vi if vn else en

    in_pdf = d.card(80, 16, 260, 58, t("Academic PDF Input", "Tệp PDF học thuật"), t("Digital or Scanned Manuscript", "Bản thảo số hoặc bản quét OCR"), icon_key="doc_pdf", fill="#EFF6FF", stroke="#1E3A8A", title_color="#1E3A8A")
    in_str = d.card(440, 16, 260, 58, t("Structured Inputs", "Đầu vào có cấu trúc"), "DOCX · BibTeX (.bib) · RIS", icon_key="multifile", fill="#F5F3FF", stroke="#6D28D9", title_color="#5B21B6")

    # Three Parallel Extractors
    p1 = d.card(18, 118, 236, 98, "GROBID 0.9.1-crf (TEI)", t("Primary PDF parser; preserves<br/>columns, XML &lt;ref target&gt;", "Bộ phân tích PDF chính;<br/>giữ cột &amp; thẻ &lt;ref target&gt;"), icon_key="tei", fill="#ECFDF5", stroke="#047857", title_color="#065F46")
    p2 = d.card(272, 118, 236, 98, t("PyMuPDF + Tesseract OCR", "PyMuPDF + OCR Tesseract"), t("Fast native text, donor URLs<br/>&amp; scanned PDF OCR fallback", "Trích văn bản nhanh, sửa URL<br/>&amp; OCR cho trang PDF quét"), icon_key="pymupdf", fill="#FFFBEB", stroke="#B45309", title_color="#92400E")
    p3 = d.card(526, 118, 236, 98, t("Native Format Readers", "Bộ đọc định dạng gốc"), t("python-docx, BibTeX &amp; RIS<br/>lossless field extraction", "python-docx, BibTeX &amp; RIS<br/>trích trường không mất mát"), icon_key="multifile", fill="#F5F3FF", stroke="#6D28D9", title_color="#5B21B6")

    d.edge(in_pdf, p1, "", ex=0.3, ey=1, nx=0.5, ny=0, pts=[(158, 94), (136, 94)], stroke="#047857")
    d.edge(in_pdf, p2, "", ex=0.75, ey=1, nx=0.5, ny=0, pts=[(275, 94), (390, 94)], stroke="#B45309")
    d.edge(in_str, p3, "", ex=0.5, ey=1, nx=0.5, ny=0, pts=[(570, 94), (644, 94)], stroke="#6D28D9")

    # Hybrid Merger Bar
    mrg = d.card(
        76,
        258,
        628,
        74,
        t("Hybrid DocumentParser Merger &amp; Normalization", "Bộ hợp nhất lai DocumentParser &amp; Chuẩn hóa"),
        t("Merges GROBID TEI + regex donors · Repairs bled/wrapped DOIs (e.g., doi: 10.1109/CVPR.2016.90)<br/>Filters style placeholders · Preserves VN diacritics (e.g., Ho / Hồ)", "Hợp nhất GROBID TEI + regex · Sửa DOI/URL ngắt dòng (vd: doi: 10.1109/CVPR.2016.90)<br/>Lọc mẫu giả · Bảo toàn dấu tiếng Việt (vd: Ho / Hồ)"),
        icon_key="merge",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )
    d.edge(p1, mrg, "", ex=0.5, ey=1, nx=0.15, ny=0, pts=[(136, 238), (170, 238)], stroke="#047857")
    d.edge(p2, mrg, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#B45309")
    d.edge(p3, mrg, "", ex=0.5, ey=1, nx=0.85, ny=0, pts=[(644, 238), (610, 238)], stroke="#6D28D9")

    # Explicitly SEPARATE: 11 CitationFormat Subclasses vs VN Legal Helper!
    c11 = d.card(
        18,
        374,
        420,
        104,
        t("11 CitationFormat Subclasses (Priority 100 → 70)", "11 lớp con CitationFormat (Ưu tiên 100 → 70)"),
        t("IEEE (100), Nature (95), ACM (88), Vancouver (85), AMA (84),<br/>APA (80), MLA (78), Chicago (75), Turabian (73),<br/>ISO 690 (72), Harvard (70) — Dominant style voting", "IEEE (100), Nature (95), ACM (88), Vancouver (85), AMA (84),<br/>APA (80), MLA (78), Chicago (75), Turabian (73),<br/>ISO 690 (72), Harvard (70) — Bỏ phiếu chuẩn chủ đạo"),
        icon_key="python",
        fill="#FFFFFF",
        stroke="#1D4ED8",
        sw=1.5,
        title_color="#1E3A8A",
    )
    vnl = d.card(
        462,
        374,
        300,
        104,
        t("VN Legal Helper (Dedicated)", "Bộ tách văn bản Luật VN (Riêng)"),
        t("Detects Luật, Nghị định, Thông tư,<br/>Quyết định + statutory codes<br/>(separate from 11 style classes)", "Nhận diện Luật, Nghị định, Thông tư,<br/>Quyết định + số hiệu văn bản<br/>(tách biệt khỏi 11 lớp chuẩn)"),
        icon_key="scale",
        fill="#FEF3C7",
        stroke="#B45309",
        sw=1.5,
        title_color="#92400E",
    )
    d.edge(mrg, c11, "", ex=0.3, ey=1, nx=0.5, ny=0, pts=[(264, 352), (228, 352)], stroke="#1D4ED8")
    d.edge(mrg, vnl, "", ex=0.75, ey=1, nx=0.5, ny=0, pts=[(547, 352), (612, 352)], stroke="#B45309")

    # Output bar
    out = d.box(100, 504, 580, 42, t("<b>Output:</b> Structured Inline Citations[] + ReferenceList[] + Detected Style → Layer 3 Linking", "<b>Đầu ra:</b> Trích dẫn nội văn[] + Danh mục TLTK[] + Chuẩn nhận diện → Tầng 3 Liên kết"), fill="#DCFCE7", stroke="#047857", sw=1.5, font_size=13)
    d.edge(c11, out, "", ex=0.5, ey=1, nx=0.35, ny=0, pts=[(228, 490), (303, 490)], stroke="#047857")
    d.edge(vnl, out, "", ex=0.5, ey=1, nx=0.75, ny=0, pts=[(612, 490), (535, 490)], stroke="#047857")
    return d


def build_fig4_3(vn: bool) -> DiagramBuilder:
    """Bidirectional Citation Linking (0 crossings, exact live 7-method cascade + manual_review, 1B connected)."""
    d = DiagramBuilder("p43", "fig4_3_linking", 780, 650)
    t = lambda en, vi: vi if vn else en

    # Dual top inputs (BOTH 1A and 1B connected explicitly into Index Spine!)
    i1a = d.card(36, 14, 326, 62, t("1A. Inline Body Markers", "1A. Ký hiệu trích dẫn nội văn"), t("[1], [1–3], [14a, 14b], (Author, 2020a)", "[1], [1–3], [14a, 14b], (Tác giả, 2020a)"), icon_key="doc_pdf", fill="#EFF6FF", stroke="#1E3A8A", title_color="#1E3A8A")
    i1b = d.card(418, 14, 326, 62, t("1B. Bibliography Entries", "1B. Mục danh mục TLTK"), t("Structured ReferenceList[] + TEI xml:id", "Danh mục TLTK có cấu trúc + TEI xml:id"), icon_key="multifile", fill="#ECFDF5", stroke="#047857", title_color="#065F46")

    spine = d.box(150, 108, 480, 42, t("<b>Dual-Index Spine</b> (TEI ID · DOI · arXiv · Index · Surname+Year)", "<b>Trục chỉ mục kép</b> (TEI ID · DOI · arXiv · Chỉ số · Họ+Năm)"), fill="#DBEAFE", stroke="#1D4ED8", sw=1.6, font_size=13)
    d.edge(i1a, spine, "", ex=0.5, ey=1, nx=0.25, ny=0, pts=[(199, 92), (270, 92)], stroke="#1E3A8A")
    d.edge(i1b, spine, "", ex=0.5, ey=1, nx=0.75, ny=0, pts=[(581, 92), (510, 92)], stroke="#047857")

    # 7-Method Cascade (Left-center vertical stack, exact live order & weights!)
    steps = [
        ("1. tei_link", "0.98", t("GROBID &lt;ref target='#bN'&gt; XML pointer", "Con trỏ XML &lt;ref target='#bN'&gt; GROBID"), "#ECFDF5", "#047857"),
        ("2. doi_exact", "0.95", t("Normalized DOI equality match", "Khớp chính xác DOI đã chuẩn hóa"), "#ECFDF5", "#047857"),
        ("3. arxiv_exact", "0.95", t("Live normalized arXiv identifier match", "Khớp trực tiếp mã arXiv đã chuẩn hóa"), "#ECFDF5", "#047857"),
        ("4. numeric_index", "0.90", t("[1], ranges [1–3], composite [14a, 14b]", "[1], dải [1–3], trích dẫn ghép [14a, 14b]"), "#EFF6FF", "#1D4ED8"),
        ("5. author_year", "0.90", t("Normalized surname + year + suffix (2020a)", "Họ chuẩn hóa + năm + hậu tố (2020a)"), "#EFF6FF", "#1D4ED8"),
        ("6. fuzzy", "0.65", t("RapidFuzz partial title / author fallback", "Dự phòng khớp mờ RapidFuzz tiêu đề/tác giả"), "#FFFBEB", "#B45309"),
        ("7. no_keys", "0.00", t("No key match → orphan / uncited diagnostic", "Không khớp khóa → mồ côi / chưa trích dẫn"), "#FEF2F2", "#DC2626"),
    ]
    prev_id = spine
    step_ids = []
    y0 = 172
    for idx, (mname, wt, desc, fl, st) in enumerate(steps):
        sy = y0 + idx * 52
        sid = d.box(
            36,
            sy,
            496,
            40,
            f"<b>{mname}</b> (w={wt})  —  {desc}",
            fill=fl,
            stroke=st,
            sw=1.4,
            font_size=13,
            align="left",
            extra="spacingLeft=10;",
        )
        step_ids.append(sid)
        if idx == 0:
            d.edge(spine, sid, "", ex=0.35, ey=1, nx=0.5, ny=0, pts=[(318, 160), (284, 160)], stroke="#1D4ED8")
        else:
            d.edge(prev_id, sid, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#64748B", sw=1.2)
        prev_id = sid

    # Separate side callout: manual_review (1.00) via Verdicts API
    man = d.card(
        562,
        244,
        198,
        122,
        "manual_review\n(w = 1.00)",
        t("Instructor override<br/>persisted via<br/>PATCH /verdicts/{id}", "Ghi đè giảng viên<br/>lưu bền vững qua<br/>PATCH /verdicts/{id}"),
        icon_key="teacher",
        fill="#FEF9C3",
        stroke="#CA8A04",
        sw=1.5,
        title_color="#854D0E",
    )

    # Bottom 3 Outputs
    o_ok = d.box(36, 566, 224, 68, t("<b>Matched Links</b><br/>Inline ↔ Reference<br/>(feeds Context Align)", "<b>Liên kết khớp</b><br/>Nội văn ↔ TLTK<br/>(cấp cho So khớp ngữ cảnh)"), fill="#DCFCE7", stroke="#047857", sw=1.5, font_size=13)
    o_or = d.box(278, 566, 224, 68, t("<b>Orphan Citations</b><br/>Cited in body but<br/>absent from bibliography", "<b>Trích dẫn mồ côi</b><br/>Có trong nội văn nhưng<br/>thiếu ở danh mục TLTK"), fill="#FEF3C7", stroke="#B45309", sw=1.5, font_size=13)
    o_un = d.box(520, 566, 240, 68, t("<b>Uncited References</b><br/>In bibliography but<br/>0 body citations → s_link", "<b>TLTK chưa trích dẫn</b><br/>Có ở danh mục nhưng<br/>0 lần gọi → tính s_link"), fill="#FEE2E2", stroke="#DC2626", sw=1.5, font_size=13)

    d.edge(step_ids[5], o_ok, "", ex=0.0, ey=0.5, nx=0.1, ny=0, pts=[(16, 452), (16, 548), (58, 548)], stroke="#047857", sw=1.5)
    d.edge(step_ids[6], o_or, "", ex=0.5, ey=1, nx=0.5, ny=0, pts=[(284, 544), (390, 544)], stroke="#B45309", sw=1.5)
    d.edge(step_ids[6], o_un, "", ex=0.85, ey=1, nx=0.5, ny=0, pts=[(458, 536), (640, 536)], stroke="#DC2626", sw=1.5)
    d.edge(man, o_ok, "", ex=0.5, ey=1, nx=0.85, ny=0, pts=[(661, 550), (226, 550)], dashed=1, stroke="#CA8A04", sw=1.4)
    return d


def build_fig4_4(vn: bool) -> DiagramBuilder:
    """4-Tier Retrieval Waterfall (ACL Anthology in Tier 0, zero duplicate PyPI, all icons labeled, Pinned-IP SSRF rail)."""
    d = DiagramBuilder("p44", "fig4_4_retrieval", 800, 690)
    t = lambda en, vi: vi if vn else en

    # Pre-Screen + Cache
    pre = d.card(
        18,
        12,
        526,
        62,
        t("Pre-Screen Router &amp; SQLite citation_cache (doi:/arxiv:/url:)", "Bộ định tuyến &amp; Bộ đệm SQLite citation_cache (doi:/arxiv:/url:)"),
        t("Cache hit (&lt;5 ms) short-circuits WAN · Extracts DOI, arXiv, URL, Title+Author keys", "Trúng đệm (&lt;5 ms) bỏ qua WAN · Tách khóa DOI, arXiv, URL, Tiêu đề+Tác giả"),
        icon_key="sqlite",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )

    # Tier 0 (Offline, ACL Anthology HERE!)
    t0 = d.box(18, 96, 526, 108, "", fill="#ECFDF5", stroke="#047857", sw=1.5)
    d.text(28, 100, 506, 24, t("Tier 0: Sub-25 ms Offline Index (Zero Network)", "Tầng 0: Chỉ mục ngoại tuyến &lt;25 ms (Không cần mạng)"), font_size=14, font_color="#065F46", bold=True, align="left")
    d.card(30, 128, 256, 66, "local_papers.db (FTS5)", t("129,137 records · 98.42% ACL", "129,137 bài · 98.42% ACL"), icon_key="acl", fill="#FFFFFF", stroke="#047857", title_color="#065F46")
    d.card(298, 128, 234, 66, "_KNOWN_PAPERS (RAM)", t("101 classics · &lt;1 ms", "101 bài kinh điển · &lt;1 ms"), icon_key="python", fill="#FFFFFF", stroke="#047857", title_color="#065F46")

    # Tier 1: Core Parallel Scholarly APIs (4 labeled icon badges)
    t1 = d.box(18, 226, 526, 114, "", fill="#EFF6FF", stroke="#1D4ED8", sw=1.5)
    d.text(28, 230, 506, 24, t("Tier 1: Core Parallel Scholarly Registries (Circuit-Breaker Guarded)", "Tầng 1: 4 API học thuật lõi song song (Có bộ ngắt mạch)"), font_size=14, font_color="#1E3A8A", bold=True, align="left")
    t1_items = [("crossref", "Crossref"), ("openalex", "OpenAlex"), ("datacite", "DataCite"), ("doi", "DOI RA")]
    for idx, (ik, lbl) in enumerate(t1_items):
        bx = 30 + idx * 126
        d.box(bx, 260, 116, 68, "", fill="#FFFFFF", stroke="#93C5FD", sw=1.2)
        d.icon(ik, bx + 44, 266, 28, 28)
        d.text(bx + 2, 298, 112, 26, lbl, font_size=13, bold=True)

    # Tier 2 + Tier 2.5 Specialist & Preprint Failover (NO duplicate PyPI!)
    t2 = d.box(18, 362, 526, 198, "", fill="#FFFBEB", stroke="#B45309", sw=1.5)
    d.text(28, 366, 506, 24, t("Tier 2: Specialist Failover &amp; Tier 2.5 Preprints (All Labeled)", "Tầng 2: Nguồn chuyên ngành &amp; Tầng 2.5 Bản thảo tiền in"), font_size=14, font_color="#92400E", bold=True, align="left")
    t2_row1 = [("dblp", "DBLP"), ("epmc", "EuroPMC"), ("doaj", "DOAJ"), ("hal", "HAL")]
    t2_row2 = [("openlib", "OpenLib"), ("pypi", "PyPI"), ("hf", "HF Hub"), ("arxiv", "arXiv (2.5)")]
    for r_i, row_items in enumerate((t2_row1, t2_row2)):
        by = 396 + r_i * 78
        for idx, (ik, lbl) in enumerate(row_items):
            bx = 30 + idx * 126
            d.box(bx, by, 116, 68, "", fill="#FFFFFF", stroke="#FCD34D", sw=1.2)
            d.icon(ik, bx + 44, by + 6, 28, 28)
            d.text(bx + 2, by + 38, 112, 26, lbl, font_size=13, bold=True)

    # Tier 3: Optional Opt-In Web Search
    t3 = d.box(
        18,
        582,
        526,
        44,
        t("<b>Tier 3 (Optional Opt-In):</b> Serper / SerpAPI — Disabled by default; API-key gated", "<b>Tầng 3 (Tùy chọn bật thêm):</b> Serper / SerpAPI — Tắt mặc định; cần khóa API"),
        fill="#F1F5F9",
        stroke="#64748B",
        sw=1.3,
        dashed=1,
        font_size=13,
        align="left",
        extra="spacingLeft=10;",
    )

    # Right Parallel Rail: Pinned-IP SSRF Link Validation & Abstract Enricher
    rail = d.box(574, 12, 212, 614, "", fill="#FEF2F2", stroke="#DC2626", sw=1.5)
    d.text(582, 18, 196, 44, t("Parallel Egress Rail\n(Pinned-IP SSRF)", "Luồng song song\n(Chặn SSRF ghim IP)"), font_size=14, font_color="#991B1B", bold=True)
    d.icon("ssrf_shield", 666, 68, 30, 30)

    r1 = d.card(586, 112, 188, 108, "LinkValidator", t("HEAD/GET liveness,<br/>RFC 2606 fake URL,<br/>redirect blocks", "Kiểm tra URL sống,<br/>RFC 2606 URL giả,<br/>chặn chuyển hướng"), icon_key="tls", fill="#FFFFFF", stroke="#DC2626", title_color="#991B1B")
    r2 = d.card(586, 238, 188, 108, "HTML Meta", t("Scrapes &lt;title&gt; &amp;<br/>citation_title tags<br/>for decoy checks", "Đọc thẻ &lt;title&gt; &amp;<br/>citation_title để<br/>bắt trang mồi nhử"), icon_key="globe", fill="#FFFFFF", stroke="#DC2626", title_color="#991B1B")
    r3 = d.card(586, 364, 188, 108, "Wayback CDX", t("Internet Archive<br/>fallback for dead<br/>HTTP 404/410 URLs", "Kho Internet Archive<br/>khôi phục liên kết<br/>chết HTTP 404/410"), icon_key="wayback", fill="#FFFFFF", stroke="#B45309", title_color="#92400E")
    r4 = d.card(586, 490, 188, 118, t("Abstract Enrich", "Bổ sung tóm tắt"), t("Fills missing abstracts<br/>on top pool[:3]<br/>via OpenAlex / EPMC", "Bổ sung tóm tắt cho<br/>3 ứng viên đầu<br/>qua OpenAlex / EPMC"), icon_key="openalex", fill="#ECFDF5", stroke="#047857", title_color="#065F46")

    # Vertical waterfall connectors on left
    d.edge(pre, t0, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#047857")
    d.edge(t0, t1, t("Miss / low sim", "Không trúng"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1D4ED8", ox=58)
    d.edge(t1, t2, t("Fallback", "Dự phòng"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#B45309", ox=48)
    d.edge(t2, t3, t("If key set", "Nếu bật"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, dashed=1, stroke="#64748B", ox=46)
    d.edge(pre, rail, "", ex=1, ey=0.5, nx=0, ny=0.05, stroke="#DC2626", sw=1.5)

    # Bottom Output bar
    d.box(18, 640, 768, 40, t("<b>Output:</b> SourceResult (ranked candidates[], abstracts, url_status, html_meta, api_errors[]) → Layer 5 Matching", "<b>Đầu ra:</b> SourceResult (ứng viên[], tóm tắt, trạng thái URL, html_meta, lỗi API[]) → Tầng 5 So khớp"), fill="#DCFCE7", stroke="#047857", sw=1.5, font_size=13)
    return d


def build_fig4_5(vn: bool) -> DiagramBuilder:
    """Layer 5 Multimodal Evidence Matching Engine (max(fuzzy, semantic), e(·), 0.65/0.35, vn_en_academic_bridge, Lê/Võ/Đỗ/Hồ/Lý)."""
    d = DiagramBuilder("p45", "fig4_5_matching", 780, 610)
    t = lambda en, vi: vi if vn else en

    # Left Dual Inputs
    in1 = d.card(16, 148, 174, 108, t("Parsed Citation", "Trích dẫn tách"), t("Title, Authors, Year,<br/>Venue, DOI, Context", "Tiêu đề, Tác giả, Năm,<br/>Nơi CB, DOI, Ngữ cảnh"), icon_key="doc_pdf", fill="#EFF6FF", stroke="#1E3A8A", title_color="#1E3A8A")
    in2 = d.card(16, 344, 174, 108, "SourceCandidate", t("Canonical Metadata<br/>+ Enriched Abstract", "Siêu dữ liệu chuẩn<br/>+ Tóm tắt bổ sung"), icon_key="fts5", fill="#ECFDF5", stroke="#047857", title_color="#065F46")

    # 4 Parallel Matching Tracks (Center)
    m1 = d.card(
        228,
        18,
        350,
        122,
        t("1. Dual Title Fidelity", "1. Độ trung thực tiêu đề kép"),
        t("RapidFuzz WRatio + SBERT e(·) [384-d]<br/>all-MiniLM-L6-v2 / Multilingual ONNX<br/><b>Score = max(fuzzy, semantic)</b>", "RapidFuzz WRatio + SBERT e(·) [384-d]<br/>all-MiniLM-L6-v2 / Đa ngữ ONNX<br/><b>Điểm = max(mờ, ngữ nghĩa)</b>"),
        icon_key="multiling",
        fill="#EFF6FF",
        stroke="#1D4ED8",
        title_color="#1E3A8A",
    )
    m2 = d.card(
        228,
        160,
        350,
        122,
        t("2. 1-to-1 Author Reconciliation", "2. Đối chiếu tác giả 1-1"),
        t("Greedy bipartite surname matching;<br/>VN diacritics (<b>Lê, Võ, Đỗ, Hồ, Lý</b>),<br/>particles (Van/De/Du) &amp; et al.", "Khớp họ hai phía 1-1;<br/>dấu tiếng Việt (<b>Lê, Võ, Đỗ, Hồ, Lý</b>),<br/>tiền tố (Van/De/Du) &amp; et al."),
        icon_key="student",
        fill="#ECFDF5",
        stroke="#047857",
        title_color="#065F46",
    )
    m3 = d.card(
        228,
        302,
        350,
        122,
        t("3. Year, Venue &amp; DOI Signals", "3. Tín hiệu Năm, Nơi công bố &amp; DOI"),
        t("Year Δ tolerance (±1 preprint grace)<br/>VenueNormalizer (aliases &amp; acronyms)<br/>DOI Exact Equality (separate bit)", "Sai lệch năm (±1 bản tiền in)<br/>VenueNormalizer (tên tắt &amp; bí danh)<br/>Khớp DOI chính xác (bit riêng biệt)"),
        icon_key="doi",
        fill="#FFFBEB",
        stroke="#B45309",
        title_color="#92400E",
    )
    m4 = d.card(
        228,
        444,
        350,
        148,
        t("4. Semantic Context Alignment", "4. Đối chiếu ngữ cảnh trích dẫn"),
        t("Hierarchical Sentence Pooling:<br/><b>0.65 · max(s_i) + 0.35 · s_abs</b><br/><b>vn_en_academic_bridge (+0.08)</b><br/>Stance contradiction &amp; lexical guards", "Gộp câu phân cấp:<br/><b>0.65 · max(s_i) + 0.35 · s_abs</b><br/><b>vn_en_academic_bridge (+0.08)</b><br/>Phát hiện mâu thuẫn lập trường"),
        icon_key="onnx",
        fill="#F5F3FF",
        stroke="#6D28D9",
        title_color="#5B21B6",
    )

    # Right Output: MatchFeatures + 16D Vector x
    out = d.card(
        610,
        214,
        156,
        178,
        "MatchFeatures\n&amp; 16D Vector x",
        t("10 base cues +<br/>6 interaction<br/>terms<br/>→ <b>Layer 6</b>", "10 tín hiệu gốc<br/>+ 6 đặc trưng<br/>tương tác<br/>→ <b>Tầng 6</b>"),
        icon_key="vec16",
        fill="#DCFCE7",
        stroke="#047857",
        sw=1.7,
        title_color="#065F46",
    )

    # Clean orthogonal bus lines (left fan-out at x=208, right fan-in at x=594)
    for target in (m1, m2, m3, m4):
        tx_y = d._coords[target][1] + d._coords[target][3] / 2
        d.edge(in1, target, "", ex=1, ey=0.5, nx=0, ny=0.4, pts=[(204, 202), (204, tx_y - 12)], stroke="#1E3A8A", sw=1.2)
        d.edge(in2, target, "", ex=1, ey=0.5, nx=0, ny=0.6, pts=[(212, 398), (212, tx_y + 12)], stroke="#047857", sw=1.2)
        d.edge(target, out, "", ex=1, ey=0.5, nx=0, ny=0.5, pts=[(594, tx_y), (594, 303)], stroke="#047857", sw=1.4)
    return d


def build_fig4_6(vn: bool) -> DiagramBuilder:
    """Layer 6 Neuro-Symbolic Verification & Platt Calibration (pure Layer 6, NO Ch.5 metrics, NO 91.4 dial, VN Độ tin cậy)."""
    d = DiagramBuilder("p46", "fig4_6_neurosymbolic", 780, 560)
    t = lambda en, vi: vi if vn else en

    # Dual Left Inputs
    i_ml = d.card(16, 62, 198, 124, "MatchFeatures → x", t("16D vector x ∈ ℝ¹⁶<br/>Title, Author, Year,<br/>Venue, Context, Inter.", "Véc-tơ 16 chiều x ∈ ℝ¹⁶<br/>Tiêu đề, Tác giả, Năm,<br/>Nơi CB, Ngữ cảnh"), icon_key="vec16", fill="#EFF6FF", stroke="#1D4ED8", title_color="#1E3A8A")
    i_sy = d.card(16, 266, 198, 134, t("Provenance Flags", "Cờ nguồn gốc rời rạc"), t("is_retracted, url_status,<br/>HTTP 429, doi_ra,<br/>VN statutory rules", "is_retracted, url_status,<br/>HTTP 429, doi_ra,<br/>quy tắc pháp luật VN"), icon_key="shield_ok", fill="#FFFBEB", stroke="#B45309", title_color="#92400E")

    # Top Neural / Statistical Path
    ml = d.card(256, 62, 232, 124, "HybridMLScorer (MLR)", t("L2 Multinomial Logistic Reg.<br/>C = 0.25 · Balanced weights<br/>→ <b>p_ML(y | x)</b>", "Hồi quy Logistic đa lớp L2<br/>C = 0.25 · Trọng số cân bằng<br/>→ <b>p_ML(y | x)</b>"), icon_key="neural", fill="#EFF6FF", stroke="#1D4ED8", sw=1.6, title_color="#1E3A8A")

    # Bottom Symbolic Guardrail Path
    sym = d.card(256, 266, 232, 134, t("SymbolicRules (68 R-*)", "Luật ký hiệu (68 R-*)"), t("Order 0 + Groups 1–5:<br/>Deterministic verdicts &amp;<br/>→ <b>y_sym, p_sym, rules[]</b>", "Bậc 0 + Nhóm 1–5:<br/>Phán quyết tất định &amp;<br/>→ <b>y_sym, p_sym, rules[]</b>"), icon_key="scale", fill="#FFFBEB", stroke="#B45309", sw=1.6, title_color="#92400E")

    # Fusion & Platt Calibration (Right column + bottom strip)
    fuse = d.box(
        530,
        134,
        234,
        108,
        t("<b>Monotonic Blend</b><br/>p_blend = α·p_sym + (1−α)·p_ML<br/>(α = 0.72 · Symbolic label y_sym<br/>never inverted by ML)", "<b>Hòa trộn đơn điệu</b><br/>p_blend = α·p_sym + (1−α)·p_ML<br/>(α = 0.72 · Nhãn ký hiệu y_sym<br/>không bị đảo bởi ML)"),
        fill="#F0FDF4",
        stroke="#059669",
        sw=1.6,
        font_size=13,
    )

    platt = d.card(
        530,
        282,
        234,
        124,
        "PlattCalibrator",
        t("z = logit(p_blend)<br/>p_cal = clip(σ(a·z + b),<br/>0.01, 0.99)", "z = logit(p_blend)<br/>p_cal = clip(σ(a·z + b),<br/>0.01, 0.99)"),
        icon_key="platt_clean",
        fill="#ECFDF5",
        stroke="#047857",
        sw=1.6,
        title_color="#065F46",
    )

    # Pure Layer 6 Output Card (NO Ch.5 numbers, NO CIS dial!)
    out = d.card(
        106,
        448,
        568,
        94,
        t("Layer 6 Output: CitationVerdict", "Đầu ra Tầng 6: CitationVerdict"),
        t("<b>label</b> ∈ {VERIFIED, METADATA_ERROR, SUSPECTED_HALLUCINATION, UNRESOLVED, RESOURCE}<br/><b>calibrated_confidence</b> p_cal ∈ [0.01, 0.99]  ·  <b>triggered_rules[]</b> audit trace → Layer 7 CIS", "<b>nhãn</b> ∈ {VERIFIED, METADATA_ERROR, SUSPECTED_HALLUCINATION, UNRESOLVED, RESOURCE}<br/><b>độ tin cậy hiệu chỉnh</b> p_cal ∈ [0.01, 0.99] · <b>vết luật triggered_rules[]</b> → Tầng 7 CIS"),
        icon_key="shield_ok",
        fill="#DCFCE7",
        stroke="#047857",
        sw=1.7,
        title_color="#065F46",
    )

    # Clean orthogonal connectors (lifted cleanly above horizontal legs)
    d.edge(i_ml, ml, "16D x", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8", oy=-14)
    d.edge(i_sy, sym, t("Flags", "Cờ"), ex=1, ey=0.5, nx=0, ny=0.5, stroke="#B45309", oy=-14)
    d.edge(i_ml, sym, "", ex=0.5, ey=1, nx=0.25, ny=0, pts=[(115, 226), (314, 226)], dashed=1, stroke="#64748B")
    d.edge(ml, fuse, "p_ML", ex=1, ey=0.5, nx=0, ny=0.35, pts=[(508, 124), (508, 172)], stroke="#1D4ED8", ox=0, oy=-14)
    d.edge(sym, fuse, "p_sym", ex=1, ey=0.35, nx=0, ny=0.7, pts=[(508, 313), (508, 210)], stroke="#B45309", ox=0, oy=-14)
    d.edge(fuse, platt, "p_blend", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#059669", ox=42, bold=True)
    d.edge(platt, out, t("p_cal", "độ tin cậy"), ex=0.5, ey=1, nx=0.8, ny=0, pts=[(647, 428), (560, 428)], stroke="#047857", ox=42, oy=-14, bold=True)
    d.edge(sym, out, "y_sym, rules[]", ex=0.5, ey=1, nx=0.35, ny=0, pts=[(372, 424), (305, 424)], stroke="#B45309", ox=-54, oy=-14, bold=True)
    return d


def build_fig4_7(vn: bool) -> DiagramBuilder:
    """Guarded Symbolic Decision Flow (relocated to Ch.4 §4.6.1, spacious side gaps, Order 0 VN Legal branch, split Group 1-2, honest footer)."""
    d = DiagramBuilder("p47", "fig4_7_decision_flow", 820, 748)
    t = lambda en, vi: vi if vn else en

    # Start Input (cx = 410)
    st = d.box(235, 12, 350, 42, t("<b>Input:</b> Citation + SourceResult + MatchFeatures", "<b>Đầu vào:</b> Trích dẫn + Kết quả nguồn + MatchFeatures"), fill="#EFF6FF", stroke="#1E3A8A", sw=1.5, font_size=13)

    # Order 0 Diamond (cx = 410, x=290..530; 78px gaps to left & right cards!)
    d0 = d.diamond(290, 80, 240, 88, t("Order 0: Resource or\nVN Statutory Check?", "Bậc 0: Tài nguyên hay\nVăn bản Luật VN?"))
    d.edge(st, d0, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1E3A8A")

    o_res = d.card(12, 86, 200, 76, "RESOURCE", t("Valid web/std/dataset<br/>or valid VN statute", "Web/chuẩn hợp lệ<br/>hoặc Luật VN hợp lệ"), icon_key="resource", fill="#E0F2FE", stroke="#0369A1", title_color="#075985")
    o_vnl = d.card(608, 86, 200, 76, "METADATA_ERROR", t("VNLegalVerifier:<br/>authority/code conflict", "VNLegalVerifier:<br/>sai thẩm quyền/số hiệu"), icon_key="scale", fill="#FEF3C7", stroke="#B45309", title_color="#92400E")

    d.edge(d0, o_res, t("Valid", "Hợp lệ"), ex=0, ey=0.5, nx=1, ny=0.5, orth=False, stroke="#0369A1", oy=-14, bold=True)
    d.edge(d0, o_vnl, t("VN conflict", "Sai luật"), ex=1, ey=0.5, nx=0, ny=0.5, orth=False, stroke="#B45309", oy=-14, bold=True)

    # Group 1–2 Diamond (cx = 410, x=286..534)
    d12 = d.diamond(286, 214, 248, 92, t("Groups 1–2: Hard\nIntegrity Guardrail?", "Nhóm 1–2: Rào chắn\ntoàn vẹn cứng?"))
    d.edge(d0, d12, t("Academic", "Học thuật"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#334155", ox=50, bold=True)

    o_ret = d.card(12, 220, 200, 80, "METADATA_ERROR", t("is_retracted = True<br/>(R-RETRACTED-PAPER)", "is_retracted = True<br/>(R-RETRACTED-PAPER)"), icon_key="scale", fill="#FEF3C7", stroke="#B45309", title_color="#92400E")
    o_hal = d.card(608, 220, 200, 80, "HALLUCINATION", t("RFC 2606 URL / Chimeric<br/>DOI / Future Year", "URL RFC 2606 / DOI lai<br/>/ Năm tương lai"), icon_key="alert_red", fill="#FEE2E2", stroke="#DC2626", title_color="#991B1B")

    d.edge(d12, o_ret, t("Retracted", "Rút bài"), ex=0, ey=0.5, nx=1, ny=0.5, orth=False, stroke="#B45309", oy=-14, bold=True)
    d.edge(d12, o_hal, t("Fabricated", "Bịa đặt"), ex=1, ey=0.5, nx=0, ny=0.5, orth=False, stroke="#DC2626", oy=-14, bold=True)

    # Group 3 Diamond (cx = 410)
    d3 = d.diamond(286, 358, 248, 90, t("Group 3: API Outage /\nNo-CSL / Low Border?", "Nhóm 3: Lỗi API / Thiếu\nCSL / Vùng biên mờ?"))
    d.edge(d12, d3, t("Pass", "Qua"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#334155", ox=34, bold=True)

    o_unr = d.card(608, 363, 200, 80, "UNRESOLVED", t("HTTP 429 · No-CSL DOI<br/>Safe Abstention", "HTTP 429 · DOI thiếu CSL<br/>Từ chối an toàn"), icon_key="teacher", fill="#F1F5F9", stroke="#475569", title_color="#1E293B")
    d.edge(d3, o_unr, t("Abstain", "Từ chối"), ex=1, ey=0.5, nx=0, ny=0.5, orth=False, stroke="#475569", oy=-14, bold=True)

    # Groups 4–5 Multimodal Fusion & Platt Calibration box
    g45 = d.card(
        198,
        498,
        424,
        74,
        t("Groups 4–5: Multimodal Rules + 16D MLR + Platt", "Nhóm 4–5: Luật đa phương thức + 16D MLR + Platt"),
        t("Title, Author, Year, Venue, Context + α=0.72 blend + Platt [0.01, 0.99]", "Tiêu đề, Tác giả, Năm, Nơi CB, Ngữ cảnh + α=0.72 + Platt [0.01, 0.99]"),
        icon_key="platt_clean",
        fill="#ECFDF5",
        stroke="#047857",
        sw=1.6,
        title_color="#065F46",
    )
    d.edge(d3, g45, t("Resolved", "Đủ chứng cứ"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#047857", ox=54, bold=True)

    # Final 4 terminal badges
    f1 = d.box(12, 608, 184, 48, "<b>VERIFIED</b>", fill="#DCFCE7", stroke="#047857", sw=1.6, font_size=13, font_color="#065F46")
    f2 = d.box(216, 608, 184, 48, "<b>METADATA_ERROR</b>", fill="#FEF3C7", stroke="#B45309", sw=1.6, font_size=13, font_color="#92400E")
    f3 = d.box(420, 608, 184, 48, "<b>HALLUCINATION</b>", fill="#FEE2E2", stroke="#DC2626", sw=1.6, font_size=13, font_color="#991B1B")
    f4 = d.box(624, 608, 184, 48, "<b>UNRESOLVED</b>", fill="#F1F5F9", stroke="#475569", sw=1.6, font_size=13, font_color="#1E293B")

    d.edge(g45, f1, "", ex=0.15, ey=1, nx=0.5, ny=0, pts=[(262, 590), (104, 590)], stroke="#047857")
    d.edge(g45, f2, "", ex=0.38, ey=1, nx=0.5, ny=0, pts=[(359, 590), (308, 590)], stroke="#B45309")
    d.edge(g45, f3, "", ex=0.62, ey=1, nx=0.5, ny=0, pts=[(461, 590), (512, 590)], stroke="#DC2626")
    d.edge(g45, f4, "", ex=0.85, ey=1, nx=0.5, ny=0, pts=[(558, 590), (716, 590)], stroke="#475569")

    # Honest Empirical Safety Footer (100% matching Table 5.5!)
    d.box(
        12,
        678,
        796,
        54,
        t(
            "<b>Held-Out Safety Audit (N = 18,000):</b> 0 / 6,480 Verified → Hallucination · 0 / 5,400 Hallucination → Verified<br/>4 / 3,960 Severe Metadata Error → Hallucination (0.10%) · 2 / 5,400 Hallucination → Unresolved (0.04%)",
            "<b>Kiểm toán an toàn kiểm thử (N = 18,000):</b> 0 / 6,480 Hợp lệ → Ảo giác · 0 / 5,400 Ảo giác → Hợp lệ<br/>4 / 3,960 Lỗi siêu dữ liệu nặng → Ảo giác (0.10%) · 2 / 5,400 Ảo giác → Chưa xác định (0.04%)",
        ),
        fill="#F8FAFC",
        stroke="#1E3A8A",
        sw=1.3,
        font_size=13,
    )
    return d


def build_bundle(vn: bool, out_path: Path) -> None:
    builders = [
        build_fig2_1(vn),
        build_fig3_1(vn),
        build_fig3_2(vn),
        build_fig3_3(vn),
        build_fig3_4(vn),
        build_fig4_1(vn),
        build_fig4_2(vn),
        build_fig4_3(vn),
        build_fig4_4(vn),
        build_fig4_5(vn),
        build_fig4_6(vn),
        build_fig4_7(vn),
    ]
    mxfile = ET.Element("mxfile", host="app.diagrams.net", modified="2026-11-26T14:00:00.000Z", version="24.7.17")
    for b in builders:
        mxfile.append(b.to_diagram_element())

    ET.indent(mxfile, space="  ")
    xml_str = ET.tostring(mxfile, encoding="unicode")
    assert ";base64" not in xml_str, "Forbidden ;base64 detected in generated .drawio XML!"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(xml_str, encoding="utf-8")
    print(f"Wrote {len(builders)} pages to {out_path} ({len(xml_str):,} bytes)")


def main() -> None:
    build_bundle(False, REPO_ROOT / "FinalReport_TDTU" / "picture" / "figures" / "drawio" / "citra_thesis_diagrams.drawio")
    build_bundle(True, REPO_ROOT / "FinalReport_TDTU_VN" / "picture" / "figures" / "drawio" / "citra_thesis_diagrams.drawio")


if __name__ == "__main__":
    main()
