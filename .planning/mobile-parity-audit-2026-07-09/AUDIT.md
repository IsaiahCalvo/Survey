# Desktop to Mobile Parity Audit

## Scope

Documents, Projects, and Templates at desktop (1440x900) and mobile (390x844 and 320x700). Reviewed visible styling, navigation, search, selection, row menus, detail views, drag ordering, and section-specific editing controls.

## Results

| Tab | Desktop capability | Mobile result |
| --- | --- | --- |
| Documents | Search, upload, four-column sorting, bulk select, duplicate, move/copy, share, delete, row copy/paste/delete/share/lock, preview/details, open | Preserved. Sorting is exposed through Filter; preview/details is now a mobile sheet reached from the row menu. |
| Projects | Search/create, project select actions, rename/reorder/pin, upload, team management, file select actions, file row menu, file reorder/open | Preserved through the folder drill-in layout. Desktop's side-by-side panes become project list then project files. |
| Templates | Search/create, template select actions, rename/reorder, modules, module bulk editing, categories, checklist editing/archive, entities, color controls, save/cancel | Preserved. Entities remain in a modal; modules remain horizontal tabs; module bulk editing and archived checklist visibility are now available on mobile. |

## Fixed During Audit

1. Templates Select/Done and bulk controls now use the same gold accent and bordered controls as desktop.
2. Documents now exposes desktop preview metadata, page preview, team, dates, Share, and Open on mobile.
3. Templates now exposes desktop module Select, duplicate, move/copy, share, delete, rename, reorder, and add controls on mobile.
4. Archived checklist items and permanent deletion are now visible on mobile.
5. Module editing remains fully usable at 320px; its Done action no longer clips.
6. Filtered entity selection now acts only on visible entities.

## Deliberate Mobile Adaptations

- Projects uses folder drill-in navigation instead of compressing desktop's project, files, and team panes side by side.
- Templates puts Entities in a modal instead of keeping a permanent third rail.
- Mobile module tabs omit category counts per the selected mobile design direction.
- Controls and data remain the same even where the layout changes.

## Evidence

- Desktop baselines: `01-documents-desktop.png`, `03-projects-desktop.png`, `05-templates-desktop.png`
- Mobile baselines: `02-documents-mobile.png`, `04-projects-mobile.png`, `06-templates-mobile.png`
- Documents details: `09-documents-mobile-details.png`, `26-documents-mobile-320-details.png`
- Template module controls: `11-templates-mobile-modules.png`, `23-templates-mobile-320-modules-fixed.png`
- Template entities and categories: `12-templates-mobile-entities.png`, `28-templates-mobile-categories-select.png`
- Selection parity: `17-documents-mobile-select.png`, `18-projects-mobile-select.png`, `19-templates-mobile-select.png`, `27-projects-mobile-files-select.png`
- Desktop regression captures: `14-documents-desktop-postfix.png`, `15-projects-desktop-postfix.png`, `16-templates-desktop-postfix.png`

## Verification Limits

Screenshots and DOM inspection confirm responsive layout, visible states, labels, colors, and available actions. Full assistive-technology behavior and native iOS/Android screen-reader behavior were not tested in this browser audit.
