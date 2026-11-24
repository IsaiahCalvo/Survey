# On-device voice: notices

`pocketTtsWorker.js` is adapted from the Pocket TTS ONNX web demo by
KevinAHM (`inference-worker.js`), licensed under the Apache License,
Version 2.0. The changes are listed at the top of that file.
A copy of the licence: https://www.apache.org/licenses/LICENSE-2.0

Files downloaded at run time (not part of this repository):

- Models: `KevinAHM/pocket-tts-onnx` on Hugging Face, int8 ONNX exports of
  Kyutai's Pocket TTS (`kyutai/pocket-tts`), CC BY 4.0.
- Voice: "casual" by Alba MacKenna, from `kyutai/tts-voices`, CC BY 4.0.

The demo's built-in `voices.bin` is not used, because it also carries
voices from non-commercial datasets (Expresso and EARS, CC BY-NC 4.0).

Packages: `onnxruntime-web` (MIT), `@sctg/sentencepiece-js` (Apache 2.0).
