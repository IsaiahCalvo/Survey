// The app's speech plugin wrapper (src/mobile/nativeSpeech.js, from the
// mobile app work), when it is in the build and the phone can use it.
// import.meta.glob keeps the build working before that file lands.
const wrappers = import.meta.glob('../mobile/nativeSpeech.js');

export async function loadNativeSpeech() {
  // Browser tests stand in a fake phone recognizer here.
  const speech = globalThis.__surveyAgentNativeSpeech
    || await wrappers['../mobile/nativeSpeech.js']?.().catch(() => null);
  if (!speech?.start) return null;
  try {
    return (await speech.isAvailable()) ? speech : null;
  } catch {
    return null;
  }
}
