// Wireless-lock planner, first custom kit: a door-by-door lock schedule.
// Tweaked from the default kit; keeps Row ID / Changed By / Changed Date so
// two-way Excel sync still matches rows. Checklist items carry the door's
// questions (lock type, gateway in range, ...) from the matching template.
export default {
  id: 'wireless-lock-schedule',
  kind: 'exportKit',
  version: '0.1.0',
  minEngine: 1,
  label: 'Wireless lock schedule',
  extends: 'default-survey@1.0.0',
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Door' },
    { field: 'entity_name', header: 'Gateway' },
    { field: 'checklist' },
    { field: 'notes', header: 'Notes' },
  ],
};
