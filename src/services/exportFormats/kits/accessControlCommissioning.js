// Starter kit: Access control commissioning. Copy it with `scripts/kits.mjs fork` to make a customer's own.
// Keeps Row ID / Changed By / Changed Date so two-way Excel sync still matches rows.
export default {
  id: 'access-control-commissioning',
  kind: 'exportKit',
  version: '1.0.0',
  minEngine: 1,
  label: 'Access control commissioning',
  extends: 'default-survey@1.0.0',
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Door' },
    { field: 'entity_name', header: 'Controller' },
    { field: 'checklist' },
    { field: 'notes', header: 'Notes' },
  ],
  answerSet: [
    { value: 'Pass', tone: 'good' },
    { value: 'Fail', tone: 'bad' },
    { value: 'N/A', tone: 'neutral' },
  ],
};
