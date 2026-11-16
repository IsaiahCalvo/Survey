/**
 * Nightly 'toolbar-settings' (Drawboard Projects VT-33 "Show/hide
 * toolbars"): a left-rail button opens a small card with two switches, Tool
 * bar (the top tool row and its settings row) and, when the pinned-tools
 * dock is on, Pinned tools. Both remembered on this device. With the tool bar
 * off, this card is the way back (keys and the right-click menu still work).
 * While the tool bar shows, a third switch makes it compact (VT-34).
 * Under the switches, Workspaces saves the whole layout under a name and puts
 * it back with one press (utils/workspaces.js).
 */
import { useEffect, useRef, useState } from 'react';
import './RailFlyout.css';
import './PageGridSettings.css';
import '../styles/toolBarVisibility.css';
import { useToolBarCompact, useToolBarHidden } from '../utils/toolBarVisibility';
import { getPinnedToolsStore, usePinnedTools } from '../pinnedTools/pinnedToolsShared.jsx';
import Icon from '../Icons';
import { WORKSPACE_NAME_MAX, applyLayout, captureLayout, deleteWorkspace, saveWorkspace, useWorkspaces } from '../utils/workspaces';

/** A window with its top bar (Lucide-style, 24 grid, 1.5 stroke). */
export const ToolbarsGlyph = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 9h18M7 6.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

function SwitchRow({ label, sub, checked, onToggle, ...rest }) {
    return (
        <button type="button" role="switch" aria-checked={checked} className="page-grid-settings__switch snapping-card__row" onClick={onToggle} {...rest}>
            <span className="snapping-card__text">
                <span>{label}</span>
                <span className="snapping-card__sub">{sub}</span>
            </span>
            <span className="page-grid-settings__knob" aria-hidden="true" />
        </button>
    );
}

function WorkspacesSection({ panelState, onApplyPanel }) {
    const workspaces = useWorkspaces();
    const [name, setName] = useState('');
    const [applied, setApplied] = useState(null);
    const save = (event) => {
        event.preventDefault();
        const entry = saveWorkspace(name, captureLayout({ panel: panelState, pinnedStore: getPinnedToolsStore() }));
        if (entry) { setName(''); setApplied(entry.id); }
    };
    return (
        <div className="toolbars-card__workspaces" data-workspaces="true">
            <div className="toolbars-card__section-title">Workspaces</div>
            {workspaces.length === 0 && <p className="page-grid-settings__hint">Save how your screen is laid out, then switch back with one press.</p>}
            {workspaces.length > 0 && (
                <div className="rail-flyout__rows" role="list">
                    {workspaces.map((ws) => (
                        <div key={ws.id} role="listitem" className="toolbars-card__workspace">
                            <button
                                type="button"
                                className="rail-flyout__row"
                                data-workspace-apply={ws.name}
                                onClick={() => { applyLayout(ws.layout, { applyPanel: onApplyPanel, pinnedStore: getPinnedToolsStore() }); setApplied(ws.id); }}
                            >
                                <span className="rail-flyout__label">{ws.name}</span>
                                <span className="rail-flyout__tick" aria-hidden="true">
                                    {applied === ws.id && <Icon name="check" size={14} color="currentColor" />}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="toolbars-card__workspace-delete"
                                aria-label={`Delete workspace ${ws.name}`}
                                data-workspace-delete={ws.name}
                                onClick={() => { deleteWorkspace(ws.id); if (applied === ws.id) setApplied(null); }}
                            >
                                <Icon name="close" size={12} color="currentColor" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            <form className="toolbars-card__workspace-save" onSubmit={save}>
                <input
                    type="text"
                    value={name}
                    maxLength={WORKSPACE_NAME_MAX}
                    placeholder="Name this layout"
                    aria-label="Workspace name"
                    data-workspace-name="true"
                    onChange={(e) => setName(e.target.value)}
                />
                <button type="submit" disabled={!name.trim()} data-workspace-save="true">Save</button>
            </form>
        </div>
    );
}

/**
 * `renderButton({ open, ref, onClick, on })`; `on` while the tool bar is hidden.
 * `panelState` ({ open, panel }) and `onApplyPanel` let a workspace read and
 * set the left rail.
 */
export function ToolbarsMenu({ renderButton, pinnedToolsOn = false, panelState = null, onApplyPanel = null }) {
    const [hidden, setHidden] = useToolBarHidden();
    const [compact, setCompact] = useToolBarCompact();
    const pinned = usePinnedTools();
    const [open, setOpen] = useState(false);
    const buttonRef = useRef(null);
    const cardRef = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
            if (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return;
            setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);
    return (
        <div className="toolbars-menu">
            {renderButton({ open, ref: buttonRef, onClick: () => setOpen((v) => !v), on: hidden })}
            {open && (
                <div ref={cardRef} role="dialog" aria-label="Toolbars" data-toolbars-menu="true" className="rail-flyout page-grid-settings__card toolbars-card">
                    <div className="rail-flyout__head">
                        <span className="rail-flyout__title">Toolbars</span>
                    </div>
                    <div className="page-grid-settings snapping-card">
                        <SwitchRow
                            label="Tool bar"
                            sub="All drawing tools and their settings"
                            checked={!hidden}
                            onToggle={() => setHidden(!hidden)}
                            data-toolbars-tool-bar="true"
                        />
                        {!hidden && (
                            <SwitchRow
                                label="Compact tool bar"
                                sub="A shorter bar with smaller buttons"
                                checked={compact}
                                onToggle={() => setCompact(!compact)}
                                data-toolbars-compact="true"
                            />
                        )}
                        {pinnedToolsOn && (
                            <SwitchRow
                                label="Pinned tools"
                                sub="The tools you use most"
                                checked={pinned.visible}
                                onToggle={() => getPinnedToolsStore().setVisible(!pinned.visible)}
                                data-toolbars-pinned="true"
                            />
                        )}
                        {hidden && <p className="page-grid-settings__hint">Keys and the right-click menu still work.</p>}
                    </div>
                    <WorkspacesSection panelState={panelState} onApplyPanel={onApplyPanel} />
                </div>
            )}
        </div>
    );
}

export default ToolbarsMenu;
