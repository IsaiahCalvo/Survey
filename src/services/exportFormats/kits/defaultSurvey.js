// Today's Survey export (the Schneider Electric layout): Row ID, Changed By,
// Changed Date, Item, one column per checklist item, Entity, Notes.
export default {
  id: 'default-survey',
  kind: 'exportKit',
  version: '1.0.0',
  minEngine: 1,
  label: 'Survey (standard)',
  extends: null,
  columns: [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Changed By' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Item' },
    { field: 'checklist' },
    { field: 'entity_name', header: 'Entity' },
    { field: 'notes', header: 'Notes' },
  ],
};
