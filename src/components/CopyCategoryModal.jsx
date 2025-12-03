import React, { useState, useEffect } from 'react';

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const CopyCategoryModal = ({
    isOpen,
    onClose,
    onConfirm,
    modules = [],
    currentModuleId,
}) => {
    const [action, setAction] = useState('copy'); // 'copy' | 'move'
    const [destinationId, setDestinationId] = useState(''); // module ID or 'new'
    const [newModuleName, setNewModuleName] = useState('');

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setAction('copy');
            setDestinationId('');
            setNewModuleName('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!destinationId) {
            alert('Please select a destination module.');
            return;
        }
        if (destinationId === 'new' && !newModuleName.trim()) {
            alert('Please enter a name for the new module.');
            return;
        }

        const type = destinationId === 'new' ? 'new' :
            destinationId === currentModuleId ? 'current' : 'existing';

        onConfirm({
            type,
            targetModuleId: destinationId === 'new' ? null : destinationId,
            newModuleName: destinationId === 'new' ? newModuleName.trim() : null,
            action // Pass action type (copy/move) although currently only copy logic is fully implemented
        });
        onClose();
    };

    // Filter modules if needed, but for "Move/Copy" usually all modules are available
    // The user might want to copy to the SAME module (duplicate), so we include currentModuleId
    const availableModules = modules;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
            }}
            onClick={onClose}
        >
            <div
                style={{
                    width: '600px',
                    maxHeight: '85vh',
                    overflow: 'auto',
                    background: '#1f1f1f',
                    color: '#eaeaea',
                    borderRadius: '12px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
                    border: '1px solid #2a2a2a',
                    padding: '16px'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', fontFamily: FONT_FAMILY }}>
                    Move/Copy Categories
                </div>

                {/* Action Selection */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa', fontFamily: FONT_FAMILY }}>Action</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setAction('copy')}
                            style={{
                                padding: '8px 16px',
                                background: action === 'copy' ? '#4A90E2' : '#2a2a2a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 500,
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY
                            }}
                        >
                            Copy
                        </button>
                        <button
                            onClick={() => setAction('move')}
                            style={{
                                padding: '8px 16px',
                                background: action === 'move' ? '#4A90E2' : '#2a2a2a',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 500,
                                fontSize: '12px',
                                fontFamily: FONT_FAMILY
                            }}
                        >
                            Move
                        </button>
                    </div>
                </div>

                {/* Destination Selection */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa', fontFamily: FONT_FAMILY }}>Destination Space</div>
                    <select
                        value={destinationId}
                        onChange={(e) => setDestinationId(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            border: '1px solid #333',
                            outline: 'none',
                            background: '#141414',
                            color: '#eaeaea',
                            fontFamily: FONT_FAMILY,
                            cursor: 'pointer',
                            fontSize: '13px'
                        }}
                    >
                        <option value="">Select destination module...</option>
                        <option value="new">Create New Module</option>
                        {availableModules.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.name} {m.id === currentModuleId ? '(Current)' : ''}
                            </option>
                        ))}
                    </select>

                    {destinationId === 'new' && (
                        <input
                            type="text"
                            value={newModuleName}
                            onChange={(e) => setNewModuleName(e.target.value)}
                            placeholder="New module name..."
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                border: '1px solid #333',
                                outline: 'none',
                                background: '#141414',
                                color: '#eaeaea',
                                fontFamily: FONT_FAMILY,
                                fontSize: '13px',
                                marginTop: '8px'
                            }}
                            autoFocus
                        />
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '8px 16px',
                            background: '#2a2a2a',
                            color: '#eaeaea',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 500,
                            fontFamily: FONT_FAMILY
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        style={{
                            padding: '8px 16px',
                            background: '#4A90E2', // Blue for Copy/Move
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 500,
                            fontFamily: FONT_FAMILY
                        }}
                    >
                        {action === 'copy' ? 'Copy' : 'Move'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CopyCategoryModal;
