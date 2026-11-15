from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

WAV_PATH = Path(__file__).resolve().parents[1] / "public" / "audio" / "soundtrack.wav"


def _read_24bit_stereo(path: Path) -> tuple[int, int, int, np.ndarray]:
    with wave.open(str(path), "rb") as w:
        nch = w.getnchannels()
        sw = w.getsampwidth()
        sr = w.getframerate()
        nf = w.getnframes()
        raw = np.frombuffer(w.readframes(nf), dtype=np.uint8).reshape(nf, nch, sw)

    pcm = (
        raw[:, :, 0].astype(np.int32)
        | (raw[:, :, 1].astype(np.int32) << 8)
        | (raw[:, :, 2].astype(np.int32) << 16)
    )
    # Sign-extend 24-bit signed PCM
    pcm = np.where(pcm & 0x800000, pcm - 0x1000000, pcm)
    samples = pcm.astype(np.float64) / float(2**23 - 1)
    return sr, nch, sw, samples


def test_soundtrack_is_exact_90s_48khz_24bit_stereo_with_full_act_coverage() -> None:
    assert WAV_PATH.exists(), f"Missing {WAV_PATH}"
    sr, nch, sw, samples = _read_24bit_stereo(WAV_PATH)

    assert sr == 48_000
    assert nch == 2
    assert sw == 3
    assert samples.shape == (4_320_000, 2), f"Expected 90.0s (4,320,000 frames), got {samples.shape}"

    peak = float(np.abs(samples).max())
    assert 0.70 <= peak <= 0.92, f"Expected normalized peak in [0.70, 0.92], got {peak:.4f}"

    # Verify every 15-second act window across all 90s has active musical energy (no dead air)
    for window_idx in range(6):
        a = window_idx * 15 * sr
        b = (window_idx + 1) * 15 * sr
        rms = float(np.sqrt(np.mean(samples[a:b] ** 2)))
        assert rms > 0.015, f"Window {window_idx * 15}-{(window_idx + 1) * 15}s is too quiet (RMS={rms:.5f})"

    # Verify clean master fade-out in final 100ms (zero pop/click at frame 10,800)
    tail_rms = float(np.sqrt(np.mean(samples[-int(0.1 * sr) :] ** 2)))
    assert tail_rms < 0.01, f"Expected clean tail fade (<0.01 RMS), got {tail_rms:.5f}"
