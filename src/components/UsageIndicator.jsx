/**
 * UsageIndicator.jsx — subscription usage panel showing projects/documents/
 * storage consumption against the current tier's limits.
 *
 * Default export UsageIndicator reads useSubscriptionLimits() and useAuth();
 * renders a tier badge plus MetricRow progress bars (gold→olive→red as
 * usage climbs), treating ≥999999 / ≥1TB limits as unlimited (∞). Free-tier
 * users at ≥75% on any metric see an upgrade-to-Pro nudge. Hidden when no user
 * or while loading.
 */
import { useSubscriptionLimits } from '../hooks/useSubscriptionLimits';
import { useAuth } from '../contexts/AuthContext';

// Module scope so these keep stable component identity across UsageIndicator
// renders (defining them in the body remounted every metric row each render).
const getProgressBarColor = (percentage) => {
  if (percentage >= 90) return 'var(--danger)';
  if (percentage >= 75) return 'var(--warning)';
  // UX 2026-09-17 (revision-2 palette): the healthy bar was a #8b5cf6 purple,
  // the only purple in the app and a hue the palette has no other use for. A
  // meter that is fine is just the accent; danger and warning still take over.
  return 'var(--accent)';
};

const ProgressBar = ({ percentage, color }) => (
  <div style={{
    width: '100%',
    height: '6px',
    // UX 2026-09-22: the track is the FIELD the bar is drawn in, so it takes the
    // raised/field surface rather than a hand-rolled white wash (the old
    // rgba(255,255,255,0.1) read 1.30:1 against the card and was invisible).
    // Every bar fill clears 3:1 on it: accent 6.06, warning 4.53, danger 3.49.
    backgroundColor: 'var(--surface-3)',
    borderRadius: '3px',
    overflow: 'hidden',
    marginTop: '4px'
  }}>
    <div style={{
      width: `${Math.min(100, percentage)}%`,
      height: '100%',
      backgroundColor: color,
      transition: 'width 0.3s ease, background-color 0.3s ease',
      borderRadius: '3px'
    }} />
  </div>
);

const MetricRow = ({ label, current, limit, unlimited, percentage, showBar = true }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontSize: '13px',
      // The metric name is body copy (--text-2, 8.20 on the card); the count is
      // the row you are reading (--text-1, 11.47). Both were white alphas.
      color: 'var(--text-2)'
    }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span style={{
        fontWeight: 600,
        color: percentage >= 90 ? 'var(--danger-text)' : 'var(--text-1)'
      }}>
        {current} / {unlimited ? '∞' : limit}
      </span>
    </div>
    {showBar && !unlimited && (
      <ProgressBar percentage={percentage} color={getProgressBarColor(percentage)} />
    )}
  </div>
);

const UsageIndicator = () => {
  const { usage, limits, loading, formatBytes, getUsagePercentage, tier } = useSubscriptionLimits();
  const { user } = useAuth();

  if (!user || loading) return null;

  const projectsUnlimited = limits.projects >= 999999;
  const documentsUnlimited = limits.documents >= 999999;
  const storageUnlimited = limits.storage >= 1024 * 1024 * 1024 * 1024; // 1TB or more

  const storagePercentage = getUsagePercentage('storage');
  const projectsPercentage = getUsagePercentage('projects');
  const documentsPercentage = getUsagePercentage('documents');

  return (
    <div style={{
      // UX 2026-09-22: this is a card on the settings panel (--surface-1), so it
      // takes --surface-2, the palette's card/well step. It used to darken the
      // panel with rgba(0,0,0,0.3) — a card DARKER than its own panel — behind a
      // blur that an opaque fill makes pointless, so the blur goes with it. Its
      // hairline was rgba(255,255,255,0.1): 1.21:1 against the panel outside it,
      // i.e. no visible edge at all. --border is 4.09:1 there and 3.60:1 inside.
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '16px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-1)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          Usage
        </h3>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          // UX 2026-09-22 — ONE LOOK FOR EVERY TIER. The 2026-08-20 "one colour
          // per tier" rule painted free green, pro #4A90E2 blue and developer
          // #a855f7 purple: three accents the palette does not have, and the
          // purple measured 2.88:1 on its white-10% wash — unreadable. The plan
          // cards in AccountSettings already dropped their per-tier hues for a
          // single gold edge (2026-09-17), so this pill now matches them: a gold
          // GLYPH on a raised NEUTRAL pill. You tell the tiers apart by the word,
          // which is what the label is for.
          //
          // WHY --surface-3 and not --accent-soft. Both are legal on a control
          // this small, but the pill keeps a hairline, and --border measures only
          // 2.77:1 on the warm tint (fails WCAG 1.4.11) against 3.11:1 on
          // --surface-3. The gold also reads better on the neutral (6.06:1 vs
          // 5.40:1), and the free-tier nudge below already needs a fill — two
          // warm washes stacked in one small card is the large warm wash this
          // palette exists to prevent.
          color: 'var(--accent)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          backgroundColor: 'var(--surface-3)',
          border: '1px solid var(--border)',
          padding: '2px 8px',
          borderRadius: '4px'
        }}>
          {tier}
        </span>
      </div>

      <MetricRow
        label="Projects"
        current={usage.projects}
        limit={limits.projects}
        unlimited={projectsUnlimited}
        percentage={projectsPercentage}
        showBar={!projectsUnlimited}
      />

      <MetricRow
        label="Documents"
        current={usage.documents}
        limit={limits.documents}
        unlimited={documentsUnlimited}
        percentage={documentsPercentage}
        showBar={!documentsUnlimited}
      />

      <MetricRow
        label="Storage"
        current={formatBytes(usage.storage)}
        limit={formatBytes(limits.storage)}
        unlimited={storageUnlimited}
        percentage={storagePercentage}
        showBar={!storageUnlimited}
      />

      {tier === 'free' && (storagePercentage >= 75 || projectsPercentage >= 75 || documentsPercentage >= 75) && (
        <div style={{
          marginTop: '12px',
          padding: '10px',
          // UX 2026-09-22: the upgrade nudge was a #8b5cf6 purple wash with a
          // purple 30% edge that measured 1.43:1 — a second accent the palette
          // does not have, and an invisible boundary. It is a callout BLOCK, not
          // a small control, so it takes the neutral raised surface rather than
          // --accent-soft (which this file reserves for small gold controls).
          backgroundColor: 'var(--surface-3)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          fontSize: '12px',
          color: 'var(--text-1)',
          lineHeight: '1.5'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            Running low on space?
          </div>
          <div style={{ color: 'var(--text-3)' }}>
            Upgrade to Pro for unlimited projects, documents, and 10GB of storage.
          </div>
        </div>
      )}
    </div>
  );
};

export default UsageIndicator;
