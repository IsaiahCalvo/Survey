// Starter kit: Fire alarm device test. Copy it with `scripts/kits.mjs fork` to make a customer's own.
// Keeps Row ID / Changed By / Changed Date so two-way Excel sync still matches rows.
export default {
  id: 'fire-alarm-devices',
  kind: 'exportKit',
  version: '1.0.0',
  minEngine: 1,
  label: 'Fire alarm device test',
  extends: 'default-survey@1.0.0',
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Device' },
    { field: 'entity_name', header: 'Panel / Loop' },
    { field: 'checklist' },
    { field: 'notes', header: 'Notes' },
  ],
  answerSet: [
    { value: 'Pass', tone: 'good' },
    { value: 'Fail', tone: 'bad' },
    { value: 'N/A', tone: 'neutral' },
  ],
};
