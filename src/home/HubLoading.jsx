/* The home's first load (owner 2026-10-04: one calm loading state, the same
   everywhere). The list area shows the one quiet line every loading place
   uses — "Loading documents…", after a short wait so a fast load shows
   nothing — instead of pulsing grey placeholder rows. The header keeps the
   real controls' room with invisible spacers, so nothing moves when the list
   arrives. Shown only while a tab's list is empty on its first load, never
   over rows already on screen. */
import { HubShell } from './HubShell';
import QuietLoading from '../components/QuietLoading';

const Block = ({ className = '', style }) => (
  <span className={`hub-loading-space ${className}`} style={style} aria-hidden="true" />
);

const LoadingHeader = ({ tab }) => {
  const desktopSearch = (className, label) => (
    <div className={className}>
      <span className="hub-loading-search-metric">
        <svg width="13" height="13" aria-hidden="true" />
        <input value="" readOnly tabIndex={-1} aria-hidden="true" />
        <span className="kbd" aria-hidden="true">⌘K</span>
        <Block className="hub-loading-search-fill" />
        <span className="hub-loading-search-label" aria-hidden="true">{label}</span>
      </span>
    </div>
  );

  /* The header holds the real header's room row for row, at the same heights,
     so nothing shifts when the data arrives: row 2 is the search field, then
     (on Documents) the sort control, then the gold action. */
  if (tab === 'documents') {
    return (
      <>
        <div className="documents-mobile-search-actions hub-mobile-search-actions hub-loading-mobile-actions">
          <div style={{ flex: '1 1 0', minWidth: 0 }}><Block style={{ width: '100%', height: 28 }} /></div>
          <Block style={{ width: 96, height: 28 }} />
          <Block style={{ width: 78, height: 28 }} />
        </div>
        {desktopSearch('documents-desktop-search', 'Search documents')}
        <Block className="hub-loading-primary-action documents-desktop-upload" style={{ width: 76, height: 28 }} />
      </>
    );
  }

  const mobileClass = tab === 'projects'
    ? 'projects-mobile-search-actions hub-mobile-search-actions'
    : 'templates-mobile-search-actions hub-mobile-search-actions';
  const desktopClass = tab === 'projects' ? 'projects-desktop-search' : 'templates-desktop-search';
  return (
    <>
      <div className={`${mobileClass} hub-loading-mobile-actions`}>
        <div style={{ flex: '1 1 0', minWidth: 0 }}><Block style={{ width: '100%', height: 28 }} /></div>
        <Block style={{ width: tab === 'projects' ? 96 : 104, height: 28 }} />
      </div>
      {desktopSearch(desktopClass, tab === 'projects' ? 'Search projects' : 'Search templates')}
    </>
  );
};

const LoadingSubtitle = ({ tab }) => {
  if (tab === 'documents') {
    return (
      <span className="documents-mobile-summary" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }} aria-hidden="true">
        <span className="documents-file-count hub-loading-metric-cell"><b>0</b> files<Block style={{ width: 30, height: 9 }} /></span>
        <span className="documents-select-row mobile-header-select-row documents-mobile-select-sort-row">
          <span className="documents-mobile-select-main">
            <button className="mobile-header-select-button section-icon-btn hub-loading-metric-cell hub-loading-metric-button" type="button" disabled tabIndex={-1}>
              <Block className="hub-loading-select-glyph" />
            </button>
          </span>
        </span>
      </span>
    );
  }

  const prefix = tab === 'projects' ? 'projects' : 'templates';
  return (
    <>
      <span className={`${prefix}-desktop-summary hub-loading-metric-cell`} aria-hidden="true">
        {tab === 'projects' ? <><b>0</b> projects</> : <><b>0</b> templates</>}
        <Block style={{ width: 60, height: 9 }} />
      </span>
      <span className={`${prefix}-mobile-summary`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }} aria-hidden="true">
        <span className={`${prefix}-mobile-count hub-loading-metric-cell`}><b>0</b> {tab === 'projects' ? 'projects' : 'templates'}<Block style={{ width: 46, height: 9 }} /></span>
        <span className={`${prefix}-mobile-select-row mobile-header-select-row`}>
          <button className="mobile-header-select-button section-icon-btn hub-loading-metric-cell hub-loading-metric-button" type="button" disabled tabIndex={-1}>
            <Block className="hub-loading-select-glyph" />
          </button>
        </span>
      </span>
    </>
  );
};

export default function HubLoading({ tab, onNav, user, templatesLocked = false }) {
  const title = tab === 'projects' ? 'Projects' : tab === 'templates' ? 'Templates' : 'Documents';

  return (
    <HubShell
      tab={tab}
      onNav={onNav}
      title={title}
      subtitle={<LoadingSubtitle tab={tab} />}
      actions={<LoadingHeader tab={tab} />}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
      templatesLocked={templatesLocked}
    >
      <section className="hub-loading-region" aria-busy="true">
        <QuietLoading label={`Loading ${title.toLowerCase()}…`} />
      </section>
    </HubShell>
  );
}
