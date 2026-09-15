import React from 'react';
import BodyPortal from './BodyPortal.js';

const bytes = value => {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) return 'an unknown size';
  if (size < 1024) return `${size} bytes`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DocumentFirstGenerationAdoptionNotice({ available = false, review = null,
  busy = false, error = '', blocked = false, onReview, onConfirm, onClose }) {
  if (!available && !review && !error) return null;
  if (!review) return <BodyPortal><section data-document-first-generation-adoption-offer
    style={{ position: 'fixed', zIndex: 7540, right: 16, bottom: 16,
      width: 'min(390px, calc(100% - 32px))', padding: 14, borderRadius: 10,
      background: '#202631', color: '#f4f6f8', border: '1px solid #465164',
      boxShadow: '0 8px 24px rgba(0,0,0,.32)' }}>
    <strong>Upgrade this cloud document?</strong>
    <p style={{ margin: '7px 0 10px', fontSize: 13 }}>
      Review the current PDF and shared marks before creating its first checked version.
      Nothing is moved until you confirm.
    </p>
    {blocked && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#ffd39a' }}>
      Saved or queued changes must be checked before this can continue.
    </p>}
    {error && <p role="alert" style={{ color: '#ffb3b3', margin: '0 0 10px' }}>{error}</p>}
    <button type="button" disabled={!available || busy} onClick={() => { void onReview?.(); }}>
      Review upgrade
    </button>
  </section></BodyPortal>;

  const pdf = review.objects?.[0];
  const hasSidecar = review.objects?.some(object => object.kind === 'sidecar');
  const acceptedCatalog = review.entity_catalog?.status === 'accepted';
  const acceptedDefinition = review.survey_definition?.status === 'accepted';
  return <BodyPortal><section data-document-first-generation-adoption-review role="dialog"
    aria-modal="true" aria-label="Review checked document upgrade"
    style={{ position: 'fixed', zIndex: 7600, top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)', width: 'min(620px, calc(100% - 24px))',
      maxHeight: 'calc(100vh - 32px)', overflow: 'auto', padding: 16, borderRadius: 10,
      background: '#202631', color: '#f4f6f8', border: '1px solid #465164',
      boxShadow: '0 12px 32px rgba(0,0,0,.38)' }}>
    <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Create the first checked version?</h2>
    <p style={{ margin: '0 0 8px', fontSize: 14 }}>
      The server checked the current {bytes(pdf?.byte_length)} PDF and the shared mark state
      through saved change {review.canonical_annotations?.through_seq}.
    </p>
    <ul style={{ margin: '8px 0 12px', paddingLeft: 20, fontSize: 13 }}>
      <li>The PDF bytes stay the same.</li>
      <li>Shared marks move to the checked model 2 store.</li>
      <li>Document entity list: {acceptedCatalog ? 'accepted' : 'none'}.</li>
      <li>Document survey structure: {acceptedDefinition ? 'accepted' : 'none'}.</li>
      <li>{hasSidecar ? 'Legacy sidecar data will be kept as a raw owner recovery file.'
        : 'No legacy sidecar file was found. The old fixed sidecar path will still retire.'}</li>
    </ul>
    <p style={{ margin: '0 0 10px', fontSize: 12, color: '#c9d0db' }}>
      Private page view, tool defaults, template choices, and Excel links are not shared or moved.
      A change made after this review will stop the upgrade and require a new review.
    </p>
    {error && <p role="alert" style={{ color: '#ffb3b3', margin: '0 0 10px' }}>{error}</p>}
    <button type="button" disabled={busy} onClick={() => { void onConfirm?.(); }}>
      Create checked version
    </button>
    <button type="button" disabled={busy} onClick={onClose} style={{ marginLeft: 8 }}>
      Not now
    </button>
  </section></BodyPortal>;
}
