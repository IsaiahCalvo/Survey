/**
 * UsageIndicator.jsx — subscription usage panel showing projects/documents/
 * storage consumption against the current tier's limits.
 *
 * Default export UsageIndicator reads useSubscriptionLimits() and useAuth();
 * renders a tier badge plus MetricRow progress bars (purple→orange→red as
 * usage climbs), treating ≥999999 / ≥1TB limits as unlimited (∞). Free-tier
 * users at ≥75% on any metric see an upgrade-to-Pro nudge. Hidden when no user
 * or while loading.
 */
import { useSubscriptionLimits } from '../hooks/useSubscriptionLimits';
import { useAuth } from '../contexts/AuthContext';

// Module scope so these keep stable component identity across UsageIndicator
// renders (defining them in the body remounted every metric row each render).
const getProgressBarColor = (percentage) => {
  if (percentage >= 90) return 'var(--danger)'; // Red
  if (percentage >= 75) return 'var(--warning)'; // Orange
  return '#8b5cf6'; // Purple
};

const ProgressBar = ({ percentage, color }) => (
  <div style={{
    width: '100%',
    height: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
      color: 'rgba(255, 255, 255, 0.9)'
    }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span style={{
        fontWeight: 600,
        color: percentage >= 90 ? 'var(--danger)' : 'rgba(255, 255, 255, 0.95)'
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
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
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
          color: 'rgba(255, 255, 255, 0.95)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          Usage
        </h3>
        <span style={{
          fontSize: '11px',
          fontWeight: 600,
          // ONE COLOR PER TIER app-wide (owner request 2026-08-20): free green,
          // pro blue, enterprise gold, developer purple — must match the plan
          // cards and Current plan buttons in AccountSettings.
          color: tier === 'developer' ? '#a855f7' : tier === 'pro' ? '#4A90E2' : tier === 'enterprise' ? '#d8a84e' : '#22c55e',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '6px',
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.9)',
          lineHeight: '1.5'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            Running low on space?
          </div>
          <div style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            Upgrade to Pro for unlimited projects, documents, and 10GB of storage.
          </div>
        </div>
      )}
    </div>
  );
};

export default UsageIndicator;
