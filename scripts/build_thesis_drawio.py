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
    d = DiagramBuilder("p21", "fig2_1_verification_paradigm", 800, 586)
    t = lambda en, vi: vi if vn else en

    # Top Input Strip
    inp = d.card(
        196,
        12,
        420,
        54,
        t("Submitted Academic Manuscript", "Bản thảo học thuật đầu vào"),
        t("PDF / DOCX / BibTeX / RIS  ·  Inline + Bibliography", "PDF / DOCX / BibTeX / RIS · Nội văn + Danh mục tham khảo"),
        icon_key="doc_pdf",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )

    # Band A: Paradigm 2 (Stylometric Attribution — strictly aligned with Ch. 1 §1.2 & Ch. 2 §2.1.3!)
    band_a = d.box(46, 108, 740, 146, "", fill="#FFF1F2", stroke="#E11D48", sw=1.4, dashed=1)
    d.text(
        58,
        114,
        716,
        24,
        t("Paradigm 2 (Stylometric Attribution): Surface AI-Text Detectors (Fragile)", "Hướng 2 (Quy kết văn phong): Bộ phát hiện văn bản AI (Kém ổn định)"),
        font_size=14,
        font_color="#9F1239",
        bold=True,
        align="left",
    )
    a1 = d.card(
        60,
        148,
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
        148,
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
        148,
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

    # Band B: Paradigm 3 (External Verification — CITRA Neuro-Symbolic Verification)
    d.box(46, 282, 740, 290, "", fill="#F0FDF4", stroke="#059669", sw=1.6)
    d.text(
        58,
        288,
        716,
        24,
        t("Paradigm 3 (External Verification): CITRA Neuro-Symbolic Verification", "Hướng 3 (Kiểm chứng nguồn ngoài): CITRA Nơ-ron – Ký hiệu thực chứng"),
        font_size=14,
        font_color="#065F46",
        bold=True,
        align="left",
    )
    b1 = d.card(
        60,
        322,
        212,
        98,
        t("1. Parse &amp; Link", "1. Trích xuất &amp; Liên kết"),
        t("GROBID TEI + PyMuPDF<br/>11 formats + VN Legal", "GROBID TEI + PyMuPDF<br/>11 chuẩn + Luật VN"),
        icon_key="tei",
        fill="#FFFFFF",
        stroke="#059669",
        title_color="#065F46",
    )
    b2 = d.card(
        310,
        322,
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
        322,
        212,
        98,
        t("3. Rules + 16D + Platt", "3. Luật + 16D + Platt"),
        t("68 symbolic rules;<br/>calibrated confidence", "68 mã luật ký hiệu;<br/>độ tin cậy hiệu chỉnh"),
        icon_key="platt_clean",
        fill="#FFFFFF",
        stroke="#059669",
        title_color="#065F46",
    )
    d.edge(b1, b2, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#059669")
    d.edge(b2, b3, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#059669")

    # Three explicitly separated epistemic outcomes: Verify vs Refute vs Abstain (100% clean EN & VN!)
    o1 = d.card(
        60,
        464,
        212,
        90,
        t("Verify (Supported)", "Xác nhận (Hợp lệ)"),
        t("VERIFIED / RESOURCE<br/>Canonical proof &amp; CIS", "Hợp lệ / Tài nguyên<br/>Chứng cứ chuẩn &amp; CIS"),
        icon_key="shield_ok",
        fill="#DCFCE7",
        stroke="#047857",
        title_color="#065F46",
    )
    o2 = d.card(
        310,
        464,
        212,
        90,
        t("Refute (Flagged)", "Bác bỏ (Cảnh báo)"),
        t("HALLUCINATION / META<br/>Audit trace &amp; repair", "Ảo giác / Lỗi siêu dữ liệu<br/>Vết luật &amp; đề xuất sửa"),
        icon_key="scale",
        fill="#FEF3C7",
        stroke="#B45309",
        title_color="#92400E",
    )
    o3 = d.card(
        560,
        464,
        212,
        90,
        t("Abstain (Review)", "Từ chối phán quyết"),
        t("UNRESOLVED (429/low)<br/>Instructor override", "Chưa xác định (429/thấp)<br/>Giảng viên hậu kiểm"),
        icon_key="teacher",
        fill="#EFF6FF",
        stroke="#1D4ED8",
        title_color="#1E3A8A",
    )

    # Clean non-crossing arrows: Red terminates at TOP border of Band A (y=108) — ZERO text slicing!
    d.edge(
        inp,
        band_a,
        "",
        ex=0.5,
        ey=1,
        nx=0.486,
        ny=0,
        orth=False,
        stroke="#E11D48",
        sw=1.7,
    )
    d.box(416, 74, 108, 24, t("<b>Prose only</b>", "<b>Chỉ văn bản</b>"), fill="#FFF1F2", stroke="#E11D48", sw=1.0, font_size=13, font_color="#9F1239", arc=6)

    d.edge(
        inp,
        b1,
        "",
        ex=0,
        ey=0.5,
        nx=0,
        ny=0.5,
        pts=[(20, 39), (20, 371)],
        stroke="#059669",
        sw=1.7,
    )
    d.box(34, 22, 146, 26, t("<b>Full structure</b>", "<b>Cấu trúc đầy đủ</b>"), fill="#ECFDF5", stroke="#059669", sw=1.1, font_size=13, font_color="#065F46", arc=6)

    # Outcomes branched cleanly from b3
    d.edge(b3, o3, ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1D4ED8")
    d.edge(b3, o2, ex=0.3, ey=1, nx=0.5, ny=0, pts=[(624, 442), (416, 442)], stroke="#B45309")
    d.edge(b3, o1, ex=0.15, ey=1, nx=0.5, ny=0, pts=[(592, 434), (166, 434)], stroke="#047857")
    return d


def build_fig3_1(vn: bool) -> DiagramBuilder:
    """True UML 2.5 Use Case Diagram strictly aligned 1:1 with Tables 3.3–3.7 (UC-01..UC-05), «include» + «extend», v3.90.10."""
    d = DiagramBuilder("p31", "fig3_1_roles", 820, 770)
    t = lambda en, vi: vi if vn else en

    # System Boundary
    d.box(164, 12, 462, 744, "", fill="#F8FAFC", stroke="#1E3A8A", sw=1.8, rounded=1, arc=4)
    d.text(
        174,
        18,
        442,
        26,
        t("CITRA Verification Platform (v3.90.10)", "Nền tảng kiểm chứng trích dẫn CITRA (v3.90.10)"),
        font_size=15,
        font_color="#1E3A8A",
        bold=True,
    )

    # Tight actor anchor box for left corridor + full actor height so bottom generalization arrows land BELOW text labels!
    def actor(ax: float, ay: float, label: str, ikey: str = "actor_navy") -> str:
        aid = d.box(ax + 35, ay, 56, 78, "", fill="none", stroke="none", sw=0)
        d.icon(ikey, ax + 45, ay + 1, 36, 46)
        d.text(ax, ay + 48, 126, 30, label, font_size=13, bold=True, font_color="#0F172A")
        return aid

    act_auth = actor(18, 86, t("Authenticated\nUser", "Người dùng\nđã xác thực"), "actor_navy")
    act_stu = actor(18, 286, t("Student", "Sinh viên"), "actor_teal")
    act_tea = actor(18, 414, t("Teacher", "Giảng viên"), "actor_amber")
    act_adm = actor(18, 544, t("Admin", "Quản trị viên"), "actor_navy")
    act_gst = actor(18, 668, t("Guest", "Khách"), "actor_slate")

    # True UML 2.5 Hollow-Triangle Generalizations clear of text labels!
    d.edge(act_stu, act_auth, "", ex=0.5, ey=0, nx=0.5, ny=1, orth=False, end_arrow="block", end_fill=0, stroke="#1E3A8A", sw=1.6)
    d.edge(
        act_tea,
        act_auth,
        "",
        ex=0,
        ey=0.30,
        nx=0,
        ny=0.30,
        pts=[(14, 437), (14, 109)],
        end_arrow="block",
        end_fill=0,
        stroke="#1E3A8A",
        sw=1.6,
    )
    d.edge(act_adm, act_tea, "", ex=0.5, ey=0, nx=0.5, ny=1, orth=False, end_arrow="block", end_fill=0, stroke="#1E3A8A", sw=1.6)

    # Exact 1:1 Use Cases matching Tables 3.3-3.7 (UC-01..UC-05) + unnumbered supporting capabilities
    uc1 = d.ellipse(178, 54, 194, 54, t("UC-01: Upload &amp;\nStream SSE", "UC-01: Tải lên &amp;\nLuồng SSE"), fill="#EFF6FF", stroke="#1D4ED8", bold=True)
    uc_core = d.ellipse(454, 54, 158, 54, t("Parse, Retrieve &amp;\nVerify (8 Layers)", "Trích xuất, Truy hồi\n&amp; Kiểm chứng"), fill="#E0F2FE", stroke="#0369A1")

    uc2 = d.ellipse(178, 120, 194, 54, t("UC-02: Repair Bib.\n&amp; Export Reports", "UC-02: Chuẩn hóa\nTLTK &amp; Xuất báo cáo"), fill="#EFF6FF", stroke="#1D4ED8", bold=True)
    uc_docx = d.ellipse(454, 120, 158, 54, t("Export Repaired\nDOCX (Pro/Plus)", "Xuất DOCX đã sửa\n(Gói nâng cao)"), fill="#E0F2FE", stroke="#0369A1")

    uc_shr = d.ellipse(178, 186, 224, 48, t("Share Report Link &amp;\nRevision Diff History", "Chia sẻ liên kết &amp;\nSo sánh phiên bản"), fill="#EFF6FF", stroke="#1D4ED8")
    uc_bil = d.ellipse(178, 244, 224, 48, t("Billing, Plans &amp; Law 91\nPrivacy Erasure", "Thanh toán gói &amp; Xóa\ndữ liệu (Luật 91/2025)"), fill="#F5F3FF", stroke="#6D28D9")

    uc_join = d.ellipse(178, 304, 224, 48, t("Batch Upload &amp; Join\nClassroom via Code", "Tải hàng loạt &amp; Tham\ngia lớp qua mã lớp"), fill="#ECFDF5", stroke="#047857")

    uc3 = d.ellipse(178, 376, 196, 56, t("UC-03: Adjudicate &amp;\nOverride Verdict", "UC-03: Hậu kiểm &amp;\nGhi đè kết luận"), fill="#FFFBEB", stroke="#B45309", bold=True)
    uc_aud = d.ellipse(454, 378, 158, 52, t("Write Append-Only\nAudit Log &amp; CIS", "Ghi nhật ký kiểm\ntoán &amp; tính lại CIS"), fill="#FEF3C7", stroke="#B45309")

    uc4 = d.ellipse(178, 444, 224, 52, t("UC-04: Supervise Class\n&amp; Shared Anomalies", "UC-04: Giám sát lớp\n&amp; Trích dẫn ảo lặp"), fill="#FFFBEB", stroke="#B45309", bold=True)

    uc5 = d.ellipse(178, 534, 232, 56, t("UC-05: Monitor 15+ APIs,\nReset Breakers &amp; Admin", "UC-05: Giám sát 15+ API,\nĐặt lại mạch &amp; Quản trị"), fill="#EEF2FF", stroke="#3730A3", bold=True)

    uc_sbx = d.ellipse(178, 632, 224, 48, t("Public Sandbox\nCitation Check", "Kiểm thử trích dẫn\nSandbox công khai"), fill="#F1F5F9", stroke="#475569")
    uc_pub = d.ellipse(178, 692, 224, 48, t("View Shared Receipt\n&amp; QR Verification", "Xem biên nhận chia sẻ\n&amp; Mã QR công khai"), fill="#F1F5F9", stroke="#475569")

    # UML Note attached cleanly above UC-03
    nt = d.note(446, 280, 168, 66, t("<b>RBAC Guard:</b><br/>{can_override_<br/>verdicts = true}", "<b>Ràng buộc RBAC:</b><br/>{can_override_<br/>verdicts = true}"))
    d.edge(nt, uc3, "", ex=0.35, ey=1, nx=0.85, ny=0, orth=False, dashed=1, end_arrow="none", stroke="#CA8A04")

    # Valid UML 2.5 «include» AND «extend» relationships!
    d.edge(uc1, uc_core, "«include»", ex=1, ey=0.5, nx=0, ny=0.5, dashed=1, end_arrow="open", end_fill=0, stroke="#0369A1", oy=-14)
    d.edge(uc_docx, uc2, "«extend»", ex=0, ey=0.5, nx=1, ny=0.5, dashed=1, end_arrow="open", end_fill=0, stroke="#0369A1", oy=-14)
    d.edge(uc3, uc_aud, "«include»", ex=1, ey=0.5, nx=0, ny=0.5, dashed=1, end_arrow="open", end_fill=0, stroke="#B45309", oy=-14)

    # Actor -> Use Case Associations (zero crossings!)
    for src, dst in [
        (act_auth, uc1),
        (act_auth, uc2),
        (act_auth, uc_shr),
        (act_auth, uc_bil),
        (act_stu, uc_join),
        (act_tea, uc3),
        (act_tea, uc4),
        (act_adm, uc5),
        (act_gst, uc_sbx),
    ]:
        d.edge(src, dst, "", ex=1, ey=0.5, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#475569", sw=1.3)

    # Right Secondary Actors («actor» system cards + Public Verifier — stacked to prevent crossings!)
    s_grobid = d.card(654, 46, 152, 72, "«actor» GROBID", "0.9.1-crf (TEI)", icon_key="tei", fill="#FFFFFF", stroke="#047857", title_color="#065F46")
    s_pay = d.card(654, 232, 152, 72, t("«actor» Gateways", "«actor» Cổng TT"), "Stripe / VNPay", icon_key="payment", fill="#FFFFFF", stroke="#6D28D9", title_color="#5B21B6")
    s_apis = d.card(654, 434, 152, 86, t("«actor» 15+ APIs", "«actor» 15+ API"), "Crossref, OpenAlex,\narXiv, Wayback", icon_key="crossref", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    act_pub = actor(668, 672, t("Public\nVerifier", "Người kiểm chứng\ncông khai"), "actor_slate")

    d.edge(uc_core, s_grobid, "", ex=1, ey=0.45, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#047857", sw=1.3)
    d.edge(uc_core, s_apis, "", ex=1, ey=0.85, nx=0, ny=0.25, pts=[(638, 100), (638, 455)], end_arrow="none", stroke="#1D4ED8", sw=1.3)
    d.edge(uc_bil, s_pay, "", ex=1, ey=0.5, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#6D28D9", sw=1.3)
    d.edge(uc5, s_apis, "", ex=1, ey=0.5, nx=0.5, ny=1, pts=[(730, 562)], end_arrow="none", stroke="#3730A3", sw=1.3)
    d.edge(uc_pub, act_pub, "", ex=1, ey=0.5, nx=0, ny=0.5, orth=False, end_arrow="none", stroke="#475569", sw=1.3)
    return d


def build_fig3_2(vn: bool) -> DiagramBuilder:
    """True UML 2.5 Sequence Diagram with Activation Bars, exact live HTTP 200 /events & POST override, UC-03, and 3-operand alt."""
    d = DiagramBuilder("p32", "fig3_2_workflow", 812, 836)
    t = lambda en, vi: vi if vn else en

    xs = [68, 200, 336, 472, 608, 740]
    hdr_y = 12
    hdr_h = 54
    bot_y = 820

    # 1. Background UML Combined Fragment frames
    d.box(10, 78, 792, 548, "", fill="#F8FAFC", stroke="#1E3A8A", sw=1.5, rounded=1, arc=3)
    d.box(22, 198, 768, 248, "", fill="#EFF6FF", stroke="#2563EB", sw=1.3, rounded=0)
    d.box(276, 260, 502, 178, "", fill="#FFFFFF", stroke="#059669", sw=1.2, dashed=1, rounded=0)
    d.box(22, 456, 768, 162, "", fill="#FEF2F2", stroke="#DC2626", sw=1.3, rounded=0)
    d.box(10, 636, 792, 180, "", fill="#FFFBEB", stroke="#B45309", sw=1.5, rounded=1, arc=3)

    # 2. Vertical dashed lifelines
    for lx in xs:
        d.edge(None, None, "", src_pt=(lx, hdr_y + hdr_h), dst_pt=(lx, bot_y), orth=False, dashed=1, end_arrow="none", stroke="#64748B", sw=1.2)

    # 2b. True UML 2.5 Execution Specification (Activation) Bars on all 6 lifelines!
    def act_bar(idx: int, y1: float, y2: float, fill: str, stroke: str) -> None:
        d.box(xs[idx] - 5, y1, 10, y2 - y1, "", fill=fill, stroke=stroke, sw=1.2, rounded=0)

    act_bar(0, 128, 192, "#DBEAFE", "#1E3A8A")
    act_bar(1, 132, 424, "#CFFAFE", "#0E7490")
    act_bar(2, 134, 428, "#D1FAE5", "#047857")
    act_bar(3, 300, 434, "#DCFCE7", "#15803D")
    act_bar(4, 330, 368, "#FEF3C7", "#B45309")
    act_bar(5, 152, 174, "#EDE9FE", "#6D28D9")
    act_bar(5, 412, 434, "#EDE9FE", "#6D28D9")
    # Activation bars in alt crash + Panel (b) override
    act_bar(3, 566, 610, "#FEE2E2", "#DC2626")
    act_bar(5, 574, 598, "#EDE9FE", "#6D28D9")
    act_bar(0, 682, 804, "#FEF3C7", "#B45309")
    act_bar(1, 684, 802, "#CFFAFE", "#0E7490")
    act_bar(2, 704, 798, "#D1FAE5", "#047857")
    act_bar(5, 734, 776, "#EDE9FE", "#6D28D9")

    # 3. Opaque Lifeline Header Boxes + Fragment Pills
    headers = [
        (t("User /\nBrowser", "Người dùng /\nTrình duyệt"), "#EFF6FF", "#1E3A8A"),
        ("CITRA SPA\n(React 18)", "#ECFEFF", "#0E7490"),
        ("FastAPI +\nQueue", "#ECFDF5", "#047857"),
        ("Integrity\nPipeline", "#F0FDF4", "#15803D"),
        ("GROBID +\n15 APIs", "#FEF3C7", "#B45309"),
        ("SQLite WAL\n(app.db)", "#F5F3FF", "#6D28D9"),
    ]
    for lx, (hlbl, hfill, hstr) in zip(xs, headers):
        d.box(lx - 58, hdr_y, 116, hdr_h, hlbl, fill=hfill, stroke=hstr, sw=1.5, font_size=13, bold=True)

    d.box(14, 82, 424, 24, t("<b>(a) Async Upload, Background Queue &amp; SSE (UC-01)</b>", "<b>(a) Tải lên bất đồng bộ, Hàng đợi &amp; SSE (UC-01)</b>"), fill="#DBEAFE", stroke="#1E3A8A", sw=1.1, font_size=13, align="left", arc=4)
    d.box(26, 202, 248, 22, t("<b>par</b> [Stream SSE || Run Pipeline]", "<b>par</b> [Luồng SSE || Chạy Pipeline]"), fill="#DBEAFE", stroke="#2563EB", sw=1.0, font_size=13, align="left", arc=3)
    d.box(280, 264, 244, 22, t("<b>loop</b> [Stages 0..7 + Progress]", "<b>loop</b> [Chặng 0..7 + Tiến độ]"), fill="#DCFCE7", stroke="#059669", sw=1.0, font_size=13, align="left", arc=3)
    d.box(26, 460, 290, 22, t("<b>alt</b> [Upload / Upstream / Crash Faults]", "<b>alt</b> [Lỗi tải lên / Nguồn ngoài / Sập tiến trình]"), fill="#FEE2E2", stroke="#DC2626", sw=1.0, font_size=13, align="left", arc=3)
    d.box(14, 640, 446, 24, t("<b>(b) critical</b> [Atomic Instructor Override &amp; CIS Recalc (UC-03)]", "<b>(b) critical</b> [Ghi đè nguyên tử &amp; Tính lại CIS (UC-03)]"), fill="#FEF3C7", stroke="#B45309", sw=1.1, font_size=13, align="left", arc=4)

    # Dashed operand dividers in par and 3-branch alt
    d.edge(None, None, "", src_pt=(22, 252), dst_pt=(790, 252), orth=False, dashed=1, end_arrow="none", stroke="#2563EB", sw=1.1)
    d.edge(None, None, "", src_pt=(22, 514), dst_pt=(790, 514), orth=False, dashed=1, end_arrow="none", stroke="#DC2626", sw=1.0)
    d.edge(None, None, "", src_pt=(22, 558), dst_pt=(790, 558), orth=False, dashed=1, end_arrow="none", stroke="#DC2626", sw=1.0)

    def msg(i_from: int, i_to: int, y: float, text: str, *, dashed: int = 0, stroke: str = "#0F172A", open_arrow: bool = False) -> None:
        sx = xs[i_from] + (5 if i_to > i_from else -5)
        dx = xs[i_to] + (-5 if i_to > i_from else 5)
        d.edge(
            None,
            None,
            text,
            src_pt=(sx, y),
            dst_pt=(dx, y),
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

    msg(0, 1, 134, t("1a. Upload", "1a. Tải PDF"), stroke="#1E3A8A")
    msg(1, 2, 134, "1b. POST /api/essays", stroke="#1E3A8A")
    msg(2, 5, 160, t("2. Atomic CAS quota + INSERT essay", "2. Giữ hạn mức CAS + lưu bài viết"), stroke="#6D28D9")
    msg(2, 1, 186, t("3. HTTP 200 (essay_id) + schedule BackgroundTasks", "3. HTTP 200 (essay_id) + lập lịch nền"), dashed=1, stroke="#047857", open_arrow=True)

    msg(1, 2, 244, "4. GET /api/essays/{id}/events (fetch ReadableStream SSE)", stroke="#2563EB")

    msg(2, 3, 310, t("5. Acquire slot (≤3 dev / ≤2 prod)", "5. Cấp khe (≤3 dev / ≤2 prod)"), stroke="#047857")
    msg(3, 4, 336, t("6. TEI parse + 15 APIs (SSRF guard)", "6. GROBID + 15 API (chặn SSRF)"), stroke="#B45309")
    msg(4, 3, 362, t("7. Candidates + HTML/Wayback meta", "7. Ứng viên + siêu dữ liệu web"), dashed=1, stroke="#B45309", open_arrow=True)
    msg(3, 2, 386, t("8a. ProgressTracker", "8a. Ghi tiến độ"), dashed=1, stroke="#2563EB", open_arrow=True)
    msg(2, 1, 398, t("8b. SSE stage frame", "8b. Khung SSE"), dashed=1, stroke="#2563EB", open_arrow=True)
    msg(3, 5, 424, t("9. Persist citations, verdicts, CIS &amp; done", "9. Lưu trích dẫn, phán quyết, CIS &amp; hoàn tất"), stroke="#6D28D9")

    # 3 Explicit alt operands (100% codebase faithful, clear of alt badge!)
    msg(2, 0, 506, t("[corrupt/invalid] HTTP 400 (pre-CAS; quota untouched)", "[tệp hỏng/sai] HTTP 400 (trước CAS; không trừ hạn mức)"), dashed=1, stroke="#DC2626", open_arrow=True)
    msg(4, 3, 546, t("[HTTP 429 / GROBID timeout] PyMuPDF fallback or R-RATE-LIMITED-ABSTAIN", "[HTTP 429 / GROBID lỗi] Chuyển PyMuPDF hoặc R-RATE-LIMITED-ABSTAIN"), dashed=1, stroke="#B45309", open_arrow=True)
    msg(3, 5, 586, t("[crash] CAS refund (quota_charged: 1→0)", "[sập tiến trình] Hoàn CAS (quota_charged: 1→0)"), stroke="#DC2626")
    msg(2, 1, 608, t("SSE error frame", "Khung lỗi SSE"), dashed=1, stroke="#DC2626", open_arrow=True)

    # Panel (b) UC-03 Atomic Instructor Override through CITRA SPA -> FastAPI -> SQLite WAL
    msg(0, 1, 688, t("10a. Submit override", "10a. Gửi ghi đè"), stroke="#B45309")
    msg(1, 2, 720, "10b. POST /api/essays/{id}/verdicts/{vid}/override", stroke="#B45309")
    msg(2, 5, 746, t("11. Update verdict (manual_review) + recalc CIS + audit_logs", "11. Cập nhật phán quyết + tính lại CIS + audit_logs"), stroke="#6D28D9")
    msg(5, 2, 770, t("12. COMMIT atomic SQLite WAL tx", "12. Xác nhận giao dịch WAL nguyên tử"), dashed=1, stroke="#6D28D9", open_arrow=True)
    msg(2, 0, 798, t("13. HTTP 200 (updated verdict + recalculated CIS)", "13. HTTP 200 (nhãn mới + CIS đã tính lại)"), dashed=1, stroke="#047857", open_arrow=True)
    return d


def build_fig3_3(vn: bool) -> DiagramBuilder:
    """Complete 15-Table Crow's Foot ERD matching src/integrity_checker/db/models.py 1:1 (ZERO hallucinated tables!)."""
    d = DiagramBuilder("p33", "fig3_3_data_model", 820, 910)
    t = lambda en, vi: vi if vn else en

    # Band 1: Identity, Auth & API Keys (4 real ORM tables)
    d.box(24, 8, 784, 152, "", fill="#F8FAFC", stroke="#1E3A8A", sw=1.4, dashed=1)
    d.text(32, 12, 768, 22, t("app.db (SQLite WAL, Migrations 0001–0013) — Band 1: Identity, Auth &amp; Security (4 Tables)", "app.db (SQLite WAL, 0001–0013) — Khối 1: Định danh, Xác thực &amp; Bảo mật (4 bảng)"), font_size=13, font_color="#1E3A8A", bold=True, align="left")

    t_users = d.erd_table(36, 40, 210, "1. users", ["<b>PK</b> id · username/email (UQ)", "role · plan_tier · can_override", "monthly_uploads_used · reset", "privacy_consented_at"], hdr_fill="#1E3A8A", stroke="#1E3A8A")
    t_sess = d.erd_table(292, 42, 156, "2. sessions", ["<b>PK</b> id · <b>FK</b> user_id", "token (UQ, JWT)", "expires_at"], hdr_fill="#1D4ED8", stroke="#1D4ED8")
    t_auth = d.erd_table(464, 42, 162, "3. auth_tokens", ["<b>PK</b> id · <b>FK</b> user_id", "token_hash (UQ)", "token_type · used_at"], hdr_fill="#1D4ED8", stroke="#1D4ED8")
    t_keys = d.erd_table(642, 42, 154, "4. api_keys", ["<b>PK</b> id · <b>FK</b> user_id", "key_prefix", "key_hash (UQ) · active"], hdr_fill="#1D4ED8", stroke="#1D4ED8")

    d.edge(t_users, t_sess, "1:N", ex=1, ey=0.45, nx=0, ny=0.45, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#1D4ED8", oy=-12)
    d.edge(t_users, t_auth, "", ex=0.88, ey=1, nx=0.5, ny=1, pts=[(221, 150), (545, 150)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#1D4ED8")
    d.edge(t_users, t_keys, "", ex=0.72, ey=1, nx=0.5, ny=1, pts=[(187, 156), (719, 156)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#1D4ED8")

    # Band 2: Core Verification, Audit & Cache (5 real ORM tables)
    d.box(24, 174, 784, 286, "", fill="#F0FDF4", stroke="#047857", sw=1.4, dashed=1)
    d.text(32, 178, 768, 22, t("app.db — Band 2: Verification Pipeline, Audit Trail &amp; Cache (5 Tables)", "app.db — Khối 2: Đường ống kiểm chứng, Nhật ký kiểm toán &amp; Bộ đệm (5 bảng)"), font_size=13, font_color="#065F46", bold=True, align="left")

    t_essays = d.erd_table(36, 208, 210, "5. essays", ["<b>PK</b> id · <b>FK</b> user_id, class_id", "filename · job_status", "cis_json · style_profile_json", "quota_charged · job_error"], hdr_fill="#047857", stroke="#047857")
    t_cit = d.erd_table(298, 208, 222, "6. citations", ["<b>PK</b> id · <b>FK</b> essay_id", "raw_text · citation_type", "mapping_status · confidence", "citation_link_json"], hdr_fill="#059669", stroke="#059669")
    t_verd = d.erd_table(572, 208, 224, "7. verdicts", ["<b>PK</b> id · <b>FK</b> essay_id", "label · confidence · features", "triggered_rules · is_overridden", "overridden_by"], hdr_fill="#059669", stroke="#059669")

    t_audit = d.erd_table(
        396,
        352,
        214,
        t("8. audit_logs (API Append*)", "8. audit_logs (Chỉ nối thêm*)"),
        ["<b>PK</b> id · <b>FK</b> verdict_id", "original_label → new_label", t("user (str) · *CASCADE xóa", "user (str) · *CASCADE xóa") if vn else "user (str) · *CASCADE on erase"],
        hdr_fill="#B45309",
        stroke="#B45309",
    )
    t_cache = d.erd_table(628, 352, 168, "9. citation_cache", ["<b>PK</b> id · cache_key (UQ)", "source · raw_response", "hit_count · last_hit_at"], hdr_fill="#0369A1", stroke="#0369A1")

    # Clean internal Band-2 FK edges (zero border overlaps!)
    d.edge(t_essays, t_cit, "1:N", ex=1, ey=0.45, nx=0, ny=0.45, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#059669", oy=-12)
    d.edge(t_essays, t_verd, "1:N", ex=0.5, ey=1, nx=0.18, ny=1, pts=[(141, 332), (612, 332)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#059669", oy=-12)
    d.edge(t_verd, t_audit, "1:N", ex=0.5, ey=1, nx=0.82, ny=0, pts=[(684, 338), (571, 338)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#B45309", ox=20, oy=-10)

    # Clean left-corridor users (1:N) -> essays routed cleanly outside dashed Band 1/2 borders (x=10)!
    d.edge(t_users, t_essays, "", ex=0, ey=0.5, nx=0, ny=0.42, pts=[(10, 96), (10, 255)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#047857")
    d.box(6, 150, 34, 20, "<b>1:N</b>", fill="#F0FDF4", stroke="#047857", sw=0.8, font_size=13, font_color="#065F46", arc=4)

    # Band 3: Classrooms, Billing & Migrations (6 real ORM tables → 15 TOTAL!)
    d.box(24, 474, 784, 294, "", fill="#FAF5FF", stroke="#6D28D9", sw=1.4, dashed=1)
    d.text(32, 478, 768, 22, t("app.db — Band 3: Classrooms, Billing, Promos &amp; Migrations (6 Tables → 15 ORM Tables Total)", "app.db — Khối 3: Lớp học, Thanh toán, Ưu đãi &amp; Di trú (6 bảng → Tổng 15 bảng ORM)"), font_size=13, font_color="#5B21B6", bold=True, align="left")

    t_cls = d.erd_table(36, 510, 178, "10. classes", ["<b>PK</b> id · <b>FK</b> teacher_id", "name · join_code (UQ)", "created_at"], hdr_fill="#0F766E", stroke="#0F766E")
    t_mem = d.erd_table(262, 510, 180, "11. class_memberships", ["<b>PK</b> id · <b>FK</b> class_id", "<b>FK</b> student_id", "joined_at"], hdr_fill="#0F766E", stroke="#0F766E")
    t_bill = d.erd_table(490, 510, 306, "12. billing_transactions", ["<b>PK</b> id · <b>FK</b> user_id · stripe_session_id (UQ)", "payment_mode · payment_method · status", "amount_usd/vnd · promo_code (str)"], hdr_fill="#6D28D9", stroke="#6D28D9")

    t_promo = d.erd_table(36, 646, 210, "13. promo_codes", ["<b>PK</b> id · code (UQ)", "discount_type/value · is_active", "used_count · <b>FK</b> created_by"], hdr_fill="#6D28D9", stroke="#6D28D9")
    t_red = d.erd_table(298, 646, 232, "14. promo_redemptions", ["<b>PK</b> id · <b>FK</b> promo_code_id", "<b>FK</b> user_id · <b>FK</b> transaction_id", "code · discount_usd · redeemed_at"], hdr_fill="#7C3AED", stroke="#7C3AED")
    t_mig = d.erd_table(562, 646, 234, "15. schema_migrations", ["<b>PK</b> version (0001..0013)", "name · checksum (SHA-256)", "execution_ms · applied_at"], hdr_fill="#475569", stroke="#475569")

    d.edge(t_cls, t_mem, "1:N", ex=1, ey=0.5, nx=0, ny=0.5, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#0F766E", oy=-12)
    # Route classes (0..1:N) -> essays cleanly up the open left corridor x=62 (100% clear of yellow note at x=98..384!)
    d.edge(t_cls, t_essays, "", ex=0.14, ey=0, nx=0.12, ny=1, pts=[(61, 468), (61, 336)], start_arrow="ERzeroToOne", end_arrow="ERzeroToMany", stroke="#0F766E")
    d.box(34, 461, 56, 20, "<b>0..1:N</b>", fill="#F0FDF4", stroke="#0F766E", sw=0.8, font_size=13, font_color="#0F766E", arc=4)
    d.edge(t_promo, t_red, "1:N", ex=1, ey=0.5, nx=0, ny=0.5, start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#7C3AED", oy=-12)
    d.edge(t_bill, t_red, "1:N", ex=0.15, ey=1, nx=0.72, ny=0, pts=[(536, 628), (465, 628)], start_arrow="ERmandOne", end_arrow="ERzeroToMany", stroke="#6D28D9", ox=24)

    # Concise FK summary note cleanly right of classes->essays wire (x=98..384, spacious 104px height -> ZERO clipping!)
    d.note(
        98,
        346,
        286,
        106,
        t(
            "<b>Other 1:N FKs from 1. users:</b><br/>classes (teacher_id), class_memberships,<br/>billing_transactions, promo_codes,<br/>promo_redemptions · DELETE /users/me",
            "<b>Khóa ngoại 1:N khác từ 1. users:</b><br/>classes (teacher_id), class_memberships,<br/>billing_transactions, promo_codes,<br/>promo_redemptions · DELETE /users/me",
        ),
    )

    # Band 4: Offline Tier-0 Retrieval Stores (aligned with Ch. 4 & Ch. 5: 87.6 ms mean < 100 ms!)
    d.box(24, 782, 784, 118, "", fill="#EFF6FF", stroke="#1D4ED8", sw=1.4)
    d.text(32, 786, 768, 22, t("Offline Tier-0 Retrieval Stores (Separate Read-Only Artifacts — Outside app.db)", "Kho truy hồi ngoại tuyến Tầng 0 (Tách biệt chỉ đọc — Ngoài app.db)"), font_size=13, font_color="#1E3A8A", bold=True, align="left")

    d.cylinder(
        36,
        814,
        374,
        76,
        t("<b>local_papers.db</b> (SQLite FTS5 BM25)<br/>129,137 records (98.42% ACL) · 87.6 ms mean", "<b>local_papers.db</b> (SQLite FTS5 BM25)<br/>129,137 bản ghi (98.42% ACL) · TB 87.6 ms"),
        fill="#DCFCE7",
        stroke="#047857",
        size=8,
    )
    d.icon("sqlite", 44, 840, 26, 26)
    d.icon("acl", 376, 840, 26, 26)

    d.card(
        426,
        816,
        370,
        72,
        t("In-Memory _KNOWN_PAPERS (Python Dict)", "Từ điển bộ nhớ _KNOWN_PAPERS (Python Dict)"),
        t("101 foundational CS/AI/Law entries · &lt;1 ms<br/>Non-DB static memory structure (not SQLite)", "101 công trình kinh điển KHMT/Luật · &lt;1 ms<br/>Cấu trúc bộ nhớ tĩnh (không phải CSDL)"),
        icon_key="python",
        fill="#FFFFFF",
        stroke="#1D4ED8",
        title_color="#1E3A8A",
    )
    return d


def build_fig3_4(vn: bool) -> DiagramBuilder:
    """True UML 2.5 Deployment Diagram: exact docker-compose names (integrity-web, essay-check-grobid), volumes, clean SSRF vs Payments."""
    d = DiagramBuilder("p34", "fig3_4_deployment", 820, 742)
    t = lambda en, vi: vi if vn else en

    # 1. Left Node: Client Device
    c_cli = d.cube(10, 152, 154, 170, t("«device»\nClient Browser", "«device»\nTrình duyệt"), fill="#EFF6FF", stroke="#1E3A8A")
    d.icon("browser", 34, 218, 28, 28)
    d.icon("tls", 70, 218, 28, 28)
    d.text(30, 254, 124, 60, t("HTTPS TLS 1.2/1.3<br/>fetch() Stream SSE", "HTTPS TLS 1.2/1.3<br/>fetch() Stream SSE"), font_size=13, align="left")

    # 2. Center Host Cube: Docker Engine on GCE (essay-check-net bridge)
    d.cube(
        208,
        12,
        400,
        718,
        t("«executionEnvironment» Docker Host\n(GCE · 2 vCPU · 5.8 GiB · essay-check-net)", "«executionEnvironment» Máy chủ Docker\n(GCE · 2 vCPU · 5.8 GiB · essay-check-net)"),
        fill="#F8FAFC",
        stroke="#0F172A",
        sw=1.8,
    )
    d.icon("docker", 560, 34, 32, 32)

    # Container 1: integrity-web (exact docker-compose service name!)
    n_web = d.cube(228, 84, 360, 108, "«container» integrity-web (Nginx 1.27 + SPA)", fill="#ECFEFF", stroke="#0E7490")
    d.icon("nginx", 248, 126, 26, 26)
    d.icon("react", 280, 126, 26, 26)
    d.icon("letsencrypt", 312, 126, 26, 26)
    d.text(346, 122, 232, 62, t("Ports :80/:443 TLS · Leaky-bucket<br/>proxy_buffering off → :8000", "Cổng :80/:443 TLS · Leaky-bucket<br/>proxy_buffering off → :8000"), font_size=13, align="left")

    # Container 2: integrity-api (FastAPI + internal SSRF Guard)
    n_api = d.cube(228, 218, 360, 236, "«container» integrity-api (FastAPI)", fill="#F0FDF4", stroke="#047857")
    d.icon("fastapi", 248, 260, 26, 26)
    d.icon("python", 280, 260, 26, 26)
    d.icon("onnx", 312, 260, 26, 26)
    d.text(
        346,
        254,
        232,
        78,
        t("Uvicorn --workers 1 · :8000<br/>(prod 127.0.0.1:8000) · ≤2 jobs<br/>ONNX SBERT · X-Accel-Buffering", "Uvicorn --workers 1 · :8000<br/>(prod 127.0.0.1:8000) · ≤2 việc<br/>ONNX SBERT · X-Accel-Buffering"),
        font_size=13,
        align="left",
    )
    n_ssrf = d.card(
        248,
        344,
        322,
        98,
        t("Pinned-IP SSRF Egress Guard", "Lớp chặn SSRF ghim IP đầu ra"),
        t("SSRFSafeAsyncNetworkBackend:<br/>DNS pin · Block RFC 1918/6598<br/>TLS SNI · Untrusted URL/HTML", "SSRFSafeAsyncNetworkBackend:<br/>Ghim DNS · Chặn RFC 1918/6598<br/>TLS SNI · Bảo vệ URL/HTML"),
        icon_key="ssrf_shield",
        fill="#FEF2F2",
        stroke="#DC2626",
        sw=1.5,
        title_color="#991B1B",
    )

    # Container 3: essay-check-grobid (exact service name, NO worker_only!)
    n_grob = d.cube(228, 480, 360, 134, "«container» essay-check-grobid (0.9.1-crf)", fill="#FFFBEB", stroke="#B45309")
    d.icon("tei", 248, 522, 26, 26)
    d.icon("java_duke", 280, 522, 26, 26)
    d.text(
        314,
        516,
        262,
        90,
        t("Bind 127.0.0.1:8070 (prod) · <b>4 GiB</b><br/><b>-Xmx768m</b> · ~3.1 GiB Wapiti CRF<br/>modelPreload=true · pdfalto=1024 MB<br/>concurrency=2 · 0 B swap", "Cổng 127.0.0.1:8070 (prod) · <b>4 GiB</b><br/><b>-Xmx768m</b> · ~3.1 GiB Wapiti CRF<br/>modelPreload=true · pdfalto=1024 MB<br/>concurrency=2 · 0 B swap"),
        font_size=13,
        align="left",
    )

    # Persistent Volumes Row inside Docker Host (explicitly fulfilling caption promise!)
    v_sql = d.cylinder(228, 634, 214, 78, t("<b>«artifact» ./data Volume</b><br/>app.db (WAL) + local_papers.db", "<b>«artifact» Phân vùng ./data</b><br/>app.db (WAL) + local_papers.db"), fill="#DCFCE7", stroke="#047857", size=8)
    d.icon("sqlite", 236, 662, 24, 24)
    v_gcache = d.cylinder(454, 634, 134, 78, t("<b>grobid-cache</b><br/>TEI XML Cache", "<b>grobid-cache</b><br/>Đệm TEI XML"), fill="#FEF3C7", stroke="#B45309", size=8)

    # 3. Right External Services
    ex_apis = d.cube(646, 232, 164, 236, t("«external»\n15+ APIs &amp; URLs", "«external»\n15+ API &amp; URL"), fill="#EFF6FF", stroke="#1D4ED8")
    for idx_i, ik in enumerate(["crossref", "openalex", "arxiv", "dblp", "epmc", "wayback"]):
        row, col = divmod(idx_i, 3)
        d.icon(ik, 666 + col * 42, 300 + row * 38, 26, 26)
    d.text(664, 384, 136, 74, t("Crossref, OpenAlex,<br/>arXiv, DBLP, EPMC,<br/>Wayback &amp; Cited URLs", "Crossref, OpenAlex,<br/>arXiv, DBLP, EPMC,<br/>Wayback &amp; URL trích"), font_size=13, align="left")

    ex_pay = d.cube(646, 510, 164, 132, t("«external»\nPayments", "«external»\nThanh toán"), fill="#F5F3FF", stroke="#6D28D9")
    d.icon("payment", 666, 574, 26, 26)
    d.text(698, 566, 102, 66, "Stripe REST\nVNPay\nHMAC-SHA512", font_size=13, align="left")

    # Clean Non-Colliding Connections + Opaque Pill Labels Clear of 3D Walls!
    d.edge(c_cli, n_web, "", ex=1, ey=0.35, nx=0, ny=0.5, pts=[(186, 211), (186, 138)], stroke="#0E7490", sw=1.7)
    d.box(100, 112, 102, 22, "<b>HTTPS / SSE</b>", fill="#FFFFFF", stroke="#0E7490", sw=0.9, font_size=13, font_color="#0E7490", arc=4)

    d.edge(n_web, n_api, "HTTP :8000", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#047857", ox=50, bold=True)
    d.edge(n_api, n_grob, "TEI :8070", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#B45309", ox=48, bold=True)
    d.edge(n_api, v_sql, "", ex=0.04, ey=0.95, nx=0.1, ny=0, pts=[(218, 442), (218, 624), (249, 624)], dashed=1, stroke="#047857", sw=1.2)
    d.edge(n_grob, v_gcache, "", ex=0.82, ey=1, nx=0.5, ny=0, orth=False, dashed=1, stroke="#B45309", sw=1.2)

    # SSRF Guard -> 15+ APIs & Untrusted URLs; integrity-api DIRECTLY -> Payments (purple wire at x=636 clears red pill!)
    d.edge(n_ssrf, ex_apis, "", ex=1, ey=0.5, nx=0, ny=0.68, stroke="#DC2626", sw=1.7)
    d.box(576, 368, 54, 22, "<b>HTTPS</b>", fill="#FFFFFF", stroke="#DC2626", sw=0.9, font_size=13, font_color="#991B1B", arc=4)

    d.edge(n_api, ex_pay, "", ex=1, ey=0.25, nx=0, ny=0.5, pts=[(636, 277), (636, 576)], stroke="#6D28D9", sw=1.6)
    d.box(576, 546, 54, 22, "<b>HTTPS</b>", fill="#FFFFFF", stroke="#6D28D9", sw=0.9, font_size=13, font_color="#5B21B6", arc=4)
    return d


def build_fig4_1(vn: bool) -> DiagramBuilder:
    """8-Layer Pipeline Architecture (zero title crossings, MatchFeatures on connector, DOCX/PDF/JSON/BibTeX/RIS, clean VN)."""
    d = DiagramBuilder("p41", "fig4_1_architecture", 812, 668)
    t = lambda en, vi: vi if vn else en

    inp = d.card(
        186,
        12,
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

    p1_box = d.box(16, 94, 780, 178, "", fill="#F8FAFC", stroke="#2563EB", sw=1.3, dashed=1)
    d.text(28, 98, 756, 22, t("Phase I: Ingestion, Structural Linking &amp; Multi-Registry Retrieval (Layers 1–4)", "Giai đoạn I: Trích xuất, Liên kết cấu trúc &amp; Truy hồi đa nguồn (Tầng 1–4)"), font_size=13, font_color="#1E3A8A", bold=True, align="left")

    l1 = d.card(26, 130, 174, 128, t("L1. Parsing", "T1. Trích xuất"), t("GROBID TEI +<br/>PyMuPDF + OCR<br/>11 Formats + VN Law", "GROBID TEI +<br/>PyMuPDF + OCR<br/>11 chuẩn + Luật VN"), icon_key="tei", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l2 = d.card(220, 130, 174, 128, t("L2. Merging", "T2. Hợp nhất"), t("Donor URL repair,<br/>TOC filter &amp;<br/>style consensus", "Sửa URL, lọc mục lục<br/>&amp; đồng thuận chuẩn<br/>trích dẫn"), icon_key="merge", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l3 = d.card(414, 130, 174, 128, t("L3. Linking", "T3. Liên kết"), t("Bidirectional 7-tier<br/>cascade (tei_link<br/>.. no_keys)", "Liên kết hai chiều<br/>7 bậc (tei_link<br/>.. no_keys)"), icon_key="link", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l4 = d.card(608, 130, 174, 128, t("L4. Retrieval", "T4. Truy hồi"), t("Tier 0–3 (15+ APIs),<br/>SSRF Link/Wayback<br/>&amp; Abstract Enrich", "Tầng 0–3 (15+ API),<br/>SSRF/Wayback &amp;<br/>Bổ sung tóm tắt"), icon_key="globe", fill="#FFFFFF", stroke="#047857", title_color="#065F46")

    # Input enters TOP of Phase I container cleanly at x=406 (zero slicing of "Phase I:" title!)
    d.edge(inp, p1_box, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1E3A8A", sw=1.7)
    d.edge(l1, l2, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8")
    d.edge(l2, l3, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8")
    d.edge(l3, l4, ex=1, ey=0.5, nx=0, ny=0.5, stroke="#047857")

    p2_box = d.box(16, 326, 780, 224, "", fill="#F0FDF4", stroke="#059669", sw=1.3, dashed=1)
    d.text(28, 330, 756, 22, t("Phase II: Multimodal Matching, Neuro-Symbolic Verification, Scoring &amp; Delivery (Layers 5–8)", "Giai đoạn II: So khớp đa phương thức, Kiểm chứng Nơ-ron–Ký hiệu &amp; Giao diện (Tầng 5–8)"), font_size=13, font_color="#065F46", bold=True, align="left")

    l5 = d.card(26, 376, 168, 156, t("L5. Matching", "T5. So khớp"), t("RapidFuzz + SBERT<br/>Author 1-1 + Venue<br/>+ Context &amp; VI↔EN<br/>→ <b>MatchFeatures</b>", "RapidFuzz + SBERT<br/>Tác giả + Nơi công bố<br/>+ Ngữ cảnh &amp; VI↔EN<br/>→ <b>MatchFeatures</b>"), icon_key="neural", fill="#FFFFFF", stroke="#059669", title_color="#065F46")
    l6 = d.card(236, 376, 174, 156, t("L6. Verify", "T6. Kiểm chứng"), t("68 Symbolic Rules<br/>+ 16D MLR (α=0.72)<br/>+ Platt Calibration<br/>→ <b>CitationVerdict</b>", "68 Luật ký hiệu<br/>+ 16D MLR (α=0.72)<br/>+ Hiệu chỉnh Platt<br/>→ <b>Phán quyết</b>"), icon_key="scale", fill="#FFFFFF", stroke="#B45309", title_color="#92400E")
    l7 = d.card(436, 376, 166, 156, t("L7. CIS &amp; Fix", "T7. CIS &amp; Sửa"), t("5-Component Rubric<br/><b>CIS [0–100]</b> +<br/>BibTeX / DOCX<br/>Auto-Repair", "5 thành phần điểm<br/><b>CIS [0–100]</b> +<br/>Tự chuẩn hóa<br/>BibTeX / DOCX"), icon_key="cis_clean", fill="#FFFFFF", stroke="#1D4ED8", title_color="#1E3A8A")
    l8 = d.card(626, 376, 156, 156, t("L8. API &amp; UI", "T8. API &amp; UI"), t("FastAPI REST +<br/>ReadableStream<br/>SSE + React 18<br/>(EN / VI)", "FastAPI REST +<br/>ReadableStream<br/>SSE + React 18<br/>(EN / VI)"), icon_key="fastapi", fill="#FFFFFF", stroke="#0E7490", title_color="#0E7490")

    # L4 -> Phase II routed cleanly along far-left corridor (x=6) into left edge of L5 — ZERO text slicing!
    d.edge(
        l4,
        l5,
        t("SourceResult (candidates + abstracts)", "Kết quả nguồn (ứng viên + tóm tắt)"),
        ex=0.5,
        ey=1,
        nx=0,
        ny=0.5,
        pts=[(695, 298), (6, 298), (6, 454)],
        stroke="#047857",
        sw=1.7,
        oy=-14,
        bold=True,
        font_color="#065F46",
    )
    # Clean compact label x ∈ ℝ¹⁶ fitting 100% inside the 42px L5->L6 gap (zero card overlap!)
    d.edge(l5, l6, "x", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#059669", sw=1.7, oy=-14, bold=True, font_color="#065F46")
    d.edge(l6, l7, "", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#B45309")
    d.edge(l7, l8, "", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8")

    out = d.card(
        120,
        584,
        572,
        68,
        t("Auditable Verification Report &amp; Classroom Analytics", "Báo cáo kiểm chứng truy vết được &amp; Phân tích lớp học"),
        t("CIS [0–100] · 5-Class Verdicts · Rule Trace · Healed DOCX / PDF / JSON / BibTeX Exports", "CIS [0–100] · 5 nhãn phán quyết · Vết luật · Xuất DOCX đã sửa / PDF / JSON / BibTeX"),
        icon_key="shield_ok",
        fill="#DCFCE7",
        stroke="#047857",
        sw=1.6,
        title_color="#065F46",
    )
    d.edge(l8, out, "", ex=0.5, ey=1, nx=1, ny=0.5, pts=[(704, 618)], stroke="#047857", sw=1.6)
    return d


def build_fig4_2(vn: bool) -> DiagramBuilder:
    """Layer 1 & 2 Ingestion & Extraction — EXACT 11 CitationFormat Protocol implementations from patterns/*.py + VN Legal."""
    d = DiagramBuilder("p42", "fig4_2_extraction", 780, 566)
    t = lambda en, vi: vi if vn else en

    in_pdf = d.card(80, 14, 260, 58, t("Academic PDF Input", "Tệp PDF học thuật"), t("Digital or Scanned Manuscript", "Bản thảo số hoặc bản quét OCR"), icon_key="doc_pdf", fill="#EFF6FF", stroke="#1E3A8A", title_color="#1E3A8A")
    in_str = d.card(440, 14, 260, 58, t("Structured Inputs", "Đầu vào có cấu trúc"), "DOCX · BibTeX (.bib) · RIS", icon_key="multifile", fill="#F5F3FF", stroke="#6D28D9", title_color="#5B21B6")

    p1 = d.card(18, 116, 236, 98, "GROBID 0.9.1-crf (TEI)", t("Primary PDF parser; preserves<br/>columns, XML &lt;ref target&gt;", "Bộ phân tích PDF chính;<br/>giữ cột &amp; thẻ &lt;ref target&gt;"), icon_key="tei", fill="#ECFDF5", stroke="#047857", title_color="#065F46")
    p2 = d.card(272, 116, 236, 98, t("PyMuPDF + Tesseract OCR", "PyMuPDF + OCR Tesseract"), t("Fast native text, donor URLs<br/>&amp; scanned PDF OCR fallback", "Trích văn bản nhanh, sửa URL<br/>&amp; OCR cho trang PDF quét"), icon_key="pymupdf", fill="#FFFBEB", stroke="#B45309", title_color="#92400E")
    p3 = d.card(526, 116, 236, 98, t("Native Format Readers", "Bộ đọc định dạng gốc"), t("python-docx, BibTeX &amp; RIS<br/>lossless field extraction", "python-docx, BibTeX &amp; RIS<br/>trích trường không mất mát"), icon_key="multifile", fill="#F5F3FF", stroke="#6D28D9", title_color="#5B21B6")

    d.edge(in_pdf, p1, "", ex=0.3, ey=1, nx=0.5, ny=0, pts=[(158, 92), (136, 92)], stroke="#047857")
    d.edge(in_pdf, p2, "", ex=0.75, ey=1, nx=0.5, ny=0, pts=[(275, 92), (390, 92)], stroke="#B45309")
    d.edge(in_str, p3, "", ex=0.5, ey=1, nx=0.5, ny=0, pts=[(570, 92), (644, 92)], stroke="#6D28D9")

    mrg = d.card(
        68,
        256,
        644,
        74,
        t("Hybrid DocumentParser Merger, TOC Filter &amp; Normalization", "Bộ hợp nhất lai DocumentParser, Lọc mục lục &amp; Chuẩn hóa"),
        t("Merges GROBID TEI + regex donors · Discards TOC dot-leaders · Repairs wrapped DOIs<br/>Normalizes VNI/TCVN3 → NFC Unicode · Preserves VN diacritics (e.g., Ho / Hồ)", "Hợp nhất GROBID TEI + regex · Lọc mục lục dấu chấm · Sửa DOI/URL ngắt dòng<br/>Chuẩn hóa VNI/TCVN3 → NFC Unicode · Bảo toàn dấu tiếng Việt (vd: Ho / Hồ)"),
        icon_key="merge",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )
    d.edge(p1, mrg, "", ex=0.5, ey=1, nx=0.15, ny=0, pts=[(136, 236), (165, 236)], stroke="#047857")
    d.edge(p2, mrg, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#B45309")
    d.edge(p3, mrg, "", ex=0.5, ey=1, nx=0.85, ny=0, pts=[(644, 236), (615, 236)], stroke="#6D28D9")

    # EXACT 11 CitationFormat Protocol implementations matching Table 4.2 & patterns/*.py!
    c11 = d.card(
        18,
        372,
        430,
        106,
        t("11 CitationFormat Implementations (Priority 100 → 70)", "11 triển khai giao thức CitationFormat (Ưu tiên 100 → 70)"),
        t("APA (100), IEEE (90), ACM (88), Harvard (85), Vancouver (80),<br/>Nature (78), CSE (77), ACS (76), AMA (75), Chicago (70),<br/>MLA (70) — Dominant StyleDetector voting", "APA (100), IEEE (90), ACM (88), Harvard (85), Vancouver (80),<br/>Nature (78), CSE (77), ACS (76), AMA (75), Chicago (70),<br/>MLA (70) — Bỏ phiếu chuẩn chủ đạo StyleDetector"),
        icon_key="python",
        fill="#FFFFFF",
        stroke="#1D4ED8",
        sw=1.5,
        title_color="#1E3A8A",
    )
    vnl = d.card(
        466,
        372,
        296,
        106,
        t("VN Legal Helper (Dedicated)", "Bộ tách văn bản Luật VN (Riêng)"),
        t("parse_vn_legal_reference():<br/>Luật, Nghị định, Thông tư,<br/>Quyết định + issuing authority", "parse_vn_legal_reference():<br/>Luật, Nghị định, Thông tư,<br/>Quyết định + cơ quan ban hành"),
        icon_key="scale",
        fill="#FEF3C7",
        stroke="#B45309",
        sw=1.5,
        title_color="#92400E",
    )
    d.edge(mrg, c11, "", ex=0.3, ey=1, nx=0.5, ny=0, pts=[(261, 350), (233, 350)], stroke="#1D4ED8")
    d.edge(mrg, vnl, "", ex=0.75, ey=1, nx=0.5, ny=0, pts=[(551, 350), (614, 350)], stroke="#B45309")

    out = d.box(96, 506, 588, 44, t("<b>Output:</b> Structured Inline Citations[] + ReferenceList[] + StyleProfile → Layer 3 Linking", "<b>Đầu ra:</b> Trích dẫn nội văn[] + Danh mục tham khảo[] + StyleProfile → Tầng 3 Liên kết"), fill="#DCFCE7", stroke="#047857", sw=1.5, font_size=13)
    d.edge(c11, out, "", ex=0.5, ey=1, nx=0.35, ny=0, pts=[(233, 492), (302, 492)], stroke="#047857")
    d.edge(vnl, out, "", ex=0.5, ey=1, nx=0.75, ny=0, pts=[(614, 492), (537, 492)], stroke="#047857")
    return d


def build_fig4_3(vn: bool) -> DiagramBuilder:
    """Bidirectional Citation Linking: exact live Jaccard+difflib, POST override route, collector rail from Tiers 1-6, all 8 statuses."""
    d = DiagramBuilder("p43", "fig4_3_linking", 800, 678)
    t = lambda en, vi: vi if vn else en

    i1a = d.card(36, 12, 336, 60, t("1A. Inline Body Markers", "1A. Ký hiệu trích dẫn nội văn"), t("[1], [1–3], [14a, 14b], (Author, 2020a)", "[1], [1–3], [14a, 14b], (Tác giả, 2020a)"), icon_key="doc_pdf", fill="#EFF6FF", stroke="#1E3A8A", title_color="#1E3A8A")
    i1b = d.card(428, 12, 336, 60, t("1B. Bibliography Entries", "1B. Mục danh mục tham khảo"), t("Structured ReferenceList[] + TEI xml:id", "Danh mục tham khảo có cấu trúc + TEI xml:id"), icon_key="multifile", fill="#ECFDF5", stroke="#047857", title_color="#065F46")

    spine = d.box(156, 102, 488, 42, t("<b>Dual-Index Spine</b> (TEI ID · DOI · arXiv · Index · Surname+Year)", "<b>Trục chỉ mục kép</b> (TEI ID · DOI · arXiv · Chỉ số · Họ+Năm)"), fill="#DBEAFE", stroke="#1D4ED8", sw=1.6, font_size=13)
    d.edge(i1a, spine, "", ex=0.5, ey=1, nx=0.25, ny=0, pts=[(204, 88), (278, 88)], stroke="#1E3A8A")
    d.edge(i1b, spine, "", ex=0.5, ey=1, nx=0.75, ny=0, pts=[(596, 88), (522, 88)], stroke="#047857")

    steps = [
        ("1. tei_link", "0.98", t("GROBID &lt;ref target='#bN'&gt; XML pointer", "Con trỏ XML &lt;ref target='#bN'&gt; GROBID"), "#ECFDF5", "#047857"),
        ("2. doi_exact", "0.95", t("Normalized DOI equality match", "Khớp chính xác DOI đã chuẩn hóa"), "#ECFDF5", "#047857"),
        ("3. arxiv_exact", "0.95", t("Live normalized arXiv identifier match", "Khớp trực tiếp mã arXiv đã chuẩn hóa"), "#ECFDF5", "#047857"),
        ("4. numeric_index", "0.90", t("[1], ranges [1–3], composite [14a, 14b]", "[1], dải [1–3], trích dẫn ghép [14a, 14b]"), "#EFF6FF", "#1D4ED8"),
        ("5. author_year", "0.90", t("Normalized surname + year + suffix (2020a)", "Họ chuẩn hóa + năm + hậu tố (2020a)"), "#EFF6FF", "#1D4ED8"),
        ("6. fuzzy", "0.65", t("Word-set Jaccard + difflib fallback (τ=0.80)", "Dự phòng Jaccard + difflib (ngưỡng τ=0.80)"), "#FFFBEB", "#B45309"),
        ("7. no_keys", "0.00", t("No key match → orphan / unresolved diagnostic", "Không khớp khóa → mồ côi / chưa xác định"), "#FEF2F2", "#DC2626"),
    ]
    prev_id = spine
    step_ids = []
    y0 = 166
    for idx, (mname, wt, desc, fl, st) in enumerate(steps):
        sy = y0 + idx * 52
        sid = d.box(
            44,
            sy,
            504,
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
            d.edge(spine, sid, "", ex=0.35, ey=1, nx=0.5, ny=0, pts=[(327, 154), (296, 154)], stroke="#1D4ED8")
        else:
            d.edge(prev_id, sid, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#64748B", sw=1.2)
        prev_id = sid

    # Left green short-circuit collector rail connecting ALL Tiers 1–6 into Matched Links!
    for idx in range(6):
        sy_mid = y0 + idx * 52 + 20
        d.edge(None, None, "", src_pt=(44, sy_mid), dst_pt=(18, sy_mid), orth=False, end_arrow="none", stroke="#047857", sw=1.3)
    d.edge(None, None, "", src_pt=(18, y0 + 20), dst_pt=(18, 558), orth=False, end_arrow="none", stroke="#047857", sw=1.5)

    # Separate side callout: manual_review (1.00) with exact live POST route!
    man = d.card(
        572,
        242,
        212,
        134,
        "manual_review\n(w = 1.00)",
        t("Instructor override via<br/>POST /api/essays/{id}/<br/>verdicts/{vid}/override", "Ghi đè giảng viên qua<br/>POST /api/essays/{id}/<br/>verdicts/{vid}/override"),
        icon_key="teacher",
        fill="#FEF9C3",
        stroke="#CA8A04",
        sw=1.5,
        title_color="#854D0E",
    )

    # Bottom 3 Diagnostic Buckets explicitly covering ALL 8 CitationMappingStatus states!
    o_ok = d.box(24, 574, 240, 88, t("<b>Resolved Links (3 states)</b><br/>matched · manual_review<br/>ambiguous_mapping (0.50)", "<b>Liên kết khớp (3 trạng thái)</b><br/>matched · manual_review<br/>ambiguous_mapping (0.50)"), fill="#DCFCE7", stroke="#047857", sw=1.5, font_size=13)
    o_or = d.box(280, 574, 240, 88, t("<b>Body-Side Faults (3 states)</b><br/>missing_reference · unresolved<br/>in_text_mismatch", "<b>Lỗi nội văn (3 trạng thái)</b><br/>missing_reference · unresolved<br/>in_text_mismatch"), fill="#FEF3C7", stroke="#B45309", sw=1.5, font_size=13)
    o_un = d.box(536, 574, 248, 88, t("<b>Bib-Side Faults (2 states)</b><br/>uncited_reference<br/>duplicate_reference → s_link", "<b>Lỗi danh mục (2 trạng thái)</b><br/>uncited_reference<br/>duplicate_reference → s_link"), fill="#FEE2E2", stroke="#DC2626", sw=1.5, font_size=13)

    d.edge(None, o_ok, "", src_pt=(18, 558), nx=0.22, ny=0, pts=[(77, 558)], stroke="#047857", sw=1.6)
    d.edge(step_ids[6], o_or, "", ex=0.5, ey=1, nx=0.5, ny=0, pts=[(296, 548), (400, 548)], stroke="#B45309", sw=1.5)
    d.edge(step_ids[6], o_un, "", ex=0.85, ey=1, nx=0.5, ny=0, pts=[(472, 540), (660, 540)], stroke="#DC2626", sw=1.5)
    d.edge(man, o_ok, "", ex=0.5, ey=1, nx=0.85, ny=0, pts=[(678, 558), (228, 558)], dashed=1, stroke="#CA8A04", sw=1.4)
    return d


def build_fig4_4(vn: bool) -> DiagramBuilder:
    """4-Tier Retrieval Waterfall: removes '(All Labeled)' leak, Sub-100 ms (87.6 ms mean), connectors into Output bar."""
    d = DiagramBuilder("p44", "fig4_4_retrieval", 804, 706)
    t = lambda en, vi: vi if vn else en

    pre = d.card(
        18,
        12,
        530,
        62,
        t("Pre-Screen Router &amp; SQLite citation_cache (doi:/arxiv:/url:)", "Bộ định tuyến &amp; Bộ đệm SQLite citation_cache (doi:/arxiv:/url:)"),
        t("Cache hit (&lt;5 ms) skips WAN · Extracts DOI, arXiv, URL &amp; title keys", "Trúng đệm (&lt;5 ms) bỏ qua WAN · Tách khóa DOI, arXiv, URL &amp; tiêu đề"),
        icon_key="sqlite",
        fill="#EFF6FF",
        stroke="#1E3A8A",
        sw=1.6,
        title_color="#1E3A8A",
    )

    t0 = d.box(18, 96, 530, 108, "", fill="#ECFDF5", stroke="#047857", sw=1.5)
    d.text(28, 100, 510, 24, t("Tier 0: Sub-100 ms Offline Index (87.6 ms mean · Zero Network)", "Tầng 0: Chỉ mục ngoại tuyến &lt;100 ms (TB 87.6 ms · Không cần mạng)"), font_size=14, font_color="#065F46", bold=True, align="left")
    d.card(30, 128, 258, 66, "local_papers.db (FTS5)", t("129,137 records · 98.42% ACL", "129,137 bài · 98.42% ACL"), icon_key="acl", fill="#FFFFFF", stroke="#047857", title_color="#065F46")
    d.card(300, 128, 236, 66, "_KNOWN_PAPERS (RAM)", t("101 classics · &lt;1 ms", "101 bài kinh điển · &lt;1 ms"), icon_key="python", fill="#FFFFFF", stroke="#047857", title_color="#065F46")

    t1 = d.box(18, 226, 530, 114, "", fill="#EFF6FF", stroke="#1D4ED8", sw=1.5)
    d.text(28, 230, 510, 24, t("Tier 1: Core Parallel Scholarly Registries (Circuit-Breaker Guarded)", "Tầng 1: 4 API học thuật lõi song song (Có bộ ngắt mạch)"), font_size=14, font_color="#1E3A8A", bold=True, align="left")
    t1_items = [("crossref", "Crossref"), ("openalex", "OpenAlex"), ("datacite", "DataCite"), ("doi", "DOI RA")]
    for idx, (ik, lbl) in enumerate(t1_items):
        bx = 30 + idx * 127
        d.box(bx, 260, 116, 68, "", fill="#FFFFFF", stroke="#93C5FD", sw=1.2)
        d.icon(ik, bx + 44, 266, 28, 28)
        d.text(bx + 2, 298, 112, 26, lbl, font_size=13, bold=True)

    t2 = d.box(18, 362, 530, 196, "", fill="#FFFBEB", stroke="#B45309", sw=1.5)
    d.text(28, 366, 510, 24, t("Tier 2: Domain-Specialist Registries &amp; Stage 2.5 Preprints", "Tầng 2: Cơ sở dữ liệu chuyên ngành &amp; Pha 2.5 Tiền ấn phẩm"), font_size=14, font_color="#92400E", bold=True, align="left")
    t2_row1 = [("dblp", "DBLP"), ("epmc", "EuroPMC"), ("doaj", "DOAJ"), ("hal", "HAL/OpenAIRE")]
    t2_row2 = [("openlib", "OpenLib"), ("pypi", "PyPI"), ("hf", "HF Hub"), ("arxiv", "arXiv (2.5)")]
    for r_i, row_items in enumerate((t2_row1, t2_row2)):
        by = 396 + r_i * 78
        for idx, (ik, lbl) in enumerate(row_items):
            bx = 30 + idx * 127
            d.box(bx, by, 116, 68, "", fill="#FFFFFF", stroke="#FCD34D", sw=1.2)
            d.icon(ik, bx + 44, by + 6, 28, 28)
            d.text(bx + 2, by + 38, 112, 26, lbl, font_size=13, bold=True)

    t3 = d.box(
        18,
        580,
        530,
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

    rail = d.box(578, 12, 212, 612, "", fill="#FEF2F2", stroke="#DC2626", sw=1.5)
    d.text(586, 18, 196, 44, t("Parallel Egress Rail\n(Pinned-IP SSRF)", "Luồng song song\n(Chặn SSRF ghim IP)"), font_size=14, font_color="#991B1B", bold=True)
    d.icon("ssrf_shield", 670, 68, 30, 30)

    d.card(590, 112, 188, 108, "LinkValidator", t("HEAD/GET liveness,<br/>RFC 2606 fake URL,<br/>redirect blocks", "Kiểm tra URL sống,<br/>RFC 2606 URL giả,<br/>chặn chuyển hướng"), icon_key="tls", fill="#FFFFFF", stroke="#DC2626", title_color="#991B1B")
    d.card(590, 238, 188, 108, "SafeHtmlMeta", t("Reads ≤128 KB head<br/>&lt;title&gt; / JSON-LD<br/>&amp; Soft-404 guard", "Đọc ≤128 KB đầu trang<br/>&lt;title&gt; / JSON-LD<br/>&amp; lọc Soft-404"), icon_key="globe", fill="#FFFFFF", stroke="#DC2626", title_color="#991B1B")
    d.card(590, 364, 188, 108, "Wayback CDX", t("Internet Archive<br/>fallback for dead<br/>HTTP 404/410 URLs", "Kho Internet Archive<br/>khôi phục liên kết<br/>chết HTTP 404/410"), icon_key="wayback", fill="#FFFFFF", stroke="#B45309", title_color="#92400E")
    d.card(590, 490, 188, 118, t("Abstract Enrich", "Bổ sung tóm tắt"), t("Fills missing abstracts<br/>on top pool[:3]<br/>via OpenAlex / EPMC", "Bổ sung tóm tắt cho<br/>3 ứng viên đầu<br/>qua OpenAlex / EPMC"), icon_key="openalex", fill="#ECFDF5", stroke="#047857", title_color="#065F46")

    d.edge(pre, t0, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#047857")
    d.edge(t0, t1, t("Miss / low sim", "Không trúng"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1D4ED8", ox=58)
    d.edge(t1, t2, t("Fallback", "Dự phòng"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#B45309", ox=48)
    d.edge(t2, t3, t("If key set", "Nếu bật"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, dashed=1, stroke="#64748B", ox=46)
    d.edge(pre, rail, "", ex=1, ey=0.5, nx=0, ny=0.05, stroke="#DC2626", sw=1.5)

    out_bar = d.box(18, 650, 772, 42, t("<b>Output:</b> SourceResult (ranked candidates[], abstracts, url_status, html_meta, api_errors[]) → Layer 5 Matching", "<b>Đầu ra:</b> SourceResult (ứng viên[], tóm tắt, trạng thái URL, html_meta, lỗi API[]) → Tầng 5 So khớp"), fill="#DCFCE7", stroke="#047857", sw=1.5, font_size=13)
    d.edge(t3, out_bar, "", ex=0.5, ey=1, nx=0.34, ny=0, orth=False, stroke="#047857", sw=1.5)
    d.edge(rail, out_bar, "", ex=0.5, ey=1, nx=0.86, ny=0, orth=False, stroke="#DC2626", sw=1.5)
    return d


def build_fig4_5(vn: bool) -> DiagramBuilder:
    """Layer 5 Multimodal Evidence Matching Engine: exact RapidFuzz token_set_ratio + Levenshtein, clean subscripts & VN."""
    d = DiagramBuilder("p45", "fig4_5_matching", 792, 614)
    t = lambda en, vi: vi if vn else en

    in1 = d.card(14, 148, 178, 108, t("Parsed Citation", "Trích dẫn tách"), t("Title, Authors, Year,<br/>Venue, DOI, Context", "Tiêu đề, Tác giả, Năm,<br/>Nơi công bố, DOI, Ngữ cảnh"), icon_key="doc_pdf", fill="#EFF6FF", stroke="#1E3A8A", title_color="#1E3A8A")
    in2 = d.card(14, 346, 178, 108, "SourceCandidate", t("Canonical Metadata<br/>+ Enriched Abstract", "Siêu dữ liệu chuẩn<br/>+ Tóm tắt bổ sung"), icon_key="fts5", fill="#ECFDF5", stroke="#047857", title_color="#065F46")

    m1 = d.card(
        234,
        18,
        354,
        122,
        t("1. Dual Title Fidelity", "1. Độ trung thực tiêu đề kép"),
        t("RapidFuzz token_set_ratio + Levenshtein<br/>+ SBERT e(·) [384-d] (MiniLM / ONNX)<br/><b>Score = max(fuzzy, semantic)</b>", "RapidFuzz token_set_ratio + Levenshtein<br/>+ SBERT e(·) [384-d] (MiniLM / ONNX)<br/><b>Điểm = max(mờ, ngữ nghĩa)</b>"),
        icon_key="multiling",
        fill="#EFF6FF",
        stroke="#1D4ED8",
        title_color="#1E3A8A",
    )
    m2 = d.card(
        234,
        160,
        354,
        122,
        t("2. 1-to-1 Author Reconciliation", "2. Đối chiếu tác giả 1-1"),
        t("Greedy bipartite surname matching;<br/>VN diacritics (<b>Lê, Võ, Đỗ, Hồ, Lý</b>),<br/>particles (Van/De/Du) &amp; et al.", "Khớp họ hai phía 1-1;<br/>dấu tiếng Việt (<b>Lê, Võ, Đỗ, Hồ, Lý</b>),<br/>tiền tố (Van/De/Du) &amp; et al."),
        icon_key="student",
        fill="#ECFDF5",
        stroke="#047857",
        title_color="#065F46",
    )
    m3 = d.card(
        234,
        302,
        354,
        122,
        t("3. Year, Venue &amp; DOI Signals", "3. Tín hiệu Năm, Nơi công bố &amp; DOI"),
        t("Year Δ tolerance (±1 preprint grace)<br/>VenueNormalizer (aliases &amp; acronyms)<br/>DOI Exact Equality (separate bit)", "Sai lệch năm (±1 bản tiền in)<br/>VenueNormalizer (tên tắt &amp; bí danh)<br/>Khớp DOI chính xác (bit riêng biệt)"),
        icon_key="doi",
        fill="#FFFBEB",
        stroke="#B45309",
        title_color="#92400E",
    )
    m4 = d.card(
        234,
        444,
        354,
        150,
        t("4. Semantic Context Alignment", "4. Đối chiếu ngữ cảnh trích dẫn"),
        t("Hierarchical Sentence Pooling:<br/><b>0.65 · max(sᵢ) + 0.35 · s(abs)</b><br/><b>vn_en_academic_bridge (+0.08)</b><br/>Stance contradiction &amp; lexical guards", "Gộp câu phân cấp:<br/><b>0.65 · max(sᵢ) + 0.35 · s(abs)</b><br/><b>vn_en_academic_bridge (+0.08)</b><br/>Phát hiện mâu thuẫn lập trường"),
        icon_key="onnx",
        fill="#F5F3FF",
        stroke="#6D28D9",
        title_color="#5B21B6",
    )

    out = d.card(
        622,
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

    for target in (m1, m2, m3, m4):
        tx_y = d._coords[target][1] + d._coords[target][3] / 2
        d.edge(in1, target, "", ex=1, ey=0.5, nx=0, ny=0.4, pts=[(208, 202), (208, tx_y - 12)], stroke="#1E3A8A", sw=1.2)
        d.edge(in2, target, "", ex=1, ey=0.5, nx=0, ny=0.6, pts=[(218, 400), (218, tx_y + 12)], stroke="#047857", sw=1.2)
        d.edge(target, out, "", ex=1, ey=0.5, nx=0, ny=0.5, pts=[(604, tx_y), (604, 303)], stroke="#047857", sw=1.4)
    return d


def build_fig4_6(vn: bool) -> DiagramBuilder:
    """Layer 6 Neuro-Symbolic Verification & Platt Calibration — exact Order 0 + Groups 1-16 matching Table 4.6!"""
    d = DiagramBuilder("p46", "fig4_6_neurosymbolic", 804, 566)
    t = lambda en, vi: vi if vn else en

    i_ml = d.card(14, 62, 212, 124, "MatchFeatures → x", t("16D vector x ∈ ℝ¹⁶<br/>Title, Author, Year,<br/>Venue, Context, Inter.", "Véc-tơ 16 chiều x ∈ ℝ¹⁶<br/>Tiêu đề, Tác giả, Năm,<br/>Nơi công bố, Ngữ cảnh"), icon_key="vec16", fill="#EFF6FF", stroke="#1D4ED8", title_color="#1E3A8A")
    i_sy = d.card(14, 268, 212, 134, t("Provenance Flags", "Cờ nguồn gốc rời rạc"), t("is_retracted, url_status,<br/>HTTP 429, doi_ra,<br/>VN statutory rules", "is_retracted, url_status,<br/>HTTP 429, doi_ra,<br/>quy tắc pháp luật VN"), icon_key="shield_ok", fill="#FFFBEB", stroke="#B45309", title_color="#92400E")

    ml = d.card(270, 62, 230, 124, "HybridMLScorer (MLR)", t("L2 Multinomial Logistic Reg.<br/>C = 0.25 · Balanced weights<br/>→ <b>p_ML(y | x)</b>", "Hồi quy Logistic đa lớp L2<br/>C = 0.25 · Trọng số cân bằng<br/>→ <b>p_ML(y | x)</b>"), icon_key="neural", fill="#EFF6FF", stroke="#1D4ED8", sw=1.6, title_color="#1E3A8A")

    # Exact Order 0 + Groups 1–16 (matching Table 4.6 & caption!)
    sym = d.card(270, 268, 230, 134, t("SymbolicRules (68 R-*)", "Luật ký hiệu (68 R-*)"), t("Order 0 + Groups 1–16:<br/>Deterministic verdicts &amp;<br/>→ <b>y_sym, p_sym, rules[]</b>", "Bậc 0 + Nhóm 1–16:<br/>Phán quyết tất định &amp;<br/>→ <b>y_sym, p_sym, rules[]</b>"), icon_key="scale", fill="#FFFBEB", stroke="#B45309", sw=1.6, title_color="#92400E")

    fuse = d.box(
        548,
        134,
        240,
        108,
        t("<b>Monotonic Blend</b><br/>p_blend = α·p_sym + (1−α)·p_ML<br/>(α = 0.72 · Symbolic label y_sym<br/>never inverted by ML)", "<b>Hòa trộn đơn điệu</b><br/>p_blend = α·p_sym + (1−α)·p_ML<br/>(α = 0.72 · Nhãn ký hiệu y_sym<br/>không bị đảo bởi ML)"),
        fill="#F0FDF4",
        stroke="#059669",
        sw=1.6,
        font_size=13,
    )

    platt = d.card(
        548,
        282,
        240,
        124,
        "PlattCalibrator",
        t("z = logit(p_blend)<br/>p_cal = clip(σ(a·z + b),<br/>0.01, 0.99) − δ_style", "z = logit(p_blend)<br/>p_cal = clip(σ(a·z + b),<br/>0.01, 0.99) − δ_style"),
        icon_key="platt_clean",
        fill="#ECFDF5",
        stroke="#047857",
        sw=1.6,
        title_color="#065F46",
    )

    out = d.card(
        110,
        452,
        584,
        96,
        t("Layer 6 Output: CitationVerdict", "Đầu ra Tầng 6: CitationVerdict"),
        t("<b>label</b> ∈ {VERIFIED, METADATA_ERROR, SUSPECTED_HALLUCINATION, UNRESOLVED, RESOURCE}<br/><b>calibrated_confidence</b> p_cal ∈ {0} ∪ [0.01, 0.99] · <b>triggered_rules[]</b> → Layer 7 CIS", "<b>nhãn</b> ∈ {VERIFIED, METADATA_ERROR, SUSPECTED_HALLUCINATION, UNRESOLVED, RESOURCE}<br/><b>độ tin cậy hiệu chỉnh</b> p_cal ∈ {0} ∪ [0.01, 0.99] · <b>vết luật triggered_rules[]</b> → Tầng 7 CIS"),
        icon_key="shield_ok",
        fill="#DCFCE7",
        stroke="#047857",
        sw=1.7,
        title_color="#065F46",
    )

    d.edge(i_ml, ml, "16D x", ex=1, ey=0.5, nx=0, ny=0.5, stroke="#1D4ED8", oy=-14)
    d.edge(i_sy, sym, t("Flags", "Cờ"), ex=1, ey=0.5, nx=0, ny=0.5, stroke="#B45309", oy=-14)
    d.edge(i_ml, sym, "", ex=0.5, ey=1, nx=0.25, ny=0, pts=[(120, 226), (328, 226)], dashed=1, stroke="#64748B")
    d.edge(ml, fuse, "p_ML", ex=1, ey=0.5, nx=0, ny=0.35, pts=[(524, 124), (524, 172)], stroke="#1D4ED8", ox=0, oy=-14)
    d.edge(sym, fuse, "p_sym", ex=1, ey=0.35, nx=0, ny=0.7, pts=[(524, 315), (524, 210)], stroke="#B45309", ox=0, oy=-14)
    d.edge(fuse, platt, "p_blend", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#059669", ox=42, bold=True)
    d.edge(platt, out, t("p_cal", "độ tin cậy"), ex=0.5, ey=1, nx=0.8, ny=0, pts=[(668, 432), (577, 432)], stroke="#047857", ox=42, oy=-14, bold=True)
    d.edge(sym, out, "y_sym, rules[]", ex=0.5, ey=1, nx=0.35, ny=0, pts=[(385, 428), (314, 428)], stroke="#B45309", ox=-54, oy=-14, bold=True)
    return d


def build_fig4_7(vn: bool) -> DiagramBuilder:
    """Guarded Symbolic Decision Flow strictly aligned with Table 4.6 (Order 0, Groups 1-4, Group 5, Groups 6-16)."""
    d = DiagramBuilder("p47", "fig4_7_decision_flow", 820, 756)
    t = lambda en, vi: vi if vn else en

    st = d.box(235, 12, 350, 42, t("<b>Input:</b> Citation + SourceResult + MatchFeatures", "<b>Đầu vào:</b> Trích dẫn + Kết quả nguồn + MatchFeatures"), fill="#EFF6FF", stroke="#1E3A8A", sw=1.5, font_size=13)

    # Order 0: Resource or VN Statutory Check (includes R-VN-LEGAL-FABRICATED!)
    d0 = d.diamond(286, 78, 248, 90, t("Order 0: Resource or\nVN Statutory Check?", "Bậc 0: Tài nguyên hay\nVăn bản Luật VN?"))
    d.edge(st, d0, "", ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#1E3A8A")

    o_res = d.card(10, 82, 206, 82, "RESOURCE", t("Valid web/std/dataset<br/>or valid VN statute", "Web/chuẩn hợp lệ<br/>hoặc Luật VN hợp lệ"), icon_key="resource", fill="#E0F2FE", stroke="#0369A1", title_color="#075985")
    o_vnl = d.card(604, 82, 206, 82, "META / HALLUC.", t("VNLegalVerifier: conflict<br/>or fabricated statute", "VNLegalVerifier: sai thẩm<br/>quyền hoặc bịa văn bản"), icon_key="scale", fill="#FEF3C7", stroke="#B45309", title_color="#92400E")

    d.edge(d0, o_res, t("Valid", "Hợp lệ"), ex=0, ey=0.5, nx=1, ny=0.5, orth=False, stroke="#0369A1", oy=-14, bold=True)
    d.edge(d0, o_vnl, t("VN fault", "Lỗi luật"), ex=1, ey=0.5, nx=0, ny=0.5, orth=False, stroke="#B45309", oy=-14, bold=True)

    # Groups 1–4: Hard Guardrails (G1–2, G4) & Known-Paper Fast Path (G3)
    d14 = d.diamond(280, 214, 260, 96, t("Groups 1–4: Hard Guardrail\nor Known Paper (G3)?", "Nhóm 1–4: Rào chắn cứng\nhay Bài kinh điển (N3)?"))
    d.edge(d0, d14, t("Academic", "Học thuật"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#334155", ox=50, bold=True)

    o_ret = d.card(10, 218, 206, 88, "VERIF. / META_ERR", t("G3: R-KNOWN-PAPER<br/>G1: R-RETRACTED-PAPER", "N3: R-KNOWN-PAPER<br/>N1: R-RETRACTED-PAPER"), icon_key="scale", fill="#FEF3C7", stroke="#B45309", title_color="#92400E")
    o_hal = d.card(604, 218, 206, 88, "HALLUCINATION", t("G1–2, G4: Fake URL /<br/>Chimeric DOI / No Record", "N1–2, N4: URL giả /<br/>DOI lai / Không bản ghi"), icon_key="alert_red", fill="#FEE2E2", stroke="#DC2626", title_color="#991B1B")

    d.edge(d14, o_ret, t("G3 / Retr.", "N3 / Rút"), ex=0, ey=0.5, nx=1, ny=0.5, orth=False, stroke="#B45309", oy=-14, bold=True)
    d.edge(d14, o_hal, t("Fabricated", "Bịa đặt"), ex=1, ey=0.5, nx=0, ny=0.5, orth=False, stroke="#DC2626", ox=-6, oy=-14, bold=True)

    # Group 5: Safe Abstention (HTTP 429 / No-CSL / R-FAIL-ALL)
    d5 = d.diamond(280, 360, 260, 92, t("Group 5: API Outage /\nNo-CSL / Low Border?", "Nhóm 5: Lỗi API / Thiếu\nCSL / Vùng biên mờ?"))
    d.edge(d14, d5, t("Pass", "Qua"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#334155", ox=34, bold=True)

    o_unr = d.card(604, 366, 206, 82, "UNRESOLVED", t("HTTP 429 · No-CSL DOI<br/>Safe Abstention (G5)", "HTTP 429 · DOI thiếu CSL<br/>Từ chối an toàn (N5)"), icon_key="teacher", fill="#F1F5F9", stroke="#475569", title_color="#1E293B")
    d.edge(d5, o_unr, t("Abstain", "Từ chối"), ex=1, ey=0.5, nx=0, ny=0.5, orth=False, stroke="#475569", oy=-14, bold=True)

    # Groups 6–16 Multimodal Evidence Scoring + 16D MLR + Platt (wider 472px so [0.01, 0.99] stays cleanly on line 2!)
    g616 = d.card(
        174,
        502,
        472,
        74,
        t("Groups 6–16: Multimodal Evidence + 16D MLR + Platt", "Nhóm 6–16: Luật đa phương thức + 16D MLR + Platt"),
        t("Title, Author, Year, Venue, Context + α=0.72 + Platt [0.01, 0.99]", "Tiêu đề, Tác giả, Năm, Nơi công bố, Ngữ cảnh + α=0.72 + Platt"),
        icon_key="platt_clean",
        fill="#ECFDF5",
        stroke="#047857",
        sw=1.6,
        title_color="#065F46",
    )
    d.edge(d5, g616, t("Resolved", "Đủ chứng cứ"), ex=0.5, ey=1, nx=0.5, ny=0, orth=False, stroke="#047857", ox=54, bold=True)

    f1 = d.box(12, 614, 184, 48, "<b>VERIFIED</b>", fill="#DCFCE7", stroke="#047857", sw=1.6, font_size=13, font_color="#065F46")
    f2 = d.box(216, 614, 184, 48, "<b>METADATA_ERROR</b>", fill="#FEF3C7", stroke="#B45309", sw=1.6, font_size=13, font_color="#92400E")
    f3 = d.box(420, 614, 184, 48, "<b>HALLUCINATION</b>", fill="#FEE2E2", stroke="#DC2626", sw=1.6, font_size=13, font_color="#991B1B")
    f4 = d.box(624, 614, 184, 48, "<b>UNRESOLVED</b>", fill="#F1F5F9", stroke="#475569", sw=1.6, font_size=13, font_color="#1E293B")

    d.edge(g616, f1, "", ex=0.15, ey=1, nx=0.5, ny=0, pts=[(245, 594), (104, 594)], stroke="#047857")
    d.edge(g616, f2, "", ex=0.38, ey=1, nx=0.5, ny=0, pts=[(353, 594), (308, 594)], stroke="#B45309")
    d.edge(g616, f3, "", ex=0.62, ey=1, nx=0.5, ny=0, pts=[(467, 594), (512, 594)], stroke="#DC2626")
    d.edge(g616, f4, "", ex=0.85, ey=1, nx=0.5, ny=0, pts=[(575, 594), (716, 594)], stroke="#475569")

    d.box(
        12,
        686,
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
