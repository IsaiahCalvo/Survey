// The Survey agent chat (KAL-527, behind the survey_agent flag). The person
// types or talks about an item ("D-117 cables pulled, card reader missing, no
// power") and can add photos; the agent fills that item's checklist, note,
// entity and media through the Survey panel's own writes. Every reply that
// changed something lists the changes with one Undo for the whole turn.
// Hands-free mode keeps the mic open: talk, hear a short spoken reply, talk
// again, with no taps. With no signal, messages wait and send once it is back.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { supabase } from '../supabaseClient';
import { classifyMediaFile } from '../services/surveyMediaService';
import { answerSetFor } from '../services/answerSets.js';
import { createSurveyAgentToolbox, surveyAgentBridge } from '../agent/surveyAgentTools.js';
import { buildAnnotationTools } from '../agent/annotationTools.js';
import { ANNOTATION_AGENT_FLAG } from '../../supabase/functions/_shared/annotationAgentSpec.js';
import { activeAgentDocument } from '../agent/webmcp.js';
import { isFeatureOn } from '../featureFlags.js';
import { makeSurveyAgentCaller, runSurveyAgentTurn, surveyAgentErrorText, usageWarning, withRetries } from '../agent/surveyAgentClient.js';
import { cleanTranscript, heardOwnVoice, snapItemNames, spokenReply, transcriptionHints } from '../agent/voiceLoop.js';
import { canSpeakReplies, createAgentVoice, unlockPlayback } from '../agent/agentVoice.js';
import { startHandsFreeMic } from '../agent/handsFreeMic.js';
import { startNativeHandsFree } from '../agent/nativeHandsFree.js';
import { loadNativeSpeech } from '../agent/nativeSpeechLoader.js';
import { isSureHearing, startDeviceHearing } from '../agent/deviceHearing.js';
import { keepScreenAwake } from '../agent/keepAwake.js';
import { AGENT_LANGS, CANCEL_WORDS, SHUTTER_WORDS, agentLocale, agentSays, readAgentLang, writeAgentLang } from '../agent/agentLanguage.js';
import { dropWaiting, keepWaiting, loadWaiting } from '../agent/waitingStore.js';
import { useAudioRecorder } from './SurveyMediaCapture';
import SurveyAgentCamera from './SurveyAgentCamera';
import './surveyAgentPanel.css';

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
const canHandsFree = () => typeof window !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && Boolean(window.AudioContext || window.webkitAudioContext);

const HANDS_FREE_TEXT = {
  listening: 'Listening. Just talk.',
  hearing: 'Hearing you...',
  working: 'Working...',
  speaking: 'Speaking. Talk to cut in.',
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

export default function SurveyAgentPanel({ onClose, mobileMode = false }) {
  const [usageLeft, setUsageLeft] = useState(null);
  const rawCall = useMemo(() => makeSurveyAgentCaller(supabase, { onUsage: setUsageLeft }), []);
  const call = useMemo(() => withRetries(rawCall), [rawCall]);
  // Spoken replies: the server's natural voice when it has one, else the
  // device's own voice.
  const voice = useMemo(() => createAgentVoice({ call: rawCall }), [rawCall]);
  // English or Spanish: how it hears, answers and speaks.
  const [lang, setLang] = useState(() => readAgentLang());
  const langRef = useRef(lang);
  langRef.current = lang;
  const speak = (text, opts = {}) => voice.speak(text, { locale: agentLocale(langRef.current), ...opts });
  const stopSpeaking = voice.stop;
  const attachmentsRef = useRef(new Map());
  const [status, setStatus] = useState(null);
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const undoLastRef = useRef(() => null);
  const toolbox = useMemo(() => createSurveyAgentToolbox({ attachments: attachmentsRef.current, undoLastTurn: () => undoLastRef.current(), getDocument: activeAgentDocument }), []);
  // Messages said or typed with no signal, sent in order once it is back.
  const queueRef = useRef([]);
  const [queued, setQueued] = useState(0);
  const [handsFree, setHandsFree] = useState(false);
  // The camera take_photo opened: { itemId, name }, and how to answer it.
  const [camera, setCamera] = useState(null);
  const cameraRef = useRef(null);
  const photoResolveRef = useRef(null);
  const requestPhoto = useCallback(({ itemId, name }) => new Promise((resolve) => {
    photoResolveRef.current?.(null);
    photoResolveRef.current = resolve;
    setCamera({ itemId, name });
  }), []);
  const closeCamera = useCallback((file = null) => {
    const resolve = photoResolveRef.current;
    photoResolveRef.current = null;
    setCamera(null);
    resolve?.(file);
  }, []);
  const [phase, setPhase] = useState('listening');
  const [hearing, setHearing] = useState(false);
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
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(readSpeakSetting);
  const speakRef = useRef(speakReplies);
  speakRef.current = speakReplies;
  const historyRef = useRef([]);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
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

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  useEffect(() => () => {
    try { speechRef.current?.abort?.(); } catch { /* already stopped */ }
    handsFreeRef.current = false;
    micRef.current?.stop();
    deviceHearingRef.current?.stop();
    pttHearingRef.current?.stop();
    awakeRef.current?.release();
    stopSpeaking();
    // A turn waiting on the camera gets "no photo" rather than hanging.
    photoResolveRef.current?.(null);
  }, []);

  const toggleLang = () => {
    const next = lang === 'es' ? 'en' : 'es';
    setLang(next);
    langRef.current = next;
    writeAgentLang(next);
    // Hands-free: the device listens in the new language from now on.
    if (deviceHearingRef.current) {
      deviceHearingRef.current.stop();
      deviceHearingRef.current = startDeviceHearing({ lang: agentLocale(next) });
    }
    if (micRef.current?.native) {
      micRef.current.stop();
      micRef.current = null;
      startHandsFreeRef.current();
    }
  };

  const toggleSpeak = () => {
    const next = !speakReplies;
    if (next) unlockPlayback();
    setSpeakReplies(next);
    if (!next) stopSpeaking();
    try { window.localStorage.setItem(SPEAK_KEY, next ? '1' : '0'); } catch { /* storage blocked */ }
  };

  const push = (entry) => setEntries((list) => [...list, { id: newId('e'), ...entry }]);

  const markEntry = (id, patch) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));

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
    // Bound to this document: if the person opens another one mid-turn, the
    // remaining tools refuse instead of writing there.
    // Markup tools (notes, shapes, callouts, highlights), shared with
    // WebMCP, for people with the annotation-agent flag.
    const annotations = isFeatureOn(ANNOTATION_AGENT_FLAG);
    const turnToolbox = createSurveyAgentToolbox({
      attachments: attachmentsRef.current,
      documentId: bridge.documentId || null,
      undoLastTurn: () => undoLastRef.current(),
      extraTools: annotations ? buildAnnotationTools({ getDocument: openDocument, text: (v) => (typeof v === 'string' ? v : JSON.stringify(v)) }) : [],
      getDocument: activeAgentDocument,
      requestPhoto,
      walkItems: () => [...walkItemsRef.current],
    });
    try {
      const result = await runSurveyAgentTurn({
        history: historyRef.current,
        userText: `${job.said || 'Attach these files.'}${fileNote}${selectedNote}`,
        call,
        toolbox: turnToolbox,
        answerValues: answerSetFor(bridge.template).map((a) => a.value),
        annotations,
        lang: langRef.current,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      toolbox.settle(result.changes);
      // Items worked on lately: speech to text expects these names most.
      const touched = result.changes.map((c) => c.itemId).filter(Boolean);
      if (touched.length) recentItemsRef.current = [...recentItemsRef.current.filter((id) => !touched.includes(id)), ...touched].slice(-8);
      for (const id of touched) walkItemsRef.current.add(id);
      historyRef.current = result.history;
      if (job.entryId) markEntry(job.entryId, { waiting: false });
      push({ role: 'agent', text: result.reply, changes: result.changes, summary: result.summary || null });
      return result.reply;
    } catch (err) {
      // No signal (or too weak to finish) before anything changed: keep the
      // message for later. Each call is one model step with no writes on the
      // server, so sending it again later cannot double anything.
      if (WAIT_CODES.has(err?.code) && !err?.changes?.length) {
        waitReasonRef.current = err.code;
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
      turnRef.current = false;
      setBusy(false);
    }
  }, [call, toolbox]);

  const send = useCallback(async (text) => {
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
    setEntries((list) => [...list, { id: entryId, role: 'user', text: said || 'Attach these.', files: files.map((f) => f.name) }]);
    // Messages wait their turn behind ones still waiting for signal.
    const job = { said, files, entryId, docKey: surveyAgentBridge.current?.waitKey || null };
    if (queueRef.current.length) {
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
    if (quiet || retried) return;
    const busy = waitReasonRef.current === 'busy_try_again';
    const first = !savedNoticeRef.current;
    if (!busy) savedNoticeRef.current = true;
    speakOutRef.current(agentSays(langRef.current, busy ? 'savedBusy' : first ? 'savedFirst' : 'saved'), { here: true });
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
        setEntries((list) => [...list, { id: entryId, role: 'user', text: row.said || 'Voice message', waiting: true }]);
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
    return entry ? applyUndo(entry) : null;
  };

  const undoEntry = (entry) => {
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
      const out = await call({ action: 'transcribe', audio, mime: file.type, duration_ms: durationMs, lang: langRef.current, hints: transcriptionHints(b, { recent: recentItemsRef.current }) });
      return snapItemNames(cleanTranscript(out?.text), Object.values(b?.markers || {}).map((m) => m?.name));
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
      if (isSureHearing(heard)) {
        const b = surveyAgentBridge.current;
        return snapItemNames(cleanTranscript(heard.text), Object.values(b?.markers || {}).map((m) => m?.name));
      }
    }
    return transcribe(clip, durationMs);
  };

  const queueClip = (clip, durationMs) => {
    const entryId = newId('e');
    setEntries((list) => [...list, { id: entryId, role: 'user', text: 'Voice message' }]);
    enqueue({ clip, durationMs, files: [], entryId, docKey: surveyAgentBridge.current?.waitKey || null });
  };

  const recorder = useAudioRecorder({
    onRecorded: async (file, durationMs) => {
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
  const stopHandsFree = useCallback(() => {
    handsFreeRef.current = false;
    setHandsFree(false);
    setHearing(false);
    micRef.current?.stop();
    micRef.current = null;
    deviceHearingRef.current?.stop();
    deviceHearingRef.current = null;
    awakeRef.current?.release();
    awakeRef.current = null;
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
  const handleHandsFreeClip = async (clip, durationMs, { cutIn = false, endedAt = Date.now() } = {}) => {
    if (!handsFreeRef.current) return;
    if (queueRef.current.length) { queueClip(clip, durationMs); return; }
    const text = await hear(clip, durationMs, endedAt);
    if (text === null) { queueClip(clip, durationMs); return; }
    await handleHandsFreeText(text, { cutIn });
  };
  // What was said, as words: from a clip, or from the phone's own hearing.
  const handleHandsFreeText = async (text, { cutIn = false } = {}) => {
    if (!text || !handsFreeRef.current) return;
    // Cut in on the agent, but it was the agent's own voice leaking back in.
    if (cutIn && heardOwnVoice(text, lastSpokenRef.current)) return;
    if (turnRef.current) { setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)); return; }
    const reply = await send(text);
    const mic = micRef.current;
    // Not while the person is already saying something else.
    if (reply && speakRef.current && handsFreeRef.current && mic?.guard() !== false) {
      lastSpokenRef.current = spokenReply(reply);
      setPhase('speaking');
      await speak(reply);
      setPhase('working');
      mic?.unguard();
    }
    const last = entriesRef.current[entriesRef.current.length - 1];
    // Out of allowance: stop listening and say why.
    if (last?.code === 'monthly_cap_reached' || last?.code === 'not_enabled_for_you') {
      if (speakRef.current) await speak(last.text);
      stopHandsFree();
      return;
    }
  };
  const onHandsFreeClip = (clip, durationMs, info) => {
    const endedAt = Date.now();
    if (cameraRef.current) { handleCameraClip(clip, durationMs, endedAt).catch(() => {}); return; }
    handsFreePendingRef.current += 1;
    setPhase('working');
    handsFreeChainRef.current = handsFreeChainRef.current
      .then(() => handleHandsFreeClipRef.current(clip, durationMs, { ...info, endedAt }))
      .catch(() => {})
      .finally(() => {
        handsFreePendingRef.current -= 1;
        if (!handsFreePendingRef.current && handsFreeRef.current) setPhase('listening');
      });
  };
  const handleHandsFreeClipRef = useRef(handleHandsFreeClip);
  handleHandsFreeClipRef.current = handleHandsFreeClip;
  // The phone's own hearing (iPhone and Android apps): words, in order.
  const onNativeText = (raw, { cutIn, unsure }) => {
    const b = surveyAgentBridge.current;
    const text = snapItemNames(cleanTranscript(raw), Object.values(b?.markers || {}).map((m) => m?.name));
    if (cameraRef.current) {
      if (CANCEL_WORDS.test(text)) cameraRef.current.cancel();
      else if (SHUTTER_WORDS.test(text)) cameraRef.current.capture().catch(() => {});
      return;
    }
    if (unsure) {
      if (speakRef.current) speak(agentSays(langRef.current, 'sayAgain')).catch(() => {});
      return;
    }
    handsFreePendingRef.current += 1;
    setPhase('working');
    handsFreeChainRef.current = handsFreeChainRef.current
      .then(() => handleHandsFreeTextRef.current(text, { cutIn }))
      .catch(() => {})
      .finally(() => {
        handsFreePendingRef.current -= 1;
        if (!handsFreePendingRef.current && handsFreeRef.current) setPhase('listening');
      });
  };
  const handleHandsFreeTextRef = useRef(null);
  handleHandsFreeTextRef.current = handleHandsFreeText;
  const onNativeTextRef = useRef(onNativeText);
  onNativeTextRef.current = onNativeText;
  const onHandsFreeClipRef = useRef(onHandsFreeClip);
  onHandsFreeClipRef.current = onHandsFreeClip;

  const startHandsFree = async () => {
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
          lang: agentLocale(langRef.current),
          onText: (text, info) => onNativeTextRef.current(text, info),
          onHearing: (on) => setHearing(on),
          onBargeIn: () => stopSpeaking(),
          spokenNow: () => lastSpokenRef.current,
          onFatal: () => { if (handsFreeRef.current) restartHandsFreeRef.current(); },
        }).catch(() => null)
        : null;
      micRef.current = micRef.current || await startHandsFreeMic({
        onClip: (clip, ms, info) => onHandsFreeClipRef.current(clip, ms, info),
        onHearing: (on) => setHearing(on),
        onBargeIn: () => stopSpeaking(),
      });
      if (!micRef.current.native) deviceHearingRef.current = startDeviceHearing({ lang: agentLocale(langRef.current) });
      awakeRef.current?.release();
      awakeRef.current = keepScreenAwake();
      handsFreeRef.current = true;
      setHandsFree(true);
      setPhase('listening');
    } catch (err) {
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
        onHearing: (on) => setHearing(on),
        onBargeIn: () => stopSpeaking(),
      });
    } catch {
      stopHandsFree();
      push({ role: 'error', text: 'The microphone could not start.' });
    }
  };

  const toggleBrowserSpeech = () => {
    const Recognition = browserSpeech();
    if (!Recognition) return;
    if (speechRef.current) {
      speechRef.current.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = agentLocale(langRef.current);
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
      setListening(false);
      // Send what is in the box, so a word fixed while listening is kept.
      const typed = draftRef.current.trim();
      if (typed || finalText.trim()) sendRef.current(typed || finalText);
    };
    speechRef.current = rec;
    setListening(true);
    rec.start();
  };

  const canTalk = Boolean(status?.transcription) || Boolean(browserSpeech());
  const recording = recorder.state !== 'idle' || listening;
  const toggleTalk = () => {
    unlockPlayback();
    if (status?.transcription) {
      if (recorder.state === 'recording') recorder.stop();
      else if (recorder.state === 'idle') {
        pttHearingRef.current?.stop();
        pttHearingRef.current = startDeviceHearing({ lang: agentLocale(langRef.current) });
        recorder.start();
      }
    } else {
      toggleBrowserSpeech();
    }
  };

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

  const removePending = (id) => {
    attachmentsRef.current.delete(id);
    setPendingFiles((list) => list.filter((f) => f.id !== id));
  };

  const ready = status?.enabled && !status?.over_cap;
  const statusText = !status ? 'Connecting...'
    : !status.enabled || status.over_cap ? surveyAgentErrorText(status.reason)
      : queued ? (waitReasonRef.current === 'busy_try_again'
        ? `Busy for a moment. ${queued === 1 ? '1 message is' : `${queued} messages are`} waiting and will send shortly.`
        : `No signal. ${queued === 1 ? '1 message is' : `${queued} messages are`} waiting and will send when you are back online.`)
        : usageWarning(usageLeft);
  const livePhase = hearing ? 'hearing' : phase === 'speaking' ? 'speaking' : transcribing || busy || phase === 'working' ? 'working' : 'listening';
  const handsFreeText = handsFree ? HANDS_FREE_TEXT[livePhase] : null;

  const panel = (
    <section
      className={`survey-agent${mobileMode ? ' is-phone' : ''}`}
      role="dialog"
      aria-label="Survey agent"
      data-testid="survey-agent-panel"
    >
      <header className="survey-agent__head">
        <span className="survey-agent__title">Survey agent <span className="survey-agent__beta">Beta</span></span>
        {status?.transcription && canHandsFree() && (
          <button
            type="button"
            className="survey-agent__voice survey-agent__handsfree"
            aria-pressed={handsFree}
            aria-label={handsFree ? 'Stop hands-free' : 'Hands-free'}
            disabled={!ready && !handsFree}
            onClick={handsFree ? stopHandsFree : startHandsFree}
          >
            {handsFree ? (mobileMode ? 'Stop' : 'Stop hands-free') : 'Hands-free'}
          </button>
        )}
        <button
          type="button"
          className="survey-agent__voice"
          aria-label={`Language: ${AGENT_LANGS[lang].label}`}
          title="English or Spanish"
          onClick={toggleLang}
        >
          {AGENT_LANGS[lang].short}
        </button>
        {canSpeakReplies() && (
          <button
            type="button"
            className="survey-agent__voice"
            aria-pressed={speakReplies}
            onClick={toggleSpeak}
          >
            {speakReplies ? 'Voice on' : 'Voice off'}
          </button>
        )}
        <button type="button" className="survey-agent__icon" aria-label="Close Survey agent" onClick={onClose}>
          <Icon name="close" size={16} color="currentColor" />
        </button>
      </header>
      <div className="survey-agent__list" ref={listRef} aria-live="polite">
        {!entries.length && (
          <p className="survey-agent__hint">
            Say or type what you see, for example: &ldquo;D-117, cables pulled, card reader missing, no power.&rdquo; Add photos with the clip.
          </p>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className={`survey-agent__msg is-${entry.role}`}>
            <div className="survey-agent__bubble">
              {entry.text}
              {entry.waiting ? <div className="survey-agent__files">Waiting for signal</div> : null}
              {entry.files?.length ? <div className="survey-agent__files">{entry.files.join(', ')}</div> : null}
            </div>
            {entry.changes?.length ? (
              <div className={`survey-agent__changes${entry.undone ? ' is-undone' : ''}`} data-testid="survey-agent-changes">
                <ul>
                  {entry.changes.map((change, i) => <li key={i}>{change.label}</li>)}
                </ul>
                {entry.undone
                  ? <span className="survey-agent__undone">{entry.undone === 'partly' ? 'Undone, later edits kept' : 'Undone'}</span>
                  : <button type="button" className="survey-agent__undo" onClick={() => undoEntry(entry)}>Undo</button>}
              </div>
            ) : null}
            {entry.summary ? (
              <button type="button" className="survey-agent__undo survey-agent__save" onClick={() => saveSummary(entry.summary)}>
                Save summary
              </button>
            ) : null}
          </div>
        ))}
        {(busy || transcribing) && <div className="survey-agent__msg is-agent"><div className="survey-agent__bubble is-typing">Working...</div></div>}
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
      {pendingFiles.length > 0 && (
        <div className="survey-agent__pending">
          {pendingFiles.map((f) => (
            <span key={f.id} className="survey-agent__chip">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removePending(f.id)}>
                <Icon name="close" size={12} color="currentColor" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="survey-agent__composer"
        onSubmit={(e) => { e.preventDefault(); unlockPlayback(); sendAndSpeak(draft); }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <button type="button" className="survey-agent__icon" aria-label="Add photos or files" disabled={!ready} onClick={() => fileInputRef.current?.click()}>
          <Icon name="paperclip" size={18} color="currentColor" />
        </button>
        <textarea
          className="survey-agent__input"
          rows={1}
          value={draft}
          placeholder={recording ? 'Listening...' : 'Type or tap the mic'}
          aria-label="Message the Survey agent"
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); unlockPlayback(); sendAndSpeak(draft); }
          }}
        />
        {canTalk && (
          <button
            type="button"
            className={`survey-agent__icon survey-agent__mic${recording ? ' is-on' : ''}`}
            aria-label={recording ? 'Stop and send' : 'Talk'}
            aria-pressed={recording}
            disabled={!ready || handsFree || ((busy || transcribing) && !recording)}
            onClick={toggleTalk}
          >
            <Icon name="mic" size={18} color="currentColor" />
          </button>
        )}
        <button type="submit" className="survey-agent__send" disabled={!ready || busy || transcribing || (!draft.trim() && !pendingFiles.length)}>
          Send
        </button>
      </form>
    </section>
  );
  return typeof document !== 'undefined' ? createPortal(panel, document.body) : panel;
}
