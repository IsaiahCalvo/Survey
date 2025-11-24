import React from 'react';
import { useDroppable } from '@dnd-kit/core';

const DropSlot = ({
  id,
  parentId = null,
  index,
  isInsideFolder = false,
  isEmptyState = false
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'slot',
      parentId: parentId || null,
      index,
      isInsideFolder,
    },
  });

  return (
    <div
      ref={setNodeRef}
      data-drop-slot-id={id}
      data-drop-slot-parent={parentId || 'root'}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: isEmptyState ? '32px' : (isInsideFolder ? '4px' : '6px'),
        marginTop: isInsideFolder ? '1px' : '2px',
        marginBottom: isInsideFolder ? '1px' : '2px',
        transition: 'all 0.16s ease-out',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '4px',
          opacity: isOver ? 1 : 0,
          boxShadow: isOver ? '0 0 0 2px rgba(74, 144, 226, 0.35)' : 'none',
          background: isOver ? 'rgba(74, 144, 226, 0.1)' : 'transparent',
          transition: 'opacity 0.2s ease-out, box-shadow 0.2s ease-out, background 0.2s ease-out',
        }}
      />
    </div>
  );
};

export default DropSlot;
