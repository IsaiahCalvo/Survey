// The face on a template someone shared with you (owner 2026-10-07): the
// owner's initials on their own pastel (utils/userColors.js), the same colour
// that person wears on every other screen. Used on the home Templates list and
// in the Survey panel's template picker, desktop and phone.
import { USER_INITIALS_INK, userColorFill } from '../utils/userColors.js';
import { presenceInitials } from './presenceIdentity.js';
import { sharedTemplateLabel } from '../services/sharedTemplates.js';

export default function SharedTemplateBadge({ sharedFrom, size = 18 }) {
  if (!sharedFrom) return null;
  const label = sharedTemplateLabel(sharedFrom);
  const initials = sharedFrom.ownerName ? presenceInitials(sharedFrom.ownerName) : '';
  return (
    <span
      data-shared-template-owner={sharedFrom.ownerId || ''}
      data-shared-template-role={sharedFrom.role || ''}
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: userColorFill(sharedFrom.ownerId || sharedFrom.ownerName || 'shared'),
        color: USER_INITIALS_INK,
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: Math.round(size * 0.46),
        fontWeight: 600,
        lineHeight: 1,
        flex: 'none',
        letterSpacing: 0,
      }}
    >
      {initials}
    </span>
  );
}
