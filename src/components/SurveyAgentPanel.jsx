// The Survey agent chat (KAL-527, behind the survey_agent flag). The person
// types or talks about an item ("D-117 cables pulled, card reader missing, no
// power") and can add photos; the agent fills that item's checklist, note,
// entity and media through the Survey panel's own writes. Every reply that
// changed something lists the changes with one Undo for the whole turn.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icons';
import { supabase } from '../supabaseClient';
import { classifyMediaFile } from '../services/surveyMediaService';
import { answerSetFor } from '../services/answerSets.js';
import { createSurveyAgentToolbox, surveyAgentBridge } from '../agent/surveyAgentTools.js';
import { makeSurveyAgentCaller, runSurveyAgentTurn, surveyAgentErrorText } from '../agent/surveyAgentClient.js';
import { useAudioRecorder } from './SurveyMediaCapture';
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
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
const speak = (text) => {
  if (!canSpeak() || !text) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(text));
  } catch { /* no voice on this device */ }
};
const stopSpeaking = () => { try { if (canSpeak()) window.speechSynthesis.cancel(); } catch { /* nothing playing */ } };

let nextId = 1;
const newId = (prefix) => `${prefix}${nextId++}`;

export default function SurveyAgentPanel({ onClose, mobileMode = false }) {
  const call = useMemo(() => makeSurveyAgentCaller(supabase), []);
  const attachmentsRef = useRef(new Map());
  const toolbox = useMemo(() => createSurveyAgentToolbox({ attachments: attachmentsRef.current }), []);
  const [status, setStatus] = useState(null);
  const [entries, setEntries] = useState([]);
  const [draft, setDraft] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [busy, setBusy] = useState(false);
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
    call({ action: 'status' })
      .then((s) => { if (live) setStatus(s || { enabled: false, reason: 'network' }); })
      .catch((err) => { if (live) setStatus({ enabled: false, reason: err?.code || 'network' }); });
    return () => { live = false; };
  }, [call]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  useEffect(() => () => {
    try { speechRef.current?.abort?.(); } catch { /* already stopped */ }
    stopSpeaking();
  }, []);

  const toggleSpeak = () => {
    const next = !speakReplies;
    setSpeakReplies(next);
    if (!next) stopSpeaking();
    try { window.localStorage.setItem(SPEAK_KEY, next ? '1' : '0'); } catch { /* storage blocked */ }
  };

  const push = (entry) => setEntries((list) => [...list, { id: newId('e'), ...entry }]);

  const send = useCallback(async (text) => {
    const said = String(text || '').trim();
    const files = pendingFiles;
    if ((!said && !files.length) || busy) return;
    const bridge = surveyAgentBridge.current;
    if (!bridge?.template) {
      push({ role: 'error', text: 'Open Survey mode with a template first.' });
      return;
    }
    const fileNote = files.length
      ? `\n[Attached in this chat: ${files.map((f) => `${f.id} (${f.kind}, ${f.name})`).join('; ')}]`
      : '';
    const selected = bridge.selectedMarkerId && bridge.markers?.[bridge.selectedMarkerId];
    const selectedNote = selected ? `\n[Selected item: ${selected.name || 'Unnamed'} (id ${bridge.selectedMarkerId})]` : '';
    setDraft('');
    setPendingFiles([]);
    push({ role: 'user', text: said || 'Attach these.', files: files.map((f) => f.name) });
    setBusy(true);
    try {
      const result = await runSurveyAgentTurn({
        history: historyRef.current,
        userText: `${said || 'Attach these files.'}${fileNote}${selectedNote}`,
        call,
        toolbox,
        answerValues: answerSetFor(bridge.template).map((a) => a.value),
      });
      historyRef.current = result.history;
      push({ role: 'agent', text: result.reply, changes: result.changes });
      if (speakRef.current) speak(result.reply);
    } catch (err) {
      push({ role: 'error', text: err?.message || surveyAgentErrorText(err?.code), changes: err?.changes || [] });
    } finally {
      setBusy(false);
    }
  }, [busy, call, pendingFiles, toolbox]);

  const sendRef = useRef(send);
  sendRef.current = send;

  const undoEntry = (entry) => {
    const changes = [...(entry.changes || [])].reverse();
    changes.forEach((change) => toolbox.undo(change));
    setEntries((list) => list.map((e) => (e.id === entry.id ? { ...e, undone: true } : e)));
    // Tell the agent, so it does not build on what was taken back.
    historyRef.current = historyRef.current.length
      ? [...historyRef.current,
        { role: 'user', content: '[The person pressed Undo on your last changes; they are reverted.]' },
        { role: 'assistant', content: 'Understood, those changes are undone.' }]
      : historyRef.current;
  };

  const transcriptionHints = () => {
    const bridge = surveyAgentBridge.current;
    return Object.values(bridge?.markers || {}).map((m) => m?.name).filter(Boolean).slice(0, 60);
  };

  const recorder = useAudioRecorder({
    onRecorded: async (file, durationMs) => {
      setBusy(true);
      let text = '';
      try {
        const audio = await blobToBase64(file);
        const out = await call({ action: 'transcribe', audio, mime: file.type, duration_ms: durationMs, hints: transcriptionHints() });
        text = String(out?.text || '').trim();
      } catch (err) {
        push({ role: 'error', text: err?.message || 'Could not hear that. Try again or type it.' });
      } finally {
        setBusy(false);
      }
      if (text) send(text);
    },
  });

  const toggleBrowserSpeech = () => {
    const Recognition = browserSpeech();
    if (!Recognition) return;
    if (speechRef.current) {
      speechRef.current.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
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
      if (finalText.trim()) sendRef.current(finalText);
    };
    speechRef.current = rec;
    setListening(true);
    rec.start();
  };

  const canTalk = Boolean(status?.transcription) || Boolean(browserSpeech());
  const recording = recorder.state !== 'idle' || listening;
  const toggleTalk = () => {
    if (status?.transcription) {
      if (recorder.state === 'recording') recorder.stop();
      else if (recorder.state === 'idle') recorder.start();
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

  const removePending = (id) => {
    attachmentsRef.current.delete(id);
    setPendingFiles((list) => list.filter((f) => f.id !== id));
  };

  const ready = status?.enabled && !status?.over_cap;
  const statusText = !status ? 'Connecting...'
    : !status.enabled || status.over_cap ? surveyAgentErrorText(status.reason) : null;

  const panel = (
    <section
      className={`survey-agent${mobileMode ? ' is-phone' : ''}`}
      role="dialog"
      aria-label="Survey agent"
      data-testid="survey-agent-panel"
    >
      <header className="survey-agent__head">
        <span className="survey-agent__title">Survey agent <span className="survey-agent__beta">Beta</span></span>
        {canSpeak() && (
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
              {entry.files?.length ? <div className="survey-agent__files">{entry.files.join(', ')}</div> : null}
            </div>
            {entry.changes?.length ? (
              <div className={`survey-agent__changes${entry.undone ? ' is-undone' : ''}`} data-testid="survey-agent-changes">
                <ul>
                  {entry.changes.map((change, i) => <li key={i}>{change.label}</li>)}
                </ul>
                {entry.undone
                  ? <span className="survey-agent__undone">Undone</span>
                  : <button type="button" className="survey-agent__undo" onClick={() => undoEntry(entry)}>Undo</button>}
              </div>
            ) : null}
          </div>
        ))}
        {busy && <div className="survey-agent__msg is-agent"><div className="survey-agent__bubble is-typing">Working...</div></div>}
      </div>
      {statusText && <p className="survey-agent__status">{statusText}</p>}
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
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
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
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); }
          }}
        />
        {canTalk && (
          <button
            type="button"
            className={`survey-agent__icon survey-agent__mic${recording ? ' is-on' : ''}`}
            aria-label={recording ? 'Stop and send' : 'Talk'}
            aria-pressed={recording}
            disabled={!ready || (busy && !recording)}
            onClick={toggleTalk}
          >
            <Icon name="mic" size={18} color="currentColor" />
          </button>
        )}
        <button type="submit" className="survey-agent__send" disabled={!ready || busy || (!draft.trim() && !pendingFiles.length)}>
          Send
        </button>
      </form>
    </section>
  );
  return typeof document !== 'undefined' ? createPortal(panel, document.body) : panel;
}
