#!/usr/bin/env python3
"""Dżingiel KULTURA — autorska fanfara symfoniczna (w duchu Mahlera), renderowana z próbek orkiestry.

Próbki: MusyngKite (gleitz/midi-js-soundfonts, licencja CC BY-SA 3.0).
Użycie:  python3 scripts/render-jingle.py <katalog MusyngKite> <katalog wyjściowy>
Wynik:   jingle.mp3 (~10 s), outro.mp3, sting.mp3 (stereo, 44,1 kHz).
"""
import os, subprocess, sys
from functools import lru_cache
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

LIB, OUT = sys.argv[1], sys.argv[2]
SR = 44100
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# ustawienie orkiestry na estradzie (−1 lewo, +1 prawo)
PAN = {"violin": -0.45, "string_ensemble_1": -0.2, "string_ensemble_2": 0.2, "tremolo_strings": -0.1, "viola": 0.1,
       "cello": 0.35, "contrabass": 0.5, "flute": -0.1, "oboe": 0.05, "clarinet": 0.15, "bassoon": 0.2,
       "french_horn": -0.35, "trumpet": 0.1, "trombone": 0.3, "tuba": 0.4, "brass_section": 0.05,
       "timpani": 0.25, "orchestral_harp": -0.55, "choir_aahs": 0.0, "glockenspiel": -0.15, "alto_sax": 0.3, "tenor_sax": 0.4, "reverse_cymbal": 0.0}


@lru_cache(maxsize=None)
def sample(inst, midi):
    f = os.path.join(LIB, f"{inst}-mp3", f"{NAMES[midi % 12]}{midi // 12 - 1}.mp3")
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    nz = np.nonzero(np.abs(x) > 1e-3)[0]
    return x[nz[0]:] if len(nz) else x


def sustain(x, n):
    """Przedłuża próbkę instrumentu o długim dźwięku przez nakładanie fragmentów z fazy wybrzmiewania."""
    if n <= len(x) - int(0.4 * SR):
        return x
    a, b, xf = int(0.5 * SR), int(2.2 * SR), int(0.35 * SR)
    seg = x[a:b]
    L = len(seg)
    fi = np.sqrt(np.linspace(0, 1, xf)); fo = fi[::-1]
    out = np.zeros(n + len(x) + L)
    out[:b] = x[:b]
    pos = b - xf
    out[pos:b] *= fo
    while pos < n:
        piece = seg.copy(); piece[:xf] *= fi; piece[-xf:] *= fo
        out[pos:pos + L] += piece
        pos += L - xf
    tail = x[b:].copy()
    tail[:xf] *= fi[:len(tail[:xf])]
    out[pos:pos + len(tail)] += tail
    return out


class Score:
    def __init__(self, seconds):
        self.L = np.zeros(int(seconds * SR)); self.R = np.zeros(int(seconds * SR))

    def add(self, mono, t, pan=0.0):
        i = int(t * SR)
        if i >= len(self.L):
            return
        n = min(len(mono), len(self.L) - i)
        gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.L[i:i + n] += mono[:n] * gl; self.R[i:i + n] += mono[:n] * gr

    def note(self, inst, t, midi, dur, vel=1.0, rel=0.4, cresc=None):
        """cresc=(v0, v1): narastanie lub wyciszanie dynamiki w trakcie dźwięku."""
        if isinstance(midi, (list, tuple)):
            for m in midi:
                self.note(inst, t, m, dur, vel / len(midi) ** 0.4, rel, cresc)
            return
        n, r = int(dur * SR), int(rel * SR)
        x = sustain(sample(inst, midi), n + r)[:n + r].copy()
        if cresc:
            env = np.full(len(x), cresc[1] ** 1.6)
            env[:min(n, len(x))] = (np.linspace(cresc[0], cresc[1], n) ** 1.6)[:len(x)]
            x *= env
        if len(x) > n:
            x[n:] *= np.linspace(1, 0, len(x) - n) ** 1.5
        self.add(x * vel, t, PAN.get(inst, 0))

    def roll(self, t, midi, dur, v0, v1, step=0.06):  # tremolo kotłów
        k = 0
        while k * step < dur:
            v = v0 + (v1 - v0) * (k * step / dur)
            self.note("timpani", t + k * step, midi, 0.18, v * 0.3, 0.15); k += 1

    def crash(self, t, vel=1.0, length=3.5):
        n = int(length * SR)
        rng = np.random.default_rng(int(t * 100) + 1)
        tt = np.arange(n) / SR
        x = sosfilt(butter(2, 3200, "highpass", fs=SR, output="sos"), rng.standard_normal(n))
        x = x * (np.exp(-tt * 1.6) * 0.8 + np.exp(-tt * 12) * 0.6) * (1 + 0.15 * np.sin(2 * np.pi * 7 * tt))
        self.add(x * vel * 0.05, t, -0.25); self.add(np.roll(x, 300) * vel * 0.05, t, 0.25)

    def render(self, peak=0.9, fade=0.4):
        rng = np.random.default_rng(3)
        n = int(2.8 * SR); tt = np.arange(n) / SR
        lp = butter(1, 4800, "lowpass", fs=SR, output="sos")
        irs = []
        for _ in range(2):  # pogłos dużej sali koncertowej
            ir = sosfilt(lp, rng.standard_normal(n)) * np.exp(-tt * 2.5)
            ir = np.concatenate([np.zeros(int(0.03 * SR)), ir]); irs.append(ir / np.sqrt(np.sum(ir ** 2)))
        wetL = fftconvolve(self.L, irs[0])[:len(self.L)]; wetR = fftconvolve(self.R, irs[1])[:len(self.R)]
        st = np.stack([self.L + 0.55 * wetL, self.R + 0.55 * wetR], 1)
        st /= np.max(np.abs(st)) + 1e-9
        st = np.tanh(st * 1.4) / np.tanh(1.4)
        f = int(fade * SR)
        st[-f:] *= (np.linspace(1, 0, f) ** 2)[:, None]
        return st * peak


def save(score, name):
    st = score.render()
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-b:a", "192k", os.path.join(OUT, f"{name}.mp3")], input=pcm, check=True)
    print(name, f"{len(st) / SR:.2f} s")


# ---------------------------------------------------------------- partytura (D-dur)
HORN_CALL = [(0.0, 57, 0.42), (0.45, 62, 0.62), (1.08, 64, 0.2), (1.3, 66, 0.42), (1.75, 69, 1.3)]  # A–D–E–F#–A


def horn_call(s, t0, shift=0, inst="french_horn", vel=0.9):
    for dt, m, d in HORN_CALL:
        s.note(inst, t0 + dt, [m + shift, m + shift - 12], d, vel, 0.35)


def climax(s, T, hold=3.2):
    """Kulminacja: zawieszenie kwarty (Dsus4) rozwiązane do D-dur całą orkiestrą."""
    s.note("reverse_cymbal", T - 2.1, 74, 2.1, 0.45, 0.02)
    s.crash(T, 1.0, hold + 1.5)
    s.note("timpani", T, 38, 0.6, 1.0, 0.6); s.note("timpani", T, 50, 0.6, 0.6, 0.6)
    # blacha: sus4 → tercja
    s.note("brass_section", T, [50, 57, 62, 67, 69, 74], 0.7, 1.3, 0.15)
    s.note("brass_section", T + 0.7, [50, 57, 62, 66, 69, 74], hold - 0.7, 1.35, 1.2, (1.0, 0.8))
    s.note("trumpet", T, 81, 0.7, 0.55, 0.1); s.note("trumpet", T + 0.7, 86, hold - 0.7, 0.5, 1.0, (1.0, 0.7))
    s.note("french_horn", T, [62, 67, 69], 0.7, 0.8, 0.15)
    s.note("french_horn", T + 0.7, [62, 66, 69], hold - 0.7, 0.85, 1.0, (1.0, 0.75))
    s.note("tuba", T, 26, hold, 0.9, 1.0, (1.0, 0.7)); s.note("trombone", T, [38, 45, 50], hold, 0.8, 1.0, (1.0, 0.7))
    # smyczki oktawami i chór
    s.note("string_ensemble_1", T, [50, 62, 67, 74, 79, 86], 0.7, 1.1, 0.15)
    s.note("string_ensemble_1", T + 0.7, [50, 62, 66, 74, 78, 86], hold - 0.7, 1.15, 1.4, (1.0, 0.8))
    s.note("violin", T + 0.7, [90, 86], hold - 0.7, 0.55, 1.4, (1.0, 0.75))
    s.note("contrabass", T, 26, hold, 0.7, 1.2); s.note("cello", T, [38, 50], hold, 0.6, 1.2)
    s.note("choir_aahs", T, [62, 67, 69, 74], 0.7, 0.7, 0.2)
    s.note("choir_aahs", T + 0.7, [62, 66, 69, 74, 78], hold - 0.7, 0.75, 1.4, (1.0, 0.8))
    # kotły: uderzenia i tremolo pod wybrzmiewającym akordem
    for k, dt in enumerate([0.7, 1.05, 1.4]):
        s.note("timpani", T + dt, 38 if k % 2 == 0 else 45, 0.5, 0.75, 0.5)
    s.roll(T + 1.6, 38, hold - 1.8, 0.7, 0.25)
    s.note("orchestral_harp", T + 0.7, [74, 78, 81, 86], 1.2, 0.35, 1.0)
    s.note("glockenspiel", T + 0.7, [90, 93], 0.8, 0.25, 1.0)
    # solo trąbki nad wybrzmiewającym akordem: echo zewu (A – D – F# – A)
    for dt, m, d in [(1.3, 69, 0.3), (1.62, 74, 0.3), (1.94, 78, 0.3), (2.26, 81, 1.1)]:
        s.note("trumpet", T + dt, m, d, 0.7, 0.5)
    # saksofon dokłada miękką sekstę do akordu końcowego
    s.note("alto_sax", T + 0.7, 71, hold - 0.9, 0.35, 1.0, (0.4, 0.9))


def jingle():
    s = Score(10.6)
    # 0–2,4 s: szept smyczków w tremolo, odległe kotły i zew waltorni
    s.note("tremolo_strings", 0.0, [38, 50, 57], 2.6, 0.8, 0.6, (0.3, 0.75))
    s.note("contrabass", 0.0, 26, 2.6, 0.35, 0.5, (0.2, 0.6))
    s.roll(0.0, 38, 2.4, 0.35, 0.75)
    horn_call(s, 0.35, 0, vel=1.25)
    # 2,4–5,0 s: rozkwit harmonii — h-moll, G-dur, Es-dur (zaskoczenie), A7
    prog = [(2.4, 47, [59, 62, 66, 71]), (3.05, 43, [59, 62, 67, 71]), (3.7, 39, [58, 63, 67, 70]), (4.35, 45, [61, 64, 67, 69])]
    for k, (t, bass, ch) in enumerate(prog):
        v = 0.55 + 0.15 * k
        s.note("string_ensemble_1", t, ch, 0.66, v, 0.35, (0.8, 1.0))
        s.note("string_ensemble_2", t, [m + 12 for m in ch], 0.66, v * 0.6, 0.35)
        s.note("cello", t, [bass, bass + 12], 0.66, v * 0.8, 0.3)
        s.note("contrabass", t, bass - 12 if bass > 40 else bass, 0.66, v * 0.6, 0.3)
        s.note("french_horn", t, ch[1:3], 0.66, v * 0.55, 0.3)
        s.note("choir_aahs", t, ch, 0.66, v * 0.45, 0.35)
    # trąbki odpowiadają motywem waltorni oktawę wyżej — wyraźniej, jako solo
    horn_call(s, 2.45, 12, "trumpet", vel=0.75)
    # saksofony: ciepła, śpiewna linia pod rozkwitem harmonii (F# – G – G – A)
    for t, m, low, d in [(2.4, 66, 62, 0.62), (3.05, 67, 62, 0.62), (3.7, 67, 63, 0.62), (4.35, 69, 64, 0.6)]:
        s.note("alto_sax", t, m, d, 0.55, 0.25, (0.7, 1.0))
        s.note("tenor_sax", t, low, d, 0.4, 0.25, (0.7, 1.0))
    s.note("timpani", 3.7, 39, 0.4, 0.7, 0.5)
    # 4,35–5,0 s: wzlot drewna i glissando harfy przed kulminacją
    for k, m in enumerate([69, 71, 73, 74, 76, 78, 79, 81, 83, 85]):
        t = 4.35 + k * 0.062
        s.note("flute", t, m + 12, 0.08, 0.4, 0.06); s.note("clarinet", t, m, 0.08, 0.35, 0.06)
        s.note("oboe", t, m, 0.08, 0.2, 0.06)
    for k, m in enumerate([57, 61, 64, 67, 69, 73, 76, 79, 81, 85, 88, 91]):
        s.note("orchestral_harp", 4.4 + k * 0.05, m, 0.5, 0.35, 0.6)
    s.roll(4.35, 45, 0.65, 0.5, 1.0, 0.045)
    # 5,0–10 s: kulminacja i wybrzmienie
    climax(s, 5.0, 3.9)
    save(s, "jingle")


def outro():
    s = Score(5.2)
    # krótki zew waltorni i kadencja A7 – D z kotłami
    for dt, m, d in [(0.0, 69, 0.4), (0.42, 66, 0.4), (0.84, 62, 0.8)]:
        s.note("french_horn", dt, [m, m - 12], d, 0.8, 0.4)
    s.note("string_ensemble_1", 0.0, [57, 61, 64, 67], 1.6, 0.6, 0.4, (0.5, 0.9))
    s.note("cello", 0.0, [45, 57], 1.6, 0.5, 0.3)
    s.note("orchestral_harp", 1.7, [50, 57, 62, 66, 69, 74, 78], 1.4, 0.4, 1.0)
    s.note("brass_section", 1.7, [50, 57, 62, 66, 69], 2.0, 1.0, 1.2, (1.0, 0.6))
    s.note("string_ensemble_1", 1.7, [50, 62, 66, 69, 74, 78], 2.2, 1.0, 1.2, (1.0, 0.6))
    s.note("choir_aahs", 1.7, [62, 66, 69, 74], 2.2, 0.6, 1.2, (1.0, 0.6))
    s.note("contrabass", 1.7, 26, 2.2, 0.6, 1.0); s.note("timpani", 1.7, 38, 0.6, 0.9, 0.6)
    s.roll(2.2, 38, 1.4, 0.6, 0.15)
    s.crash(1.7, 0.5, 3.0)
    save(s, "outro")


def sting():
    s = Score(2.4)
    # zew waltorni na tle akordu harfy — przerywnik między rozdziałami
    s.note("french_horn", 0.0, [57, 45], 0.3, 0.7, 0.3)
    s.note("french_horn", 0.32, [62, 50], 0.9, 0.75, 0.6, (1.0, 0.6))
    for k, m in enumerate([50, 57, 62, 66, 69, 74]):
        s.note("orchestral_harp", 0.32 + k * 0.04, m, 0.9, 0.4, 0.8)
    s.note("string_ensemble_1", 0.32, [62, 66, 69], 1.0, 0.45, 0.6, (0.6, 0.3))
    s.note("timpani", 0.32, 38, 0.4, 0.4, 0.4)
    save(s, "sting")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    jingle(); outro(); sting()
