// Shared loading skeletons (owner 2026-10-20, after studying Drawboard PDF:
// placeholders shaped like the real rows, a short wait before they show, one
// soft sweep; supersedes the 2026-10-04 "one quiet line" decision). Every
// loading list in the app builds from these pieces so the look is the same
// everywhere; styles live in ./skeleton.css (prefers-reduced-motion aware).
import './skeleton.css';

export const SKELETON_SHOW_AFTER_MS = 300;

// Deterministic "random" widths, so rows look like real text but never move
// between renders.
const WIDTHS = [62, 48, 71, 55, 66, 43, 58, 69, 51, 60];
export const skeletonWidth = (i, scale = 1) => `${Math.round(WIDTHS[i % WIDTHS.length] * scale)}%`;

export function SkeletonBlock({ w = '100%', h = 10, round = false, paper = false, className = '', style }) {
  const cls = ['sk-block', round && 'is-round', paper && 'is-paper', className].filter(Boolean).join(' ');
  return <span aria-hidden="true" className={cls} style={{ width: w, height: h, ...style }} />;
}

// The announced wrapper: one status for screen readers, fades in after the wait.
export function Skeleton({ label = 'Loading…', className = '', immediate = false, style, children, as: Tag = 'div' }) {
  return (
    <Tag
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-skeleton="true"
      data-sk-immediate={immediate ? 'true' : undefined}
      className={`sk ${className}`.trim()}
      style={style}
    >
      <span className="sk-visually-hidden">{label}</span>
      {children}
    </Tag>
  );
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

function PhoneRows({ count = 7 }) {
  return (
    <div className="sk-phone" aria-hidden="true">
      {range(count).map((i) => (
        <div className="sk-phone-row" key={i}>
          <SkeletonBlock w={34} h={44} paper />
          <div className="sk-stack">
            <SkeletonBlock w={skeletonWidth(i)} h={11} />
            <SkeletonBlock w={skeletonWidth(i + 3, 0.6)} h={9} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Home → Documents: the ledger table plus its preview pane.
export function DocumentsSkeleton({ rows = 8, label = 'Loading documents…' }) {
  return (
    <Skeleton label={label} className="sk-root" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className="sk-hub" aria-hidden="true">
        <div className="sk-card sk-docs">
          <div className="sk-docs-list">
            <div className="sk-docs-head">
              <span /><span />
              <SkeletonBlock w={30} h={8} />
              <SkeletonBlock w={44} h={8} />
              <SkeletonBlock w={60} h={8} />
              <SkeletonBlock w={28} h={8} />
              <span />
            </div>
            {range(rows).map((i) => (
              <div className="sk-docs-row" key={i}>
                <span />
                <SkeletonBlock w={22} h={30} paper />
                <SkeletonBlock w={skeletonWidth(i)} h={11} />
                <SkeletonBlock w={i % 3 === 1 ? 0 : skeletonWidth(i + 2, 1.2)} h={9} />
                <span className="sk-stack">
                  <SkeletonBlock w={52} h={9} />
                  <SkeletonBlock w={78} h={8} />
                </span>
                <SkeletonBlock w={50} h={9} />
                <span />
              </div>
            ))}
          </div>
          <div className="sk-docs-aside">
            <SkeletonBlock w={52} h={8} />
            <SkeletonBlock w="78%" h={14} style={{ marginTop: 8 }} />
            <SkeletonBlock w="56%" h={9} />
            <SkeletonBlock className="sk-preview" paper h="auto" />
          </div>
        </div>
      </div>
      <PhoneRows />
    </Skeleton>
  );
}

function PaneList({ rows = 4, dots = 3, button = 98, narrow = false }) {
  return (
    <div className={`sk-card sk-pane-left${narrow ? ' is-narrow' : ''}`}>
      <div className="sk-pane-top">
        <SkeletonBlock w={button} h={26} style={{ borderRadius: 6 }} />
        <SkeletonBlock w={16} h={12} />
      </div>
      {range(rows).map((i) => (
        <div className="sk-list-row" key={i}>
          <SkeletonBlock w={skeletonWidth(i, 1.1)} h={11} />
          <span className="sk-dots">
            {range(dots - (i % 2)).map((d) => <SkeletonBlock key={d} w={13} h={13} round />)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Home → Projects: project list, then the open project's files and team.
export function ProjectsSkeleton({ label = 'Loading projects…' }) {
  return (
    <Skeleton label={label} className="sk-root" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className="sk-hub" aria-hidden="true">
        <PaneList rows={3} button={98} />
        <div className="sk-card sk-pane-main">
          <div className="sk-main-head">
            <SkeletonBlock w={4} h={32} style={{ borderRadius: 2 }} />
            <SkeletonBlock w="28%" h={18} />
            <span className="sk-spacer" />
            <SkeletonBlock w={82} h={28} style={{ borderRadius: 6 }} />
            <SkeletonBlock w={106} h={28} style={{ borderRadius: 6 }} />
          </div>
          <div className="sk-main-body">
            <SkeletonBlock w={46} h={9} />
            {range(4).map((i) => (
              <div className="sk-file-row" key={i}>
                <span className="sk-grow"><SkeletonBlock w={skeletonWidth(i + 1, 0.8)} h={10} /></span>
                <SkeletonBlock w={16} h={16} round />
                <SkeletonBlock w={52} h={9} />
                <SkeletonBlock w={44} h={9} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <PhoneRows />
    </Skeleton>
  );
}

// Home → Templates: template list, the open template, and its entities.
export function TemplatesSkeleton({ label = 'Loading templates…' }) {
  return (
    <Skeleton label={label} className="sk-root" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div className="sk-hub" aria-hidden="true">
        <PaneList rows={2} button={106} narrow />
        <div className="sk-card sk-pane-main">
          <div className="sk-main-head" style={{ height: 92 }}>
            <SkeletonBlock w={4} h={32} style={{ borderRadius: 2 }} />
            <SkeletonBlock w="34%" h={18} />
            <span className="sk-spacer" />
            <SkeletonBlock w={152} h={18} style={{ borderRadius: 4 }} />
          </div>
          <div className="sk-main-body">
            <SkeletonBlock w={70} h={9} />
            <SkeletonBlock w="44%" h={12} style={{ margin: '10px 0' }} />
            <SkeletonBlock w={78} h={9} />
            {range(3).map((i) => (
              <div className="sk-chip-row" key={i}>
                <SkeletonBlock w={skeletonWidth(i, 0.35)} h={11} />
              </div>
            ))}
          </div>
        </div>
        <div className="sk-card sk-pane-right">
          <div className="sk-pane-top" style={{ height: 63 }}>
            <SkeletonBlock w={60} h={9} />
          </div>
          <div className="sk-main-body">
            {range(3).map((i) => (
              <div className="sk-chip-row" key={i} style={{ paddingLeft: 32 }}>
                <SkeletonBlock w={18} h={18} round />
                <SkeletonBlock w={skeletonWidth(i + 4, 1)} h={11} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <PhoneRows />
    </Skeleton>
  );
}

// Archive list rows: the live six-column grid (select, thumb, Name, Type,
// Archived, Days remaining). `bare` drops the hub card + gutters when the
// caller already sits in one.
export function ListRowsSkeleton({ rows = 6, label = 'Loading…', bare = false }) {
  return (
    <Skeleton label={label} className="sk-root" style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
      <div className="sk-hub" aria-hidden="true" style={bare ? { padding: 0 } : undefined}>
        <div className={bare ? undefined : 'sk-card'} style={{ flex: 1 }}>
          {range(rows).map((i) => (
            <div className="sk-docs-row" key={i} style={{ gridTemplateColumns: '32px 54px minmax(150px,1fr) 110px 124px 110px' }}>
              <span />
              <SkeletonBlock w={22} h={30} paper />
              <SkeletonBlock w={skeletonWidth(i, 0.8)} h={11} />
              <SkeletonBlock w={56} h={9} />
              <SkeletonBlock w={64} h={9} />
              <SkeletonBlock w={40} h={9} />
            </div>
          ))}
        </div>
      </div>
      <PhoneRows count={rows} />
    </Skeleton>
  );
}

// Viewer → Pages panel before the page count is known: page-shaped cards.
export function PageThumbsSkeleton({ count = 4, width = 120, ratio = 11 / 8.5, label = 'Loading pages…' }) {
  return (
    <Skeleton label={label} className="sk-thumbs">
      {range(count).map((i) => (
        <span className="sk-thumb" key={i} aria-hidden="true">
          <SkeletonBlock w={width} h={Math.round(width * ratio)} paper />
          <SkeletonBlock w={18} h={8} />
        </span>
      ))}
    </Skeleton>
  );
}

// Viewer → Search panel while the first results are being found.
// Decorative only: the panel status line already announces "Searching…".
export function SearchResultsSkeleton({ groups = 2 }) {
  return (
    <div className="sk sk-search" data-skeleton="true" aria-hidden="true">
      {range(groups).map((g) => (
        <div key={g}>
          <div className="sk-search-head"><SkeletonBlock w={46} h={8} /></div>
          {range(3 - g).map((i) => (
            <div className="sk-search-row" key={i}>
              <SkeletonBlock w={skeletonWidth(i + g * 3, 1.3)} h={9} />
              <SkeletonBlock w={skeletonWidth(i + g * 3 + 5, 0.7)} h={9} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
