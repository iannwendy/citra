#!/usr/bin/env python3
"""Generate 350-DPI print-native Q1 Matplotlib charts (EN & VN) for CITRA Chapter 5."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.patheffects as pe
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from matplotlib.ticker import FuncFormatter

REPO_ROOT = Path(__file__).resolve().parents[1]
REPORT_JSON = REPO_ROOT / "data" / "models" / "neuro_symbolic_benchmark_report.json"
PERF_JSON = REPO_ROOT / "reports" / "benchmarks" / "pipeline_performance_benchmark.json"

# Q1 Publication Colorblind-Safe Palette (aligned with Q1 chart playbook)
NAVY = "#1E3A8A"
BLUE = "#2563EB"
SKY = "#60A5FA"
SKY_LIGHT = "#93C5FD"
EMERALD = "#059669"
EMERALD_DARK = "#047857"
MINT = "#6EE7B7"
AMBER = "#D97706"
CORAL = "#DC2626"
SLATE = "#64748B"
SLATE_LIGHT = "#CBD5E1"
BG_WHITE = "#FFFFFF"

plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["DejaVu Sans", "Arial", "Helvetica"],
        "font.size": 9.8,
        "axes.titlesize": 10.8,
        "axes.titleweight": "bold",
        "axes.labelsize": 9.8,
        "axes.labelweight": "bold",
        "xtick.labelsize": 8.6,
        "ytick.labelsize": 8.6,
        "legend.fontsize": 8.2,
        "axes.edgecolor": "#334155",
        "axes.linewidth": 0.9,
        "grid.color": "#E2E8F0",
        "grid.linewidth": 0.65,
        "savefig.dpi": 350,
        "savefig.facecolor": BG_WHITE,
        "figure.facecolor": BG_WHITE,
        "axes.facecolor": BG_WHITE,
    }
)


def load_benchmark() -> dict:
    with REPORT_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def load_perf_benchmark() -> dict:
    with PERF_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)


def make_fig5_1(data: dict, lang: str, out_path: Path) -> None:
    """Four-panel 350-DPI Q1 benchmark figure (8.8 x 6.2 in -> ~6.7-8.0 pt printed on A4)."""
    is_vn = lang == "vn"
    fig, axes = plt.subplots(2, 2, figsize=(9.0, 6.55), dpi=350)
    plt.subplots_adjust(left=0.145, right=0.96, top=0.935, bottom=0.085, wspace=0.34, hspace=0.41)

    # =========================================================================
    # Panel (a): In-Distribution Baseline Ablation (N = 18,000) — Horizontal Bars
    # =========================================================================
    ax = axes[0, 0]
    b = data["baselines_on_test_set"]
    prop = data["neuro_symbolic_platt_calibrated"]["classification"]

    rows = [
        ("B0", "B0: Exact DOI Only" if not is_vn else "B0: Chỉ khớp DOI"),
        ("B1", "B1: Single Crossref" if not is_vn else "B1: Chỉ Crossref"),
        ("B3", "B3: SBERT Threshold" if not is_vn else "B3: Ngưỡng SBERT"),
        ("B4", "B4: Linear Heuristic" if not is_vn else "B4: Tuyến tính (không TC)"),
        ("B2", "B2: RapidFuzz + Auth." if not is_vn else "B2: RapidFuzz + Tác giả"),
        ("B5", "B5: 16D Logistic Reg." if not is_vn else "B5: Hồi quy Logistic 16D"),
        ("Proposed", "CITRA (Proposed)" if not is_vn else "CITRA (Đề xuất)"),
    ]
    accs = [b[k]["accuracy"] * 100 if k != "Proposed" else prop["accuracy"] * 100 for k, _ in rows]
    f1s = [b[k]["macro_f1"] * 100 if k != "Proposed" else prop["macro_f1"] * 100 for k, _ in rows]
    y = np.arange(len(rows))
    h = 0.36

    acc_colors = [SLATE] + [BLUE] * 5 + [EMERALD]
    f1_colors = [SLATE_LIGHT] + [SKY_LIGHT] * 5 + [MINT]

    ax.barh(y + h / 2, accs, h, color=acc_colors, edgecolor="#334155", linewidth=0.5, label="Accuracy (%)" if not is_vn else "Độ chính xác (%)")
    ax.barh(y - h / 2, f1s, h, color=f1_colors, edgecolor="#475569", linewidth=0.5, label="Macro-F1 (%)")

    ax.set_yticks(y)
    ax.set_yticklabels([lbl for _, lbl in rows], fontsize=8.4)
    ax.get_yticklabels()[-1].set_fontweight("bold")
    ax.get_yticklabels()[-1].set_color(EMERALD_DARK)
    ax.set_xlim(0, 122)
    ax.set_ylim(-0.6, len(rows) + 0.65)
    ax.set_xlabel("Held-Out Test Score (%)" if not is_vn else "Điểm trên tập kiểm thử độc lập (%)", fontsize=9.4)
    ax.set_title(
        "(a) Controlled ID Ablation (N = 18,000)" if not is_vn else "(a) Loại bỏ thành phần ID (N = 18,000)",
        fontsize=10.6,
        color=NAVY,
        pad=7,
    )
    ax.grid(axis="x", linestyle="--", alpha=0.6)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

    for idx_r, (ac, f1) in enumerate(zip(accs, f1s, strict=True)):
        fw = "bold" if idx_r == len(rows) - 1 else "normal"
        col = EMERALD_DARK if idx_r == len(rows) - 1 else "#1E293B"
        ax.text(ac + 1.4, idx_r + h / 2, f"{ac:.2f}%", va="center", ha="left", fontsize=7.9, fontweight=fw, color=col)
        ax.text(f1 + 1.4, idx_r - h / 2, f"{f1:.2f}%", va="center", ha="left", fontsize=7.7, fontweight=fw, color=col)

    ann = ax.annotate(
        "vs. B5: McNemar χ² = 328.9\nHolm p = 1.66×10⁻⁷³ (−85.7% err.)"
        if not is_vn
        else "vs. B5: McNemar χ² = 328.9\nHolm p = 1.66×10⁻⁷³ (−85.7% lỗi)",
        xy=(99.7, 6.22),
        xytext=(43.0, 7.02),
        ha="center",
        va="center",
        fontsize=7.6,
        fontweight="bold",
        color=EMERALD_DARK,
        bbox=dict(boxstyle="round,pad=0.28", facecolor="#ECFDF5", edgecolor=EMERALD, lw=0.9),
        arrowprops=dict(arrowstyle="->", color=EMERALD_DARK, lw=1.25, connectionstyle="arc3,rad=-0.10"),
        zorder=6,
    )
    ann.arrow_patch.set_path_effects([pe.Stroke(linewidth=3.0, foreground="white"), pe.Normal()])
    ax.legend(loc="lower right", fontsize=7.8, frameon=True, framealpha=0.94, edgecolor="#CBD5E1")

    # =========================================================================
    # Panel (b): Confusion Matrix & Zero-Harm Safety (N = 18,000)
    # =========================================================================
    ax = axes[0, 1]
    cm = np.array(
        [
            [6476, 4, 0, 0],
            [37, 3907, 4, 12],
            [0, 0, 5398, 2],
            [0, 0, 0, 2160],
        ]
    )
    row_pct = cm / cm.sum(axis=1, keepdims=True) * 100.0
    im = ax.imshow(row_pct, cmap="YlGnBu", vmin=0.0, vmax=100.0, aspect="auto")

    x_lbls = (
        ["Verified", "Metadata\nError", "Suspected\nHalluc.", "Unresolved"]
        if not is_vn
        else ["Hợp lệ", "Lỗi siêu\ndữ liệu", "Ảo giác", "Chưa\nxác định"]
    )
    y_lbls = (
        ["Verified\n(6,480)", "Metadata\n(3,960)", "Halluc.\n(5,400)", "Unresolved\n(2,160)"]
        if not is_vn
        else ["Hợp lệ\n(6,480)", "Lỗi SDL\n(3,960)", "Ảo giác\n(5,400)", "Chưa XĐ\n(2,160)"]
    )
    ax.set_xticks(range(4))
    ax.set_yticks(range(4))
    ax.set_xticklabels(x_lbls, fontsize=7.8, fontweight="bold")
    ax.set_yticklabels(y_lbls, fontsize=7.8)
    ax.set_xticks(np.arange(-0.5, 4, 1), minor=True)
    ax.set_yticks(np.arange(-0.5, 4, 1), minor=True)
    ax.tick_params(which="minor", bottom=False, left=False)
    ax.grid(which="minor", color="#CBD5E1", linewidth=0.8)
    ax.set_xlabel("Predicted Verdict Class" if not is_vn else "Nhãn phán quyết dự đoán", fontsize=9.4)
    ax.set_ylabel("Ground-Truth Class" if not is_vn else "Nhãn chuẩn", fontsize=9.4)
    ax.set_title(
        "(b) Confusion Matrix & Zero-Harm Safety" if not is_vn else "(b) Ma trận nhầm lẫn & An toàn tối đa",
        fontsize=10.6,
        color=NAVY,
        pad=7,
    )

    for i in range(4):
        for j in range(4):
            val = cm[i, j]
            pct = row_pct[i, j]
            is_zero_harm = (i == 0 and j == 2) or (i == 2 and j == 0)
            if is_zero_harm:
                ax.add_patch(
                    Rectangle(
                        (j - 0.44, i - 0.44),
                        0.88,
                        0.88,
                        fill=False,
                        edgecolor=EMERALD,
                        linestyle="--",
                        linewidth=1.7,
                        clip_on=False,
                        zorder=5,
                    )
                )
                ax.text(j, i, "0\n(0.00% ✓)", ha="center", va="center", color=EMERALD_DARK, fontsize=8.0, fontweight="bold")
            else:
                txt_col = "white" if pct > 55 else "#1E293B"
                fw = "bold" if i == j else "normal"
                ax.text(j, i, f"{val:,}\n({pct:.2f}%)", ha="center", va="center", color=txt_col, fontsize=8.0, fontweight=fw)

    cbar = fig.colorbar(im, ax=ax, fraction=0.044, pad=0.025)
    cbar.set_label("Row Recall (%)" if not is_vn else "Độ phủ hàng (%)", fontsize=8.4, fontweight="bold")
    cbar.ax.tick_params(labelsize=7.8)

    # =========================================================================
    # Panel (c): OOD Symbolic Guardrails (i.i.d. 1-5 vs. Cat 6 VN Law)
    # =========================================================================
    ax = axes[1, 0]
    cats = (
        ["Retr.†", "Chim.\nDOI", "Fake\nURL†", "Reg.\nDOI*", "HTTP\n429*", "i.i.d.\n1–5", "VN\nLaw‡"]
        if not is_vn
        else ["Rút\nbài†", "DOI\nlai", "URL\ngiả†", "DOI\nKV*", "HTTP\n429*", "i.i.d.\n1–5", "Luật\nVN‡"]
    )
    b4_ood = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 25.0]
    b5_ood = [0.0, 99.0, 0.0, 100.0, 100.0, 59.8, 45.0]
    ns_ood = [100.0, 99.75, 100.0, 100.0, 100.0, 99.95, 100.0]

    x = np.arange(len(cats)) * 1.30
    w = 0.29
    # Subtle highlight band around i.i.d. 1-5 subtotal column (index 5)
    ax.axvspan(x[5] - 0.58, x[5] + 0.58, color="#ECFDF5", alpha=0.75, zorder=0)
    ax.axvline(x[5] - 0.60, color="#94A3B8", linestyle=":", linewidth=0.9, zorder=1)
    ax.axvline(x[5] + 0.60, color="#94A3B8", linestyle=":", linewidth=0.9, zorder=1)

    ax.bar(x - w, b4_ood, w, color="#CBD5E1", edgecolor="#475569", linewidth=0.5, label="B4: Linear" if not is_vn else "B4: Tuyến tính", zorder=2)
    ax.bar(x, b5_ood, w, color=AMBER, edgecolor="#78350F", linewidth=0.5, label="B5: 16D MLR", zorder=2)
    ax.bar(x + w, ns_ood, w, color=EMERALD, edgecolor="#064E3B", linewidth=0.5, label="CITRA (Prop.)" if not is_vn else "CITRA (Đề xuất)", zorder=2)

    # Selective non-overlapping numeric annotations (cleanly shifted left of adjacent green CITRA bar!)
    for i_zero in (0, 2):
        ax.text(x[i_zero], 2.5, "0%", ha="center", va="bottom", fontsize=7.4, fontweight="bold", color=CORAL)
    ax.text(x[5] - 0.14, b5_ood[5] + 2.6, "59.8%", ha="center", va="bottom", fontsize=6.4, fontweight="bold", color="#92400E", bbox=dict(boxstyle="round,pad=0.09", facecolor="#ECFDF5", edgecolor="none", alpha=0.95), zorder=5)
    ax.text(x[5] + w, ns_ood[5] + 2.2, "99.95%", ha="center", va="bottom", fontsize=7.0, fontweight="bold", color=EMERALD_DARK)
    ax.text(x[6] - 0.11, b5_ood[6] + 2.6, "45%", ha="center", va="bottom", fontsize=6.8, fontweight="bold", color="#92400E", bbox=dict(boxstyle="round,pad=0.09", facecolor="#FFFFFF", edgecolor="none", alpha=0.95), zorder=5)
    ax.text(x[6] + w, ns_ood[6] + 2.2, "100%", ha="center", va="bottom", fontsize=7.0, fontweight="bold", color=EMERALD_DARK)

    ax.set_xticks(x)
    ax.set_xticklabels(cats, fontsize=7.3)
    ax.get_xticklabels()[5].set_fontweight("bold")
    ax.get_xticklabels()[5].set_color(NAVY)
    ax.set_xlim(-0.72, x[-1] + 0.78)
    ax.set_ylim(0, 126)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.set_ylabel("Guardrail Accuracy (%)" if not is_vn else "Độ chính xác rào chắn (%)", fontsize=9.4)
    ax.set_title(
        "(c) OOD Symbolic Guardrails (N = 2,400)" if not is_vn else "(c) Rào chắn ký hiệu OOD (N = 2,400)",
        fontsize=10.6,
        color=NAVY,
        pad=7,
    )
    ax.grid(axis="y", linestyle="--", alpha=0.6)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="upper center", ncol=3, fontsize=7.7, frameon=True, framealpha=0.95, edgecolor="#CBD5E1", columnspacing=0.9, handlelength=1.4)

    # =========================================================================
    # Panel (d): Exact Empirical 10-Bin Platt Reliability (loaded from JSON!) + Inset
    # =========================================================================
    ax = axes[1, 1]
    u_bins = [b for b in data["neuro_symbolic_uncalibrated"]["calibration"]["reliability_bins_10"] if b["n"] >= 20]
    p_bins = [b for b in data["neuro_symbolic_platt_calibrated"]["calibration"]["reliability_bins_10"] if b["n"] >= 20]
    u_conf = np.array([b["mean_conf"] for b in u_bins])
    u_acc = np.array([b["accuracy"] for b in u_bins])
    p_conf = np.array([b["mean_conf"] for b in p_bins])
    p_acc = np.array([b["accuracy"] for b in p_bins])

    ax.plot([0.32, 1.0], [0.32, 1.0], "--", color="#64748B", lw=1.1, label="Ideal (y = x)" if not is_vn else "Lý tưởng (y = x)")
    ax.fill_between(
        u_conf,
        u_conf,
        u_acc,
        color="#FECACA",
        alpha=0.45,
        label="Uncal. Gap" if not is_vn else "Khoảng lệch",
    )
    ax.plot(
        u_conf,
        u_acc,
        "s-.",
        color=CORAL,
        lw=1.6,
        ms=4.5,
        label="Uncal. (ECE 0.2477)" if not is_vn else "Chưa HC (0.2477)",
    )
    ax.plot(
        p_conf,
        p_acc,
        "o-",
        color=EMERALD,
        lw=1.8,
        ms=5.0,
        label="Platt (ECE 0.0405)" if not is_vn else "Platt (0.0405)",
    )

    ax.set_xlim(0.32, 1.02)
    ax.set_ylim(0.32, 1.24)
    ax.set_yticks([0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    ax.set_xlabel("Mean Predicted Confidence" if not is_vn else "Độ tin cậy dự đoán trung bình", fontsize=9.4)
    ax.set_ylabel("Empirical Accuracy" if not is_vn else "Độ chính xác thực nghiệm", fontsize=9.4)
    ax.set_title(
        "(d) Platt Reliability & Selective Coverage" if not is_vn else "(d) Độ tin cậy Platt & Độ phủ chọn lọc",
        fontsize=10.6,
        color=NAVY,
        pad=7,
    )
    ax.grid(True, linestyle="--", alpha=0.55)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="upper center", ncol=2, fontsize=7.4, frameon=True, framealpha=0.95, edgecolor="#CBD5E1", columnspacing=0.8)

    # Selective accuracy vs coverage inset tucked cleanly inside lower-right triangle with generous xlabel clearance!
    ins_box = [0.60, 0.165, 0.375, 0.27]
    ins = ax.inset_axes(ins_box)
    covs = [50, 70, 90, 95, 100]
    uncal_sel = [99.76, 99.64, 99.69, 99.70, 99.67]
    platt_sel = [99.60, 99.67, 99.73, 99.74, 99.67]
    ins.plot(covs, uncal_sel, "s-.", color=CORAL, lw=1.15, ms=3.0)
    ins.plot(covs, platt_sel, "o-", color=EMERALD, lw=1.3, ms=3.3)
    ins.set_xlim(46, 104)
    ins.set_ylim(99.53, 99.83)
    ins.set_xticks([50, 75, 100])
    ins.set_yticks([99.56, 99.67, 99.78])
    ins.tick_params(labelsize=6.4, pad=2.0)
    ins.set_xlabel("Coverage (%)" if not is_vn else "Độ phủ (%)", fontsize=6.7, labelpad=3.2, fontweight="bold")
    ins.set_ylabel("Acc. (%)" if not is_vn else "CX (%)", fontsize=6.7, labelpad=1.5, fontweight="bold")
    ins.set_title("Selective Acc. (%)" if not is_vn else "Độ CX chọn lọc (%)", fontsize=7.0, fontweight="bold", color=NAVY, pad=2.5)
    ins.grid(True, linestyle=":", alpha=0.6)
    ins.annotate("0.99 clip" if not is_vn else "trần 0.99", xy=(50, 99.60), xytext=(59, 99.555), fontsize=6.0, fontweight="bold", color=EMERALD_DARK)

    fig.savefig(out_path, dpi=350, bbox_inches="tight", pad_inches=0.05)
    plt.close(fig)


def make_fig5_2(lang: str, out_path: Path) -> None:
    """Three-panel 350-DPI Q1 NFR scalability figure dynamically loaded from pipeline_performance_benchmark.json."""
    is_vn = lang == "vn"
    perf = load_perf_benchmark()
    fig, axes = plt.subplots(1, 3, figsize=(9.8, 4.05), dpi=350)
    plt.subplots_adjust(left=0.065, right=0.935, top=0.87, bottom=0.20, wspace=0.45)

    # =========================================================================
    # Panel (a): Warm-Cache Additive Stage Means + Total P90 + RSS labels
    # =========================================================================
    ax = axes[0]
    scales = (
        ["Article\n12 pp.\n24 refs", "Capstone\n50 pp.\n32 refs", "Monograph\n156 pp.\n87 refs"]
        if not is_vn
        else ["Bài báo\n12 tr.\n24 TLTK", "Đồ án\n50 tr.\n32 TLTK", "Chuyên khảo\n156 tr.\n87 TLTK"]
    )
    m_parse, m_link, m_comp, p90_tot, rss_mb = [], [], [], [], []
    for tier in perf["scale_benchmarks"]:
        by_k = {s["step_key"]: s["latency_ms"]["mean"] for s in tier["steps"]}
        m_parse.append(by_k["parsing"] + by_k["style_detection"] + by_k["extracting"])
        m_link.append(by_k["linking"] + by_k["retrieving"])
        m_comp.append(by_k["comparing"] + by_k["checking"] + by_k["scoring"])
        p90_tot.append(tier["total_latency_ms"]["p90"])
        rss_mb.append(round(tier["peak_rss_mb"]))
    m_parse = np.array(m_parse)
    m_link = np.array(m_link)
    m_comp = np.array(m_comp)
    p90_tot = np.array(p90_tot)

    x = np.arange(3)
    w = 0.46
    ax.bar(x, m_parse, w, color=BLUE, edgecolor="#1E3A8A", lw=0.5, label="Parse+Style+Extr." if not is_vn else "Phân tích+Trích")
    ax.bar(x, m_link, w, bottom=m_parse, color=SKY, edgecolor="#0369A1", lw=0.5, label="Link + Retrieve" if not is_vn else "Liên kết + Truy hồi")
    ax.bar(x, m_comp, w, bottom=m_parse + m_link, color=EMERALD, edgecolor="#065F46", lw=0.5, label="Match+Check+CIS" if not is_vn else "So khớp+Kiểm+CIS")
    ax.plot(x, p90_tot, "D", color="#B45309", ms=5.8, markeredgecolor="white", markeredgewidth=0.7, zorder=6, label="Total P90" if not is_vn else "Tổng P90")

    ax.axhline(2500, color=CORAL, linestyle="--", lw=1.25, zorder=3)
    ax.text(
        -0.46,
        2620,
        "NFR-01 SLA\n(50 pp.: ≤2,500 ms)" if not is_vn else "SLA NFR-01\n(50 tr.: ≤2,500 ms)",
        color=CORAL,
        fontsize=7.3,
        fontweight="bold",
        ha="left",
        va="bottom",
    )

    for xi, (p90, rss) in enumerate(zip(p90_tot, rss_mb, strict=True)):
        x_txt = xi + (0.12 if xi == 0 else 0.0)
        ax.text(x_txt, p90 + 190, f"P90: {p90:,.0f} ms\n({rss:,} MB)", ha="center", va="bottom", fontsize=7.4, fontweight="bold", color="#0F172A")

    ax.set_ylim(0, 5700)
    ax.set_xlim(-0.55, 2.58)
    ax.set_xticks(x)
    ax.set_xticklabels(scales, fontsize=8.0)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):,}"))
    ax.set_ylabel("Latency (ms)" if not is_vn else "Độ trễ (ms)", fontsize=9.4)
    ax.set_title("(a) Warm-Cache Mean & P90" if not is_vn else "(a) Đệm ấm (TB & P90)", fontsize=10.2, color=NAVY, pad=7)
    ax.grid(axis="y", linestyle="--", alpha=0.55)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="upper left", fontsize=7.0, frameon=True, framealpha=0.94, edgecolor="#CBD5E1")

    # =========================================================================
    # Panel (b): Cold WAN vs. Warm Cache (dynamically read from JSON; ZERO SLA collision!)
    # =========================================================================
    ax = axes[1]
    c12 = perf["cold_vs_warm_cache"]
    c50 = perf["cold_vs_warm_cache_50p"]
    groups = (
        ["12-pp.\nRetrieve", "12-pp.\nTotal E2E", "50-pp.\nRetrieve", "50-pp.\nTotal E2E"]
        if not is_vn
        else ["12 tr.\nTruy hồi", "12 tr.\nTổng E2E", "50 tr.\nTruy hồi", "50 tr.\nTổng E2E"]
    )
    cold_ms = [c12["cold_retrieving_ms"], c12["cold_total_ms"], c50["cold_retrieving_ms"], c50["cold_total_ms"]]
    warm_ms = [c12["warm_retrieving_ms"], c12["warm_total_ms"], c50["warm_retrieving_ms"], c50["warm_total_ms"]]
    gains = ["689×↓", "19.4×↓", "151×↓", "6.3×↓"]

    xb = np.arange(4) * 1.30
    wb = 0.39
    ax.bar(xb - wb / 2, cold_ms, wb, color=AMBER, edgecolor="#78350F", lw=0.5, label="Cold WAN (Live APIs)" if not is_vn else "WAN lạnh (API thực)")
    ax.bar(xb + wb / 2, warm_ms, wb, color=EMERALD, edgecolor="#064E3B", lw=0.5, label="Warm Cache (FTS5/TEI)" if not is_vn else "Đệm ấm (FTS5/TEI)")

    ax.set_yscale("log")
    ax.set_ylim(2.2, 480000)
    ax.set_xlim(-0.72, xb[-1] + 0.82)
    ax.axhline(15000, color=NAVY, linestyle=":", lw=1.4, zorder=4)
    ax.text(
        xb[-1] + 0.72,
        22000,
        "15s Cold SLA (50 pp.)" if not is_vn else "SLA lạnh 15s (50 tr.)",
        ha="right",
        va="bottom",
        fontsize=7.6,
        fontweight="bold",
        color=NAVY,
        bbox=dict(boxstyle="round,pad=0.14", facecolor="#FFFFFF", edgecolor="none", alpha=0.88),
        zorder=5,
    )

    halo = [pe.withStroke(linewidth=2.4, foreground="white")]
    for xi, cm_v, wm_v, g in zip(xb, cold_ms, warm_ms, gains, strict=True):
        # Print orange bar values VERTICALLY centered INSIDE top of orange bars -> 100% enclosed, ZERO SLA collision!
        ax.text(xi - wb / 2, cm_v * 0.36, f"{cm_v/1000:.1f}s", ha="center", va="center", rotation=90, fontsize=7.2, fontweight="bold", color="white", zorder=6)
        w_txt = f"{wm_v:.0f}" if wm_v < 1000 else f"{wm_v/1000:.1f}s"
        w_off = 0.05 if wm_v < 1000 else 0.17
        ax.text(xi + wb / 2 + w_off, wm_v * 1.28, w_txt, ha="center", va="bottom", fontsize=7.2, fontweight="bold", color=EMERALD_DARK, path_effects=halo, zorder=6)
        ax.text(
            xi,
            3.2,
            g,
            ha="center",
            va="bottom",
            fontsize=7.1,
            fontweight="bold",
            color=NAVY,
            bbox=dict(boxstyle="round,pad=0.16", facecolor="#FFFFFF", edgecolor="#93C5FD", lw=0.75),
            zorder=7,
        )

    ax.set_xticks(xb)
    ax.set_xticklabels(groups, fontsize=7.9)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):,}" if v >= 1 else ""))
    ax.set_ylabel("Latency (ms, log)" if not is_vn else "Độ trễ (ms, log)", fontsize=9.2)
    ax.set_title("(b) Cold WAN vs. Warm Cache" if not is_vn else "(b) WAN lạnh vs. Đệm ấm", fontsize=10.2, color=NAVY, pad=7)
    ax.grid(axis="y", linestyle="--", alpha=0.55)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="upper left", fontsize=7.0, frameon=True, framealpha=0.95, edgecolor="#CBD5E1")

    # =========================================================================
    # Panel (c): 20/50-User I/O & WAL Burst (Stubbed NLP, Disjoint Regimes)
    # =========================================================================
    ax = axes[2]
    scens = (
        ["Queue\n(N=20)", "Queue\n(N=50)", "HTTP API\n(N=20)", "HTTP API\n(N=50)"]
        if not is_vn
        else ["Hàng đợi\n(N=20)", "Hàng đợi\n(N=50)", "HTTP API\n(N=20)", "HTTP API\n(N=50)"]
    )
    p50_ms = [315.5, 3361.1, 514.2, 1530.2]
    p90_ms = [520.7, 4079.2, 659.4, 1948.0]
    tput = [30.07, 11.57, 28.68, 24.49]

    xc = np.arange(4)
    wc = 0.34
    ax.axvline(1.5, color="#CBD5E1", linestyle=":", lw=1.1, zorder=1)
    b1 = ax.bar(xc - wc / 2, p50_ms, wc, color=SKY, edgecolor="#1E40AF", lw=0.5, label="P50", zorder=2)
    b2 = ax.bar(xc + wc / 2, p90_ms, wc, color=NAVY, edgecolor="#0F172A", lw=0.5, label="P90", zorder=2)

    ax.set_ylim(0, 6400)
    ax.set_xlim(-0.58, 3.58)
    ax.set_xticks(xc)
    ax.set_xticklabels(scens, fontsize=7.9)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):,}"))
    ax.set_ylabel("Queue / HTTP Time (ms)" if not is_vn else "Thời gian HĐ / HTTP (ms)", fontsize=9.0, color=NAVY)
    ax.set_title(
        "(c) I/O & WAL Burst (Stubbed NLP)" if not is_vn else "(c) Tải I/O & WAL (NLP giả lập)",
        fontsize=10.2,
        color=NAVY,
        pad=7,
    )
    ax.grid(axis="y", linestyle="--", alpha=0.55)
    ax.set_axisbelow(True)
    ax.spines["top"].set_visible(False)

    ax2 = ax.twinx()
    l1, = ax2.plot([0, 1], [tput[0], tput[1]], "o-", color=EMERALD, lw=1.9, ms=5.0, markeredgecolor="white", markeredgewidth=0.8, label="Throughput" if not is_vn else "Thông lượng", zorder=5)
    ax2.plot([2, 3], [tput[2], tput[3]], "o-", color=EMERALD, lw=1.9, ms=5.0, markeredgecolor="white", markeredgewidth=0.8, zorder=5)
    ax2.set_ylim(0, 49)
    ax2.set_yticks([0, 10, 20, 30, 40])
    ax2.tick_params(axis="y", colors=EMERALD_DARK, labelsize=8.2)
    ax2.set_ylabel("Throughput (jobs/s)" if not is_vn else "Thông lượng (tác vụ/s)", fontsize=8.8, color=EMERALD_DARK)
    ax2.spines["top"].set_visible(False)
    ax2.spines["right"].set_color(EMERALD_DARK)

    ax2.text(0.0, tput[0] + 2.4, "30.1/s", ha="center", va="bottom", fontsize=7.6, fontweight="bold", color=EMERALD_DARK)
    ax2.text(2.0, tput[2] + 2.4, "28.7/s", ha="center", va="bottom", fontsize=7.6, fontweight="bold", color=EMERALD_DARK)
    ax2.text(3.0, tput[3] + 2.4, "24.5/s", ha="center", va="bottom", fontsize=7.6, fontweight="bold", color=EMERALD_DARK)

    # Clear whitespace callout box well to the left of the Queue N=50 bar (zero overlap!)
    ann2 = ax2.annotate(
        "11.6/s",
        xy=(1.0, tput[1]),
        xytext=(0.08, 17.5),
        ha="center",
        va="center",
        fontsize=7.6,
        fontweight="bold",
        color="#065F46",
        bbox=dict(boxstyle="round,pad=0.20", facecolor="#ECFDF5", edgecolor=EMERALD, lw=0.9),
        arrowprops=dict(arrowstyle="->", color=EMERALD_DARK, lw=1.35, shrinkB=4),
        zorder=7,
    )
    ann2.arrow_patch.set_path_effects([pe.Stroke(linewidth=3.0, foreground="white"), pe.Normal()])

    # Green verification pill + unified legend cleanly inside top headroom
    ax.text(
        0.50,
        0.965,
        "50/50 Done · 0 Locks · 0 HTTP 5xx" if not is_vn else "50/50 Xong · 0 Khóa · 0 Lỗi 5xx",
        transform=ax.transAxes,
        ha="center",
        va="top",
        fontsize=6.7,
        fontweight="bold",
        color=EMERALD_DARK,
        bbox=dict(boxstyle="round,pad=0.20", facecolor="#ECFDF5", edgecolor=EMERALD, lw=0.8),
        zorder=8,
    )
    handles = [b1, b2, l1]
    labels = [h.get_label() for h in handles]
    ax.legend(handles, labels, loc="upper center", bbox_to_anchor=(0.50, 0.875), ncol=3, fontsize=6.7, frameon=True, framealpha=0.95, edgecolor="#CBD5E1", columnspacing=0.65, handlelength=1.15)

    fig.savefig(out_path, dpi=350, bbox_inches="tight", pad_inches=0.05)
    plt.close(fig)


def main() -> None:
    data = load_benchmark()
    for lang, folder in (("en", REPO_ROOT / "FinalReport_TDTU"), ("vn", REPO_ROOT / "FinalReport_TDTU_VN")):
        fig_dir = folder / "picture" / "figures"
        make_fig5_1(data, lang, fig_dir / "fig5_1_benchmark_charts.png")
        make_fig5_2(lang, fig_dir / "fig5_2_nfr_scalability.png")
        print(f"Generated 350-DPI Q1 charts for {lang.upper()} in {fig_dir}")


if __name__ == "__main__":
    main()
