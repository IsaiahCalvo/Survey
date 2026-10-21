// Starter kit: Punch list. Copy it with `scripts/kits.mjs fork` to make a customer's own.
// Keeps Row ID / Changed By / Changed Date so two-way Excel sync still matches rows.
export default {
  id: 'punch-list',
  kind: 'exportKit',
  version: '1.0.0',
  minEngine: 1,
  label: 'Punch list',
  extends: 'default-survey@1.0.0',
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Item' },
    { field: 'entity_name', header: 'Area' },
    { field: 'checklist' },
    { field: 'notes', header: 'Notes' },
  ],
  answerSet: [
    { value: 'Open', tone: 'bad' },
    { value: 'Done', tone: 'good' },
    { value: 'N/A', tone: 'neutral' },
  ],
};
