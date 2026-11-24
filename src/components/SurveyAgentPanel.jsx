// The Survey agent chat (KAL-527, behind the survey_agent flag). The person
// types or talks about an item ("D-117 cables pulled, card reader missing, no
// power") and can add photos; the agent fills that item's checklist, note,
// entity and media through the Survey panel's own writes. Every reply that
// changed something lists the changes with one Undo for the whole turn.
// Hands-free mode keeps the mic open: talk, hear a short spoken reply, talk
// again, with no taps. With no signal, messages wait and send once it is back.
//
// One window (owner 2026-10-21): the Survey panel's mic starts and stops
// hands-free with no window; the chat lives hidden and keeps listening. The
// typing dots beside the mic swap the Survey panel for the chat (`view`
// 'chat', drawn inside `host`); a tap outside or Back swaps it back.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { supabase } from '../supabaseClient';
import { AuthContext } from '../contexts/AuthContext';
import { AI_NOTICE_VERSION, hasAiConsent } from '../legal/legalVersions';
import { classifyMediaFile } from '../services/surveyMediaService';
import { answerSetFor, templateHasTypedItems } from '../services/answerSets.js';
import { createSurveyAgentToolbox, placementOf, surveyAgentBridge } from '../agent/surveyAgentTools.js';
import { buildAnnotationTools } from '../agent/annotationTools.js';
import { ANNOTATION_AGENT_FLAG } from '../../supabase/functions/_shared/annotationAgentSpec.js';
import { activeAgentDocument } from '../agent/webmcp.js';
import { isFeatureOn } from '../featureFlags.js';
import { makeSurveyAgentCaller, runSurveyAgentTurn, surveyAgentErrorText, usageWarning, withRetries } from '../agent/surveyAgentClient.js';
import { cleanTranscript, heardOwnVoice, snapItemNames, spokenReply, transcriptionHints } from '../agent/voiceLoop.js';
import { canSpeakReplies, createAgentVoice, unlockPlayback } from '../agent/agentVoice.js';
import { letGoOfWarmMic, startHandsFreeMic } from '../agent/handsFreeMic.js';
import { createTurnJoiner, joinTurnText, joinWavs } from '../agent/turnJoiner.js';
import { createHoldToTalk } from '../agent/holdToTalk.js';
import { createVoiceLog, loggedCaller, reportAgentAnswer, sendVoiceLog } from '../agent/voiceLog.js';
import { startNativeHandsFree } from '../agent/nativeHandsFree.js';
import { loadNativeSpeech } from '../agent/nativeSpeechLoader.js';
import { hearLocally, isSureHearing, prepareLocalHearing, sharesMicSafely, startDeviceHearing } from '../agent/deviceHearing.js';
import { runOfflineTurn } from '../agent/offlineHelper.js';
import { deviceModelInfo, downloadDeviceModel, readyDeviceModel } from '../agent/deviceModel.js';
import { keepScreenAwake } from '../agent/keepAwake.js';
import { getMicLevel, levelFromRms, setMicLevel, startStreamMeter, subscribeMicLevel } from '../agent/micLevel.js';
import { AGENT_LANG, CANCEL_WORDS, SHUTTER_WORDS, agentLocale, agentSays } from '../agent/agentLanguage.js';
import { dropWaiting, keepWaiting, loadWaiting } from '../agent/waitingStore.js';
import { useAudioRecorder } from './SurveyMediaCapture';
import SurveyAgentCamera from './SurveyAgentCamera';
import { useTooltip } from './Tooltip';
import AgentLearnedDialog from './AgentLearnedDialog.jsx';
import { createAgentMemoryStore } from '../agent/agentMemory.js';
import { SHEET_KINDS, placementWords } from '../agent/sheetKind.js';
import './surveyAgentPanel.css';

// What the agent learned per project (names, note wording), shared by every
// panel so the item lookups see what a save just added.
const agentMemory = createAgentMemoryStore(supabase);

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const browserSpeech = () => (typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition || null
  : null);

// Spoken replies (owner 2026-10-20: "the real goal is speech"): the device's
// own free voice reads each reply, unless the person turns it off.
const SPEAK_KEY = 'survey.agent.speak';
const readSpeakSetting = () => {
  try { return window.localStorage.getItem(SPEAK_KEY) !== '0'; } catch { return true; }
};
// KAL-529 (Nightly flag agent-template-offers): offers to grow the template
// on a Yes / No card, and how notes are written: sentences or bullets.
const TEMPLATE_OFFERS_FLAG = 'agent-template-offers';
const NOTE_STYLE_KEY = 'survey.agent.noteStyle';
// KAL-532 (Nightly flag agent-photo-questions): questions about a photo.
const PHOTO_QUESTIONS_FLAG = 'agent-photo-questions';
// Nightly flag survey-agent-offline: with no signal, plain-rules commands are
// done on the device (offlineHelper.js) and hearing uses offline speech.
const OFFLINE_FLAG = 'survey-agent-offline';
// A photo goes to the model at most this wide or tall, as a JPEG.
const PHOTO_QUESTION_MAX_SIDE = 1280;
const shrinkPhoto = async (blob) => {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('That photo type cannot be read here.');
  }
  const scale = Math.min(1, PHOTO_QUESTION_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!jpeg) throw new Error('Could not prepare that photo.');
  return jpeg;
};
const readNoteStyle = () => {
  try { return window.localStorage.getItem(NOTE_STYLE_KEY) === 'bullets' ? 'bullets' : 'sentences'; } catch { return 'sentences'; }
};
const canHandsFree = () => typeof window !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && Boolean(window.AudioContext || window.webkitAudioContext);

const HANDS_FREE_TEXT = {
  listening: 'Listening. Just talk.',
  hearing: 'Hearing you...',
  working: 'Working...',
  speaking: 'Speaking. Talk to cut in.',
};

// Ideas on an empty chat, sent as they are when tapped.
const SUGGESTIONS = [
  'Find camera 6 on the 4th floor',
  'D-117 is installed but has no power',
  "What's left on this sheet?",
];

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5zM18.5 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
  </svg>
);
const SpeakerIcon = ({ muted }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4.5 4.5 0 010 6M18 6.5a8 8 0 010 11" />}
  </svg>
);
// Notes as bullets (three dotted lines) or sentences (plain lines).
const NoteStyleIcon = ({ bullets }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    {bullets
      ? <path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" strokeWidth="1.5" />
      : <path d="M4 7h16M4 12h16M4 17h10" />}
  </svg>
);
const ArrowUpIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
  </svg>
);

// Hands-free (ChatGPT's voice-mode button): a small sound wave.
const WaveIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
  </svg>
);
const StopIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </svg>
);

// The live waveform the typing line turns into while the mic records: the
// newest loudness readings scroll in from the right. Bars are written to the
// DOM straight from the level feed, so the page does not re-render per frame.
const WAVE_BARS = 40;
function MicWaveform() {
  const barsRef = useRef(null);
  useEffect(() => {
    const levels = new Array(WAVE_BARS).fill(0);
    let latest = getMicLevel();
    const off = subscribeMicLevel((v) => { latest = v; });
    const timer = setInterval(() => {
      levels.shift();
      levels.push(latest);
      const bars = barsRef.current?.children;
      if (!bars) return;
      for (let i = 0; i < bars.length; i += 1) bars[i].style.transform = `scaleY(${Math.max(0.12, levels[i]).toFixed(3)})`;
    }, 70);
    return () => { off(); clearInterval(timer); };
  }, []);
  return (
    <div className="survey-agent__wave" ref={barsRef} aria-hidden="true">
      {Array.from({ length: WAVE_BARS }, (_, i) => <span key={i} />)}
    </div>
  );
}

// A tapped mic sends once the person has been quiet this long after talking.
const TAP_END_SILENCE_MS = 1600;

// "10:12 PM" on each message, and how long a reply took ("2.4 s", "1 min 5 s").
const clockTime = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const tookText = (ms) => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
};

let nextId = 1;
const newId = (prefix) => `${prefix}${nextId++}`;

// No signal, too weak to finish a call, or the per-minute limit (hands-free
// talk can reach it): the message waits and sends later.
const WAIT_CODES = new Set(['offline', 'network', 'busy_try_again']);
// Kept on the device, unique across reloads.
const waitIdOf = () => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// The last status the server gave this person, so the chat still opens
// with no signal. Only whether it is on; limits come back with the signal.
const LAST_STATUS_KEY = 'survey.agent.lastStatus';
function readLastStatus(userId) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAST_STATUS_KEY) || 'null');
    return saved?.userId === userId && saved.enabled ? { enabled: true, reason: null, transcription: Boolean(saved.transcription), speech: false } : null;
  } catch { return null; }
}
function writeLastStatus(userId, s) {
  try {
    window.localStorage.setItem(LAST_STATUS_KEY, JSON.stringify({ userId, enabled: true, transcription: Boolean(s.transcription) }));
  } catch { /* storage blocked */ }
}


const openDocument = () => {
  const doc = activeAgentDocument();
  if (!doc) throw new Error('No document is open.');
  return doc;
};

export default function SurveyAgentPanel({
  onClose,
  mobileMode = false,
  view = 'chat',
  host = null,
  handsFreeAsk = 0,
  onShowChat = () => {},
  onActivity = () => {},
}) {
  const tip = useTooltip();
  // Nothing goes to the AI providers until the person has read who gets what
  // and said yes (Apple 5.1.2(i); privacy policy, "AI assistant"). The yes is
  // kept on the account with the notice's version.
  const auth = useContext(AuthContext);
  const aiConsented = hasAiConsent(auth?.user);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState('');
  const allowAi = async () => {
    if (!auth?.updateProfile) return;
    setConsentError('');
    setConsentSaving(true);
    try {
      await auth.updateProfile({ ai_assistant_consent: { version: AI_NOTICE_VERSION, at: new Date().toISOString() } });
    } catch (err) {
      setConsentError(err?.message || 'Could not save that. Try again.');
    } finally {
      setConsentSaving(false);
    }
  };
  const [usageLeft, setUsageLeft] = useState(null);
  // The last few spoken turns with times, for "Send voice log"; sent by
  // itself once a session when hearing or the model fails.
  const voiceLogRef = useRef(null);
  const sendLogRef = useRef(() => {});
  if (!voiceLogRef.current) voiceLogRef.current = createVoiceLog({ onError: () => sendLogRef.current('error') });
  const voiceLog = voiceLogRef.current;
  const rawCall = useMemo(() => loggedCaller(makeSurveyAgentCaller(supabase, { onUsage: setUsageLeft }), () => voiceLogRef.current), []);
  const call = useMemo(() => withRetries(rawCall), [rawCall]);
  // KAL-532 learning loop: a turn that changed something, or one taken back,
  // counted per prompt version, only with "Help improve Survey" on.
  const sendFeedback = (event, promptVersion) => {
    if (!promptVersion || auth?.user?.user_metadata?.improve_survey_opt_in?.on !== true) return;
    rawCall({ action: 'feedback', event, prompt_version: promptVersion }).catch(() => { /* a lost count is fine */ });
  };
  const sendFeedbackRef = useRef(sendFeedback);
  const saveSummaryRef = useRef(null);
  sendFeedbackRef.current = sendFeedback;
  // Spoken replies: the server's natural voice when it has one, else the
  // device's own voice.
  const voice = useMemo(() => createAgentVoice({ call: rawCall }), [rawCall]);
  const speak = (text, opts = {}) => voice.speak(text, { locale: agentLocale(), ...opts });
  const stopSpeaking = voice.stop;
  const attachmentsRef = useRef(new Map());
  const [status, setStatus] = useState(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const undoLastRef = useRef(() => null);
  const toolbox = useMemo(() => createSurveyAgentToolbox({ attachments: attachmentsRef.current, undoLastTurn: () => undoLastRef.current(), getDocument: activeAgentDocument, memory: agentMemory }), []);
  // Messages said or typed with no signal, sent in order once it is back.
  const queueRef = useRef([]);
  const [queued, setQueued] = useState(0);
  const [handsFree, setHandsFree] = useState(false);
  // The camera take_photo opened: { itemId, name }, and how to answer it.
  const [camera, setCamera] = useState(null);
  const onShowChatRef = useRef(onShowChat);
  onShowChatRef.current = onShowChat;
  const cameraRef = useRef(null);
  const photoResolveRef = useRef(null);
  const requestPhoto = useCallback(({ itemId, name }) => new Promise((resolve) => {
    photoResolveRef.current?.(null);
    photoResolveRef.current = resolve;
    setCamera({ itemId, name });
    onShowChatRef.current();
  }), []);
  const closeCamera = useCallback((file = null) => {
    const resolve = photoResolveRef.current;
    photoResolveRef.current = null;
    setCamera(null);
    resolve?.(file);
  }, []);
  const [phase, setPhase] = useState('listening');
  const [hearing, setHearing] = useState(false);
  const hearingRef = useRef(false);
  const micRef = useRef(null);
  const recentItemsRef = useRef([]);
  // Every item worked on in this chat: what an end-of-walk summary covers.
  const walkItemsRef = useRef(new Set());
  const handsFreeRef = useRef(false);
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // One turn at a time; a ref, so a send started from a stale closure still sees it.
  const turnRef = useRef(false);
  // The turn running now ({ stop, spoken }), so new speech can stop it.
  const activeTurnRef = useRef(null);
  // Words held to lead the next spoken turn ({ text, unfinished, timer }).
  const carryRef = useRef(null);
  // The per-minute limit's wait, from the last busy reply.
  const retryAfterRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(readSpeakSetting);
  const speakRef = useRef(speakReplies);
  speakRef.current = speakReplies;
  const [noteStyle, setNoteStyle] = useState(readNoteStyle);
  const noteStyleRef = useRef(noteStyle);
  noteStyleRef.current = noteStyle;
  // Template additions offered in this chat, so each is offered once, and
  // what the person said Yes to, told to the agent with their next message.
  const offeredRef = useRef(new Set());
  const offerNotesRef = useRef([]);
  const historyRef = useRef([]);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);
  const speechRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const userId = await supabase?.auth?.getSession?.().then((r) => r?.data?.session?.user?.id || null).catch(() => null);
      try {
        const s = await call({ action: 'status' });
        if (!live) return;
        setStatus(s || { enabled: false, reason: 'network' });
        voice.setServerVoice(Boolean(s?.speech));
        if (s?.usage_left) setUsageLeft(s.usage_left);
        if (userId && s?.enabled) writeLastStatus(userId, s);
      } catch (err) {
        if (!live) return;
        // No signal: if the agent worked for this person before, open
        // anyway, so what they say waits on the device and sends later.
        const last = WAIT_CODES.has(err?.code) && userId ? readLastStatus(userId) : null;
        setStatus(last ? { ...last, over_cap: false } : { enabled: false, reason: err?.code || 'network' });
      }
    })();
    return () => { live = false; };
  }, [call, voice]);

  // Follow the newest message. Before the first one the list is the
  // welcome card, which reads from its heading down (on a phone's half
  // sheet, scrolling it to the end cut off "What do you see?").
  useEffect(() => {
    const el = listRef.current;
    if (el && (entries.length > 0 || busy)) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  // The box grows with what is typed, up to its CSS max height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => () => {
    try { speechRef.current?.abort?.(); } catch { /* already stopped */ }
    handsFreeRef.current = false;
    micRef.current?.stop();
    deviceHearingRef.current?.stop();
    pttHearingRef.current?.stop();
    awakeRef.current?.release();
    pttMeterRef.current?.stop();
    speechMeterRef.current?.stop();
    setMicLevel(0, { reset: true });
    stopSpeaking();
    // A turn waiting on the camera gets "no photo" rather than hanging.
    photoResolveRef.current?.(null);
  }, []);

  const toggleSpeak = () => {
    const next = !speakReplies;
    if (next) unlockPlayback();
    setSpeakReplies(next);
    if (!next) stopSpeaking();
    try { window.localStorage.setItem(SPEAK_KEY, next ? '1' : '0'); } catch { /* storage blocked */ }
  };

  const toggleNoteStyle = () => {
    const next = noteStyle === 'bullets' ? 'sentences' : 'bullets';
    setNoteStyle(next);
    try { window.localStorage.setItem(NOTE_STYLE_KEY, next); } catch { /* storage blocked */ }
  };

  const push = (entry) => setEntries((list) => [...list, { id: newId('e'), at: Date.now(), ...entry }]);
  // 'sending' | 'sent' | 'failed' | null, for the Send voice log button.
  const [logState, setLogState] = useState(null);
  // "What Survey learned" for the drawing's project.
  const [learnedOpen, setLearnedOpen] = useState(false);
  sendLogRef.current = async (reason = 'manual') => {
    if (reason === 'manual') setLogState('sending');
    const release = typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : null;
    const ok = await sendVoiceLog(supabase, voiceLogRef.current, { reason, release }).catch(() => false);
    if (reason === 'manual') setLogState(ok ? 'sent' : 'failed');
  };

  const markEntry = (id, patch) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const dropEntry = (id) => setEntries((list) => list.filter((e) => e.id !== id));

  // A Yes / No card from offer_checklist_line or offer_category (KAL-529).
  const setOfferState = (entryId, index, state) => setEntries((list) => list.map((e) => (e.id !== entryId ? e : {
    ...e,
    offers: e.offers.map((o, i) => (i === index ? { ...o, state } : o)),
  })));
  // "Page 6 or 33?" (ask_which_page): a tap answers as if said. With
  // "Remember for this project" on, the picked sheets join the project's
  // placement rule (saved here, so it holds whatever the model does next).
  const setChoice = (entryId, patch) => setEntries((list) => list.map((e) => (e.id !== entryId || !e.choice ? e : { ...e, choice: { ...e.choice, ...patch } })));
  const answerChoice = async (entry, { pick = [], none = false, other = false } = {}) => {
    const choice = entry.choice;
    if (!choice || choice.state !== 'open' || turnRef.current) return;
    if (other) {
      setChoice(entry.id, { state: 'answered', answer: 'Another page' });
      setDraft('Page ');
      inputRef.current?.focus();
      return;
    }
    const pages = [...new Set(pick.map((o) => o.page))];
    const label = (o) => `page ${o.page}${o.sheet ? ` (the ${o.sheet})` : ''}`;
    const text = none ? 'Neither of those pages.'
      : pick.length === 1 ? `${label(pick[0])[0].toUpperCase()}${label(pick[0]).slice(1)}.`
        : `All of them: pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}.`;
    let note = null;
    const kinds = [...new Set(pick.map((o) => o.sheet).filter(Boolean))];
    const b = surveyAgentBridge.current;
    if (choice.remember && !none && kinds.length && kinds.length === pick.length && b?.projectId) {
      const rule = placementOf(agentMemory.cached(b.projectId));
      const merged = SHEET_KINDS.filter((k) => kinds.includes(k) || (rule.saved && rule.kinds.includes(k)));
      try {
        await agentMemory.save(b.projectId, { kind: 'placement', heard: 'sheets', means: merged.join(', ') });
        note = `Saved for this project: put devices on ${placementWords(merged)}. Do not call remember for it.`;
      } catch {
        note = null;
      }
    }
    setChoice(entry.id, { state: 'answered', answer: `${text}${note ? ' Remembered for this project.' : ''}` });
    const reply = await send(text, { note });
    if (reply && speakRef.current && !handsFreeRef.current) speak(reply);
  };

  const answerOffer = async (entry, index, yes) => {
    const offer = entry.offers?.[index];
    if (!offer || offer.state !== 'open') return;
    if (!yes) {
      setOfferState(entry.id, index, 'declined');
      offerNotesRef.current.push(offer.kind === 'line'
        ? `The person said no to adding "${offer.text}" to ${offer.categoryName}.`
        : `The person said no to adding the category ${offer.name}.`);
      return;
    }
    const b = surveyAgentBridge.current;
    if (!b?.template || (b.documentId || null) !== (offer.documentId || null) || !b.canEditTemplate) {
      setOfferState(entry.id, index, 'failed');
      return;
    }
    setOfferState(entry.id, index, 'adding');
    try {
      if (offer.kind === 'category') {
        const saved = await b.addCategory(offer.moduleId, offer.name);
        setOfferState(entry.id, index, saved ? 'added' : 'failed');
        if (saved) offerNotesRef.current.push(`The person said yes: the category ${offer.name} was added; get its id from get_survey_context.`);
        return;
      }
      const lineId = await b.addChecklistLine(offer.moduleId, offer.categoryId, offer.text);
      if (!lineId) { setOfferState(entry.id, index, 'failed'); return; }
      let answered = false;
      if (offer.itemId && offer.answer) {
        // The new line reaches the bridge's template on the next render.
        for (let tries = 0; tries < 20 && !answered; tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          const now = surveyAgentBridge.current;
          const hasLine = (now?.template?.modules || now?.template?.spaces || [])
            .some((m) => (m.categories || []).some((c) => c.id === offer.categoryId && (c.checklist || []).some((l) => l?.id === lineId)));
          if (hasLine && now.markers?.[offer.itemId]) {
            const before = now.markers[offer.itemId].checklistResponses?.[lineId] || null;
            now.setAnswers(offer.itemId, [{ checklistItemId: lineId, value: offer.answer }]);
            answered = true;
            // The answer joins the reply's changes, so its Undo takes it back
            // (the new line stays in the template).
            const change = {
              itemId: offer.itemId,
              documentId: offer.documentId || null,
              label: `${offer.itemName}: ${offer.text} ${offer.answer}`,
              fields: [{ type: 'answer', id: lineId, before, after: offer.answer }],
            };
            setEntries((list) => list.map((e) => (e.id !== entry.id || e.undone ? e : { ...e, changes: [...(e.changes || []), change] })));
          }
        }
      }
      setOfferState(entry.id, index, 'added');
      offerNotesRef.current.push(`The person said yes: "${offer.text}" (id ${lineId}) was added to ${offer.categoryName}${answered ? ` and set to ${offer.answer} on ${offer.itemName}` : ''}.`);
    } catch (err) {
      console.warn('[survey-agent] template offer failed', err);
      setOfferState(entry.id, index, 'failed');
    }
  };

  const reportEntry = async (entry) => {
    markEntry(entry.id, { reported: 'sending' });
    const list = entriesRef.current;
    const at = list.findIndex((e) => e.id === entry.id);
    const asked = list.slice(0, at < 0 ? list.length : at).reverse().find((e) => e.role === 'user')?.text || '';
    const release = typeof __BUILD_STAMP__ !== 'undefined' ? __BUILD_STAMP__ : null;
    const ok = await reportAgentAnswer(supabase, { answer: entry.text, asked, release }).catch(() => false);
    markEntry(entry.id, { reported: ok ? 'sent' : 'failed' });
  };

  const offlineAskRef = useRef(null);
  // The device's own model (the phone's, or Chrome/Edge's built-in):
  // fetched once on a tap where the app may start that.
  const [deviceModel, setDeviceModel] = useState({ state: 'none', engine: 'browser', progress: 0 });
  useEffect(() => {
    if (!isFeatureOn(OFFLINE_FLAG)) return undefined;
    let live = true;
    deviceModelInfo().then((info) => { if (live) setDeviceModel((prev) => ({ ...prev, ...info })); });
    return () => { live = false; };
  }, []);
  const fetchDeviceModel = async () => {
    setDeviceModel((prev) => ({ ...prev, state: 'downloading', progress: 0 }));
    try {
      await downloadDeviceModel({ onProgress: (progress) => setDeviceModel((prev) => ({ ...prev, state: 'downloading', progress })) });
      setDeviceModel({ ...(await deviceModelInfo()), progress: 1 });
    } catch {
      setDeviceModel({ ...(await deviceModelInfo()), progress: 0 });
    }
  };
  // No signal (or the server busy): a message the plain rules can read is
  // done on the device now instead of waiting. Returns the reply, or null.
  // The server's chat hears about it, so later turns build on it.
  const tryOffline = async (job) => {
    if (!isFeatureOn(OFFLINE_FLAG) || !job?.said || job.files?.length) return null;
    const bridge = surveyAgentBridge.current;
    if (!bridge?.template) return null;
    const box = createSurveyAgentToolbox({
      documentId: bridge.documentId || null,
      undoLastTurn: () => undoLastRef.current(),
      getDocument: activeAgentDocument,
      walkItems: () => [...walkItemsRef.current],
      memory: agentMemory,
    });
    let result = null;
    // A question asked on the device is answered by the very next message.
    const pending = offlineAskRef.current;
    offlineAskRef.current = null;
    try {
      // Free speech, with a model on this device: it picks among the items the rules found.
      const model = await readyDeviceModel();
      result = await runOfflineTurn({ text: job.said, toolbox: box, bridge, learned: agentMemory.cached(bridge.projectId), pending, model });
    } catch (err) {
      console.warn('[survey-agent] offline turn failed', err);
      return null;
    }
    if (!result) return null;
    offlineAskRef.current = result.pending || null;
    await new Promise((resolve) => setTimeout(resolve, 0));
    toolbox.settle(result.changes);
    const touched = result.changes.map((c) => c.itemId).filter(Boolean);
    if (touched.length) recentItemsRef.current = [...recentItemsRef.current.filter((id) => !touched.includes(id)), ...touched].slice(-8);
    for (const id of touched) walkItemsRef.current.add(id);
    historyRef.current = [...historyRef.current,
      { role: 'user', content: job.said },
      { role: 'assistant', content: `${result.reply} [Done on the device with no signal.]` }];
    if (job.entryId) markEntry(job.entryId, { waiting: false });
    push({ role: 'agent', text: result.reply, changes: result.changes, offline: true, byModel: Boolean(result.byModel) });
    voiceLog.event('offline_turn', { calls: result.calls.map((c) => c.name), changes: result.changes.length });
    return result.reply;
  };
  const tryOfflineRef = useRef(tryOffline);
  tryOfflineRef.current = tryOffline;

  // Runs one message through the agent. Returns the reply text, or null when
  // nothing was answered (error, or queued for lack of signal).
  const runJob = useCallback(async (job) => {
    const bridge = surveyAgentBridge.current;
    if (!bridge?.template) {
      push({ role: 'error', text: 'Open Survey mode with a template first.' });
      return null;
    }
    const fileNote = job.files.length
      ? `\n[Attached in this chat: ${job.files.map((f) => `${f.id} (${f.kind}, ${f.name})`).join('; ')}]`
      : '';
    const selected = bridge.selectedMarkerId && bridge.markers?.[bridge.selectedMarkerId];
    const selectedNote = selected ? `\n[Selected item: ${selected.name || 'Unnamed'} (id ${bridge.selectedMarkerId})]` : '';
    turnRef.current = true;
    setBusy(true);
    // The person talking again over a spoken turn stops it while it has
    // changed nothing yet (onHearingChange); its words join the next turn.
    const turn = { stop: false, spoken: Boolean(job.spoken) };
    activeTurnRef.current = turn;
    const startedAt = Date.now();
    // Bound to this document: if the person opens another one mid-turn, the
    // remaining tools refuse instead of writing there.
    // Markup tools (notes, shapes, callouts, highlights), shared with
    // WebMCP, for people with the annotation-agent flag.
    const annotations = isFeatureOn(ANNOTATION_AGENT_FLAG);
    const offersOn = isFeatureOn(TEMPLATE_OFFERS_FLAG);
    const photosOn = isFeatureOn(PHOTO_QUESTIONS_FLAG) && statusRef.current?.photos === true;
    const offerNote = offerNotesRef.current.length ? `\n[${offerNotesRef.current.join(' ')}]` : '';
    offerNotesRef.current = [];
    const turnToolbox = createSurveyAgentToolbox({
      attachments: attachmentsRef.current,
      documentId: bridge.documentId || null,
      undoLastTurn: () => undoLastRef.current(),
      extraTools: annotations ? buildAnnotationTools({ getDocument: openDocument, text: (v) => (typeof v === 'string' ? v : JSON.stringify(v)) }) : [],
      getDocument: activeAgentDocument,
      requestPhoto,
      walkItems: () => [...walkItemsRef.current],
      memory: agentMemory,
      offered: offersOn ? offeredRef.current : null,
      askPhoto: photosOn ? async ({ blob, question }) => {
        const jpeg = await shrinkPhoto(blob);
        const res = await call({ action: 'look', image: await blobToBase64(jpeg), mime: 'image/jpeg', question, ...(AGENT_LANG !== 'en' ? { lang: AGENT_LANG } : {}) });
        return res?.text || '';
      } : null,
    });
    try {
      const result = await runSurveyAgentTurn({
        history: historyRef.current,
        userText: `${job.said || 'Attach these files.'}${fileNote}${selectedNote}${offerNote}${job.note ? `\n[${job.note}]` : ''}`,
        call,
        toolbox: turnToolbox,
        answerValues: answerSetFor(bridge.template).map((a) => a.value),
        typedLines: templateHasTypedItems(bridge.template),
        annotations,
        lang: AGENT_LANG,
        offers: offersOn,
        noteStyle: offersOn ? noteStyleRef.current : null,
        photos: photosOn,
        shouldStop: () => turn.stop,
      });
      // Stopped mid-thought ("I need you to camera 80 on floor three um"):
      // a spoken turn waits for the rest; a typed one is asked for it.
      if (result.unfinished) {
        voiceLog.event('turn_unfinished', { ms: Date.now() - startedAt });
        if (job.spoken && job.onCarry && !job.note) {
          if (job.entryId) dropEntry(job.entryId);
          job.onCarry(job.said, { unfinished: true });
          return null;
        }
        if (job.entryId) markEntry(job.entryId, { waiting: false });
        push({ role: 'agent', text: 'Go on, what should I do?', tookMs: Date.now() - startedAt });
        return 'Go on, what should I do?';
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      toolbox.settle(result.changes);
      // Items worked on lately: speech to text expects these names most.
      const touched = result.changes.map((c) => c.itemId).filter(Boolean);
      if (touched.length) recentItemsRef.current = [...recentItemsRef.current.filter((id) => !touched.includes(id)), ...touched].slice(-8);
      for (const id of touched) walkItemsRef.current.add(id);
      historyRef.current = result.history;
      if (job.entryId) markEntry(job.entryId, { waiting: false });
      push({
        role: 'agent',
        text: result.reply,
        changes: result.changes,
        summary: result.summary || null,
        offers: result.offers?.length ? result.offers.map((offer) => ({ ...offer, state: 'open' })) : null,
        choice: result.choice ? { ...result.choice, state: 'open', remember: false } : null,
        promptVersion: result.promptVersion || null,
        tookMs: Date.now() - startedAt,
      });
      if (result.changes.length) sendFeedbackRef.current('changed', result.promptVersion);
      // "Export the summary": saved at once, as the button would (KAL-532).
      if (result.summary?.save) saveSummaryRef.current?.(result.summary);
      voiceLog.event('turn_done', { reply: result.reply, changes: result.changes.map((c) => c.label || c.type || '') });
      return result.reply;
    } catch (err) {
      // Talked over before anything changed: these words lead the next turn.
      if (err?.code === 'superseded') {
        voiceLog.event('turn_talked_over', { ms: Date.now() - startedAt });
        if (job.entryId) dropEntry(job.entryId);
        job.onCarry?.(job.said, { unfinished: false });
        return null;
      }
      // No signal (or too weak to finish) before anything changed: keep the
      // message for later. Each call is one model step with no writes on the
      // server, so sending it again later cannot double anything.
      if (WAIT_CODES.has(err?.code) && !err?.changes?.length) {
        const done = await tryOfflineRef.current(job);
        if (done !== null) return done;
        waitReasonRef.current = err.code;
        retryAfterRef.current = Number(err.retryAfter) || null;
        enqueueRef.current(job);
        return null;
      }
      // The server refused the stored chat: start over rather than repeat it.
      if (err?.code === 'bad_message' || err?.code === 'bad_message_order' || err?.code === 'conversation_too_long') historyRef.current = [];
      await new Promise((resolve) => setTimeout(resolve, 0));
      toolbox.settle(err?.changes);
      if (job.entryId) markEntry(job.entryId, { waiting: false });
      push({ role: 'error', text: err?.message || surveyAgentErrorText(err?.code), changes: err?.changes || [], code: err?.code });
      return null;
    } finally {
      if (activeTurnRef.current === turn) activeTurnRef.current = null;
      turnRef.current = false;
      setBusy(false);
    }
  }, [call, toolbox]);

  // spoken: said hands-free, so it may be talked over or cut off mid-thought;
  // onCarry(words) then takes the words back to lead the next turn. note:
  // a line for the agent only, not shown.
  const send = useCallback(async (text, { spoken = false, onCarry = null, note = null } = {}) => {
    const said = String(text || '').trim();
    const files = pendingFiles;
    if ((!said && !files.length) || turnRef.current) return null;
    if (!surveyAgentBridge.current?.template) {
      push({ role: 'error', text: 'Open Survey mode with a template first.' });
      return null;
    }
    setDraft('');
    setPendingFiles([]);
    const entryId = newId('e');
    setEntries((list) => [...list, { id: entryId, role: 'user', text: said || 'Attach these.', files: files.map((f) => f.name), at: Date.now() }]);
    // Messages wait their turn behind ones still waiting for signal.
    const job = { said, files, entryId, docKey: surveyAgentBridge.current?.waitKey || null, spoken, onCarry, note };
    if (queueRef.current.length) {
      // With no signal, what the rules can read is done now; the rest waits.
      const done = await tryOfflineRef.current(job);
      if (done !== null) return done;
      enqueueRef.current(job, { quiet: true });
      return null;
    }
    return runJob(job);
  }, [pendingFiles, runJob]);

  // Signal back: send what waited, oldest first, and stop at the first
  // message that has to wait again. A message waits for its own document.
  const flushingRef = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushingRef.current || turnRef.current) return;
    flushingRef.current = true;
    try {
      while (queueRef.current.length) {
        const job = queueRef.current[0];
        if (job.docKey && job.docKey !== (surveyAgentBridge.current?.waitKey || null)) break;
        queueRef.current.shift();
        setQueued(queueRef.current.length);
        job.flushing = true;
        let reply = null;
        if (job.clip) {
          const text = await transcribeRef.current(job.clip, job.durationMs);
          if (text === null) { queueRef.current.unshift(job); setQueued(queueRef.current.length); break; }
          if (!text) {
            if (job.entryId) markEntry(job.entryId, { text: 'Voice message (could not hear it)', waiting: false });
          } else {
            if (job.entryId) markEntry(job.entryId, { text });
            const said = { said: text, files: [], entryId: job.entryId, docKey: job.docKey, waitId: job.waitId };
            reply = await runJob(said);
            if (queueRef.current.includes(said)) {
              // Heard, but the turn has to wait again: keep the words, not the audio.
              queueRef.current[queueRef.current.indexOf(said)] = { ...said, flushing: false };
              if (job.waitId && job.docKey) keepWaiting({ id: job.waitId, docKey: job.docKey, said: text });
              break;
            }
          }
        } else {
          reply = await runJob(job);
          if (queueRef.current.includes(job)) { job.flushing = false; break; }
        }
        dropWaiting(job.waitId);
        if (reply) await speakOutRef.current(reply);
      }
      if (!queueRef.current.length) savedNoticeRef.current = false;
    } finally {
      flushingRef.current = false;
    }
  }, [runJob]);

  const flushQueueRef = useRef(flushQueue);
  flushQueueRef.current = flushQueue;

  useEffect(() => {
    const online = () => { flushQueue(); };
    window.addEventListener('online', online);
    // Also try now and then: phones report "online" on a dead connection.
    const timer = setInterval(() => { if (queueRef.current.length) flushQueue(); }, 20_000);
    return () => { window.removeEventListener('online', online); clearInterval(timer); };
  }, [flushQueue]);

  // Typed or tapped-mic messages: answer aloud too when voice is on (not in
  // hands-free mode, which speaks for itself and must not hear it).
  const sendAndSpeak = useCallback(async (text) => {
    // A typed message is its own turn, so the log keeps only the recent ones.
    voiceLog.turn('typed', { chars: String(text || '').length });
    const reply = await send(text);
    if (reply && speakRef.current && !handsFreeRef.current) speak(reply);
    return reply;
  }, [send]);
  const sendRef = useRef(sendAndSpeak);
  sendRef.current = sendAndSpeak;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // A reply said out loud when voice is on. In hands-free the mic is guarded
  // (not while the person is mid-sentence) so it can be cut off by talking.
  const speakOut = async (reply, { here = false } = {}) => {
    if (!reply || !speakRef.current) return;
    if (!handsFreeRef.current) { await speak(reply, { here }); return; }
    const mic = micRef.current;
    if (mic?.guard() === false) return;
    lastSpokenRef.current = spokenReply(reply);
    setPhase('speaking');
    await speak(reply, { here });
    setPhase(handsFreePendingRef.current ? 'working' : 'listening');
    mic?.unguard();
  };
  const speakOutRef = useRef(speakOut);
  speakOutRef.current = speakOut;

  // Puts a message in the waiting line (at the front when it was being
  // sent from there), keeps it on the device, and says so: "saved, will
  // send" once per stretch without signal, then just "Saved."
  const savedNoticeRef = useRef(false);
  const busyTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(busyTimerRef.current), []);
  const waitReasonRef = useRef('offline');
  const enqueue = (job, { quiet = false } = {}) => {
    // Back from a send attempt: same place in line, and nothing new to say.
    const retried = Boolean(job.flushing);
    if (retried) { job.flushing = false; queueRef.current.unshift(job); } else queueRef.current.push(job);
    setQueued(queueRef.current.length);
    if (job.entryId) markEntry(job.entryId, { waiting: true });
    // Files stay in this session only; words and recorded audio survive a reload.
    if (!job.files?.length && job.docKey) {
      job.waitId = job.waitId || waitIdOf();
      keepWaiting({ id: job.waitId, docKey: job.docKey, said: job.said || null, clip: job.clip || null, durationMs: job.durationMs || null });
    }
    // Busy (the per-minute limit), not offline: try again as soon as the
    // limit says, not at the next 20 s check.
    if (waitReasonRef.current === 'busy_try_again' && !busyTimerRef.current) {
      const ms = Math.min(20_000, Math.max(2_000, (retryAfterRef.current || 3) * 1000));
      busyTimerRef.current = setTimeout(() => { busyTimerRef.current = null; flushQueueRef.current(); }, ms);
    }
    if (quiet || retried) return;
    const busy = waitReasonRef.current === 'busy_try_again';
    const first = !savedNoticeRef.current;
    if (!busy) savedNoticeRef.current = true;
    speakOutRef.current(agentSays(busy ? 'savedBusy' : first ? 'savedFirst' : 'saved'), { here: true });
  };
  const enqueueRef = useRef(enqueue);
  enqueueRef.current = enqueue;

  // Messages left waiting on this device for this document (the chat was
  // closed or the page reloaded with no signal): show them and send them.
  useEffect(() => {
    const docKey = surveyAgentBridge.current?.waitKey || null;
    if (!docKey) return undefined;
    let live = true;
    loadWaiting(docKey).then((rows) => {
      if (!live || !rows.length) return;
      for (const row of rows) {
        if (queueRef.current.some((j) => j.waitId === row.id)) continue;
        const entryId = newId('e');
        setEntries((list) => [...list, { id: entryId, role: 'user', text: row.said || 'Voice message', waiting: true, at: Date.now() }]);
        queueRef.current.push({ said: row.said || '', files: [], clip: row.clip || null, durationMs: row.durationMs || null, entryId, docKey, waitId: row.id });
      }
      savedNoticeRef.current = true;
      setQueued(queueRef.current.length);
      flushQueueRef.current();
    });
    return () => { live = false; };
  }, []);

  const applyUndo = (entry) => {
    const result = toolbox.undo(entry.changes || []);
    const undone = result.kept ? 'partly' : true;
    setEntries((list) => list.map((e) => (e.id === entry.id ? { ...e, undone } : e)));
    return result;
  };
  // The agent's undo_last_turn: the newest reply with changes not yet undone.
  undoLastRef.current = () => {
    const entry = [...entriesRef.current].reverse().find((e) => e.role === 'agent' && e.changes?.length && !e.undone);
    if (entry) sendFeedbackRef.current('voice_undo', entry.promptVersion);
    return entry ? applyUndo(entry) : null;
  };

  const undoEntry = (entry) => {
    sendFeedbackRef.current('undo', entry.promptVersion);
    const { reverted, kept } = applyUndo(entry);
    // Tell the agent, so it does not build on what was taken back.
    const note = kept
      ? `[The person pressed Undo on those changes: ${reverted} reverted, ${kept} kept because they were changed again since.]`
      : '[The person pressed Undo on those changes; they are reverted.]';
    historyRef.current = historyRef.current.length
      ? [...historyRef.current,
        { role: 'user', content: note },
        { role: 'assistant', content: 'Understood.' }]
      : historyRef.current;
  };


  // Speech to text on the server. Returns the words, '' when nothing was
  // heard, or null when there is no signal (the caller keeps the clip).
  const transcribe = async (file, durationMs) => {
    setTranscribing(true);
    try {
      const audio = await blobToBase64(file);
      const b = surveyAgentBridge.current;
      const out = await call({ action: 'transcribe', audio, mime: file.type, duration_ms: durationMs, lang: AGENT_LANG, hints: transcriptionHints(b, { recent: recentItemsRef.current }) });
      const heard = snapItemNames(cleanTranscript(out?.text), Object.values(b?.markers || {}).map((m) => m?.name));
      voiceLog.event('heard', { source: 'server', text: heard });
      return heard;
    } catch (err) {
      if (WAIT_CODES.has(err?.code)) { waitReasonRef.current = err.code; return null; }
      push({ role: 'error', text: err?.message || 'Could not hear that. Try again or type it.', code: err?.code });
      return '';
    } finally {
      setTranscribing(false);
    }
  };
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  // The device's own hearing first (free); the server only when the device
  // heard nothing or was unsure. Same return values as transcribe.
  const deviceHearingRef = useRef(null);
  const awakeRef = useRef(null);
  const pttHearingRef = useRef(null);
  const hear = async (clip, durationMs, endedAt, hearing = deviceHearingRef.current) => {
    if (hearing?.available) {
      const heard = await hearing.heardFor(endedAt, durationMs);
      voiceLog.event('device_heard', { text: heard?.text || '', sure: isSureHearing(heard) });
      if (isSureHearing(heard)) {
        const b = surveyAgentBridge.current;
        return snapItemNames(cleanTranscript(heard.text), Object.values(b?.markers || {}).map((m) => m?.name));
      }
    }
    return transcribe(clip, durationMs);
  };

  const queueClip = (clip, durationMs) => {
    const entryId = newId('e');
    setEntries((list) => [...list, { id: entryId, role: 'user', text: 'Voice message', at: Date.now() }]);
    enqueue({ clip, durationMs, files: [], entryId, docKey: surveyAgentBridge.current?.waitKey || null });
  };

  // Tap or hold to talk: the mic pulses with the voice, and a tap (not a
  // hold) ends by itself once the person stops talking.
  const pttMeterRef = useRef(null);
  const [pttHearing, setPttHearing] = useState(false);
  const onPttSpeechRef = useRef(() => {});
  const recorder = useAudioRecorder({
    onStream: (stream) => {
      pttMeterRef.current?.stop();
      pttMeterRef.current = stream
        ? startStreamMeter(stream, { onSpeech: (said) => onPttSpeechRef.current(said), gateOptions: { endSilenceMs: TAP_END_SILENCE_MS } })
        : null;
      if (!stream) setPttHearing(false);
    },
    onRecorded: async (file, durationMs) => {
      voiceLog.turn('recorded', { ms: durationMs });
      const hearing = pttHearingRef.current;
      pttHearingRef.current = null;
      const endedAt = Date.now();
      if (queueRef.current.length) { hearing?.stop(); queueClip(file, durationMs); return; }
      const text = await hear(file, durationMs, endedAt, hearing);
      hearing?.stop();
      if (text === null) { queueClip(file, durationMs); return; }
      if (!text) return;
      // A typed message is still running: keep the words in the box to send next.
      if (turnRef.current) setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text));
      else sendRef.current(text);
    },
  });

  // Hands-free: each clip the mic cuts is heard, answered and (with voice
  // on) spoken, then the mic listens again. While the agent speaks the mic
  // is guarded: speaking up clearly cuts the agent off and is heard next.
  const joinerRef = useRef(null);
  const stopHandsFree = useCallback(() => {
    if (handsFreeRef.current) voiceLogRef.current?.event('hands_free_stop');
    // Words still held for joining are dropped with hands-free.
    joinerRef.current?.clear();
    clearTimeout(carryRef.current?.timer);
    carryRef.current = null;
    handsFreeRef.current = false;
    setHandsFree(false);
    setHearing(false);
    micRef.current?.stop();
    micRef.current = null;
    letGoOfWarmMic();
    deviceHearingRef.current?.stop();
    deviceHearingRef.current = null;
    awakeRef.current?.release();
    awakeRef.current = null;
    setMicLevel(0, { reset: true });
    stopSpeaking();
  }, []);

  // With the camera open, "take it" / "cancel" go straight to the camera:
  // the turn that opened it is still waiting on the photo.
  const handleCameraClip = async (clip, durationMs, endedAt) => {
    const text = await hear(clip, durationMs, endedAt);
    if (!text || !cameraRef.current) return;
    if (CANCEL_WORDS.test(text)) cameraRef.current.cancel();
    else if (SHUTTER_WORDS.test(text)) await cameraRef.current.capture();
  };

  // One clip at a time, in order. The mic keeps listening while the agent
  // works (people talk on) and while it speaks (people cut in).
  const handsFreeChainRef = useRef(Promise.resolve());
  const lastSpokenRef = useRef('');
  const handsFreePendingRef = useRef(0);
  const handleHandsFreeClip = async (clip, durationMs, { cutIn = false, endedAt = Date.now(), warm = false } = {}) => {
    if (!handsFreeRef.current) return;
    if (queueRef.current.length) { queueClip(clip, durationMs); return; }
    const text = await hear(clip, durationMs, endedAt, warm ? null : undefined);
    if (text === null) { queueClip(clip, durationMs); return; }
    await handleHandsFreeText(text, { cutIn });
  };
  // One thought, one turn (the way a live voice agent waits for the end of
  // what is said): words whose turn was talked over, or that stopped
  // mid-thought, wait here and lead the next turn. If nothing more comes,
  // they go out alone; after a stop mid-thought, with a note to answer now.
  const takeCarry = () => {
    const held = carryRef.current;
    if (!held) return '';
    clearTimeout(held.timer);
    carryRef.current = null;
    return held.text;
  };
  const CARRY_WAIT_MS = { talkedOver: 4000, unfinished: 6000 };
  const carry = (words, { unfinished = false } = {}) => {
    const text = String(words || '').trim();
    if (!text) return;
    const held = carryRef.current;
    if (held) clearTimeout(held.timer);
    const next = { text: held ? `${held.text} ${text}` : text, unfinished };
    const check = () => {
      if (carryRef.current !== next) return;
      // Still talking, or a turn is on its way: it will take the words.
      if (!handsFreeRef.current) { carryRef.current = null; return; }
      if (hearingRef.current || joinerRef.current?.holding || handsFreePendingRef.current > 0) {
        next.timer = setTimeout(check, 1000);
        return;
      }
      const alone = takeCarry();
      runHandsFree(() => handleHandsFreeTextRef.current(alone, { note: next.unfinished ? 'Nothing more was said. Answer now; do not reply with only "…".' : null }));
    };
    next.timer = setTimeout(check, unfinished ? CARRY_WAIT_MS.unfinished : CARRY_WAIT_MS.talkedOver);
    carryRef.current = next;
  };

  // What was said, as words: from a clip, or from the phone's own hearing.
  const handleHandsFreeText = async (heardText, { cutIn = false, note = null } = {}) => {
    if (!heardText || !handsFreeRef.current) return;
    // Cut in on the agent, but it was the agent's own voice leaking back in.
    if (cutIn && heardOwnVoice(heardText, lastSpokenRef.current)) return;
    // Words from a turn that was talked over, or stopped mid-thought, lead.
    const carried = takeCarry();
    const text = carried ? `${carried} ${heardText}` : heardText;
    if (turnRef.current) { setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)); return; }
    const reply = await send(text, { spoken: true, onCarry: carry, note });
    const mic = micRef.current;
    // Not while the person is already saying something else.
    if (reply && speakRef.current && handsFreeRef.current && mic?.guard() !== false) {
      lastSpokenRef.current = spokenReply(reply);
      setPhase('speaking');
      voiceLog.event('speaking', { chars: reply.length });
      await speak(reply);
      voiceLog.event('spoke');
      setPhase('working');
      mic?.unguard();
    }
    const last = entriesRef.current[entriesRef.current.length - 1];
    // Out of allowance: stop listening and say why.
    if (last?.code === 'monthly_cap_reached' || last?.code === 'credit_used_up' || last?.code === 'not_enabled_for_you') {
      if (speakRef.current) await speak(last.text);
      stopHandsFree();
      return;
    }
  };
  // In order, one turn at a time.
  const runHandsFree = (job) => {
    handsFreePendingRef.current += 1;
    setPhase('working');
    handsFreeChainRef.current = handsFreeChainRef.current
      .then(job)
      .catch(() => {})
      .finally(() => {
        handsFreePendingRef.current -= 1;
        if (!handsFreePendingRef.current && handsFreeRef.current) setPhase('listening');
      });
  };
  // Clips cut at short pauses are one turn: heard together, sent once.
  const onJoinedTurn = (parts) => {
    const clips = parts.filter((p) => p.clip);
    const cutIn = parts.some((p) => p.cutIn);
    const warm = clips.some((p) => p.warm);
    if (!clips.length) {
      const text = joinTurnText(parts);
      if (text) runHandsFree(() => handleHandsFreeTextRef.current(text, { cutIn }));
      return;
    }
    const first = clips[0];
    const last = clips[clips.length - 1];
    // From the first clip's start to the last one's end.
    const spanMs = Math.max(last.endedAt - (first.endedAt - first.durationMs), last.durationMs);
    runHandsFree(async () => {
      const clip = await joinWavs(clips.map((p) => p.clip));
      await handleHandsFreeClipRef.current(clip, spanMs, { cutIn, endedAt: last.endedAt, warm });
    });
  };
  const onJoinedTurnRef = useRef(onJoinedTurn);
  onJoinedTurnRef.current = onJoinedTurn;
  if (!joinerRef.current) {
    joinerRef.current = createTurnJoiner({
      onTurn: (parts) => onJoinedTurnRef.current(parts),
      // What the device heard so far: a turn that stops on "and" waits on.
      peek: () => deviceHearingRef.current?.latestText?.() || '',
    });
  }
  const onHearingChange = (on) => {
    setHearing(on);
    hearingRef.current = on;
    // Talking again while a spoken turn works: stop it if it changed nothing
    // yet, and say it all as one turn.
    if (on && activeTurnRef.current?.spoken) activeTurnRef.current.stop = true;
    // The phone's own hearing gives no loudness: a steady pulse while it hears.
    if (micRef.current?.native) setMicLevel(on ? 0.7 : 0, { reset: !on });
    // A new log turn only when nothing is held for joining: clips joined
    // into one message stay in one log turn.
    if (!on) voiceLog.event('speech_end');
    else if (joinerRef.current.holding) voiceLog.event('speech_start');
    else voiceLog.turn('speech_start');
    joinerRef.current.hearing(on);
  };
  const onHandsFreeClip = (clip, durationMs, info) => {
    const endedAt = Date.now();
    voiceLog.event('clip', { ms: durationMs, cut_in: Boolean(info?.cutIn), warm: Boolean(info?.warm), camera: Boolean(cameraRef.current) });
    if (cameraRef.current) { handleCameraClip(clip, durationMs, endedAt).catch(() => {}); return; }
    joinerRef.current.add({ clip, durationMs, endedAt, cutIn: Boolean(info?.cutIn), warm: Boolean(info?.warm) });
  };
  const handleHandsFreeClipRef = useRef(handleHandsFreeClip);
  handleHandsFreeClipRef.current = handleHandsFreeClip;
  // The phone's own hearing (iPhone and Android apps): words, in order.
  const onNativeText = (raw, { cutIn, unsure }) => {
    const b = surveyAgentBridge.current;
    const text = snapItemNames(cleanTranscript(raw), Object.values(b?.markers || {}).map((m) => m?.name));
    voiceLog.event('native_heard', { raw, text, unsure: Boolean(unsure), cut_in: Boolean(cutIn) });
    if (cameraRef.current) {
      if (CANCEL_WORDS.test(text)) cameraRef.current.cancel();
      else if (SHUTTER_WORDS.test(text)) cameraRef.current.capture().catch(() => {});
      return;
    }
    if (unsure) {
      if (speakRef.current) speak(agentSays('sayAgain')).catch(() => {});
      return;
    }
    joinerRef.current.add({ text, cutIn: Boolean(cutIn) });
  };
  const handleHandsFreeTextRef = useRef(null);
  handleHandsFreeTextRef.current = handleHandsFreeText;
  const onNativeTextRef = useRef(onNativeText);
  onNativeTextRef.current = onNativeText;
  const onHandsFreeClipRef = useRef(onHandsFreeClip);
  onHandsFreeClipRef.current = onHandsFreeClip;

  const startHandsFree = async () => {
    voiceLog.tap('hands_free_tap');
    unlockPlayback();
    if (recorder.state !== 'idle') recorder.stop();
    if (speechRef.current) speechRef.current.stop();
    try {
      // In the phone apps, the phone's own speech to text hears the person;
      // the web mic and the server only when it can't.
      const speech = await loadNativeSpeech();
      micRef.current = speech
        ? await startNativeHandsFree({
          speech,
          lang: agentLocale(),
          onText: (text, info) => onNativeTextRef.current(text, info),
          onHearing: (on) => onHearingChange(on),
          onBargeIn: () => stopSpeaking(),
          spokenNow: () => lastSpokenRef.current,
          offline: isFeatureOn(OFFLINE_FLAG),
          onFatal: () => { if (handsFreeRef.current) restartHandsFreeRef.current(); },
        }).catch(() => null)
        : null;
      micRef.current = micRef.current || await startHandsFreeMic({
        onClip: (clip, ms, info) => onHandsFreeClipRef.current(clip, ms, info),
        onHearing: (on) => onHearingChange(on),
        onBargeIn: () => stopSpeaking(),
        onLevel: (v) => setMicLevel(levelFromRms(v)),
      });
      voiceLog.event('mic_started', { native: Boolean(micRef.current.native) });
      if (!micRef.current.native) {
        // Offline speech pack (Chrome/Edge): fetched once, then heard with no signal.
        if (isFeatureOn(OFFLINE_FLAG)) await prepareLocalHearing(agentLocale());
        deviceHearingRef.current = startDeviceHearing({ lang: agentLocale() });
      }
      awakeRef.current?.release();
      awakeRef.current = keepScreenAwake();
      handsFreeRef.current = true;
      setHandsFree(true);
      setPhase('listening');
    } catch (err) {
      voiceLog.error('mic_failed', { name: err?.name || null, message: err?.message || null });
      push({ role: 'error', text: err?.name === 'NotAllowedError' ? 'Allow the microphone to talk hands-free.' : 'The microphone could not start.' });
    }
  };

  const startHandsFreeRef = useRef(startHandsFree);
  startHandsFreeRef.current = startHandsFree;
  // The phone's hearing stopped for good mid-walk (permission taken away, the
  // language not offered): carry on with the web mic and the server.
  const restartHandsFreeRef = useRef(null);
  restartHandsFreeRef.current = async () => {
    micRef.current?.stop();
    try {
      micRef.current = await startHandsFreeMic({
        onClip: (clip, ms, info) => onHandsFreeClipRef.current(clip, ms, info),
        onHearing: (on) => onHearingChange(on),
        onBargeIn: () => stopSpeaking(),
        onLevel: (v) => setMicLevel(levelFromRms(v)),
      });
    } catch {
      stopHandsFree();
      push({ role: 'error', text: 'The microphone could not start.' });
    }
  };

  const speechMeterRef = useRef(null);
  // Cancel: stop hearing and drop what was heard, with nothing sent.
  const cancelBrowserSpeech = () => {
    const rec = speechRef.current;
    if (!rec) return;
    rec.cancelled = true;
    try { rec.abort(); } catch { /* already stopped */ }
  };
  const toggleBrowserSpeech = () => {
    const Recognition = browserSpeech();
    if (!Recognition) return;
    if (speechRef.current) {
      speechRef.current.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = agentLocale();
    if (isFeatureOn(OFFLINE_FLAG)) {
      hearLocally(rec, rec.lang);
      prepareLocalHearing(rec.lang);
    }
    rec.interimResults = true;
    rec.continuous = true;
    let finalText = '';
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      setDraft(`${finalText}${interim}`.trim());
    };
    rec.onerror = () => {};
    rec.onend = () => {
      speechRef.current = null;
      speechMeterRef.current?.stop();
      speechMeterRef.current = null;
      setListening(false);
      if (rec.cancelled) { setDraft(''); return; }
      // Send what is in the box, so a word fixed while listening is kept.
      const typed = draftRef.current.trim();
      if (typed || finalText.trim()) sendRef.current(typed || finalText);
    };
    speechRef.current = rec;
    setListening(true);
    rec.start();
    if (!sharesMicSafely()) {
      // Phones go quiet or cut the browser's hearing off when a second stream
      // opens the mic, so the pulse follows the browser's speech events instead.
      // No stream readings follow, so set the level outright instead of easing
      // toward it (one eased step only reaches 0.42).
      rec.onspeechstart = () => setMicLevel(0.7, { reset: true });
      rec.onspeechend = () => setMicLevel(0, { reset: true });
      speechMeterRef.current = { stop: () => setMicLevel(0, { reset: true }) };
      return;
    }
    // The browser hears for itself; a second look at the mic just for the pulse.
    navigator.mediaDevices?.getUserMedia?.({ audio: true }).then((stream) => {
      if (speechRef.current !== rec) { stream.getTracks().forEach((t) => t.stop()); return; }
      const meter = startStreamMeter(stream);
      speechMeterRef.current = { stop: () => { meter.stop(); stream.getTracks().forEach((t) => t.stop()); } };
    }).catch(() => {});
  };

  const canTalk = Boolean(status?.transcription) || Boolean(browserSpeech());
  const recording = recorder.state !== 'idle' || listening;
  const startTalk = () => {
    if (recorder.state !== 'idle') return;
    pttHearingRef.current?.stop();
    // The offline speech pack is checked for next time (a tap may fetch it).
    if (isFeatureOn(OFFLINE_FLAG)) prepareLocalHearing(agentLocale());
    pttHearingRef.current = startDeviceHearing({ lang: agentLocale() });
    recorder.start();
  };
  // Let go before the mic is open (the permission prompt): send once it is.
  const stopWhenOpenRef = useRef(false);
  const stopTalk = () => {
    if (recorder.state === 'starting') stopWhenOpenRef.current = true;
    else recorder.stop();
  };
  useEffect(() => {
    if (recorder.state === 'recording' && stopWhenOpenRef.current) recorder.stop();
    if (recorder.state !== 'starting') stopWhenOpenRef.current = false;
  }, [recorder.state, recorder]);
  const cancelTalk = () => {
    stopWhenOpenRef.current = false;
    pttHearingRef.current?.stop();
    pttHearingRef.current = null;
    recorder.cancel();
  };
  const toggleTalk = () => {
    unlockPlayback();
    if (status?.transcription) {
      if (recorder.state === 'recording') recorder.stop();
      else startTalk();
    } else {
      toggleBrowserSpeech();
    }
  };
  // Hold the mic to talk, let go to send, slide away to cancel; a tap still
  // starts and the next tap sends. Only for the recorder: the browser's own
  // speech recognition keeps tap on, tap off.
  const [holdUi, setHoldUi] = useState({ holding: false, cancelling: false });
  const holdRef = useRef(null);
  const talkRef = useRef(null);
  talkRef.current = { startTalk, stopTalk, cancelTalk, recording: () => recorder.state !== 'idle' };
  if (!holdRef.current) {
    holdRef.current = createHoldToTalk({
      start: () => talkRef.current.startTalk(),
      stop: () => talkRef.current.stopTalk(),
      cancel: () => talkRef.current.cancelTalk(),
      recording: () => talkRef.current.recording(),
      onChange: setHoldUi,
    });
  }
  const holdable = Boolean(status?.transcription);
  onPttSpeechRef.current = (said) => {
    setPttHearing(said === 'start');
    if (said === 'end' && !holdUi.holding && recorder.state === 'recording') {
      voiceLog.event('tap_speech_end');
      recorder.stop();
    }
  };
  // Only the finger that started the press counts: a second touch must not
  // take over (and send what the first was cancelling).
  const holdPointerRef = useRef(null);
  const ownPointer = (e) => e.pointerId === holdPointerRef.current;

  const addFiles = (fileList) => {
    const added = [];
    for (const file of Array.from(fileList || [])) {
      const kind = classifyMediaFile(file);
      if (!kind) continue;
      const id = newId('a');
      attachmentsRef.current.set(id, { file, kind, name: file.name || kind });
      added.push({ id, kind, name: file.name || kind });
    }
    if (added.length) setPendingFiles((list) => [...list, ...added]);
  };

  // The end-of-walk summary as a text file: the share sheet on a phone
  // (Mail, Messages, Files...), else a download (the native app turns a
  // download into its share sheet too).
  const saveSummary = async ({ title, text }) => {
    const name = `${String(title || 'Survey summary').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.txt`;
    const file = new File([text], name, { type: 'text/plain' });
    try {
      if (mobileMode && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  saveSummaryRef.current = saveSummary;

  const removePending = (id) => {
    attachmentsRef.current.delete(id);
    setPendingFiles((list) => list.filter((f) => f.id !== id));
  };

  const ready = status?.enabled && !status?.over_cap && aiConsented;
  const statusText = !aiConsented ? null
    : !status ? 'Connecting...'
    : !status.enabled || status.over_cap ? surveyAgentErrorText(status.reason)
      : queued ? (waitReasonRef.current === 'busy_try_again'
        ? `Busy for a moment. ${queued === 1 ? '1 message is' : `${queued} messages are`} waiting and will send shortly.`
        : `No signal. ${queued === 1 ? '1 message is' : `${queued} messages are`} waiting and will send when you are back online.`)
        : usageWarning(usageLeft);
  const livePhase = hearing ? 'hearing' : phase === 'speaking' ? 'speaking' : transcribing || busy || phase === 'working' ? 'working' : 'listening';
  const handsFreeText = handsFree ? HANDS_FREE_TEXT[livePhase] : null;

  // The Survey panel's mic and dots follow what the agent is doing.
  const activity = handsFree ? livePhase : (busy || transcribing ? 'working' : 'idle');
  useEffect(() => { onActivity({ handsFree, phase: activity }); }, [handsFree, activity, onActivity]);

  // Each tap of the Survey panel's mic starts or stops hands-free, once the
  // server has said whether this person can use the agent. When hands-free
  // can't run here, the chat opens so the reason (or the keyboard) shows.
  const askHandledRef = useRef(0);
  useEffect(() => {
    if (!status || handsFreeAsk <= askHandledRef.current) return;
    askHandledRef.current = handsFreeAsk;
    if (handsFreeRef.current) { stopHandsFree(); letGoOfWarmMic(); return; }
    if (ready && status.transcription && canHandsFree()) startHandsFreeRef.current();
    else { letGoOfWarmMic(); onShowChatRef.current(); }
  }, [handsFreeAsk, status, ready, stopHandsFree]);

  // A tap anywhere outside the chat goes back to the Survey panel.
  const sectionRef = useRef(null);
  useEffect(() => {
    if (view !== 'chat' || !host) return undefined;
    const outside = (e) => {
      const t = e.target;
      if (!(t instanceof Element) || sectionRef.current?.contains(t) || t.closest('[data-survey-agent-dots]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [view, host, onClose]);

  const thinking = busy || transcribing;
  // The right-hand button is hands-free until there is something to send.
  // While hands-free is on, typed words or a file get a Send beside Stop, so
  // they can go without ending the voice session (Codex review on #1199).
  const handsFreeAvailable = Boolean(status?.transcription) && canHandsFree();
  const hasContent = Boolean(draft.trim()) || pendingFiles.length > 0;
  const showSend = hasContent || (!handsFree && !handsFreeAvailable);
  const showHandsFree = handsFree || (handsFreeAvailable && !showSend);
  const micHearing = handsFree ? livePhase === 'hearing' : pttHearing || listening;
  const panel = (
    <section
      ref={sectionRef}
      className={`survey-agent${mobileMode ? ' is-phone' : ''}${host ? ' is-inline' : ''}`}
      role={host ? 'region' : 'dialog'}
      aria-label="Survey agent"
      data-testid="survey-agent-panel"
      hidden={view !== 'chat'}
    >
      <header className="survey-agent__head">
        <span className="survey-agent__badge" aria-hidden="true"><SparkleIcon /></span>
        <span className="survey-agent__title">Survey agent <span className="survey-agent__beta">Beta</span></span>
        {/* Icons, not text links: with "Send voice log" and "Learned" as
            words the name and its Beta pill were cut off ("Survey a…") in
            the 320px side panel and on phones. */}
        {logState !== null || entries.length > 0 ? (() => {
          const logLabel = logState === 'sent' ? 'Voice log sent' : logState === 'failed' ? 'Could not send the voice log. Try again' : logState === 'sending' ? 'Sending the voice log…' : 'Send voice log';
          return (
            <button
              type="button"
              className="survey-agent__icon"
              aria-label={logLabel}
              data-log-state={logState || 'idle'}
              {...tip(logLabel, 'below')}
              disabled={logState === 'sending'}
              onClick={() => sendLogRef.current('manual')}
            >
              <Icon name={logState === 'sent' ? 'check' : logState === 'failed' ? 'retry' : 'upload'} size={16} color="currentColor" />
            </button>
          );
        })() : null}
        {deviceModel.state === 'downloadable' || deviceModel.state === 'downloading' ? (() => {
          const progress = typeof deviceModel.progress === 'number' ? ` ${Math.round(deviceModel.progress * 100)}%` : '';
          const label = deviceModel.state === 'downloading'
            ? (deviceModel.engine === 'apple' ? 'The iPhone is still getting its own model' : `Getting the offline helper…${progress}`)
            : deviceModel.engine === 'browser'
              ? 'Get the offline helper: reads free speech with no signal (about 2 GB, use Wi-Fi)'
              : "Get the offline helper: the phone's own model reads free speech with no signal (use Wi-Fi)";
          return (
            <button type="button" className="survey-agent__icon" aria-label={label} data-testid="survey-agent-device-model" {...tip(label, 'below')} disabled={deviceModel.state === 'downloading'} onClick={fetchDeviceModel}>
              <Icon name="download" size={16} color="currentColor" />
            </button>
          );
        })() : null}
        {surveyAgentBridge.current?.projectId ? (
          <button type="button" className="survey-agent__icon" aria-label="Learned" {...tip('What the agent learned on this project', 'below')} onClick={() => setLearnedOpen(true)}>
            <Icon name="lightbulbOn" size={16} color="currentColor" />
          </button>
        ) : null}
        <button type="button" className="survey-agent__icon" aria-label={host ? 'Back to Survey' : 'Close Survey agent'} onClick={onClose}>
          <Icon name="close" size={16} color="currentColor" />
        </button>
      </header>
      <div className="survey-agent__list" ref={listRef} aria-live="polite">
        {!aiConsented && (
          <div className="survey-agent__consent" data-testid="survey-agent-consent">
            <span className="survey-agent__badge is-big" aria-hidden="true"><SparkleIcon /></span>
            <p className="survey-agent__hello">Before you start</p>
            <p className="survey-agent__hint">
              The agent uses AI from outside companies. What you type or say, voice recordings, photos you add, and the survey data it needs to answer go to OpenAI or Groq, which run the AI models that answer you and turn your speech into text. They use it only to answer you. Answers can be wrong, so check them.{' '}
              <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy policy</a>
            </p>
            {consentError ? <p className="survey-agent__status" role="alert">{consentError}</p> : null}
            <div className="survey-agent__suggestions">
              <button type="button" className="survey-agent__suggestion is-primary" disabled={consentSaving || !auth?.updateProfile} onClick={allowAi}>
                {consentSaving ? 'Saving…' : 'Allow and continue'}
              </button>
              <button type="button" className="survey-agent__suggestion" onClick={onClose}>
                Not now
              </button>
            </div>
          </div>
        )}
        {aiConsented && !entries.length && (
          <div className="survey-agent__empty">
            <span className="survey-agent__badge is-big" aria-hidden="true"><SparkleIcon /></span>
            <p className="survey-agent__hello">What do you see?</p>
            <p className="survey-agent__hint">
              Talk or type about an item and I fill in its checklist, note, entity and photos. Add photos with the clip.
            </p>
            <div className="survey-agent__suggestions">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="survey-agent__suggestion"
                  disabled={!ready || thinking}
                  onClick={() => { unlockPlayback(); sendAndSpeak(text); }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`survey-agent__msg is-${entry.role}`}>
            {entry.role === 'agent' && <span className="survey-agent__badge" aria-hidden="true"><SparkleIcon /></span>}
            <div className="survey-agent__body">
              <div className="survey-agent__bubble">
                {entry.role === 'error' && <Icon name="warningCircle" size={14} color="currentColor" />}
                <span>{entry.text}</span>
                {entry.waiting ? <div className="survey-agent__files">Waiting for signal</div> : null}
                {entry.offline ? <div className="survey-agent__files" data-testid="survey-agent-offline-done">{entry.byModel ? 'Read by the model on this device, no signal needed. Check it.' : entry.changes?.length ? 'Done on this device, no signal needed' : 'Answered on this device, no signal needed'}</div> : null}
                {entry.files?.length ? <div className="survey-agent__files">{entry.files.join(', ')}</div> : null}
              </div>
              {entry.at ? (
                <div className="survey-agent__time" data-testid="survey-agent-time">
                  <time dateTime={new Date(entry.at).toISOString()}>{clockTime(entry.at)}</time>
                  {entry.tookMs != null ? <span>{` · took ${tookText(entry.tookMs)}`}</span> : null}
                </div>
              ) : null}
              {entry.choice ? (
                <div className="survey-agent__offer survey-agent__choice" data-testid="survey-agent-choice" data-choice-state={entry.choice.state}>
                  {entry.choice.state === 'open' ? (
                    <>
                      <div className="survey-agent__offer-actions">
                        {entry.choice.options.map((o) => (
                          <button key={o.id} type="button" className="survey-agent__suggestion" disabled={thinking} onClick={() => answerChoice(entry, { pick: [o] })}>
                            {`Page ${o.page}`}{o.sheet ? <span className="survey-agent__choice-sheet">{` ${o.spot === 'table' ? `${o.sheet} table` : o.sheet}`}</span> : null}
                          </button>
                        ))}
                        <button type="button" className="survey-agent__suggestion" disabled={thinking} onClick={() => answerChoice(entry, { pick: entry.choice.options })}>
                          {entry.choice.options.length === 2 ? 'Both' : 'All'}
                        </button>
                        <button type="button" className="survey-agent__suggestion" disabled={thinking} onClick={() => answerChoice(entry, { none: true })}>
                          {entry.choice.options.length === 2 ? 'Neither' : 'None'}
                        </button>
                        <button type="button" className="survey-agent__suggestion" disabled={thinking} onClick={() => answerChoice(entry, { other: true })}>
                          Other
                        </button>
                      </div>
                      {entry.choice.canRemember && entry.choice.options.every((o) => o.sheet) ? (
                        <div className="survey-agent__offer-actions survey-agent__remember" role="group" aria-label="Remember this answer">
                          <button type="button" className="survey-agent__suggestion" aria-pressed={!entry.choice.remember} onClick={() => setChoice(entry.id, { remember: false })}>
                            Just this time
                          </button>
                          <button type="button" className="survey-agent__suggestion" aria-pressed={entry.choice.remember} onClick={() => setChoice(entry.id, { remember: true })}>
                            Remember for this project
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : <span className="survey-agent__undone">{entry.choice.answer}</span>}
                </div>
              ) : null}
              {entry.offers?.map((offer, i) => (
                <div key={i} className="survey-agent__offer" data-testid="survey-agent-offer" data-offer-state={offer.state}>
                  <p className="survey-agent__offer-text">
                    {offer.kind === 'line'
                      ? <>Add &ldquo;{offer.text}&rdquo; to the {offer.categoryName} checklist{offer.itemName ? <>, set to {offer.answer} on {offer.itemName}</> : null}?</>
                      : <>Add the category {offer.name}{offer.moduleName ? <> to {offer.moduleName}</> : null}?</>}
                  </p>
                  {offer.state === 'open' || offer.state === 'adding' ? (
                    <div className="survey-agent__offer-actions">
                      <button type="button" className="survey-agent__suggestion is-primary" disabled={offer.state === 'adding'} onClick={() => answerOffer(entry, i, true)}>
                        {offer.state === 'adding' ? 'Adding…' : 'Yes'}
                      </button>
                      <button type="button" className="survey-agent__suggestion" disabled={offer.state === 'adding'} onClick={() => answerOffer(entry, i, false)}>
                        No
                      </button>
                    </div>
                  ) : (
                    <span className="survey-agent__undone">
                      {offer.state === 'added' ? 'Added to the template' : offer.state === 'declined' ? 'Not added' : 'Could not add it. Add it in the template instead.'}
                    </span>
                  )}
                </div>
              ))}
              {entry.changes?.length ? (
                <div className={`survey-agent__changes${entry.undone ? ' is-undone' : ''}`} data-testid="survey-agent-changes">
                  <ul>
                    {entry.changes.map((change, i) => (
                      <li key={i}><Icon name="check" size={12} color="currentColor" /><span>{change.label}</span></li>
                    ))}
                  </ul>
                  {entry.undone
                    ? <span className="survey-agent__undone">{entry.undone === 'partly' ? 'Undone, later edits kept' : 'Undone'}</span>
                    : <button type="button" className="survey-agent__undo" onClick={() => undoEntry(entry)}><Icon name="undo" size={12} color="currentColor" />Undo</button>}
                </div>
              ) : null}
              {entry.role === 'agent' && entry.text && !entry.offline ? (
                <button
                  type="button"
                  className="survey-agent__report"
                  disabled={entry.reported === 'sending' || entry.reported === 'sent'}
                  onClick={() => reportEntry(entry)}
                >
                  {entry.reported === 'sent' ? 'Reported. Thanks' : entry.reported === 'failed' ? 'Could not report. Try again' : entry.reported === 'sending' ? 'Reporting…' : 'Report answer'}
                </button>
              ) : null}
              {entry.summary ? (
                <button type="button" className="survey-agent__undo survey-agent__save" onClick={() => saveSummary(entry.summary)}>
                  Save summary
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="survey-agent__msg is-agent is-thinking" role="status">
            <span className="survey-agent__badge is-spinning" aria-hidden="true"><SparkleIcon /></span>
            <span className="survey-agent__shimmer">{transcribing ? 'Listening back...' : 'Working...'}</span>
          </div>
        )}
      </div>
      {handsFreeText && (
        <p className={`survey-agent__live is-${livePhase}`} role="status">
          <span className="survey-agent__dot" aria-hidden="true" />
          {handsFreeText}
        </p>
      )}
      {camera && (
        <SurveyAgentCamera
          key={camera.itemId}
          ref={cameraRef}
          itemName={camera.name}
          handsFree={handsFree}
          onDone={closeCamera}
        />
      )}
      {statusText && <p className="survey-agent__status" role="status">{statusText}</p>}
      <form
        className="survey-agent__composer"
        onSubmit={(e) => { e.preventDefault(); unlockPlayback(); sendAndSpeak(draft); }}
      >
        <div className={`survey-agent__box${recording ? ' is-recording' : ''}`}>
          {pendingFiles.length > 0 && (
            <div className="survey-agent__pending">
              {pendingFiles.map((f) => (
                <span key={f.id} className="survey-agent__chip">
                  <Icon name={f.kind === 'video' ? 'video' : f.kind === 'audio' ? 'mic' : 'image'} size={12} color="currentColor" />
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removePending(f.id)}>
                    <Icon name="close" size={12} color="currentColor" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            multiple
            hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
          {/* Owner 2026-10-26 (after ChatGPT's phone chat box): while the
              mic records, the typing line turns into a live waveform. */}
          {recording ? (
            <div className="survey-agent__wave-row" role="status" aria-label={micHearing ? 'Hearing you' : 'Listening'}>
              <MicWaveform />
              {listening && draft ? <span className="survey-agent__wave-text">{draft.length > 60 ? `…${draft.slice(-60)}` : draft}</span> : null}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              className="survey-agent__input"
              rows={1}
              value={draft}
              placeholder={handsFree ? 'Hands-free is on. Just talk.' : 'Ask, or say what you see'}
              aria-label="Message the Survey agent"
              disabled={!ready}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); unlockPlayback(); sendAndSpeak(draft); }
              }}
            />
          )}
          {/* One row of tools inside the box: attach and read-aloud on the
              left; talk, then hands-free (or Send once there is something to
              send) on the right. Recording swaps the left side for Cancel. */}
          <div className="survey-agent__tools">
            {recording && !handsFree ? (
              <button
                type="button"
                className="survey-agent__icon"
                aria-label="Cancel"
                {...tip('Cancel', 'right')}
                onClick={() => { if (listening) cancelBrowserSpeech(); else cancelTalk(); }}
              >
                <Icon name="close" size={18} color="currentColor" />
              </button>
            ) : (
              <>
                <button type="button" className="survey-agent__icon" aria-label="Add photos or files" {...tip('Add photos or files', 'right')} disabled={!ready} onClick={() => fileInputRef.current?.click()}>
                  <Icon name="paperclip" size={18} color="currentColor" />
                </button>
                {canSpeakReplies() && (
                  <button
                    type="button"
                    className="survey-agent__icon"
                    aria-pressed={speakReplies}
                    aria-label={speakReplies ? 'Read replies aloud: on' : 'Read replies aloud: off'}
                    {...tip(speakReplies ? 'Replies are read aloud. Tap to stop.' : 'Replies are not read aloud. Tap to hear them.', 'right')}
                    onClick={toggleSpeak}
                  >
                    <SpeakerIcon muted={!speakReplies} />
                  </button>
                )}
                {isFeatureOn(TEMPLATE_OFFERS_FLAG) && (
                  <button
                    type="button"
                    className="survey-agent__icon"
                    aria-label={noteStyle === 'bullets' ? 'Notes as bullets' : 'Notes as sentences'}
                    data-note-style={noteStyle}
                    {...tip(noteStyle === 'bullets' ? 'Notes are written as bullets. Tap for sentences.' : 'Notes are written as sentences. Tap for bullets.', 'right')}
                    onClick={toggleNoteStyle}
                  >
                    <NoteStyleIcon bullets={noteStyle === 'bullets'} />
                  </button>
                )}
              </>
            )}
            <span className="survey-agent__spacer" />
            {canTalk && (
              <button
                type="button"
                className={`survey-agent__icon survey-agent__mic${recording ? ' is-on' : ''}${micHearing ? ' is-hearing' : ''}${holdUi.cancelling ? ' is-cancel' : ''}`}
                aria-label={recording ? 'Stop and send' : 'Talk'}
                {...tip(holdable && !recording ? 'Tap to talk (it sends when you stop), or hold' : undefined, 'left')}
                aria-pressed={recording}
                disabled={!ready || handsFree || (thinking && !recording)}
                onPointerDown={holdable ? (e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  if (holdPointerRef.current !== null) return;
                  holdPointerRef.current = e.pointerId;
                  try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
                  unlockPlayback();
                  holdRef.current.down(e.clientX, e.clientY, e.timeStamp);
                } : undefined}
                onPointerMove={holdable ? (e) => { if (ownPointer(e)) holdRef.current.move(e.clientX, e.clientY, e.timeStamp); } : undefined}
                onPointerUp={holdable ? (e) => {
                  if (!ownPointer(e)) return;
                  holdPointerRef.current = null;
                  holdRef.current.up(e.timeStamp);
                } : undefined}
                onPointerCancel={holdable ? (e) => {
                  if (!ownPointer(e)) return;
                  holdPointerRef.current = null;
                  holdRef.current.abort();
                } : undefined}
                onContextMenu={holdable ? (e) => e.preventDefault() : undefined}
                // A pointer press is handled above; a keyboard press (detail 0)
                // or the browser's own speech still toggles here.
                onClick={(e) => { if (!holdable || e.detail === 0) toggleTalk(); }}
              >
                <span className="survey-agent__mic-ring" aria-hidden="true" />
                {recording ? <ArrowUpIcon /> : <Icon name="mic" size={18} color="currentColor" />}
              </button>
            )}
            {!(recording && !handsFree) && showSend && (
              <button
                type="submit"
                className="survey-agent__send"
                aria-label="Send"
                {...tip('Send', 'left')}
                disabled={!ready || thinking || (!draft.trim() && !pendingFiles.length)}
              >
                <ArrowUpIcon />
              </button>
            )}
            {!(recording && !handsFree) && showHandsFree && (
              <button
                type="button"
                className={`survey-agent__send survey-agent__handsfree${handsFree ? ' is-on' : ''}`}
                aria-pressed={handsFree}
                aria-label={handsFree ? 'Stop hands-free' : 'Hands-free'}
                {...tip(handsFree ? 'Stop hands-free' : 'Hands-free: just talk, hear the reply, talk again', 'left')}
                disabled={!ready && !handsFree}
                onClick={handsFree ? stopHandsFree : startHandsFree}
              >
                {handsFree ? <StopIcon /> : <WaveIcon />}
              </button>
            )}
          </div>
          {holdUi.holding && (
            <span className="survey-agent__hold-hint" role="status">
              {holdUi.cancelling ? 'Let go to cancel' : 'Let go to send. Slide away to cancel.'}
            </span>
          )}
        </div>
      </form>
      {learnedOpen && surveyAgentBridge.current?.projectId ? (
        <AgentLearnedDialog
          store={agentMemory}
          projectId={surveyAgentBridge.current.projectId}
          canEdit={surveyAgentBridge.current.canEdit !== false}
          onClose={() => setLearnedOpen(false)}
        />
      ) : null}
    </section>
  );
  return typeof document !== 'undefined' ? createPortal(panel, host || document.body) : panel;
}
