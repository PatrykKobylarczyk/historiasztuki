#!/usr/bin/env python3
"""Dżingiel KULTURA — autorska polka na orkiestrę, renderowana z próbek instrumentów.

Próbki: MusyngKite (gleitz/midi-js-soundfonts, licencja CC BY-SA 3.0).
Użycie:  python3 scripts/render-jingle.py <katalog MusyngKite> <katalog wyjściowy>
Wynik:   jingle.mp3, outro.mp3, sting.mp3 (stereo, 44,1 kHz).
"""
import os, subprocess, sys
from functools import lru_cache
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

LIB, OUT = sys.argv[1], sys.argv[2]
SR = 44100
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# panorama jak na estradzie: skrzypce z lewej, basy z prawej, dęte w środku
PAN = {"violin": -0.35, "string_ensemble_1": -0.15, "pizzicato_strings": -0.25, "flute": 0.1, "piccolo": 0.15,
       "clarinet": 0.25, "trumpet": 0.05, "brass_section": 0.0, "trombone": 0.3, "french_horn": -0.3, "tuba": 0.35,
       "contrabass": 0.45, "timpani": 0.2, "glockenspiel": -0.1, "accordion": -0.05}


@lru_cache(maxsize=None)
def sample(inst, midi):
    f = os.path.join(LIB, f"{inst}-mp3", f"{NAMES[midi % 12]}{midi // 12 - 1}.mp3")
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).copy()
    nz = np.nonzero(np.abs(x) > 1e-3)[0]  # obcięcie ciszy na początku próbki
    return x[nz[0]:] if len(nz) else x


class Score:
    def __init__(self, seconds):
        self.L = np.zeros(int(seconds * SR)); self.R = np.zeros(int(seconds * SR)); self.gain = 1.0

    def add(self, mono, t, pan=0.0):
        i = int(t * SR)
        if i >= len(self.L):
            return
        n = min(len(mono), len(self.L) - i)
        gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.L[i:i + n] += mono[:n] * gl; self.R[i:i + n] += mono[:n] * gr

    def note(self, inst, t, midi, dur, vel=1.0, rel=0.18):
        if isinstance(midi, (list, tuple)):
            for m in midi:
                self.note(inst, t, m, dur, vel / len(midi) ** 0.35, rel)
            return
        x = sample(inst, midi)
        n, r = int(dur * SR), int(rel * SR)
        x = x[:n + r].copy()
        if len(x) > n:
            x[n:] *= np.linspace(1, 0, len(x) - n)
        self.add(x * vel * self.gain, t, PAN.get(inst, 0))

    def noise(self, t, dur, vel, kind="snare"):
        n = int(dur * SR)
        rng = np.random.default_rng(int(t * 1000) + 7)
        x = rng.standard_normal(n)
        env = np.exp(-np.arange(n) / SR * (30 if kind == "snare" else 3.2))
        sos = butter(2, 1800 if kind == "snare" else 4500, "highpass", fs=SR, output="sos")
        x = sosfilt(sos, x) * env
        if kind == "snare":
            x += 0.5 * np.sin(2 * np.pi * 185 * np.arange(n) / SR) * np.exp(-np.arange(n) / SR * 40)
        if kind == "swell":  # talerz smyczkiem / crescendo do kulminacji
            x = sosfilt(sos, rng.standard_normal(n)) * np.linspace(0, 1, n) ** 2.5
        self.add(x * vel * 0.12 * self.gain, t, -0.2 if kind != "snare" else 0.1)

    def roll(self, t, midi, dur, vel0, vel1):  # tremolo kotłów
        k, step = 0, 0.055
        while k * step < dur:
            v = vel0 + (vel1 - vel0) * (k * step / dur)
            self.note("timpani", t + k * step, midi, 0.2, v * 0.32, 0.12); k += 1

    def render(self, peak=0.89):
        L, R = self.L, self.R
        # pogłos sali koncertowej: szum z wykładniczym zanikiem, lekko przyciemniony
        rng = np.random.default_rng(3)
        n = int(1.9 * SR); tt = np.arange(n) / SR
        lp = butter(1, 5200, "lowpass", fs=SR, output="sos")
        irL = sosfilt(lp, rng.standard_normal(n)) * np.exp(-tt * 3.6)
        irR = sosfilt(lp, rng.standard_normal(n)) * np.exp(-tt * 3.6)
        pre = int(0.022 * SR)
        irL = np.concatenate([np.zeros(pre), irL]); irR = np.concatenate([np.zeros(pre), irR])
        irL /= np.sqrt(np.sum(irL ** 2)); irR /= np.sqrt(np.sum(irR ** 2))
        wetL = fftconvolve(L, irL)[:len(L)]; wetR = fftconvolve(R, irR)[:len(R)]
        mix = 0.22
        L, R = L + mix * wetL * 2.2, R + mix * wetR * 2.2
        st = np.stack([L, R], 1)
        st /= np.max(np.abs(st)) + 1e-9
        st = np.tanh(st * 1.6) / np.tanh(1.6)  # miękkie nasycenie, gęstsze brzmienie
        f = int(0.25 * SR)
        st[-f:] *= np.linspace(1, 0, f)[:, None]
        return st * peak


def save(score, name):
    st = score.render()
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-b:a", "192k", os.path.join(OUT, f"{name}.mp3")], input=pcm, check=True)
    print(name, f"{len(st) / SR:.2f} s")


# ---------------------------------------------------------------- partytura
Q = 0.375          # ćwierćnuta (160 BPM), takt 2/4 = 0,75 s
E = Q / 2
G, D7, C, Am = [55, 59, 62], [54, 57, 60], [52, 55, 60], [52, 57, 60]
HARM = [(43, 50, G), (43, 50, G), (38, 45, D7), (38, 45, D7), (43, 50, G), (36, 45, Am), (38, 45, D7), (43, 50, G)]
# melodia w ósemkach: (pozycja, midi, długość)
MEL = [(0, 74, 1), (1, 71, 1), (2, 67, 1), (3, 71, 1), (4, 74, 2), (6, 76, 1), (7, 74, 1),
       (8, 72, 1), (9, 69, 1), (10, 66, 1), (11, 69, 1), (12, 72, 2), (14, 74, 1), (15, 72, 1),
       (16, 71, 1), (17, 74, 1), (18, 79, 1), (19, 74, 1), (20, 76, 1), (21, 72, 1), (22, 69, 1), (23, 72, 1),
       (24, 74, 1), (25, 78, 1), (26, 81, 1), (27, 78, 1), (28, 79, 2)]
# druga głos klarnetu — tercje / seksty pod melodią
COUNTER = {74: 71, 71: 67, 67: 64, 76: 72, 72: 69, 69: 66, 66: 62, 79: 74, 81: 78, 78: 74}


def oompah(s, t0, harm, vel=1.0):
    for k, (root, fifth, ch) in enumerate(harm):
        t = t0 + k * 2 * Q
        s.note("tuba", t, root, E * 0.9, 0.75 * vel); s.note("contrabass", t, root, E * 0.9, 0.35 * vel)
        s.note("tuba", t + Q, fifth, E * 0.9, 0.65 * vel); s.note("contrabass", t + Q, fifth, E * 0.9, 0.3 * vel)
        for off in (E, Q + E):
            s.note("pizzicato_strings", t + off, ch, E, 0.75 * vel)
            s.note("french_horn", t + off, [m + 12 for m in ch], E * 0.8, 0.35 * vel, 0.1)
            s.noise(t + off, 0.15, 0.2 * vel)


def melody(s, t0, mel, vel=1.0):
    for pos, m, d in mel:
        t, dur = t0 + pos * E, d * E * 0.88
        s.note("violin", t, m, dur, 0.95 * vel, 0.12)
        s.note("string_ensemble_1", t, m, dur, 0.45 * vel, 0.12)
        s.note("flute", t, m + 12, dur, 0.42 * vel, 0.1)
        s.note("clarinet", t, COUNTER.get(m, m - 3), dur, 0.42 * vel, 0.1)
        if d >= 2 or pos % 8 == 0:
            s.note("glockenspiel", t, m + 12, 0.3, 0.28 * vel, 0.4)


def finale(s, t):
    """„pa-PAM!” — dominanta i tonika całą orkiestrą, kotły i talerz."""
    s.gain = 0.75
    s.note("brass_section", t, [62, 66, 69, 72], E * 0.9, 1.0, 0.08)
    s.note("string_ensemble_1", t, [62, 66, 72, 78], E * 0.9, 0.7, 0.08)
    s.note("tuba", t, 38, E * 0.9, 0.9); s.note("timpani", t, 50, 0.3, 0.9)
    s.noise(t, 0.15, 0.9)
    T = t + Q
    s.note("brass_section", T, [55, 59, 62, 67, 71], 1.15, 1.25, 0.6)
    s.note("trumpet", T, 79, 1.15, 0.7, 0.6)
    s.note("string_ensemble_1", T, [55, 62, 67, 71, 74, 79], 1.2, 0.9, 0.7)
    s.note("violin", T, 83, 1.2, 0.7, 0.6); s.note("flute", T, 86, 1.0, 0.4, 0.5)
    s.note("tuba", T, 31, 1.1, 1.0, 0.6); s.note("contrabass", T, 31, 1.1, 0.5, 0.6)
    s.note("glockenspiel", T, 91, 0.6, 0.4, 0.8)
    s.roll(T, 43, 0.9, 0.5, 0.9); s.note("timpani", T + 0.95, 43, 0.6, 1.0, 0.5)
    s.noise(T, 2.0, 0.4, "crash")
    s.gain = 1.0
    return T + 1.2


def jingle():
    s = Score(11.6)
    # wstęp: kotły na dominancie i fanfara blachy „ta-ta-ta-TAM”
    s.roll(0.0, 50, 2 * Q, 0.25, 0.8)
    s.noise(0.0, 2 * Q, 0.25, "swell")
    for k, m in enumerate([62, 67, 71]):
        s.note("brass_section", Q + k * (Q / 3), [m - 12, m], Q / 3 * 0.85, 0.9, 0.05)
    t0 = 2 * Q
    s.note("brass_section", t0, [55, 62, 67, 74], E * 0.9, 1.0, 0.05)
    s.noise(t0, 1.2, 0.2, "crash")
    # temat
    melody(s, t0, MEL)
    oompah(s, t0, HARM)
    # trąbki dorzucają odpowiedzi w pauzach melodii
    for pos, m in [(5, 79), (13, 78)]:
        s.note("trumpet", t0 + pos * E, m, E * 0.8, 0.5, 0.08)
    end = finale(s, t0 + 16 * Q)
    s.L, s.R = s.L[:int((end + 1.3) * SR)], s.R[:int((end + 1.3) * SR)]
    save(s, "jingle")


def outro():
    s = Score(4.2)
    # zbieg skrzypiec i fletu do dominanty, potem finał
    for k, m in enumerate([81, 78, 74, 72, 69, 66, 62, 66]):
        s.note("violin", k * (E / 2), m, E / 2 * 0.85, 0.85, 0.06)
        s.note("flute", k * (E / 2), m + 12, E / 2 * 0.85, 0.35, 0.06)
    s.note("pizzicato_strings", 0, [50, 57, 60, 66], E, 0.7)
    end = finale(s, 2 * Q)
    s.L, s.R = s.L[:int((end + 1.2) * SR)], s.R[:int((end + 1.2) * SR)]
    save(s, "outro")


def sting():
    s = Score(1.9)
    for k, m in enumerate([74, 78, 79]):
        last = k == 2
        s.note("glockenspiel", k * E, m + 12, 0.5 if last else E, 0.45, 0.5)
        s.note("flute", k * E, m + 12, E * (2 if last else 0.8), 0.45, 0.2)
        s.note("violin", k * E, m, E * (2 if last else 0.8), 0.7, 0.2)
    s.note("pizzicato_strings", 2 * E, [43, 55, 59, 62, 67], 0.3, 0.9)
    s.note("french_horn", 2 * E, [67, 71], 0.5, 0.35, 0.3)
    s.note("timpani", 2 * E, 43, 0.4, 0.5, 0.4)
    save(s, "sting")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    jingle(); outro(); sting()
