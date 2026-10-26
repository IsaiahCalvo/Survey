// Ready line types for the template editor (nightly 'custom-answers'): one
// pick sets how a checklist line is answered, with its unit, range or
// options already filled in. Each `fields` is a plain item setting that
// itemAnswerFields keeps as-is.
const options = (pairs) => pairs.map(([value, tone]) => ({ value, tone }));

export const ITEM_TYPE_LIBRARY = Object.freeze([
  { id: 'condition', label: 'Condition 1-5', fields: { kind: 'score', scale: 5, issueAt: 2 } },
  { id: 'rating-10', label: 'Rating 1-10', fields: { kind: 'score', scale: 10 } },
  {
    id: 'defects',
    label: 'Defects',
    fields: { kind: 'many', options: options([['None', 'good'], ['Damaged', 'bad'], ['Missing', 'bad'], ['Loose', 'bad'], ['Dirty', 'neutral']]) },
  },
  { id: 'quantity', label: 'Quantity', fields: { kind: 'count' } },
  { id: 'expiry-date', label: 'Expiry date', fields: { kind: 'date', issueIfPast: true } },
  { id: 'install-date', label: 'Install date', fields: { kind: 'date' } },
  { id: 'mounting-height', label: 'Mounting height (in)', fields: { kind: 'number', unit: 'in' } },
  { id: 'clear-width', label: 'Clear width (in, 32 or more)', fields: { kind: 'number', unit: 'in', min: 32 } },
  { id: 'voltage', label: 'Voltage (V)', fields: { kind: 'number', unit: 'V' } },
  { id: 'temperature', label: 'Temperature (°F)', fields: { kind: 'number', unit: '°F' } },
  { id: 'serial', label: 'Serial number', fields: { kind: 'text' } },
  { id: 'note', label: 'Note', fields: { kind: 'text' } },
].map((t) => Object.freeze(t)));

export const itemTypeById = (id) => ITEM_TYPE_LIBRARY.find((t) => t.id === id) || null;
