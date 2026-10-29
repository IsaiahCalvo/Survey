import DialogCard from './DialogCard.jsx';

/**
 * "This template changed since this document used it": keep the version the
 * document was surveyed with, or move to the latest. The app's one dialog
 * shell (owner 2026-10-26: this one "looked like shit" next to the rest).
 */
export default function SurveyTemplateVersionDialog({ latest, onChoose, onCancel }) {
  return (
    <DialogCard
      title="Survey template updated"
      message={`${latest.name} has changed since you used it in this document. Keep the version used here, or use the latest template. Your Survey Markers and answers stay saved.`}
      onClose={onCancel}
      width={420}
      zIndex={10003}
      // Phone walk 2026-10-28: inside the viewer it opened under the phone's
      // Survey sheet, so tapping a changed template looked like it did nothing.
      atRoot
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={() => onChoose(false)}>Keep previous version</button>
          <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={() => onChoose(true)}>Use latest version</button>
        </>
      )}
    />
  );
}
