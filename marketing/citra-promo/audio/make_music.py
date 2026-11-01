"""CITRA promo — procedural soundtrack + SFX (48 kHz, stereo, 24-bit WAV).

Everything is synthesised from scratch (royalty-free by construction) and
locked to src/timeline.json so that hits/whooshes land on the scene cuts.

Usage:  python3 audio/make_music.py  -> public/audio/soundtrack.wav
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
DUR = TL["durationSec"] + 0.0
N = int(SR * DUR)
BPM = TL["bpm"]
BEAT = 60.0 / BPM  # 0.5 s
BAR = BEAT * 4  # 2.0 s
rng = np.random.default_rng(7)


# ----------------------------------------------------------------- helpers
def t_arr(n: int) -> np.ndarray:
    return np.arange(n) / SR


def midi(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0) -> None:
    """Mix mono/stereo clip x into stereo buf at time `at` seconds."""
    i = int(at * SR)
    if i >= buf.shape[0] or i + x.shape[0] <= 0:
        return
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    j = min(buf.shape[0], i + x.shape[0])
    s = max(0, -i)
    buf[max(i, 0):j] += gain * x[s : s + (j - max(i, 0))]


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR / 2 - 100) / (SR / 2), "low")
    return signal.lfilter(b, a, x, axis=0)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x, axis=0)


def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], "band")
    return signal.lfilter(b, a, x, axis=0)


def saw(freq, n, phase=0.0):
    t = t_arr(n)
    return 2.0 * ((freq * t + phase) % 1.0) - 1.0


def adsr(n, a=0.01, d=0.1, s=0.7, r=0.2):
    env = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    env[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    env[na : na + nd] = np.linspace(1, s, nd, endpoint=False)
    if nr > 0 and nr < n:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


def reverb_ir(seconds=2.6, predelay=0.02, damp=3.2):
    n = int(seconds * SR)
    t = t_arr(n)
    env = np.exp(-damp * t / seconds * 2.2)
    ir = rng.standard_normal((n, 2)) * env[:, None]
    ir = lp(ir, 6500)
    pd = np.zeros((int(predelay * SR), 2))
    ir = np.concatenate([pd, ir])
    ir /= np.sqrt((ir**2).sum(axis=0))
    return ir


IR = reverb_ir()
IR_SHORT = reverb_ir(1.1, 0.01, 3.0)


def reverb(x, ir=IR, mix=0.3):
    wet = np.stack([signal.fftconvolve(x[:, c], ir[:, c])[: x.shape[0]] for c in range(2)], axis=1)
    return x * (1 - mix) + wet * mix * 1.6


def delay_pingpong(x, time, fb=0.35, mix=0.3):
    d = int(time * SR)
    out = x.copy()
    tap = x.copy()
    for k in range(1, 6):
        shifted = np.zeros_like(x)
        shifted[d * k :] = tap[: -d * k] if d * k < len(x) else 0
        g = fb**k
        if k % 2:
            out[:, 0] += shifted[:, 1] * g * mix
            out[:, 1] += shifted[:, 0] * g * mix
        else:
            out += shifted * g * mix
    return out


# ----------------------------------------------------------------- instruments
def kick():
    n = int(0.45 * SR)
    t = t_arr(n)
    f = 46 + 120 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t * 400) * 0.25
    return np.tanh((body + click) * 1.6) * 0.9


def clap():
    n = int(0.35 * SR)
    t = t_arr(n)
    nz = bp(rng.standard_normal(n), 900, 4200)
    env = np.zeros(n)
    for off in (0.0, 0.011, 0.022):
        k = int(off * SR)
        env[k:] += np.exp(-t[: n - k] * 60) * 0.6
    env += np.exp(-t * 14) * 0.35
    return nz * env * 0.55


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    t = t_arr(n)
    nz = hp(rng.standard_normal(n), 7500, 3)
    return nz * np.exp(-t * (14 if open_ else 75)) * 0.28


def pad_note(m, dur, bright=1800):
    n = int(dur * SR)
    out = np.zeros((n, 2))
    for c, det in enumerate((-0.09, 0.09)):
        v = np.zeros(n)
        for d in (-1, 0, 1):
            v += saw(midi(m + det + d * 0.06), n, phase=rng.random())
        out[:, c] = v / 3
    out = lp(out, bright, 2)
    return out * adsr(n, 0.45, 0.4, 0.8, 0.7)[:, None] * 0.12


def bass_note(m, dur):
    n = int(dur * SR)
    t = t_arr(n)
    f = midi(m)
    v = 0.6 * saw(f, n) + 0.6 * np.sin(2 * np.pi * f / 2 * t)
    v = lp(v, 420, 2)
    return np.tanh(v * 1.4) * adsr(n, 0.005, 0.08, 0.75, 0.05) * 0.32


def pluck(m, dur=0.4):
    n = int(dur * SR)
    t = t_arr(n)
    f = midi(m)
    v = saw(f, n) * 0.6 + np.sin(2 * np.pi * f * t) * 0.5
    # time-varying brightness via two-band crossfade
    bright = lp(v, 5200)
    dark = lp(v, 900)
    k = np.exp(-t * 18)
    v = bright * k + dark * (1 - k)
    return v * np.exp(-t * 7) * 0.16


def piano(m, dur=2.5, vel=1.0):
    n = int(dur * SR)
    t = t_arr(n)
    f = midi(m)
    v = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.45), (3, 0.22), (4, 0.12), (5, 0.06)):
        v += a * np.sin(2 * np.pi * f * h * t * (1 + 0.0004 * h)) * np.exp(-t * (1.2 + h * 0.9))
    v *= 1 - np.exp(-t * 400)
    return v * 0.14 * vel


def riser(dur=2.0):
    n = int(dur * SR)
    t = t_arr(n)
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 64
    for i in range(seg):
        a, b = i * n // seg, (i + 1) * n // seg
        fc = 400 + (i / seg) ** 2 * 9000
        out[a:b] = bp(nz, fc * 0.7, fc * 1.4)[a:b]
    sweep = np.sin(2 * np.pi * np.cumsum(180 + 900 * (t / dur) ** 2.2) / SR) * 0.15
    env = (t / dur) ** 2.4
    return (out * 0.5 + sweep) * env * 0.5


def impact():
    n = int(2.8 * SR)
    t = t_arr(n)
    f = 38 + 70 * np.exp(-t * 9)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.0)
    crack = lp(rng.standard_normal(n), 2500) * np.exp(-t * 9) * 0.5
    return np.tanh((boom + crack) * 1.5) * 0.75


def whoosh(dur=0.5):
    n = int(dur * SR)
    t = t_arr(n)
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    seg = 24
    for i in range(seg):
        a, b = i * n // seg, (i + 1) * n // seg
        x = i / seg
        fc = 500 + 5000 * np.sin(np.pi * x) ** 1.5
        out[a:b] = bp(nz, fc * 0.6, fc * 1.6)[a:b]
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    st = np.stack([out * env * (1 - t / dur * 0.6), out * env * (0.4 + t / dur * 0.6)], axis=1)
    return st * 0.28


def type_click():
    n = int(0.03 * SR)
    t = t_arr(n)
    c = hp(rng.standard_normal(n), 2500) * np.exp(-t * 500)
    th = np.sin(2 * np.pi * 180 * t) * np.exp(-t * 200) * 0.5
    return (c + th) * (0.12 + 0.06 * rng.random())


def glitch(dur=0.55):
    n = int(dur * SR)
    out = np.zeros(n)
    i = 0
    while i < n:
        L = int(SR * rng.uniform(0.01, 0.05))
        kind = rng.integers(0, 3)
        tt = t_arr(L)
        if kind == 0:
            seg = np.sign(np.sin(2 * np.pi * rng.uniform(80, 900) * tt)) * 0.4
        elif kind == 1:
            seg = rng.standard_normal(L) * 0.35
            seg = np.round(seg * 6) / 6
        else:
            seg = np.zeros(L)
        out[i : i + L] = seg[: n - i]
        i += L
    out = lp(out, 7000)
    return out * 0.45


# ----------------------------------------------------------------- arrangement
music = np.zeros((N, 2))
drums = np.zeros((N, 2))
sfx = np.zeros((N, 2))
side = np.ones(N)  # sidechain gain

# A minor / C major progression (per bar): Fmaj7 - C/E - Am7 - G
PROG = [
    [53, 57, 60, 64],  # F A C E
    [52, 55, 60, 64],  # E G C E (C/E)
    [57, 60, 64, 67],  # A C E G
    [55, 59, 62, 67],  # G B D G
]
BASS = [41, 40, 45, 43]

# --- intro (0-10s): sparse piano + low drone; tension
for i, (at, m) in enumerate([(0.0, 69), (2.0, 64), (3.0, 72), (5.2, 63), (6.0, 69), (7.0, 64), (8.0, 65), (9.0, 67)]):
    place(music, piano(m, 2.8, 0.9), at)
drone = np.zeros(int(10 * SR))
td = t_arr(len(drone))
drone = (np.sin(2 * np.pi * midi(33) * td) + 0.4 * np.sin(2 * np.pi * midi(45) * td + 0.3)) * 0.07
drone *= np.clip(td / 3, 0, 1) * np.clip((10 - td) / 0.5, 0, 1)
place(music, drone, 0.0)
place(music, pad_note(57, 4.8, 900) * 0.8, 5.2)
place(music, pad_note(60, 4.8, 900) * 0.6, 5.2)
place(music, pad_note(64, 4.8, 900) * 0.5, 7.0)
place(sfx, riser(2.0), 8.0, 0.9)

# --- main body (10s - 56s): bars 5..27 (0-indexed bar = t/2)
def section_energy(t):
    if t < 18:
        return 1  # kick + pad + bass
    if 28 <= t < 30:
        return 0  # breath (pad only)
    if t < 32:
        return 2  # + hats + claps
    if t < 48:
        return 3  # + arp
    if t < 56:
        return 4  # full
    return -1


kick_s, clap_s, hat_c, hat_o = kick(), clap(), hat(), hat(True)
for bar in range(5, 28):
    t0 = bar * BAR
    e = section_energy(t0)
    chord = PROG[bar % 4]
    # pad
    for m in chord:
        place(music, pad_note(m, BAR + 0.6, 1400 + 600 * max(e, 0)), t0)
    if e >= 3:
        place(music, pad_note(chord[0] + 12, BAR + 0.6, 2600) * 0.5, t0)
    if e == 0:
        continue
    # bass: 8ths
    for k in range(8):
        place(music, bass_note(BASS[bar % 4] + (12 if (k % 4 == 3 and e >= 3) else 0), BEAT / 2 * 0.9), t0 + k * BEAT / 2)
    # drums
    for b in range(4):
        tb = t0 + b * BEAT
        if not (bar == 23 and b >= 2):  # drop kick for fill before 48s
            place(drums, kick_s, tb, 0.95)
            i0 = int(tb * SR)
            dk = int(0.28 * SR)
            side[i0 : i0 + dk] = np.minimum(side[i0 : i0 + dk], 0.35 + 0.65 * np.linspace(0, 1, len(side[i0 : i0 + dk])) ** 0.8)
        if e >= 2 and b in (1, 3):
            place(drums, clap_s, tb, 0.9)
        if e >= 2:
            place(drums, hat_c, tb + BEAT / 2, 0.9)
            if e >= 3:
                place(drums, hat_c, tb + BEAT / 4, 0.45)
                place(drums, hat_c, tb + 3 * BEAT / 4, 0.45)
        if e >= 4 and b == 3:
            place(drums, hat_o, tb + BEAT / 2, 0.7)
    # arp: 16ths
    if e >= 3:
        notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[3] + 12, chord[2] + 12, chord[1] + 12, chord[3] + 12, chord[2] + 24]
        for k in range(16):
            place(music, pluck(notes[k % len(notes)], 0.35), t0 + k * BEAT / 4, 0.9 if k % 4 == 0 else 0.65)

# snare-roll fill into the drop at 48s (bar 23 second half)
for k in range(16):
    tt = 46 + 1.0 + k * (1.0 / 16)
    place(drums, clap_s * (0.25 + 0.75 * k / 16), tt, 0.7)
place(sfx, riser(2.0), 46.0, 0.8)
# small fill at 28s breath
place(sfx, riser(1.0), 29.0, 0.5)

# --- ending (56-60): final chord + piano, reverb tail
for m in [53, 57, 60, 64, 69]:
    place(music, pad_note(m, 4.0, 2200) * 0.9, 56.0)
for at, m in [(56.0, 72), (56.5, 76), (57.0, 79), (57.5, 84)]:
    place(music, piano(m, 3.5, 0.9), at)
place(music, bass_note(41, 2.5) * 1.2, 56.0)
place(drums, kick_s, 56.0, 1.0)

# --- SFX
sx = TL["sfx"]
for key in ("typeA", "typeB"):
    s = sx[key]
    for c in range(s["chars"]):
        place(sfx, type_click(), s["start"] + c / s["cps"] + rng.uniform(-0.004, 0.004))
place(sfx, glitch(), sx["glitch"], 1.0)
for at in sx["impact"]:
    place(sfx, impact(), at, 1.0)
for at in sx["whoosh"]:
    place(sfx, whoosh(0.5), at, 0.9)
place(sfx, impact() * 0.7, sx["endHit"], 1.0)

# ----------------------------------------------------------------- mix
music *= side[:, None]
music = delay_pingpong(music, BEAT * 0.75, 0.32, 0.22)
music = reverb(music, IR, 0.28)
drums = reverb(drums, IR_SHORT, 0.12)
sfx = reverb(sfx, IR, 0.2)
mix = music * 1.0 + drums * 0.85 + sfx * 0.9
mix = hp(mix, 28)

# master fade out tail
tt = t_arr(N)
fade = np.clip((DUR - tt) / 1.6, 0, 1) ** 1.5
mix *= fade[:, None]
fade_in = np.clip(tt / 0.05, 0, 1)
mix *= fade_in[:, None]

# glue: soft clip + normalise to -1 dBFS
mix = mix / (np.abs(mix).max() + 1e-9) * 1.4
mix = np.tanh(mix) / np.tanh(1.4)
mix *= 10 ** (-1.0 / 20)

out = ROOT / "public" / "audio"
out.mkdir(parents=True, exist_ok=True)
pcm = (np.clip(mix, -1, 1) * (2**23 - 1)).astype(np.int32)
raw = np.zeros((N, 2, 3), dtype=np.uint8)
for b in range(3):
    raw[:, :, b] = (pcm >> (8 * b)) & 0xFF
with wave.open(str(out / "soundtrack.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(3)
    w.setframerate(SR)
    w.writeframes(raw.tobytes())
print("wrote", out / "soundtrack.wav", f"{DUR:.1f}s")
