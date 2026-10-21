"""Step 4: speech to text on each clip's speech (plus the mic's pre-roll),
with the same Whisper model Groq runs (large-v3-turbo) on the CPU.

python transcribe.py <workdir> <out.jsonl> [--no-hints] [--prompt KEY] [--voice V] [--model NAME]
--prompt picks manifest['prompts'][KEY] (written by prompts.mjs) in place of
the default hint; --voice only runs clips of that voice.
Resumes: clips already in out.jsonl are skipped. Needs faster-whisper.
"""
import json, os, sys, wave
import numpy as np
from faster_whisper import WhisperModel

RATE = 16000


def load(path, start, end):
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return data[int(max(0, start) * RATE):int(end * RATE)]


def main():
    work, out = sys.argv[1], sys.argv[2]
    hints = '--no-hints' not in sys.argv
    key = sys.argv[sys.argv.index('--prompt') + 1] if '--prompt' in sys.argv else None
    voice = sys.argv[sys.argv.index('--voice') + 1] if '--voice' in sys.argv else None
    model_name = sys.argv[sys.argv.index('--model') + 1] if '--model' in sys.argv else 'deepdml/faster-whisper-large-v3-turbo-ct2'
    manifest = json.load(open(os.path.join(work, 'manifest.json')))
    prompt = manifest['prompts'][key] if key else manifest['prompt']
    done = set()
    if os.path.exists(out):
        done = {json.loads(line)['file'] for line in open(out) if line.strip()}
    model = WhisperModel(model_name, device='cpu', compute_type='int8')
    with open(out, 'a') as f:
        for item in manifest['items']:
            if item['file'] in done or (voice and item['voice'] != voice):
                continue
            audio = load(os.path.join(work, 'clips', item['file']), item['speech_from_s'] - 0.35, item['speech_to_s'] + 0.6)
            segs, _ = model.transcribe(audio, language='en', initial_prompt=prompt if hints else None,
                                       beam_size=1, temperature=0, condition_on_previous_text=False)
            text = ' '.join(s.text.strip() for s in segs)
            f.write(json.dumps({'file': item['file'], 'text': text, 'hints': (key or True) if hints else False}) + '\n')
            f.flush()


if __name__ == '__main__':
    main()
