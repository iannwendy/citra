"""CITRA 90s · 120fps Keynote Spatial Cinema — Procedural 5-Act Score + Foley (48 kHz, 24-bit Stereo).

Synthesised 100% from first principles (zero external samples, royalty-free by construction)
and locked to src/timeline.json so every sub-drop, riser, whoosh, Loupe chime, API ping,
and Bento spotlight click lands frame-accurately on the 120 BPM musical grid.

Usage:  .venv/bin/python marketing/citra-promo/audio/make_music.py  -> public/audio/soundtrack.wav
"""

from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parents[1]
TL = json.loads((ROOT / "src" / "timeline.json").read_text())
SR = 48_000
DUR = float(TL["durationSec"])
N = int(SR * DUR)
BPM = float(TL["bpm"])
BEAT = 60.0 / BPM  # 0.5 s
BAR = BEAT * 4  # 2.0 s
rng = np.random.default_rng(2026)


# ----------------------------------------------------------------- DSP helpers
def t_arr(n: int) -> np.ndarray:
    return np.arange(n) / SR


def midi(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def place(buf: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0) -> None:
    """Mix mono or stereo clip `x` into stereo `buf` at `at` seconds."""
    i = int(round(at * SR))
    if i >= buf.shape[0] or i + x.shape[0] <= 0:
        return
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    j = min(buf.shape[0], i + x.shape[0])
    s = max(0, -i)
    buf[max(i, 0) : j] += gain * x[s : s + (j - max(i, 0))]


def lp(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    b, a = signal.butter(order, min(fc, SR / 2 - 120) / (SR / 2), "low")
    return signal.lfilter(b, a, x, axis=0)


def hp(x: np.ndarray, fc: float, order: int = 2) -> np.ndarray:
    b, a = signal.butter(order, max(16.0, fc) / (SR / 2), "high")
    return signal.lfilter(b, a, x, axis=0)


def bp(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    b, a = signal.butter(order, [max(20.0, lo) / (SR / 2), min(hi, SR / 2 - 120) / (SR / 2)], "band")
    return signal.lfilter(b, a, x, axis=0)


def saw(freq: float, n: int, phase: float = 0.0) -> np.ndarray:
    t = t_arr(n)
    return 2.0 * ((freq * t + phase) % 1.0) - 1.0


def adsr(n: int, a: float = 0.01, d: float = 0.1, s: float = 0.7, r: float = 0.2) -> np.ndarray:
    env = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    if na > 0:
        env[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    if nd > 0:
        env[na : na + nd] = np.linspace(1, s, nd, endpoint=False)
    if 0 < nr < n:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


def reverb_ir(seconds: float = 2.8, predelay: float = 0.022, damp: float = 3.1) -> np.ndarray:
    n = int(seconds * SR)
    t = t_arr(n)
    env = np.exp(-damp * t / seconds * 2.2)
    ir = rng.standard_normal((n, 2)) * env[:, None]
    ir = lp(ir, 6800)
    pd = np.zeros((int(predelay * SR), 2))
    ir = np.concatenate([pd, ir])
    ir /= np.sqrt((ir**2).sum(axis=0))
    return ir


IR_HALL = reverb_ir(2.8, 0.022, 3.1)
IR_ROOM = reverb_ir(1.05, 0.01, 3.2)


def reverb(x: np.ndarray, ir: np.ndarray = IR_HALL, mix: float = 0.28) -> np.ndarray:
    wet = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: x.shape[0]] for c in range(2)], axis=1)
    return x * (1.0 - mix) + wet * mix * 1.55


def delay_pingpong(x: np.ndarray, time_sec: float, fb: float = 0.33, mix: float = 0.24) -> np.ndarray:
    d = int(time_sec * SR)
    out = x.copy()
    tap = x.copy()
    for k in range(1, 6):
        shifted = np.zeros_like(x)
        if d * k < len(x):
            shifted[d * k :] = tap[: -d * k]
        g = fb**k
        if k % 2:
            out[:, 0] += shifted[:, 1] * g * mix
            out[:, 1] += shifted[:, 0] * g * mix
        else:
            out += shifted * g * mix
    return out


# ----------------------------------------------------------------- Instruments
def kick() -> np.ndarray:
    n = int(0.44 * SR)
    t = t_arr(n)
    f = 45.0 + 124.0 * np.exp(-t * 34.0)
    ph = 2.0 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.6)
    click = hp(rng.standard_normal(n), 3100) * np.exp(-t * 420.0) * 0.24
    return np.tanh((body + click) * 1.65) * 0.9


def clap() -> np.ndarray:
    n = int(0.34 * SR)
    t = t_arr(n)
    nz = bp(rng.standard_normal(n), 950, 4400)
    env = np.zeros(n)
    for off in (0.0, 0.011, 0.021):
        k = int(off * SR)
        env[k:] += np.exp(-t[: n - k] * 62.0) * 0.58
    env += np.exp(-t * 14.5) * 0.34
    return nz * env * 0.54


def hat(open_: bool = False) -> np.ndarray:
    n = int((0.24 if open_ else 0.058) * SR)
    t = t_arr(n)
    nz = hp(rng.standard_normal(n), 7600, 3)
    return nz * np.exp(-t * (14.5 if open_ else 78.0)) * 0.26


def pad_note(m: float, dur: float, bright: float = 1900.0) -> np.ndarray:
    n = int(dur * SR)
    out = np.zeros((n, 2))
    for c, det in enumerate((-0.09, 0.09)):
        v = np.zeros(n)
        for d in (-1, 0, 1):
            v += saw(midi(m + det + d * 0.055), n, phase=float(rng.random()))
        out[:, c] = v / 3.0
    out = lp(out, bright, 2)
    return out * adsr(n, 0.42, 0.38, 0.82, 0.68)[:, None] * 0.115


def bass_note(m: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = t_arr(n)
    f = midi(m)
    v = 0.58 * saw(f, n) + 0.62 * np.sin(2.0 * np.pi * (f / 2.0) * t)
    v = lp(v, 430, 2)
    return np.tanh(v * 1.45) * adsr(n, 0.005, 0.075, 0.76, 0.05) * 0.32


def pluck(m: float, dur: float = 0.38, pan: float = 0.0) -> np.ndarray:
    n = int(dur * SR)
    t = t_arr(n)
    f = midi(m)
    v = saw(f, n) * 0.55 + np.sin(2.0 * np.pi * f * t) * 0.5
    bright = lp(v, 5400)
    dark = lp(v, 920)
    k = np.exp(-t * 18.0)
    mono = (bright * k + dark * (1.0 - k)) * np.exp(-t * 7.2) * 0.155
    lg = np.sqrt(0.5 * (1.0 - np.clip(pan, -0.8, 0.8)))
    rg = np.sqrt(0.5 * (1.0 + np.clip(pan, -0.8, 0.8)))
    return np.stack([mono * lg * 1.4, mono * rg * 1.4], axis=1)


def piano(m: float, dur: float = 2.6, vel: float = 1.0) -> np.ndarray:
    n = int(dur * SR)
    t = t_arr(n)
    f = midi(m)
    v = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.44), (3, 0.21), (4, 0.11), (5, 0.05)):
        v += a * np.sin(2.0 * np.pi * f * h * t * (1.0 + 0.00035 * h)) * np.exp(-t * (1.15 + h * 0.88))
    v *= 1.0 - np.exp(-t * 420.0)
    return v * 0.145 * vel


# ----------------------------------------------------------------- Foley & SFX
def riser(dur: float = 2.0) -> np.ndarray:
    n = int(dur * SR)
    t = t_arr(n)
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 64
    for i in range(seg):
        a, b = i * n // seg, (i + 1) * n // seg
        fc = 380.0 + (i / seg) ** 2 * 9200.0
        out[a:b] = bp(nz, fc * 0.7, fc * 1.4)[a:b]
    sweep = np.sin(2.0 * np.pi * np.cumsum(170.0 + 940.0 * (t / dur) ** 2.2) / SR) * 0.16
    env = (t / dur) ** 2.3
    return (out * 0.48 + sweep) * env * 0.52


def impact() -> np.ndarray:
    n = int(2.8 * SR)
    t = t_arr(n)
    f = 36.0 + 74.0 * np.exp(-t * 9.5)
    boom = np.sin(2.0 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.95)
    crack = lp(rng.standard_normal(n), 2600) * np.exp(-t * 9.5) * 0.48
    return np.tanh((boom + crack) * 1.55) * 0.78


def whoosh(dur: float = 0.48) -> np.ndarray:
    n = int(dur * SR)
    t = t_arr(n)
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 24
    for i in range(seg):
        a, b = i * n // seg, (i + 1) * n // seg
        x = i / seg
        fc = 480.0 + 5200.0 * np.sin(np.pi * x) ** 1.5
        out[a:b] = bp(nz, fc * 0.6, fc * 1.6)[a:b]
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    st = np.stack([out * env * (1.0 - t / dur * 0.55), out * env * (0.45 + t / dur * 0.55)], axis=1)
    return st * 0.27


def laser_scan_sfx(dur: float = 0.42) -> np.ndarray:
    n = int(dur * SR)
    t = t_arr(n)
    f = 1400.0 * np.exp(-t * 2.4) + 320.0
    ph = 2.0 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) * np.sin(np.pi * np.clip(t / dur, 0, 1)) * 0.12
    air = bp(rng.standard_normal(n), 1800, 6200) * np.exp(-t * 8.0) * 0.08
    return tone + air


def glass_chime(root_midi: float = 79.0) -> np.ndarray:
    """Crystalline harmonic GlassLoupe / UI confirmation chime."""
    n = int(0.85 * SR)
    t = t_arr(n)
    f1 = midi(root_midi)
    f2 = midi(root_midi + 7)
    v = (
        0.65 * np.sin(2.0 * np.pi * f1 * t) * np.exp(-t * 5.2)
        + 0.45 * np.sin(2.0 * np.pi * f2 * t) * np.exp(-t * 6.8)
        + 0.22 * np.sin(2.0 * np.pi * f1 * 2.0 * t) * np.exp(-t * 10.0)
    )
    v *= 1.0 - np.exp(-t * 500.0)
    return np.stack([v * 0.16, np.roll(v, int(0.008 * SR)) * 0.16], axis=1)


def api_ping(m: float, pan: float) -> np.ndarray:
    n = int(0.28 * SR)
    t = t_arr(n)
    f = midi(m)
    v = np.sin(2.0 * np.pi * f * t) * np.exp(-t * 15.0) * (1.0 - np.exp(-t * 600.0)) * 0.11
    lg = np.sqrt(0.5 * (1.0 - pan))
    rg = np.sqrt(0.5 * (1.0 + pan))
    return np.stack([v * lg * 1.4, v * rg * 1.4], axis=1)


def bento_tick(pan: float) -> np.ndarray:
    n = int(0.09 * SR)
    t = t_arr(n)
    v = (
        np.sin(2.0 * np.pi * 1480.0 * t) * np.exp(-t * 65.0) * 0.12
        + hp(rng.standard_normal(n), 4200) * np.exp(-t * 220.0) * 0.08
    )
    lg = np.sqrt(0.5 * (1.0 - pan))
    rg = np.sqrt(0.5 * (1.0 + pan))
    return np.stack([v * lg * 1.4, v * rg * 1.4], axis=1)


def type_click() -> np.ndarray:
    n = int(0.028 * SR)
    t = t_arr(n)
    c = hp(rng.standard_normal(n), 2600) * np.exp(-t * 520.0)
    th = np.sin(2.0 * np.pi * 185.0 * t) * np.exp(-t * 210.0) * 0.48
    return (c + th) * (0.11 + 0.05 * float(rng.random()))


def glitch_burst(dur: float = 0.52) -> np.ndarray:
    n = int(dur * SR)
    out = np.zeros(n)
    i = 0
    while i < n:
        L = int(SR * float(rng.uniform(0.01, 0.045)))
        kind = int(rng.integers(0, 3))
        tt = t_arr(L)
        if kind == 0:
            seg = np.sign(np.sin(2.0 * np.pi * float(rng.uniform(90, 920)) * tt)) * 0.38
        elif kind == 1:
            seg = np.round(rng.standard_normal(L) * 2.2) / 6.0
        else:
            seg = np.zeros(L)
        out[i : i + L] = seg[: n - i]
        i += L
    out = lp(out, 7200)
    return np.stack([out * 0.44, -np.roll(out, 24) * 0.44], axis=1)


# ----------------------------------------------------------------- 5-Act Arrangement (90.0s = 45 bars)
music = np.zeros((N, 2))
drums = np.zeros((N, 2))
sfx = np.zeros((N, 2))
side = np.ones(N)

# Progression A (Acts I-IV): Fmaj7 - C/E - Am7 - G6
PROG_A = [
    [53, 57, 60, 64],
    [52, 55, 60, 64],
    [57, 60, 64, 67],
    [55, 59, 62, 67],
]
BASS_A = [41, 40, 45, 43]

# Progression B (Act V Climax 72-86s): Dm9 - Am7 - Fmaj7 - Gsus4/G (heroic lift)
PROG_B = [
    [50, 57, 60, 64],
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [55, 59, 62, 67],
]
BASS_B = [38, 45, 41, 43]

# --- ACT I: Hook (0-10s, bars 0..4) — Obsidian Forensic Tension
for at, m in [
    (0.0, 69),
    (1.5, 64),
    (2.5, 72),
    (4.0, 67),
    (5.2, 63),
    (6.4, 69),
    (7.2, 72),
    (8.0, 74),
    (8.8, 76),
]:
    place(music, piano(m, 2.6, 0.88), at)

drone_n = int(10.0 * SR)
td = t_arr(drone_n)
drone = (np.sin(2.0 * np.pi * midi(33) * td) + 0.45 * np.sin(2.0 * np.pi * midi(45) * td + 0.3)) * 0.08
drone *= np.clip(td / 2.2, 0, 1) * np.clip((10.0 - td) / 0.4, 0, 1)
place(music, drone, 0.0)
place(music, pad_note(57, 4.6, 950) * 0.85, 5.2)
place(music, pad_note(60, 4.6, 950) * 0.65, 5.2)
place(music, pad_note(64, 3.2, 1200) * 0.65, 6.8)
place(sfx, riser(2.0), 8.0, 0.92)


def bar_energy(t0: float) -> int:
    """Energy contour across bars 5..42 (10.0s .. 86.0s):
    0 = suspended atmospheric pad breath
    1 = warm pad + pulse kick + deep bass (Brand Reveal)
    2 = propulsive groove (+ hats & claps: Ingest)
    3 = intricate stereo arpeggio + 16th hats (Architecture, Hallucination, Retraction)
    4 = full ensemble + upper octave pad + open hats (Auto-Fix, Educator, Bento)
    5 = triumphant Act V Empirical Climax (+ lead octave piano motif: Ablation & Scale)
    """
    if t0 < 16.0:
        return 1  # 10-16s Brand Reveal
    if t0 < 22.0:
        return 2  # 16-22s Ingest
    if 28.0 <= t0 < 30.0:
        return 0  # 28-30s Breath into Act III
    if t0 < 44.0:
        return 3  # 22-28s Architecture & 30-44s Hallucination + Retraction
    if t0 < 50.0:
        return 2  # 44-50s Dual Trace crystalline focus
    if t0 < 70.0:
        return 4  # 50-70s AutoFix, Educator, Ecosystem Bento
    if t0 < 72.0:
        return 0  # 70-72s Pre-climax riser break
    if t0 < 80.0:
        return 5  # 72-80s 120K Ablation Climax
    if t0 < 86.0:
        return 3  # 80-86s Engineering Scale Monument
    return -1


kick_s, clap_s, hat_c, hat_o = kick(), clap(), hat(False), hat(True)

for bar in range(5, 43):
    t0 = bar * BAR
    e = bar_energy(t0)
    is_climax = t0 >= 72.0
    chord = (PROG_B if is_climax else PROG_A)[bar % 4]
    bass_m = (BASS_B if is_climax else BASS_A)[bar % 4]

    # Stereo harmonic pads
    for m in chord:
        place(music, pad_note(m, BAR + 0.55, 1450 + 520 * max(e, 1)), t0)
    if e >= 3:
        place(music, pad_note(chord[0] + 12, BAR + 0.55, 2800) * 0.52, t0)
    if e >= 5:
        place(music, pad_note(chord[2] + 12, BAR + 0.55, 3400) * 0.45, t0)
        # Heroic keynote piano motif on beats 1 and 2.5
        place(music, piano(chord[3] + 12, 1.8, 0.92), t0)
        place(music, piano(chord[2] + 12, 1.4, 0.78), t0 + 1.5 * BEAT)
        place(music, piano(chord[0] + 24, 1.6, 0.85), t0 + 3.0 * BEAT)

    if e == 0:
        continue

    # Bassline (8th notes)
    for k in range(8):
        oct_jump = 12 if (k % 4 == 3 and e >= 3) else 0
        place(music, bass_note(bass_m + oct_jump, BEAT / 2 * 0.88), t0 + k * BEAT / 2)

    # Drums & sidechain envelope
    for b in range(4):
        tb = t0 + b * BEAT
        place(drums, kick_s, tb, 0.96 if e >= 4 else 0.88)
        i0 = int(tb * SR)
        dk = int(0.27 * SR)
        seg_len = len(side[i0 : i0 + dk])
        if seg_len > 0:
            side[i0 : i0 + dk] = np.minimum(
                side[i0 : i0 + dk],
                0.36 + 0.64 * np.linspace(0, 1, seg_len) ** 0.82,
            )

        if e >= 2 and b in (1, 3):
            place(drums, clap_s, tb, 0.88)
        if e >= 2:
            place(drums, hat_c, tb + BEAT / 2, 0.88)
            if e >= 3:
                place(drums, hat_c, tb + BEAT / 4, 0.42)
                place(drums, hat_c, tb + 3 * BEAT / 4, 0.42)
        if e >= 4 and b == 3:
            place(drums, hat_o, tb + BEAT / 2, 0.68)

    # Stereo 16th-note arpeggiator
    if e >= 3:
        arp_notes = [
            chord[0] + 12,
            chord[1] + 12,
            chord[2] + 12,
            chord[3] + 12,
            chord[2] + 12,
            chord[1] + 12,
            chord[3] + 12,
            chord[2] + 24,
        ]
        for k in range(16):
            pan = 0.38 if (k % 2 == 0) else -0.38
            vel = 0.92 if (k % 4 == 0) else 0.64
            place(music, pluck(arp_notes[k % len(arp_notes)], 0.34, pan=pan), t0 + k * BEAT / 4, vel)

# --- Transitions & Snare Fills
place(sfx, riser(1.5), 20.5, 0.65)  # into 22s Dark Obsidian Architecture
place(sfx, riser(1.2), 28.8, 0.65)  # into 30s Hallucination Dive
place(sfx, riser(2.0), 70.0, 0.92)  # into 72s 120K Ablation Climax
for k in range(16):
    tt = 71.0 + k * (1.0 / 16.0)
    place(drums, clap_s * (0.25 + 0.75 * k / 16.0), tt, 0.72)

# --- ACT V Grand Finale (86.0s - 90.0s): Luminous Cmaj9 / Fmaj9 Resolve
for m in [48, 55, 60, 64, 67, 71]:
    place(music, pad_note(m, 3.85, 2400) * 0.92, 86.0)
for at, m in [(86.0, 72), (86.45, 76), (86.9, 79), (87.4, 84)]:
    place(music, piano(m, 2.3, 0.95), at)
place(music, bass_note(36, 2.6) * 1.15, 86.0)
place(drums, kick_s, 86.0, 1.0)

# --- Synchronized Foley Cues from timeline.json
sx = TL["sfx"]
for at in sx.get("laserScan", []):
    place(sfx, laser_scan_sfx(0.42), float(at), 0.95)

for key in ("typeA", "typeB", "typeC"):
    if key in sx:
        s = sx[key]
        for c in range(int(s["chars"])):
            jitter = float(rng.uniform(-0.0035, 0.0035))
            place(sfx, type_click(), float(s["start"]) + c / float(s["cps"]) + jitter)

place(sfx, glitch_burst(0.52), float(sx["glitch"]), 1.0)

for at in sx.get("impact", []):
    place(sfx, impact(), float(at), 1.0)

for at in sx.get("whoosh", []):
    place(sfx, whoosh(0.48), float(at), 0.88)

chime_scale = [79, 81, 84, 76, 79, 81, 84, 86, 88, 79, 84, 88]
for idx, at in enumerate(sx.get("chimes", [])):
    place(sfx, glass_chime(chime_scale[idx % len(chime_scale)]), float(at), 0.85)

ping_scale = [72, 74, 76, 79, 81, 84, 86, 88]
for idx, at in enumerate(sx.get("apiPings", [])):
    pan = -0.65 + 1.3 * ((idx * 37) % 15) / 14.0
    place(sfx, api_ping(ping_scale[idx % len(ping_scale)], pan), float(at), 0.82)

for idx, at in enumerate(sx.get("bentoTicks", [])):
    pan = -0.5 + (idx % 4) * (1.0 / 3.0)
    place(sfx, bento_tick(pan), float(at), 0.9)

if "ablationRiser" in sx:
    place(sfx, riser(1.6), float(sx["ablationRiser"]), 0.65)

if "endHit" in sx:
    place(sfx, glass_chime(84), float(sx["endHit"]) + 0.05, 0.9)

# ----------------------------------------------------------------- Master Bus & Export
music *= side[:, None]
music = delay_pingpong(music, BEAT * 0.75, 0.31, 0.21)
music = reverb(music, IR_HALL, 0.27)
drums = reverb(drums, IR_ROOM, 0.11)
sfx = reverb(sfx, IR_HALL, 0.19)

mix = music * 1.0 + drums * 0.84 + sfx * 0.88
mix = hp(mix, 28.0)

# Clean master fade-in (40ms) and smooth finale fade-out over last 1.45s so final 100ms < 0.01 RMS
tt = t_arr(N)
fade_out = np.clip((DUR - tt) / 1.45, 0.0, 1.0) ** 1.85
fade_in = np.clip(tt / 0.04, 0.0, 1.0)
mix *= (fade_in * fade_out)[:, None]

# Warm analog-style saturation & normalization to -1.0 dBFS (~0.891 peak)
mix = mix / (np.abs(mix).max() + 1e-9) * 1.38
mix = np.tanh(mix) / np.tanh(1.38)
mix *= 10.0 ** (-1.0 / 20.0)

out_dir = ROOT / "public" / "audio"
out_dir.mkdir(parents=True, exist_ok=True)
wav_file = out_dir / "soundtrack.wav"

pcm = (np.clip(mix, -1.0, 1.0) * (2**23 - 1)).astype(np.int32)
raw = np.zeros((N, 2, 3), dtype=np.uint8)
for b in range(3):
    raw[:, :, b] = (pcm >> (8 * b)) & 0xFF

with wave.open(str(wav_file), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(3)
    w.setframerate(SR)
    w.writeframes(raw.tobytes())

print(f"wrote {wav_file} ({DUR:.1f}s, {N} frames, peak={np.abs(mix).max():.4f})")
