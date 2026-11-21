#!/usr/bin/env python3
"""Ident radiowy w stylu nowojorskiego jazzu (6–7 s) — autorska kompozycja.

Trąbka, fortepian, kontrabas, sekcja dęta i perkusja grana miotełkami (perkusja syntetyzowana).
Próbki instrumentów: MusyngKite (gleitz/midi-js-soundfonts, CC BY-SA 3.0).
Użycie: python3 scripts/render-ident-jazz.py <katalog MusyngKite> <plik.mp3>
"""
import os, subprocess, sys
from functools import lru_cache
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

LIB, OUTFILE = sys.argv[1], sys.argv[2]
SR = 44100
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
PAN = {"trumpet": 0.0, "acoustic_grand_piano": -0.3, "acoustic_bass": 0.15, "alto_sax": -0.25, "tenor_sax": 0.25,
       "trombone": 0.35, "baritone_sax": 0.3}

BPM = 168
B = 60 / BPM                     # ćwierćnuta
def sw(beat):                    # swing: ósemka „na raz” 2/3, „na i” 1/3
    whole = int(beat); frac = beat - whole
    return (whole + (2 / 3 if abs(frac - 0.5) < 1e-6 else frac)) * B


def note_n(name):                # "F5" -> midi
    for i, n in sorted(enumerate(NAMES), key=lambda p: -len(p[1])):
        if name.startswith(n):
            return 12 * (int(name[len(n):]) + 1) + i
    raise ValueError(name)


@lru_cache(maxsize=None)
def sample(inst, midi):
    f = os.path.join(LIB, f"{inst}-mp3", f"{NAMES[midi % 12]}{midi // 12 - 1}.mp3")
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    nz = np.nonzero(np.abs(x) > 1e-3)[0]
    return x[nz[0]:] if len(nz) else x


class Mix:
    def __init__(self, sec):
        self.L = np.zeros(int(sec * SR)); self.R = np.zeros(int(sec * SR))

    def add(self, x, t, pan):
        i = int(t * SR)
        if i >= len(self.L) or i < 0:
            return
        n = min(len(x), len(self.L) - i)
        self.L[i:i + n] += x[:n] * np.cos((pan + 1) * np.pi / 4)
        self.R[i:i + n] += x[:n] * np.sin((pan + 1) * np.pi / 4)

    def play(self, inst, t, notes, dur, vel=1.0, rel=0.12, bend=0.0):
        notes = [note_n(n) if isinstance(n, str) else n for n in (notes if isinstance(notes, (list, tuple)) else [notes])]
        for m in notes:
            x = sample(inst, m)
            n, r = int(dur * SR), int(rel * SR)
            x = x[:n + r].copy()
            if len(x) > n:
                x[n:] *= np.linspace(1, 0, len(x) - n) ** 1.3
            if bend:  # „scoop” trąbki: podjazd od dołu do dźwięku
                k = int(0.06 * SR); idx = np.arange(len(x)).astype(float)
                ratio = 2 ** (bend * np.clip(1 - idx / k, 0, 1) / 12)
                pos = np.cumsum(ratio); pos = pos[pos < len(x) - 1]
                x = np.interp(pos, idx, x)
            self.add(x * vel / len(notes) ** 0.35, t, PAN.get(inst, 0))

    # --- perkusja grana miotełkami (synteza) ---
    def ride(self, t, vel=1.0):
        n = int(0.9 * SR); tt = np.arange(n) / SR
        x = sum(np.sign(np.sin(2 * np.pi * f * tt)) for f in (3120, 4340, 5210, 6890, 8130)) / 5
        x = sosfilt(butter(2, [3000, 12000], "bandpass", fs=SR, output="sos"), x + 0.4 * np.random.default_rng(int(t * 1e3)).standard_normal(n))
        x *= np.exp(-tt * 5) * (0.6 + 0.4 * np.exp(-tt * 40))
        self.add(x * vel * 0.05, t, 0.35)

    def brush(self, t, vel=1.0, length=0.22):
        n = int(length * SR); tt = np.arange(n) / SR
        x = sosfilt(butter(2, [900, 6000], "bandpass", fs=SR, output="sos"), np.random.default_rng(int(t * 1e3) + 5).standard_normal(n))
        env = np.sin(np.pi * np.clip(tt / length, 0, 1)) ** 1.5
        self.add(x * env * vel * 0.035, t - length * 0.4, -0.2)

    def tap(self, t, vel=1.0):
        n = int(0.18 * SR); tt = np.arange(n) / SR
        x = sosfilt(butter(2, [1200, 7000], "bandpass", fs=SR, output="sos"), np.random.default_rng(int(t * 1e3) + 9).standard_normal(n))
        x = x * np.exp(-tt * 28) + 0.35 * np.sin(2 * np.pi * 210 * tt) * np.exp(-tt * 35)
        self.add(x * vel * 0.12, t, -0.1)

    def kick(self, t, vel=1.0):
        n = int(0.3 * SR); tt = np.arange(n) / SR
        f = 48 + 40 * np.exp(-tt * 30)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
        self.add(x * vel * 0.35, t, 0)

    def crash(self, t, vel=1.0):
        n = int(2.0 * SR); tt = np.arange(n) / SR
        x = sum(np.sign(np.sin(2 * np.pi * f * tt)) for f in (2730, 3910, 5470, 7230)) / 4
        x = sosfilt(butter(2, 2500, "highpass", fs=SR, output="sos"), x * 0.5 + np.random.default_rng(42).standard_normal(n))
        x *= np.exp(-tt * 2.2) * (0.7 + 0.3 * np.exp(-tt * 20))
        self.add(x * vel * 0.045, t, 0.3); self.add(np.roll(x, 400) * vel * 0.035, t, -0.3)

    def master(self, length, peak=0.9):
        rng = np.random.default_rng(1)
        n = int(1.2 * SR); tt = np.arange(n) / SR
        lp = butter(1, 7000, "lowpass", fs=SR, output="sos")
        out = []
        for ch in (self.L, self.R):  # krótki, „klubowy” pogłos studia
            ir = sosfilt(lp, rng.standard_normal(n)) * np.exp(-tt * 5.5)
            ir = np.concatenate([np.zeros(int(0.012 * SR)), ir]); ir /= np.sqrt(np.sum(ir ** 2))
            out.append(ch + 0.32 * fftconvolve(ch, ir)[:len(ch)])
        st = np.stack(out, 1)[:int(length * SR)]
        # lekka kompresja i nasycenie — nowoczesne, „premium” brzmienie
        st /= np.max(np.abs(st)) + 1e-9
        st = np.tanh(st * 1.8) / np.tanh(1.8)
        f = int(0.35 * SR); st[-f:] *= (np.linspace(1, 0, f) ** 2)[:, None]
        return st * peak


# ---------------------------------------------------------------- partytura: F-dur, 168 BPM, swing
def compose():
    m = Mix(7.6)
    T, P, BASS = "trumpet", "acoustic_grand_piano", "acoustic_bass"

    # 0–2 s — motyw trąbki: śmiały, łatwy do zapamiętania (F – A – C – D – C – A … G – F)
    motif = [(0, "F5", .4, 0), (0.5, "A5", .4, 0), (1, "C6", .8, -2), (2, "D6", .35, 0), (2.5, "C6", .35, 0),
             (3, "A5", .7, 0), (4, "G5", .35, 0), (4.5, "F5", .9, -1)]
    for b, n, d, bend in motif:
        m.play(T, sw(b), n, d * B * 1.6, 1.5 if b in (1, 4.5) else 1.3, 0.1, bend)
    # fortepian akcentuje motyw akordami bez prymy (Fmaj9, Dm9 z antycypacją)
    m.play(P, sw(0), ["A3", "C4", "E4", "G4"], 0.35, 0.8)
    m.play(P, sw(2.5), ["F3", "A3", "C4", "E4"], 0.3, 0.7)
    m.play(P, sw(4.5), ["Bb3", "D4", "F4", "A4"], 0.4, 0.75)
    m.play(BASS, sw(0), "F2", 0.5, 1.0); m.play(BASS, sw(2.5), "D2", 0.5, 0.9); m.play(BASS, sw(4.5), "G2", 0.5, 0.9)
    m.kick(sw(0), 0.6); m.crash(sw(0), 0.12)
    for b in (1, 3):
        m.brush(sw(b), 0.8)
    for b in (0, 1, 1.5, 2, 3, 3.5):
        m.ride(sw(b), 0.6 if b % 1 else 0.85)

    # 2–5 s — fortepian odpowiada trąbce; walking bass i miotełki w swingu
    run = [(5.5, "A5"), (6, "C6"), (6.5, "D6"), (7, "F6"), (7.5, "E6"), (8, "D6"), (8.5, "C6"), (9, "A5"),
           (9.5, "Ab5"), (10, "G5"), (10.5, "F5"), (11, "D5"), (11.5, "F5"), (12, "A5")]
    for b, n in run:
        m.play(P, sw(b), n, 0.22, 0.95 if b % 1 == 0 else 0.75, 0.15)
    comp = [(6, ["Bb3", "D4", "F4", "A4"]), (7.5, ["Bb3", "E4", "A4", "D5"]), (9, ["A3", "C4", "E4", "G4"]),
            (10.5, ["Gb3", "C4", "Eb4", "A4"]), (12, ["Bb3", "D4", "F4", "A4"])]
    for b, ch in comp:
        m.play(P, sw(b), ch, 0.3, 0.6)
    walk = ["F2", "G2", "A2", "C3", "A2", "Bb2", "D2", "G2"]       # ćwierćnuty, takty 2–3
    for k, n in enumerate(walk):
        m.play(BASS, sw(5 + k), n, B * 0.95, 0.95, 0.08)
    for b in np.arange(5, 13, 1.0):
        m.ride(sw(b), 0.85); m.ride(sw(b + 0.5), 0.55) if int(b) % 2 == 1 else None
        if int(b) % 2 == 0:
            m.brush(sw(b), 0.9); m.kick(sw(b), 0.25)
    # trąbka dorzuca krótkie odpowiedzi w pauzach fortepianu
    m.play(T, sw(8.5), "D6", 0.18, 0.5, 0.08); m.play(T, sw(9), "C6", 0.25, 0.55, 0.1)
    # przejście: triola werbla miotełką
    for k in range(3):
        m.tap(sw(12) + k * B / 3 * 2, 0.6 + 0.2 * k)
    m.tap(sw(13), 1.0)

    # 5–7 s — finał całego zespołu: „da-DAH!” z ostrym akcentem blachy (C7#9 → Gb13 → F6/9)
    horns = {"trumpet": [("C7#9", ["A5"]), ("Gb13", ["Ab5"]), ("F69", ["A5", "C6"])],
             "alto_sax": [("C7#9", ["Eb5"]), ("Gb13", ["Eb5"]), ("F69", ["G5"])],
             "tenor_sax": [("C7#9", ["Bb4"]), ("Gb13", ["Bb4"]), ("F69", ["D5"])],
             "trombone": [("C7#9", ["E4"]), ("Gb13", ["E4"]), ("F69", ["A4"])],
             "baritone_sax": [("C7#9", ["C3"]), ("Gb13", ["Gb2"]), ("F69", ["F2"])]}
    hits = {"C7#9": (13.5, 0.2), "Gb13": (14.5, 0.2), "F69": (15, 1.45)}
    for inst, parts in horns.items():
        for chord, notes in parts:
            b, d = hits[chord]
            m.play(inst, sw(b), notes, d if chord != "F69" else d, 1.0 if chord == "F69" else 0.85, 0.25 if chord == "F69" else 0.06,
                   -1.5 if inst == "trumpet" and chord == "F69" else 0)
    m.play(T, sw(15) + 0.9, "F6", 0.45, 0.75, 0.35)          # wysoki „dzwonek” trąbki na koniec
    m.play(P, sw(13.5), ["Bb3", "E4", "Eb5"], 0.18, 0.7)
    m.play(P, sw(14.5), ["Bb3", "E4", "Ab4", "Eb5"], 0.18, 0.75)
    m.play(P, sw(15), ["F2", "A3", "D4", "G4", "C5", "F5"], 1.4, 1.0, 0.5)
    m.play(BASS, sw(13.5), "C2", 0.2, 0.9); m.play(BASS, sw(14.5), "Gb2", 0.2, 0.9); m.play(BASS, sw(15), "F1", 1.3, 1.1, 0.4)
    m.kick(sw(13.5), 0.7); m.kick(sw(14.5), 0.7); m.kick(sw(15), 1.0)
    m.tap(sw(13.5), 1.0); m.tap(sw(14.5), 1.1)
    m.crash(sw(15), 0.45)
    return m, sw(15) + 1.55


if __name__ == "__main__":
    mix, length = compose()
    st = mix.master(length)
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-b:a", "256k", OUTFILE], input=pcm, check=True)
    print(OUTFILE, f"{len(st) / SR:.2f} s")
