/**
 * PageTemplatePicker.jsx — Nightly 'page-templates' (Drawboard PDF Pro push
 * 2026-11-12, drawboard-trial/pdf-pro row C18): the page menu's "Template page
 * below" asks which paper the new page gets. A tap on a tile adds the page at
 * once, sized like the page above it, drawn with that paper's lines
 * (utils/blankPagePaper.js). Same tiles as Home > New > Other templates.
 */

import DialogCard, { DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import { TemplatePreview } from '../home/PaperTemplatesDialog.jsx';
import { PAPER_TEMPLATES, TEMPLATE_GROUPS } from '../home/paperTemplates.js';
import '../home/paperTemplates.css';

export default function PageTemplatePicker({ afterPage, onPick, onClose }) {
  return (
    <DialogCard
      atRoot
      zIndex={30000}
      title="Template page"
      onClose={onClose}
      width={640}
      cardProps={{ 'data-page-template-picker': 'true' }}
      footer={(
        <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
      )}
    >
      <div className="paper-template-groups">
        {TEMPLATE_GROUPS.map((g) => (
          <div key={g.id} role="group" aria-label={g.label}>
            <span style={DIALOG_LABEL_STYLE}>{g.label}</span>
            <div className="paper-template-tiles">
              {PAPER_TEMPLATES.filter((t) => t.group === g.id && t.id !== 'blank').map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-paper-template={t.id}
                  className="paper-template-tile"
                  onClick={() => { onPick(afterPage, t.id); onClose(); }}
                >
                  <TemplatePreview id={t.id} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </DialogCard>
  );
}
