import { HubShell } from './HubShell';

const ROWS = [0, 1, 2, 3, 4];
const MOBILE_ROWS = [0, 1, 2, 3];

const Block = ({ className = '', style }) => (
  <span className={`hub-skeleton-block ${className}`} style={style} aria-hidden="true" />
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

  /* The skeleton mirrors the real header row for row, at the same heights, so
     nothing shifts when the data arrives: row 2 is the search field, then (on
     Documents) the sort control, then the gold action. */
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
        {tab === 'projects' ? <><b>0</b> projects · expand any to see its files and team</> : <><b>0</b> templates · reusable category + checklist sets</>}
        <Block style={{ width: 210, height: 9 }} />
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

const DocumentsSkeleton = () => {
  const grid = '32px 54px minmax(150px,1fr) 124px 124px 72px';
  return (
    <div className="documents-ledger-body hub-loading-body" style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0 }}>
      <div className="card documents-desktop-card" style={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr', height: '100%', overflow: 'hidden' }}>
        <div style={{ overflow: 'hidden', borderRight: '1px solid var(--ink-500)' }}>
          <div className="hub-loading-ledger-header" style={{ display: 'grid', gridTemplateColumns: grid }}>
            <span /><span />
            {[72, 54, 70, 28].map((width, index) => <Block key={index} style={{ width, height: 8 }} />)}
          </div>
          {ROWS.map((row) => (
            <div key={row} className="hub-loading-document-row" style={{ display: 'grid', gridTemplateColumns: grid }}>
              <Block style={{ width: 14, height: 14, justifySelf: 'center' }} />
              <Block style={{ width: 23, height: 30, justifySelf: 'center' }} />
              <Block style={{ width: row % 2 ? '56%' : '72%', height: 11, marginLeft: 14 }} />
              <Block style={{ width: row % 2 ? 58 : 76, height: 9 }} />
              <span className="hub-loading-date-pair"><Block style={{ width: 48, height: 8 }} /><Block style={{ width: 68, height: 7 }} /></span>
              <Block style={{ width: 42, height: 8 }} />
            </div>
          ))}
        </div>
        <aside className="hub-loading-document-preview">
          <Block style={{ width: 48, height: 8 }} />
          <Block style={{ width: '62%', height: 14, marginTop: 18 }} />
          <Block style={{ width: '44%', height: 8, marginTop: 9 }} />
          <Block className="hub-loading-preview-page" />
          <Block style={{ width: 34, height: 8, marginTop: 14 }} />
          <span className="hub-loading-person"><Block style={{ width: 22, height: 22, borderRadius: '50%' }} /><Block style={{ width: 84, height: 9 }} /></span>
        </aside>
      </div>
      <div className="documents-mobile-list">
        {MOBILE_ROWS.map((row) => (
          <div key={row} className="mobile-doc-card hub-loading-mobile-row">
            <Block style={{ width: 18, height: 18, justifySelf: 'center' }} />
            <span className="hub-loading-copy"><Block style={{ width: row % 2 ? '68%' : '82%', height: 11 }} /><Block style={{ width: '58%', height: 8 }} /></span>
            <Block style={{ width: 38, height: 54, justifySelf: 'center' }} />
          </div>
        ))}
      </div>
    </div>
  );
};

const SidebarRows = ({ kind }) => (
  <>
    <div className="hub-loading-sidebar-controls">
      <Block style={{ width: kind === 'projects' ? 92 : 101, height: 28 }} />
      <Block style={{ width: 42, height: 22 }} />
    </div>
    <div className="hub-loading-sidebar-list">
      {ROWS.map((row) => (
        <div key={row} className="hub-loading-sidebar-row">
          <Block style={{ width: 14, height: 14, justifySelf: 'center' }} />
          <span className="hub-loading-copy"><Block style={{ width: row % 2 ? '62%' : '78%', height: 10 }} /><Block style={{ width: '42%', height: 7 }} /></span>
          <Block style={{ width: 18, height: 18 }} />
        </div>
      ))}
    </div>
  </>
);

const ProjectsSkeleton = () => (
  <div className="projects-tab-body hub-loading-body" style={{ padding: '0 8px 8px 8px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
    <div className="projects-desktop-layout" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 8, height: '100%', minHeight: 0 }}>
      <div className="card hub-loading-sidebar"><SidebarRows kind="projects" /></div>
      <div className="card hub-loading-project-detail">
        <div className="hub-loading-project-header">
          <Block style={{ width: '36%', height: 22 }} />
          <span className="hub-loading-button-pair"><Block style={{ width: 76, height: 28 }} /><Block style={{ width: 96, height: 28 }} /></span>
        </div>
        <div className="hub-loading-project-columns">
          <section className="hub-loading-project-files">
            <span className="hub-loading-section-heading"><Block style={{ width: 30, height: 8 }} /><Block style={{ width: 42, height: 18 }} /></span>
            <div className="hub-loading-file-header"><span /><Block style={{ width: 52, height: 7 }} /><Block style={{ width: 58, height: 7 }} /><Block style={{ width: 32, height: 7 }} /><span /></div>
            {ROWS.map((row) => (
              <div className="hub-loading-project-file-row" key={row}>
                <Block style={{ width: 14, height: 14, justifySelf: 'center' }} />
                <Block style={{ width: row % 2 ? '58%' : '74%', height: 10 }} />
                <span className="hub-loading-person"><Block style={{ width: 18, height: 18, borderRadius: '50%' }} /><Block style={{ width: 38, height: 8 }} /></span>
                <Block style={{ width: 42, height: 8 }} />
                <Block style={{ width: 18, height: 18, justifySelf: 'center' }} />
              </div>
            ))}
          </section>
          <aside className="hub-loading-project-team">
            <Block style={{ width: 30, height: 8 }} />
            {ROWS.slice(0, 4).map((row) => (
              <span className="hub-loading-team-row" key={row}>
                <Block style={{ width: 22, height: 22, borderRadius: '50%' }} />
                <span className="hub-loading-copy"><Block style={{ width: row % 2 ? 54 : 72, height: 9 }} /><Block style={{ width: 46, height: 7 }} /></span>
              </span>
            ))}
          </aside>
        </div>
      </div>
    </div>
    <div className="projects-mobile-layout">
      <div className="projects-mobile-browser projects-mobile-drill-view">
        {/* The rows sit in a panel here for the same reason the real list does:
            one card, hairline-parted lines. The real list gets its panel from
            the reorder wrapper, which a skeleton has no use for. */}
        <div className="hub-loading-mobile-panel">
          {MOBILE_ROWS.map((row) => (
            <div key={row} className="projects-mobile-folder-row drill reorderable hub-loading-mobile-row">
              <Block style={{ width: 14, height: 14, justifySelf: 'center' }} />
              <span className="hub-loading-copy"><Block style={{ width: row % 2 ? '64%' : '80%', height: 11 }} /><Block style={{ width: '48%', height: 8 }} /></span>
              <Block style={{ width: 18, height: 18, justifySelf: 'center' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const TemplatesSkeleton = () => (
  <div className="ed-scope hub-loading-body" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
    <div className="templates-editor-body" style={{ padding: '0 8px 8px 8px', height: '100%', overflow: 'hidden' }}>
      <div className="templates-editor-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr 268px', gap: 8, height: '100%' }}>
        <aside className="hub-loading-template-panel hub-loading-sidebar"><SidebarRows kind="templates" /></aside>
        <section className="hub-loading-template-panel hub-loading-template-editor">
          <div className="hub-loading-template-header"><Block style={{ width: 4, height: 36 }} /><Block style={{ width: '42%', height: 22 }} /><Block style={{ width: 52, height: 8, marginLeft: 'auto' }} /></div>
          <div className="hub-loading-template-content">
            <Block style={{ width: 38, height: 7 }} />
            <span className="hub-loading-module-tabs"><Block style={{ width: 96, height: 24 }} /><Block style={{ width: 74, height: 24 }} /><Block style={{ width: 18, height: 18 }} /></span>
            <span className="hub-loading-category-heading"><span className="hub-loading-copy"><Block style={{ width: 54, height: 7 }} /><Block style={{ width: 42, height: 18 }} /></span><Block style={{ width: 92, height: 24 }} /></span>
            {ROWS.slice(0, 3).map((row) => <Block className="hub-loading-category-card" style={{ height: row === 0 ? 78 : 64 }} key={row} />)}
          </div>
        </section>
        <aside className="hub-loading-template-panel hub-loading-entities-rail">
          <div className="hub-loading-entities-header"><Block style={{ width: 58, height: 8 }} /><Block style={{ width: 82, height: 24 }} /></div>
          <div className="hub-loading-entities-controls"><Block style={{ width: 42, height: 18 }} /></div>
          <div className="hub-loading-entities-list">
            {ROWS.map((row) => <span className="hub-loading-entity-row" key={row}><Block style={{ width: 14, height: 14 }} /><Block style={{ width: 18, height: 18, borderRadius: '50%' }} /><Block style={{ width: row % 2 ? '56%' : '72%', height: 9 }} /><Block style={{ width: 14, height: 14 }} /></span>)}
          </div>
        </aside>
      </div>
      <div className="templates-mobile-layout">
        <div className="templates-mobile-browser">
          <div className="hub-loading-mobile-panel">
            {MOBILE_ROWS.map((row) => (
              <div key={row} className="templates-mobile-row reorderable hub-loading-mobile-row">
                <Block style={{ width: 14, height: 14, justifySelf: 'center' }} />
                <span className="hub-loading-copy"><Block style={{ width: row % 2 ? '66%' : '82%', height: 11 }} /><Block style={{ width: '50%', height: 8 }} /></span>
                <Block style={{ width: 18, height: 18, justifySelf: 'center' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default function HubLoadingSkeletons({ tab, onNav, user, templatesLocked = false }) {
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
      <section className="hub-loading-region" aria-busy="true" role="status" aria-label={`Loading ${title.toLowerCase()}`}>
        {tab === 'documents' ? <DocumentsSkeleton /> : null}
        {tab === 'projects' ? <ProjectsSkeleton /> : null}
        {tab === 'templates' ? <TemplatesSkeleton /> : null}
      </section>
    </HubShell>
  );
}
