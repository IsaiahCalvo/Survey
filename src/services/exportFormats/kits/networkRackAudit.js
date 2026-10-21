// Starter kit: Network rack audit. Copy it with `scripts/kits.mjs fork` to make a customer's own.
// Keeps Row ID / Changed By / Changed Date so two-way Excel sync still matches rows.
export default {
  id: 'network-rack-audit',
  kind: 'exportKit',
  version: '1.0.0',
  minEngine: 1,
  label: 'Network rack audit',
  extends: 'default-survey@1.0.0',
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Rack' },
    { field: 'entity_name', header: 'Room' },
    { field: 'checklist' },
    { field: 'notes', header: 'Notes' },
  ],
  answerSet: [
    { value: 'Good', tone: 'good' },
    { value: 'Fair', tone: 'neutral' },
    { value: 'Poor', tone: 'bad' },
    { value: 'N/A', tone: 'neutral' },
  ],
};
