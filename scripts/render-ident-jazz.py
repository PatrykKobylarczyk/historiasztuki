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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drums import hit

LIB, OUTFILE = sys.argv[1], sys.argv[2]
SR = 44100
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
PAN = {"trumpet": 0.0, "acoustic_grand_piano": -0.3, "acoustic_bass": 0.15, "alto_sax": -0.25, "tenor_sax": 0.25,
       "trombone": 0.35, "baritone_sax": 0.3, "muted_trumpet": 0.3}
PAN["tenor_sax"] = 0.2; PAN["alto_sax"] = -0.15

WINDS = {"trumpet", "muted_trumpet", "trombone", "alto_sax", "tenor_sax", "baritone_sax"}
BREATH = butter(2, [900, 5000], "bandpass", fs=SR, output="sos")
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
        self.rng = np.random.default_rng(1950)
        self.events = []   # zapis nut do eksportu MIDI: (instrument, czas, midi, długość, głośność)
        self.SL = np.zeros(int(sec * SR)); self.SR_ = np.zeros(int(sec * SR))   # osobna szyna solisty

    def add(self, x, t, pan, solo=False):
        i = int(t * SR)
        if i >= len(self.L) or i < 0:
            return
        L, R = (self.SL, self.SR_) if solo else (self.L, self.R)
        n = min(len(x), len(L) - i)
        L[i:i + n] += x[:n] * np.cos((pan + 1) * np.pi / 4)
        R[i:i + n] += x[:n] * np.sin((pan + 1) * np.pi / 4)

    def play(self, inst, t, notes, dur, vel=1.0, rel=0.12, bend=0.0, players=1, vib=0.0, spread=0.25, solo=False):
        """Gra jak żywi muzycy: każdy z `players` ma własne drobne przesunięcie w czasie, dynamikę i strój."""
        notes = [note_n(n) if isinstance(n, str) else n for n in (notes if isinstance(notes, (list, tuple)) else [notes])]
        for m in notes:
            self.events.append(("solo_" + inst if solo else inst, t, m, dur, min(1.0, vel)))
            for p in range(players):
                rng = self.rng
                dt = rng.normal(0, 0.009) + (0.006 * p)
                cents = rng.normal(0, 4) if players > 1 or vib else rng.normal(0, 1.5)
                v = vel * rng.uniform(0.9, 1.08) / len(notes) ** 0.35 / players ** 0.55
                x = sample(inst, m)
                n, r = int(dur * SR), int(rel * SR)
                x = x[:int((n + r) * 1.05) + 10].copy()
                idx = np.arange(len(x)).astype(float)
                semis = np.full(len(x), cents / 100)
                if bend:  # „scoop”: podjazd od dołu do dźwięku
                    k = int(0.06 * SR); semis += bend * np.clip(1 - idx / k, 0, 1)
                if vib:   # wibrato pojawiające się po chwili, jak u dętego
                    tt = idx / SR; semis += vib * np.clip((tt - 0.15) / 0.2, 0, 1) * np.sin(2 * np.pi * 5.4 * tt + rng.uniform(0, 6))
                pos = np.cumsum(2 ** (semis / 12)); pos = pos[pos < len(x) - 1]
                x = np.interp(pos, idx, x)[:n + r]
                if inst in WINDS:
                    pk = np.max(np.abs(x[:int(0.1 * SR)])) + 1e-9
                    # naturalny atak dętego: krótki podmuch powietrza i „zadęcie” na początku dźwięku
                    k = int(0.035 * SR); tb = np.arange(k) / SR
                    br = sosfilt(BREATH, rng.standard_normal(k)) * np.exp(-tb * 90) * pk * (0.10 if "sax" in inst else 0.07)
                    x[:k] += br[:len(x[:k])]
                    if dur > 0.4:  # długi dźwięk: lekkie crescendo w trakcie, jak u żywego muzyka
                        sw_ = np.ones(len(x)); nn = min(n, len(x))
                        sw_[:nn] = 0.86 + 0.14 * np.sin(np.linspace(0, np.pi / 2, nn))
                        x *= sw_
                if len(x) > n:
                    x[n:] *= np.exp(-np.arange(len(x) - n) / SR / max(rel / 3, 0.02))
                pan = PAN.get(inst, 0) + (p - (players - 1) / 2) * spread
                self.add(x * v, t + dt, 0.0 if solo else float(np.clip(pan, -0.9, 0.9)), solo)

    # --- perkusja: prawdziwe próbki zestawu Gretsch (miotełki, ride, stopa) ---
    def ride(self, t, vel=1.0):
        self.events.append(("drums", t, 51, 0.1, min(1.0, vel)))
        t += self.rng.normal(0, 0.005); vel *= self.rng.uniform(0.85, 1.1)
        self.add(hit("ride", 1.0, 0.3) * vel * 0.13, t, 0.35)

    def brush(self, t, vel=1.0, length=0.22):
        self.events.append(("drums", t, 40, 0.1, min(1.0, vel)))
        t += self.rng.normal(0, 0.006)
        self.add(hit("brush_ghost", 0.5) * vel * 0.12, t, -0.2)

    def tap(self, t, vel=1.0):
        self.events.append(("drums", t, 38, 0.1, min(1.0, vel)))
        self.add(hit("brush", 0.6) * vel * 0.2, t, -0.1)

    def kick(self, t, vel=1.0):
        self.events.append(("drums", t, 36, 0.1, min(1.0, vel)))
        self.add(hit("kick", 0.5) * vel * 0.3, t, 0)

    def kit(self, name, t, vel=1.0, pan=0.0, length=0.6):
        gm = {"tom_hi": 48, "tom_lo": 45, "flam": 38, "snare_hard": 38, "snare": 38, "hihat_foot": 44, "kick": 36}.get(name, 38)
        self.events.append(("drums", t, gm, 0.1, min(1.0, vel)))
        t += self.rng.normal(0, 0.004); vel *= self.rng.uniform(0.9, 1.08)
        self.add(hit(name, length, 0.15) * vel * 0.22, t, pan)

    def crash(self, t, vel=1.0):
        self.events.append(("drums", t, 49, 0.1, min(1.0, vel)))
        self.add(hit("ride", 2.2, 0.6) * vel * 0.3, t, 0.3)
        self.add(hit("cymbal", 2.2, 0.6) * vel * 0.12, t, -0.3)

    def master(self, length, peak=0.89, solo_gain=1.9):
        """Studio z dobrą akustyką: naturalna przestrzeń, szerokie stereo, delikatna kompresja emisyjna."""
        irL, irR = chamber_ir(0.85)
        dist = butter(1, 10000, "lowpass", fs=SR, output="sos")
        out = []
        for bed, solo, ir in ((self.L, self.SL, irL), (self.R, self.SR_, irR)):
            bed = sosfilt(dist, bed)
            dry = bed + solo_gain * solo
            wet = fftconvolve(0.42 * bed + 0.2 * solo_gain * solo, ir)[:len(bed)]
            out.append(dry + wet)
        st = np.stack(out, 1)[:int(length * SR)]
        st /= np.max(np.abs(st)) + 1e-9
        st = glue(st)
        st *= peak / (np.max(np.abs(st)) + 1e-9)
        f = int(0.45 * SR); st[-f:] *= (np.linspace(1, 0, f) ** 2)[:, None]
        return st


def glue(st, thr_db=-14, ratio=2.0, att=0.012, rel=0.18):
    """Łagodny kompresor szyny (2:1) — spójny, „radiowy” miks bez spłaszczania dynamiki."""
    from scipy.signal import lfilter
    lvl = np.max(np.abs(st), 1)
    a_att, a_rel = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR))
    env = lfilter([1 - a_rel], [1, -a_rel], lvl)          # wolny obwiedniowy
    env = np.maximum(env, lfilter([1 - a_att], [1, -a_att], lvl))
    db = 20 * np.log10(env + 1e-9)
    gain_db = np.where(db > thr_db, (thr_db - db) * (1 - 1 / ratio), 0)
    return st * (10 ** (gain_db / 20))[:, None]


def chamber_ir(rt=1.0):
    """Odpowiedź impulsowa małej sali koncertowej: wczesne odbicia + ogon z szybszym wygasaniem wysokich tonów."""
    rng = np.random.default_rng(7)
    n = int(rt * 1.6 * SR); tt = np.arange(n) / SR
    irs = []
    for ch in range(2):
        ir = np.zeros(n)
        # wczesne odbicia od ścian, sufitu i podłogi sceny (5–70 ms)
        for k in range(14):
            d = rng.uniform(0.005, 0.07); g = 0.55 * (1 - d / 0.08) * rng.uniform(0.6, 1.0)
            ir[int(d * SR)] += g * (1 if rng.random() > 0.3 else -1)
        ir = sosfilt(butter(1, 6000, "lowpass", fs=SR, output="sos"), ir)
        # ogon pogłosowy w pasmach: niskie wybrzmiewają dłużej, wysokie krócej (pochłanianie powietrza i widowni)
        tail = np.zeros(n)
        noise = rng.standard_normal(n)
        for lo, hi, rt_band in ((60, 400, rt * 1.15), (400, 2000, rt), (2000, 6000, rt * 0.7), (6000, 12000, rt * 0.4)):
            band = sosfilt(butter(2, [lo, hi], "bandpass", fs=SR, output="sos"), noise)
            tail += band * np.exp(-6.9 * tt / rt_band)
        onset = np.clip((tt - 0.02) / 0.06, 0, 1)
        tail *= onset * 0.22
        ir = ir + tail
        irs.append(ir / np.sqrt(np.sum(ir ** 2)) * 0.9)
    return irs


# ---------------------------------------------------------------- partytura: F-dur, 168 BPM, swing
def compose():
    m = Mix(9.2)
    T, P, BASS = "trumpet", "acoustic_grand_piano", "acoustic_bass"

    # 0–2 s — motyw trąbki: śmiały, łatwy do zapamiętania (F – A – C – D – C – A … G – F)
    motif = [(0, "F5", .4, 0), (0.5, "A5", .4, 0), (1, "C6", .8, -2), (2, "D6", .35, 0), (2.5, "C6", .35, 0),
             (3, "A5", .7, 0), (4, "G5", .35, 0), (4.5, "F5", .9, -1)]
    for b, n, d, bend in motif:
        long = d >= 0.7
        # trąbka prowadzi (z wibrato na długich dźwiękach), saksofon tenorowy dubluje oktawę niżej — brzmienie big bandu
        m.play(T, sw(b), n, d * B * 1.6, 1.0 if b in (1, 4.5) else 0.9, 0.22, bend * 0.5, vib=0.07 if long else 0, solo=True)
        m.play("tenor_sax", sw(b), note_n(n) - 12, d * B * 1.6, 0.45, 0.12, bend * 0.5, players=2, vib=0.1 if long else 0)
    # sekcja saksofonów: miękkie tło akordowe pod motywem
    for b, ch, d in [(0, ["A4", "C5", "E5"], 2.3), (2.5, ["F4", "A4", "C5"], 1.9), (4.5, ["F4", "A4", "D5"], 0.9)]:
        m.play("alto_sax", sw(b), ch, d * B, 0.22, 0.2, players=2, vib=0.06)
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
        # saksofon altowy prowadzi odpowiedź, fortepian ją cicho dubluje
        acc = b % 1 == 0
        m.play("alto_sax", sw(b), n, B * (0.62 if acc else 0.4), 1.0 if acc else 0.85, 0.12, -0.6 if b in (7, 9) else 0,
               vib=0.06 if b == 12 else 0, solo=True)
        m.play(P, sw(b), n, 0.2, 0.25 if acc else 0.18, 0.15)
    comp = [(6, ["Bb3", "D4", "F4", "A4"]), (7.5, ["Bb3", "E4", "A4", "D5"]), (9, ["A3", "C4", "E4", "G4"]),
            (10.5, ["Gb3", "C4", "Eb4", "A4"]), (12, ["Bb3", "D4", "F4", "A4"])]
    for b, ch in comp:
        m.play(P, sw(b), ch, 0.3, 0.6)
        # puzony: ciche, długie tło pod solo saksofonu
        m.play("trombone", sw(b), [note_n(x) - 12 if note_n(x) > 64 else note_n(x) for x in ch[:3]], B * 1.4, 0.2, 0.2, players=2)
    walk = ["F2", "G2", "A2", "C3", "A2", "Bb2", "D2", "G2"]       # ćwierćnuty, takty 2–3
    for k, n in enumerate(walk):
        m.play(BASS, sw(5 + k), n, B * 0.95, 0.95, 0.08)
    for b in np.arange(5, 13, 1.0):
        m.ride(sw(b), 0.85); m.ride(sw(b + 0.5), 0.55) if int(b) % 2 == 1 else None
        if int(b) % 2 == 0:
            m.brush(sw(b), 0.9); m.kick(sw(b), 0.25)
    # trąbka dorzuca krótkie odpowiedzi w pauzach fortepianu
    m.play(T, sw(8.5), "D6", 0.18, 0.5, 0.08); m.play(T, sw(9), "C6", 0.25, 0.55, 0.1)
    # drobne dodatki: krótka odpowiedź trąbki z tłumikiem i saksofon wprowadzający finał
    m.play("muted_trumpet", sw(10.5), "A5", 0.14, 0.45, 0.08); m.play("muted_trumpet", sw(11), "G5", 0.3, 0.5, 0.15)
    # SOLO PERKUSJI (break): zespół milknie na jeden takt, perkusista gra pałkami triolami po werblu i tomach
    F = 4.0                                       # o tyle ćwierćnut przesuwa się finał
    tri = B / 3
    solo = [  # (ćwierćnuta, numer trioli 0–2, instrument, siła, panorama)
        (12, 2, "snare", 0.5, -0.1),
        (13, 0, "snare_hard", 0.95, -0.1), (13, 1, "snare", 0.45, -0.1), (13, 2, "snare", 0.6, -0.1),
        (14, 0, "tom_hi", 0.9, -0.3), (14, 1, "snare", 0.5, -0.1), (14, 2, "tom_hi", 0.75, -0.3),
        (15, 0, "tom_lo", 1.0, 0.3), (15, 1, "tom_hi", 0.7, -0.3), (15, 2, "tom_lo", 0.85, 0.3),
        (16, 0, "flam", 1.0, -0.1), (16, 1, "tom_hi", 0.8, -0.3), (16, 2, "tom_lo", 0.95, 0.3),
    ]
    for q, k, name, v, pan in solo:
        m.kit(name, sw(q) + k * tri, v * (0.8 + 0.06 * (q - 12)), pan)
    for q in (13, 15):
        m.kit("hihat_foot", sw(q), 0.5, 0.25)
    for q in (14, 16):
        m.kick(sw(q), 0.7)
    m.kit("snare_hard", sw(16.5) + tri * 0.5, 1.0, -0.1)   # sygnał dla zespołu: „wchodzimy!”

    # 5–7 s — finał całego zespołu: „da-DAH!” z ostrym akcentem blachy (C7#9 → Gb13 → F6/9)
    horns = {"trumpet": [("C7#9", ["A5"]), ("Gb13", ["Ab5"]), ("F69", ["A5", "C6"])],
             "alto_sax": [("C7#9", ["Eb5"]), ("Gb13", ["Eb5"]), ("F69", ["G5"])],
             "tenor_sax": [("C7#9", ["Bb4"]), ("Gb13", ["Bb4"]), ("F69", ["D5"])],
             "trombone": [("C7#9", ["E4"]), ("Gb13", ["E4"]), ("F69", ["A4"])],
             "baritone_sax": [("C7#9", ["C3"]), ("Gb13", ["Gb2"]), ("F69", ["F2"])]}
    horns["trombone"] = [("C7#9", ["E4", "C3"]), ("Gb13", ["E4", "Gb2"]), ("F69", ["A4", "F2"])]   # + puzon basowy
    hits = {"C7#9": (13.5 + F, 0.2), "Gb13": (14.5 + F, 0.2), "F69": (15 + F, 1.45)}
    for inst, parts in horns.items():
        for chord, notes in parts:
            b, d = hits[chord]
            players = {"trumpet": 3, "alto_sax": 2, "tenor_sax": 2, "trombone": 2}.get(inst, 1)
            m.play(inst, sw(b), notes, d, 1.1 if chord == "F69" else 0.9, 0.25 if chord == "F69" else 0.06,
                   -1.5 if inst == "trumpet" and chord == "F69" else 0, players=players,
                   vib=0.05 if chord == "F69" and inst != "baritone_sax" else 0)
    m.play(T, sw(15 + F) + 0.9, "F6", 0.55, 0.8, 0.5, vib=0.07, solo=True)  # wysoki „dzwonek” trąbki prowadzącej na koniec
    m.play("alto_sax", sw(15 + F) + 0.9, "C6", 0.5, 0.45, 0.35, vib=0.12)
    m.play(P, sw(13.5 + F), ["Bb3", "E4", "Eb5"], 0.18, 0.7)
    m.play(P, sw(14.5 + F), ["Bb3", "E4", "Ab4", "Eb5"], 0.18, 0.75)
    m.play(P, sw(15 + F), ["F2", "A3", "D4", "G4", "C5", "F5"], 1.4, 1.0, 0.5)
    m.play(BASS, sw(13.5 + F), "C2", 0.2, 0.9); m.play(BASS, sw(14.5 + F), "Gb2", 0.2, 0.9); m.play(BASS, sw(15 + F), "F1", 1.3, 1.1, 0.4)
    m.kick(sw(13.5 + F), 0.7); m.kick(sw(14.5 + F), 0.7); m.kick(sw(15 + F), 1.0)
    m.tap(sw(13.5 + F), 1.0); m.tap(sw(14.5 + F), 1.1)
    m.crash(sw(15 + F), 0.45)
    return m, sw(15 + F) + 1.55


GM = {"trumpet": 56, "solo_trumpet": 56, "muted_trumpet": 59, "alto_sax": 65, "solo_alto_sax": 65, "tenor_sax": 66,
      "baritone_sax": 67, "trombone": 57, "acoustic_grand_piano": 0, "acoustic_bass": 32}


def write_midi(events, path):
    """Wielościeżkowy plik MIDI (typ 1) z aranżacją — do nagrania z profesjonalnymi bibliotekami lub przez muzyków."""
    ppq, tempo = 480, int(60_000_000 / BPM)
    tick = lambda sec: int(round(sec * ppq * BPM / 60))
    vlq = lambda v: bytes(((v >> s) & 0x7F) | (0x80 if s else 0) for s in range(21, -1, -7) if (v >> s) or s == 0)
    tracks, names = [], {}
    for name in dict.fromkeys(e[0] for e in events):
        names[name] = len(names)
    def track(name, evs):
        ch = 9 if name == "drums" else names[name] % 9
        msgs = [(0, bytes([0xFF, 0x03, len(name)]) + name.encode())]
        if name != "drums":
            msgs.append((0, bytes([0xC0 | ch, GM.get(name, 0)])))
        for _, t, m, d, v in evs:
            on, off = tick(max(t, 0)), tick(max(t, 0) + d)
            msgs.append((on, bytes([0x90 | ch, m, max(1, int(v * 110))])))
            msgs.append((off, bytes([0x80 | ch, m, 0])))
        msgs.sort(key=lambda x: (x[0], x[1][0] & 0xF0 != 0x80))
        out, last = b"", 0
        for t, msg in msgs:
            out += vlq(t - last) + msg; last = t
        out += vlq(0) + b"\xFF\x2F\x00"
        return b"MTrk" + len(out).to_bytes(4, "big") + out
    tempo_track = b"\x00\xFF\x51\x03" + tempo.to_bytes(3, "big") + b"\x00\xFF\x58\x04\x04\x02\x18\x08\x00\xFF\x2F\x00"
    tracks.append(b"MTrk" + len(tempo_track).to_bytes(4, "big") + tempo_track)
    for name in names:
        tracks.append(track(name, [e for e in events if e[0] == name]))
    with open(path, "wb") as f:
        f.write(b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big") + len(tracks).to_bytes(2, "big") + ppq.to_bytes(2, "big"))
        for t in tracks:
            f.write(t)


if __name__ == "__main__":
    mix, length = compose()
    if len(sys.argv) > 3:
        write_midi(mix.events, sys.argv[3]); print(sys.argv[3])
    st = mix.master(length)
    pcm = (np.clip(st, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    "-b:a", "256k", OUTFILE], input=pcm, check=True)
    print(OUTFILE, f"{len(st) / SR:.2f} s")
