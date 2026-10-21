// Starter kit: CCTV camera check. Copy it with `scripts/kits.mjs fork` to make a customer's own.
// Keeps Row ID / Changed By / Changed Date so two-way Excel sync still matches rows.
export default {
  id: 'cctv-cameras',
  kind: 'exportKit',
  version: '1.0.0',
  minEngine: 1,
  label: 'CCTV camera check',
  extends: 'default-survey@1.0.0',
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Camera' },
    { field: 'entity_name', header: 'Recorder' },
    { field: 'checklist' },
    { field: 'notes', header: 'Notes' },
  ],
  answerSet: [
    { value: 'Works', tone: 'good' },
    { value: 'Not working', tone: 'bad' },
    { value: 'N/A', tone: 'neutral' },
  ],
};
