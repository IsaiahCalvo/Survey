const DEFAULT_RULE = 'var(--ink-500)';
const DEFAULT_MUTED = 'var(--ink-200)';
const DEFAULT_TEXT = 'var(--bone-100)';
const DEFAULT_DISABLED = 'var(--ink-300)';

export const moreButtonStyle = ({
  color = DEFAULT_MUTED,
  size = 24,
} = {}) => ({
  width: size,
  height: size,
  borderRadius: 6,
  padding: 0,
  background: 'transparent',
  border: 0,
  color,
  cursor: 'pointer',
  lineHeight: 1,
  display: 'inline-grid',
  placeItems: 'center',
  fontFamily: 'inherit',
  flex: 'none',
});

export const closeButtonStyle = ({
  borderColor = DEFAULT_RULE,
  color = DEFAULT_MUTED,
  size = 24,
} = {}) => ({
  width: size,
  height: size,
  borderRadius: 6,
  padding: 0,
  background: 'transparent',
  border: `1px solid ${borderColor}`,
  color,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  display: 'grid',
  placeItems: 'center',
  fontFamily: 'inherit',
  flex: 'none',
});

export const miniButtonStyle = ({
  borderColor = DEFAULT_RULE,
  color = DEFAULT_TEXT,
  disabled = false,
  danger = false,
  iconOnly = false,
} = {}) => ({
  background: 'transparent',
  border: `1px solid ${borderColor}`,
  borderRadius: 2,
  color: disabled ? DEFAULT_DISABLED : (danger ? 'var(--danger)' : color),
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit',
  fontSize: 10.5,
  height: 18,
  lineHeight: 1,
  padding: iconOnly ? 0 : '1px 7px',
  width: iconOnly ? 18 : undefined,
  boxSizing: 'border-box',
  whiteSpace: 'nowrap',
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const miniSelectButtonStyle = ({
  color = 'var(--gold)',
} = {}) => ({
  background: 'transparent',
  border: 0,
  borderRadius: 2,
  color,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 10.5,
  fontWeight: 600,
  lineHeight: 1,
  padding: '2px 5px',
  whiteSpace: 'nowrap',
});
