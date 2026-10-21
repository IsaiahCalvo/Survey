"""Step 2: speaks each phrase with espeak-ng voices and mixes in site noise.

python make_clips.py <workdir>
Writes <workdir>/clips/*.wav (16 kHz mono) and <workdir>/manifest.json.
Noise is made here (no recordings needed): a generator's hum, hammer
blows, a saw's whine and people talking far off. Each clip gets 1 s of the
same noise before and 1.5 s after, as the mic hears it on site.
"""
import json, os, subprocess, sys, wave
import numpy as np

RATE = 16000
rng = np.random.default_rng(7)


def read_wav(path):
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        rate = w.getframerate()
    if rate != RATE:
        idx = np.arange(0, len(data), rate / RATE)
        data = np.interp(idx, np.arange(len(data)), data).astype(np.float32)
    return data


def write_wav(path, data):
    pcm = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())


def colored(n, power):
    # 1/f^power noise from white noise, shaped in the frequency domain.
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE); f[0] = f[1]
    out = np.fft.irfft(spec / f ** (power / 2), n)
    return (out / np.max(np.abs(out))).astype(np.float32)


def noise(kind, n):
    t = np.arange(n) / RATE
    if kind == 'generator':
        hum = sum(np.sin(2 * np.pi * 60 * k * t + k) / k for k in range(1, 8))
        return (0.6 * hum / np.max(np.abs(hum)) + 0.4 * colored(n, 2)).astype(np.float32)
    if kind == 'hammer':
        out = 0.05 * colored(n, 1)
        at = 0
        while at < n:
            at += int(RATE * rng.uniform(0.25, 0.7))
            blow = int(RATE * 0.08)
            if at + blow < n:
                env = np.exp(-np.arange(blow) / (RATE * 0.012))
                out[at:at + blow] += env * rng.standard_normal(blow) * 1.0
        return out.astype(np.float32)
    if kind == 'saw':
        whine = np.sin(2 * np.pi * (3200 + 150 * np.sin(2 * np.pi * 0.7 * t)) * t)
        band = np.fft.irfft(np.fft.rfft(rng.standard_normal(n)) * (np.abs(np.fft.rfftfreq(n, 1 / RATE) - 4000) < 2500), n)
        return (0.5 * whine + 0.5 * band / np.max(np.abs(band))).astype(np.float32)
    if kind == 'crowd':
        # Far-off talk: speech-band noise with a syllable-rate swell.
        band = np.fft.irfft(np.fft.rfft(rng.standard_normal(n)) * (np.abs(np.fft.rfftfreq(n, 1 / RATE) - 900) < 700), n)
        swell = 0.6 + 0.4 * np.sin(2 * np.pi * 4 * t + rng.uniform(0, 6))
        return (band / np.max(np.abs(band)) * swell).astype(np.float32)
    raise ValueError(kind)


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-9)


def main():
    work = sys.argv[1]
    base = json.load(open(os.path.join(work, 'manifest-base.json')))
    os.makedirs(os.path.join(work, 'clips'), exist_ok=True)
    conditions = [('clean', None)] + [(k, snr) for k in ['generator', 'hammer', 'saw', 'crowd'] for snr in (10, 3)]
    items = []
    for v in base['voices']:
        for p_i, phrase in enumerate(base['phrases']):
            raw = os.path.join(work, 'clips', f'tts_{v.replace("+", "_")}_{p_i}.wav')
            subprocess.run(['espeak-ng', '-v', v, '-s', '155', '-w', raw, phrase['said']], check=True)
            speech = read_wav(raw)
            speech = speech / (np.max(np.abs(speech)) + 1e-9) * 0.5
            pad_before, pad_after = int(RATE * 1.0), int(RATE * 1.5)
            for kind, snr in conditions:
                total = pad_before + len(speech) + pad_after
                mix = np.zeros(total, dtype=np.float32)
                mix[pad_before:pad_before + len(speech)] += speech
                if kind != 'clean':
                    nz = noise(kind, total)
                    nz *= rms(speech) / rms(nz) / (10 ** (snr / 20))
                    mix += nz
                name = f'{v.replace("+", "_")}_{p_i}_{kind}{snr or ""}.wav'
                write_wav(os.path.join(work, 'clips', name), mix)
                items.append({'file': name, 'voice': v, 'phrase': p_i, 'said': phrase['said'], 'name': phrase['name'], 'noise': kind, 'snr': snr,
                              'speech_from_s': pad_before / RATE, 'speech_to_s': (pad_before + len(speech)) / RATE})
            os.remove(raw)
    json.dump({**base, 'items': items}, open(os.path.join(work, 'manifest.json'), 'w'), indent=1)
    print(len(items), 'clips')


if __name__ == '__main__':
    main()
