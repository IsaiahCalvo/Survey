/* Sort by (Role / Name / Activity) in the share dialog, Nightly flag
   share-extras. The app drop-down on desktop and tablet; the phone's own
   list on a phone, as ValueSelect asks of its callers. */
import ValueSelect from '../components/ValueSelect.jsx';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { ACCESS_SORTS } from './accessRows.js';

const OPTIONS = ACCESS_SORTS.map((o) => ({ value: o.key, label: o.label }));

export default function AccessSortSelect({ value, onChange }) {
  if (isPhoneLayout()) {
    return (
      <select className="access-sort-native" aria-label="Sort people by" data-testid="access-sort" value={value} onChange={(e) => onChange(e.target.value)}>
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <span data-testid="access-sort">
      <ValueSelect label="Sort people by" value={value} onChange={onChange} options={OPTIONS} size="sm" width="104px" />
    </span>
  );
}
