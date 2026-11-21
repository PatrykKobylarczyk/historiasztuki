"""Prawdziwe próbki perkusji (zestaw Gretsch z tidalcycles/Dirt-Samples).

Katalog z próbkami: zmienna środowiskowa DRUMS (domyślnie /tmp/dirt).
"""
import os, subprocess
from functools import lru_cache
import numpy as np

SR = 44100
DIR = os.environ.get("DRUMS", "/tmp/dirt")
FILES = {
    "kick": "gretsch/013_kick.wav", "snare": "gretsch/020_snare.wav", "snare_ghost": "gretsch/021_snareghost.wav",
    "brush": "gretsch/002_brushsnare.wav", "brush_ghost": "gretsch/003_brushsnareghost.wav",
    "ride": "gretsch/019_ridecymbal.wav", "ride_bell": "gretsch/018_ridebell.wav",
    "cymbal": "gretsch/017_openhat.wav", "cymbal_rub": "gretsch/008_cymbalrub.wav", "hihat_foot": "gretsch/010_foothat.wav",
    "tom_hi": "gretsch/012_hitom.wav", "tom_lo": "gretsch/015_lotom.wav", "flam": "gretsch/009_flam.wav",
    "snare_hard": "gretsch/022_snarehard.wav",
}


@lru_cache(maxsize=None)
def drum(name):
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", os.path.join(DIR, FILES[name]), "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return x / (np.max(np.abs(x)) + 1e-9)


def hit(name, length=None, fade=0.05):
    x = drum(name)
    if length:
        n = int(length * SR); x = x[:n].copy()
        f = min(len(x), int(fade * SR)); x[-f:] *= np.linspace(1, 0, f)
    return x
