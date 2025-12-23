// App.jsx - PDF Management Dashboard
import React, { useRef, useState, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx-js-style';
import ExcelJS from 'exceljs';
import { useMSGraph } from './contexts/MSGraphContext';
import { uploadExcelFile, getFileMetadata, downloadExcelFileByPath } from './services/excelGraphService';
import PageAnnotationLayer from './PageAnnotationLayer';
import TextLayer from './TextLayer';
import { savePDFWithAnnotationsPdfLib } from './utils/pdfAnnotationsPdfLib';
import { importAnnotationsFromPdf } from './utils/pdfAnnotationImporter';
import PDFPageCanvas from './components/PDFPageCanvas';
import { pdfWorkerManager } from './utils/PDFWorkerManager';
import Icon from './Icons';
import CompactColorPicker from './components/CompactColorPicker';
import PDFSidebar from './PDFSidebar';
import RegionSelectionTool from './RegionSelectionTool';
import SpaceRegionOverlay from './SpaceRegionOverlay';
import TabBar from './TabBar';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PageRenderCache } from './utils/pdfCache';
import { regionContainsPoint } from './utils/regionMath';
import { createZoomController, ZOOM_MODES, loadZoomPreferences, saveZoomPreferences, clampScale, DEFAULT_ZOOM_PREFERENCES } from './utils/zoomController';
import { useAuth } from './contexts/AuthContext';
import { AuthModal } from './components/AuthModal';
import { UserMenu } from './components/UserMenu';
import { AccountSettings } from './components/AccountSettings';
import { useOptionalAuth } from './components/OptionalAuthPrompt';
import BallInCourtIndicator from './components/BallInCourtIndicator';
import SearchHighlightLayer from './components/SearchHighlightLayer';
import UnsupportedAnnotationsNotice from './components/UnsupportedAnnotationsNotice';
import { useProjects, useDocuments, useTemplates, useStorage, useDocumentToolPreferences, DEFAULT_TOOL_PREFERENCES, TOOLS_WITH_STROKE_WIDTH, TOOLS_WITH_FILL } from './hooks/useDatabase';
import { supabase } from './supabaseClient';

// Set up the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS;

// Consistent font stack for the entire application
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, Ubuntu, "Noto Sans", Arial, sans-serif';

// Convert hex color to rgba with default opacity (default 0.2, but highlights use 1.0)
const hexToRgba = (hex, opacity = 0.2) => {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB values
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

// Ensure color is in rgba format with specified opacity (default 0.2, but highlights use 1.0)
const ensureRgbaOpacity = (color, opacity = 0.2) => {
  if (!color) return `rgba(227, 209, 251, ${opacity})`; // Default purple

  // If already rgba, ensure opacity is correct
  if (color.startsWith('rgba')) {
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbaMatch) {
      return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${opacity})`;
    }
  }

  // If hex, convert to rgba
  if (color.startsWith('#')) {
    return hexToRgba(color, opacity);
  }

  // Fallback to default
  return `rgba(227, 209, 251, ${opacity})`;
};

const DEFAULT_SURVEY_HIGHLIGHT_OPACITY = 0.4;

// Normalize highlight colors while preserving any opacity saved on the template
const normalizeHighlightColor = (color, fallbackOpacity = DEFAULT_SURVEY_HIGHLIGHT_OPACITY) => {
  if (!color || typeof color !== 'string') {
    return null;
  }

  const trimmed = color.trim();
  const rgbaMatch = trimmed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);

  if (rgbaMatch) {
    const [, r, g, b, opacityStr] = rgbaMatch;
    if (opacityStr !== undefined) {
      const parsedOpacity = parseFloat(opacityStr);
      const clampedOpacity = Number.isFinite(parsedOpacity)
        ? Math.min(1, Math.max(0, parsedOpacity))
        : fallbackOpacity;
      return `rgba(${r}, ${g}, ${b}, ${clampedOpacity})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${fallbackOpacity})`;
  }

  if (trimmed.startsWith('#')) {
    return hexToRgba(trimmed, fallbackOpacity);
  }

  return trimmed;
};

// Convert hex to RGB
const hexToRgb = (hex) => {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return { r, g, b };
};

// Extract hex color from rgba or hex string (for indicator display)
const getHexFromColor = (color) => {
  if (!color) return null;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return null;
};

const getHexFromBallColor = (color) => {
  if (!color) return '#E3D1FB';
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return '#E3D1FB';
};

const getOpacityFromBallColor = (color) => {
  if (!color) return 100;

  // Extract opacity from rgba string
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && match[4]) {
      // Convert opacity from 0-1 range to 0-100 range
      const opacity = parseFloat(match[4]);
      return Math.round(opacity * 100);
    }
  }

  // For hex colors or if no opacity found, default to 100%
  return 100;
};

// Helper to get hex from color (for stroke/fill)
const getHexFromAnnotationColor = (color) => {
  if (!color) return '#ff0000';
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, '0');
      const g = parseInt(match[2]).toString(16).padStart(2, '0');
      const b = parseInt(match[3]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
  }
  if (color.startsWith('#')) {
    return color;
  }
  return '#ff0000';
};

// Helper to get opacity from color (for stroke/fill)
const getOpacityFromAnnotationColor = (color) => {
  if (!color) return 100;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match && match[4]) {
      const opacity = parseFloat(match[4]);
      return Math.round(opacity * 100);
    }
  }
  return 100;
};

const escapeCSVValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === '') return '';
  const escaped = str.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) {
    return `"${escaped}"`;
  }
  return escaped;
};

const sanitizeFilename = (value, fallback = 'export') => {
  if (!value || typeof value !== 'string') return fallback;
  const sanitized = value.trim().replace(/[^a-z0-9_-]+/gi, '_');
  return sanitized || fallback;
};

const dataURLToUint8Array = (dataUrl) => {
  const base64 = dataUrl.split(',')[1];
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const traceRegionPath = (ctx, region, scaleFactor = 1) => {
  if (!ctx || !region || !Array.isArray(region.coordinates) || region.coordinates.length < 4) {
    return false;
  }

  const coords = region.coordinates;
  ctx.moveTo(coords[0] * scaleFactor, coords[1] * scaleFactor);
  for (let i = 2; i < coords.length; i += 2) {
    ctx.lineTo(coords[i] * scaleFactor, coords[i + 1] * scaleFactor);
  }
  ctx.closePath();
  return true;
};

const applyRegionMaskToCanvasContext = (context, regions, scaleFactor = 1) => {
  if (!context || !Array.isArray(regions) || regions.length === 0) {
    return;
  }

  // Solid overlay
  context.save();
  context.fillStyle = 'rgba(40, 40, 40, 0.55)';
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.globalCompositeOperation = 'destination-out';
  regions.forEach(region => {
    context.beginPath();
    if (traceRegionPath(context, region, scaleFactor)) {
      context.fill();
    }
  });
  context.globalCompositeOperation = 'source-over';
  context.restore();

  // Hatched overlay
  context.save();
  const hatchCanvas = document.createElement('canvas');
  hatchCanvas.width = 12;
  hatchCanvas.height = 12;
  const hatchCtx = hatchCanvas.getContext('2d');
  hatchCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  hatchCtx.lineWidth = 1;
  hatchCtx.beginPath();
  hatchCtx.moveTo(0, 12);
  hatchCtx.lineTo(12, 0);
  hatchCtx.stroke();
  hatchCtx.beginPath();
  hatchCtx.moveTo(-4, 12);
  hatchCtx.lineTo(8, 0);
  hatchCtx.stroke();

  const pattern = context.createPattern(hatchCanvas, 'repeat');
  if (pattern) {
    context.fillStyle = pattern;
    context.globalAlpha = 0.35;
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'destination-out';
    regions.forEach(region => {
      context.beginPath();
      if (traceRegionPath(context, region, scaleFactor)) {
        context.fill();
      }
    });
    context.globalCompositeOperation = 'source-over';
  }
  context.restore();
};

const generateUniqueId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const createCopyName = (name, usedNames) => {
  const trimmedName = (name || 'Untitled').trim();
  const baseName = trimmedName.replace(/\s+\(Copy(?:\s+\d+)?\)$/i, '');
  let attempt = `${baseName} (Copy)`;
  let counter = 2;
  while (usedNames.has(attempt.toLowerCase())) {
    attempt = `${baseName} (Copy ${counter})`;
    counter += 1;
  }
  usedNames.add(attempt.toLowerCase());
  return attempt;
};

const normalizeName = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const hasNameConflict = (
  items,
  candidateName,
  {
    getName = (item) => item?.name,
    getId = (item) => item?.id,
    ignoreId,
    predicate
  } = {}
) => {
  if (!Array.isArray(items)) return false;
  const normalizedCandidate = normalizeName(candidateName);
  if (!normalizedCandidate) return false;

  const shouldIgnore = typeof ignoreId !== 'undefined';

  return items.some((item) => {
    if (!item) return false;
    if (predicate && !predicate(item)) return false;
    if (shouldIgnore && getId(item) === ignoreId) return false;
    const existingName = normalizeName(getName(item));
    return existingName && existingName === normalizedCandidate;
  });
};

const ZOOM_MODE_LABELS = {
  [ZOOM_MODES.FIT_PAGE]: 'Fit Page',
  [ZOOM_MODES.FIT_WIDTH]: 'Fit Width',
  [ZOOM_MODES.FIT_HEIGHT]: 'Fit Height',
  [ZOOM_MODES.MANUAL]: 'Manual %'
};

const ZOOM_MODE_DESCRIPTIONS = {
  [ZOOM_MODES.FIT_PAGE]: 'Show the entire page within the viewport.',
  [ZOOM_MODES.FIT_WIDTH]: 'Fill the viewer width. Scroll vertically for height.',
  [ZOOM_MODES.FIT_HEIGHT]: 'Fill the viewer height. Horizontal scroll may appear.',
  [ZOOM_MODES.MANUAL]: 'Use a specific zoom percentage.'
};

const ZOOM_MODE_OPTIONS = [
  {
    id: ZOOM_MODES.FIT_PAGE,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_PAGE],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_PAGE]
  },
  {
    id: ZOOM_MODES.FIT_WIDTH,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_WIDTH],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_WIDTH]
  },
  {
    id: ZOOM_MODES.FIT_HEIGHT,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.FIT_HEIGHT],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.FIT_HEIGHT]
  },
  {
    id: ZOOM_MODES.MANUAL,
    label: ZOOM_MODE_LABELS[ZOOM_MODES.MANUAL],
    description: ZOOM_MODE_DESCRIPTIONS[ZOOM_MODES.MANUAL]
  }
];

const MANUAL_ZOOM_SESSION_KEY = 'pdfViewerManualZoomScale';

const TemplateDragOverlayItem = ({ label }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      borderRadius: '8px',
      border: '2px solid #4A90E2',
      background: 'rgba(43, 43, 43, 0.92)',
      color: '#eaeaea',
      fontSize: '13px',
      fontWeight: 500,
      boxShadow: '0 10px 26px rgba(0, 0, 0, 0.45)',
      backdropFilter: 'blur(2px)'
    }}
  >
    <span style={{ fontSize: '16px', color: '#4A90E2' }}>☰</span>
    <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
  </div>
);

const TemplateModuleSortableRow = React.memo(function TemplateModuleSortableRow({
  module,
  isSelected,
  nameValue,
  onToggleSelect,
  onNameChange,
  onNameKeyDown,
  disabled
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: module.id,
    disabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    width: '100%'
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          padding: '4px 6px',
          borderRadius: '8px',
          background: isDragging ? 'rgba(58, 58, 58, 0.25)' : 'transparent',
          border: isSelected ? '1px solid rgba(74, 144, 226, 0.45)' : '1px solid transparent',
          transition: 'background 0.18s ease, border-color 0.18s ease'
        }}
      >
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: disabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
            color: '#888',
            fontSize: '16px',
            userSelect: 'none',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            touchAction: 'none'
          }}
          aria-label="Drag to reorder module"
        >
          ☰
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(module.id)}
          style={{ cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
        />
        <input
          type="text"
          value={nameValue}
          onChange={(e) => onNameChange(module.id, e.target.value)}
          onKeyDown={(e) => onNameKeyDown(module.id, e)}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid #4A90E2',
            outline: 'none',
            background: '#141414',
            color: '#eaeaea',
            fontFamily: FONT_FAMILY,
            fontSize: '13px',
            minWidth: 0
          }}
        />
      </div>
    </div>
  );
});

const BallInCourtSortableRow = React.memo(function BallInCourtSortableRow({
  entity,
  selectedColorPickerId,
  onOpenColorPicker,
  onNameChange,
  onDelete,
  isAnyDragging
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: entity.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    width: '100%'
  };

  const isColorPickerSelected = selectedColorPickerId === entity.id;
  const currentHex = getHexFromBallColor(entity.color);
  const currentOpacity = getOpacityFromBallColor(entity.color);

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '8px 10px',
          background: '#1b1b1b',
          border: isDragging ? '1px solid rgba(74, 144, 226, 0.6)' : '1px solid #2f2f2f',
          borderRadius: '8px',
          boxShadow: isDragging ? '0 8px 24px rgba(0, 0, 0, 0.45)' : 'none',
          opacity: isDragging ? 0.65 : 1,
          transition: 'border 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease'
        }}
      >
        <div
          {...attributes}
          {...listeners}
          data-ball-drag-handle
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: '#1f1f1f',
            border: '1px solid #2d2d2d',
            cursor: isDragging ? 'grabbing' : 'grab',
            color: '#777',
            flexShrink: 0,
            transition: 'background 0.15s ease, color 0.15s ease, border 0.15s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#bbb';
            e.currentTarget.style.background = '#262626';
            e.currentTarget.style.border = '1px solid #3a3a3a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#777';
            e.currentTarget.style.background = '#1f1f1f';
            e.currentTarget.style.border = '1px solid #2d2d2d';
          }}
          title="Drag to reorder"
        >
          <Icon name="grip" size={11} />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1 }}>
          <div data-color-picker-area style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div
                style={{
                  width: '40px',
                  height: '28px',
                  border: isColorPickerSelected ? '2px solid #4A90E2' : '1px solid #2f2f2f',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  position: 'relative',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  background: '#ffffff'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenColorPicker(entity.id, currentHex, currentOpacity);
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: currentHex || '#E3D1FB',
                    opacity: currentOpacity / 100,
                    mixBlendMode: 'multiply',
                    borderRadius: '5px'
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: '9px',
                  color: '#666',
                  lineHeight: 1,
                  textAlign: 'center',
                  opacity: 0.7
                }}
              >
                {currentOpacity}%
              </div>
            </div>
          </div>
          <input
            type="text"
            value={entity.name}
            onChange={(e) => onNameChange(entity.id, e.target.value)}
            placeholder="Entity name (e.g., GC, Subcontractor)"
            style={{
              flex: 1,
              padding: '6px 8px',
              background: '#141414',
              color: '#ddd',
              border: '1px solid #2f2f2f',
              borderRadius: '6px',
              outline: 'none',
              fontSize: '13px',
              height: '28px',
              boxSizing: 'border-box'
            }}
          />
        </div>
        <button
          data-ball-delete
          onClick={onDelete}
          title="Delete"
          className="btn btn-danger btn-icon-only btn-sm"
          style={{
            padding: '6px',
            minWidth: '28px',
            minHeight: '28px',
            flexShrink: 0,
            display: isAnyDragging ? 'none' : 'flex'
          }}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
    </div>
  );
});

const BallInCourtDragOverlayItem = ({ entity }) => {
  if (!entity) return null;
  const currentHex = getHexFromBallColor(entity.color);
  const currentOpacity = getOpacityFromBallColor(entity.color);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '2px solid #4A90E2',
        background: 'rgba(43, 43, 43, 0.92)',
        color: '#eaeaea',
        fontSize: '13px',
        fontWeight: 500,
        boxShadow: '0 10px 26px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(2px)'
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: '6px',
          background: '#1f1f1f',
          border: '1px solid #2d2d2d',
          color: '#bbb'
        }}
      >
        <Icon name="grip" size={11} />
      </span>
      <span
        style={{
          width: '32px',
          height: '20px',
          borderRadius: '5px',
          background: currentHex || '#E3D1FB',
          opacity: currentOpacity / 100,
          border: '1px solid rgba(255, 255, 255, 0.12)'
        }}
      />
      <span style={{ whiteSpace: 'nowrap' }}>{entity.name || 'Entity'}</span>
    </div>
  );
};

const TemplateCategorySortableRow = React.memo(function TemplateCategorySortableRow({
  category,
  isSelected,
  nameValue,
  onToggleSelect,
  onNameChange,
  onNameKeyDown,
  disabled
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: category.id,
    disabled
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.2, 0, 0.2, 1)',
    width: '100%'
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
          padding: '4px 6px',
          borderRadius: '8px',
          background: isDragging ? 'rgba(58, 58, 58, 0.25)' : 'transparent',
          border: isSelected ? '1px solid rgba(74, 144, 226, 0.45)' : '1px solid transparent',
          transition: 'background 0.18s ease, border-color 0.18s ease'
        }}
      >
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: disabled ? 'default' : (isDragging ? 'grabbing' : 'grab'),
            color: '#888',
            fontSize: '16px',
            userSelect: 'none',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            touchAction: 'none'
          }}
          aria-label="Drag to reorder category"
        >
          ☰
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(category.id)}
          style={{ cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
        />
        <input
          type="text"
          value={nameValue}
          onChange={(e) => onNameChange(category.id, e.target.value)}
          onKeyDown={(e) => onNameKeyDown(category.id, e)}
          style={{
            flex: 1,
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid #4A90E2',
            outline: 'none',
            background: '#141414',
            color: '#eaeaea',
            fontFamily: FONT_FAMILY,
            fontSize: '13px',
            minWidth: 0
          }}
        />
      </div>
    </div>
  );
});

// Convert RGB to HSL
const rgbToHsl = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
};

// Convert HSL to RGB
const hslToRgb = (h, s, l) => {
  h /= 360;
  s /= 100;
  l /= 100;
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

// Generate color swatch grid
const generateColorSwatches = () => {
  const swatches = [];
  // Row 1: Reds and pinks
  swatches.push('#FF0000', '#CC0000', '#990000', '#660000', '#FF3366', '#FF6699', '#FF99CC', '#CC0066');
  // Row 2: Yellows and oranges
  swatches.push('#FFFF00', '#FFCC00', '#FF9900', '#FF6600', '#CC6600', '#996600', '#CC9900', '#FFCC66');
  // Row 3: Greens
  swatches.push('#00FF00', '#00CC00', '#00FF66', '#66FF00', '#33CC00', '#00CC66', '#009900', '#006600');
  // Row 4: Blues and purples
  swatches.push('#0000FF', '#0066FF', '#0099FF', '#00CCFF', '#00FFFF', '#0066CC', '#6600CC', '#0000CC');
  // Row 5: Grays and neutrals
  swatches.push('#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF', '#E3D1FB', '#CBDCFF');
  return swatches;
};

// ==========================================
// DATA PERSISTENCE LAYER
// ==========================================

const generateUUID = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Store structure: { [pdfId]: { items: {}, annotations: {} } }
// Items: { [itemId]: { itemId, itemType, name, quantity, installationData, commissioningData, ... } }
// Annotations: { [annotationId]: { annotationId, pdfCoordinates, displayType, spaceId, itemId, itemType, notesData } }

const getPDFId = (file) => {
  if (!file) return null;
  // Use file name + size as unique identifier
  return `${file.name}-${file.size}`;
};

const loadPDFData = (pdfId) => {
  if (!pdfId) return { items: {}, annotations: {} };
  try {
    const data = localStorage.getItem(`pdfData_${pdfId}`);
    if (!data) return { items: {}, annotations: {} };
    const parsed = JSON.parse(data);
    return {
      items: parsed.items || {},
      annotations: parsed.annotations || {}
    };
  } catch (e) {
    // console.error('Error loading PDF data:', e);
    return { items: {}, annotations: {} };
  }
};

const savePDFData = (pdfId, items, annotations) => {
  if (!pdfId) return;
  try {
    const data = { items, annotations };
    localStorage.setItem(`pdfData_${pdfId}`, JSON.stringify(data));
  } catch (e) {
    console.error('Error saving PDF data:', e);
  }
};

const saveHighlightAnnotations = (pdfId, highlightAnnotations) => {
  if (!pdfId) return;
  try {
    const key = `highlightAnnotations_${pdfId}`;
    const data = JSON.stringify(highlightAnnotations);
    localStorage.setItem(key, data);
    // console.log('Successfully saved highlightAnnotations to localStorage:', { key, size: data.length });
  } catch (e) {
    console.error('Error saving highlight annotations:', e);
  }
};

const saveAnnotationsByPage = (pdfId, annotationsByPage) => {
  if (!pdfId) return;
  try {
    const key = `annotationsByPage_${pdfId}`;
    const data = JSON.stringify(annotationsByPage);
    localStorage.setItem(key, data);
  } catch (e) {
    console.error('Error saving annotationsByPage:', e);
  }
};

const loadAnnotationsByPage = (pdfId) => {
  if (!pdfId) return {};
  try {
    const data = localStorage.getItem(`annotationsByPage_${pdfId}`);
    if (!data) return {};
    return JSON.parse(data);
  } catch (e) {
    console.error('Error loading annotationsByPage:', e);
    return {};
  }
};

const loadHighlightAnnotations = (pdfId) => {
  if (!pdfId) return {};
  try {
    const data = localStorage.getItem(`highlightAnnotations_${pdfId}`);
    if (!data) return {};
    return JSON.parse(data);
  } catch (e) {
    console.error('Error loading highlight annotations:', e);
    return {};
  }
};

// ==========================================
// ITEM AND ANNOTATION HELPER FUNCTIONS
// ==========================================

// Get module name from template (for readable IDs)
const getModuleName = (template, moduleId) => {
  const module = template?.modules?.find(m => m.id === moduleId);
  return module?.name || 'Unknown Module';
};

// Get category name from template
const getCategoryName = (template, moduleId, categoryId) => {
  const module = template?.modules?.find(m => m.id === moduleId);
  const category = module?.categories?.find(c => c.id === categoryId);
  return category?.name || 'Unknown Category';
};

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const generateDefaultHighlightName = (categoryName, highlights = []) => {
  const baseName = (categoryName && categoryName.trim()) ? categoryName.trim() : 'Untitled Category';
  const pattern = new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`, 'i');
  let maxNumber = 0;

  highlights.forEach(highlight => {
    const existingName = (highlight?.name || '').trim();
    const match = pattern.exec(existingName);
    if (match) {
      const sequence = parseInt(match[1], 10);
      if (!Number.isNaN(sequence)) {
        maxNumber = Math.max(maxNumber, sequence);
      }
    }
  });

  return `${baseName} ${maxNumber + 1}`;
};

// Get itemType from category name (assumes category.name = itemType)
const getItemType = (template, moduleId, categoryId) => {
  return getCategoryName(template, moduleId, categoryId);
};

// Create new Item object
const createItem = (template, moduleId, categoryId, name, quantity = 1) => {
  const itemId = generateUUID();
  const itemType = getItemType(template, moduleId, categoryId);
  const moduleName = getModuleName(template, moduleId);

  // Initialize module-specific metadata based on template modules
  const metadata = {};
  if (template?.modules) {
    template.modules.forEach(module => {
      metadata[`${module.name.toLowerCase()}Data`] = {};
    });
  }

  return {
    itemId,
    itemType,
    name,
    quantity,
    ...metadata
  };
};

// Create new Annotation object
const createAnnotation = (pdfCoordinates, displayType, template, moduleId, itemId, itemType) => {
  const annotationId = generateUUID();

  // Initialize module-specific notes data
  const notesData = {};
  if (template?.modules) {
    template.modules.forEach(module => {
      notesData[`${module.name.toLowerCase()}Data`] = {};
    });
  }

  return {
    annotationId,
    pdfCoordinates,
    displayType,
    moduleId,
    itemId: itemId || null,
    itemType: itemType || null,
    notesData
  };
};

// Get module name key for metadata (e.g., "Installation" -> "installationData")
const getModuleDataKey = (moduleName) => {
  return `${moduleName.toLowerCase().replace(/\s+/g, '')}Data`;
};

// Get all items in a module
const getModuleItems = (items, moduleId, template) => {
  return Object.values(items).filter(item => {
    const moduleName = getModuleName(template, moduleId);
    const dataKey = getModuleDataKey(moduleName);
    return item[dataKey] && Object.keys(item[dataKey]).length > 0;
  });
};

// Get all items in a category within a module
const getCategoryItems = (items, moduleId, categoryId, template) => {
  const categoryName = getCategoryName(template, moduleId, categoryId);
  return Object.values(items).filter(item => item.itemType === categoryName);
};

// Filter annotations by module
const filterAnnotationsByModule = (annotations, moduleId) => {
  return Object.fromEntries(
    Object.entries(annotations).filter(([_, ann]) => ann.moduleId === moduleId)
  );
};

// ITEM TRANSFER HELPER FUNCTIONS

// Check if category exists in destination module
const categoryExists = (template, destModuleId, categoryName) => {
  const module = template?.modules?.find(m => m.id === destModuleId);
  if (!module || !module.categories) return false;
  return module.categories.some(cat => cat.name === categoryName);
};

// Get checklist from source category
const getCategoryChecklist = (template, moduleId, categoryId) => {
  const module = template?.modules?.find(m => m.id === moduleId);
  if (!module || !module.categories) return [];
  const category = module.categories.find(c => c.id === categoryId);
  return category?.checklist || [];
};

// Transfer items between modules with proper category checks
const transferItems = (itemsToTransfer, sourceModuleId, destModuleId, template, items, annotations) => {
  const newItems = { ...items };
  const updatedAnnotations = { ...annotations };

  // Group by itemType to handle categories
  const itemsByType = {};
  itemsToTransfer.forEach(itemId => {
    const item = items[itemId];
    if (!item) return;
    const itemType = item.itemType;
    if (!itemsByType[itemType]) itemsByType[itemType] = [];
    itemsByType[itemType].push(item);
  });

  // Check which categories need to be created
  const categoriesToCreate = [];
  Object.keys(itemsByType).forEach(itemType => {
    if (!categoryExists(template, destModuleId, itemType)) {
      categoriesToCreate.push({ itemType, items: itemsByType[itemType] });
    }
  });

  // Handle categories that already exist - direct transfer
  Object.keys(itemsByType).forEach(itemType => {
    if (categoryExists(template, destModuleId, itemType)) {
      // Find the category ID in destination module
      const destModule = template?.modules?.find(m => m.id === destModuleId);
      const destCategory = destModule?.categories?.find(c => c.name === itemType);
      const destCategoryId = destCategory?.id || null;

      itemsByType[itemType].forEach(item => {
        // Transfer WITHOUT metadata (blank slate)
        const moduleName = getModuleName(template, destModuleId);
        const dataKey = getModuleDataKey(moduleName);

        // Initialize item with destination module data
        // Use a placeholder key so it passes getModuleItems check (which requires Object.keys().length > 0)
        newItems[item.itemId] = {
          ...item,
          [dataKey]: { _initialized: true } // Placeholder so item shows up in module
        };

        // Find source annotation to get pdfCoordinates
        const sourceAnnotation = Object.values(annotations).find(ann =>
          ann.itemId === item.itemId && ann.moduleId === sourceModuleId
        );

        if (sourceAnnotation) {
          // Create a NEW annotation for the destination module (don't modify the source one)
          const destAnnotation = createAnnotation(
            sourceAnnotation.pdfCoordinates,
            sourceAnnotation.displayType || 'highlight',
            template,
            destModuleId,
            item.itemId,
            itemType
          );

          updatedAnnotations[destAnnotation.annotationId] = destAnnotation;
        } else {
          // No source annotation found, but we still need to create one for the destination
          // Use null coordinates - this should be rare
          const destAnnotation = createAnnotation(
            null,
            'highlight',
            template,
            destModuleId,
            item.itemId,
            itemType
          );

          updatedAnnotations[destAnnotation.annotationId] = destAnnotation;
        }
      });
    }
  });

  return { newItems, updatedAnnotations, categoriesToCreate };
};

// Migrate legacy highlightAnnotations to new system
const migrateLegacyHighlights = (legacyHighlights, items, annotations, template) => {
  const newItems = { ...items };
  const newAnnotations = { ...annotations };

  Object.values(legacyHighlights).forEach(highlight => {
    // Skip if already migrated (check if item exists with this name in this module/category)
    const categoryName = getCategoryName(template, highlight.moduleId, highlight.categoryId);
    const existingItem = Object.values(newItems).find(item =>
      item.name === highlight.name &&
      item.itemType === categoryName &&
      highlight.moduleId
    );

    if (existingItem) {
      // Item already exists, just ensure annotation exists
      const existingAnnotation = Object.values(newAnnotations).find(ann =>
        ann.itemId === existingItem.itemId &&
        ann.moduleId === highlight.moduleId
      );

      if (!existingAnnotation) {
        const annotation = createAnnotation(
          highlight.bounds,
          'highlight',
          template,
          highlight.moduleId,
          existingItem.itemId,
          categoryName
        );
        newAnnotations[annotation.annotationId] = annotation;
      }
    } else {
      // Create new item and annotation
      const item = createItem(
        template,
        highlight.moduleId,
        highlight.categoryId,
        highlight.name || 'Untitled Item',
        1
      );

      // Set checklist responses from legacy data
      const moduleName = getModuleName(template, highlight.moduleId);
      const dataKey = getModuleDataKey(moduleName);
      item[dataKey] = highlight.checklistResponses || {};

      const annotation = createAnnotation(
        highlight.bounds,
        'highlight',
        template,
        highlight.moduleId,
        item.itemId,
        categoryName
      );

      newItems[item.itemId] = item;
      newAnnotations[annotation.annotationId] = annotation;
    }
  });

  return { items: newItems, annotations: newAnnotations };
};

// PDF Thumbnail Generator Component
function PDFThumbnail({ dataUrl, filePath, docId, getDocumentUrl, downloadDocument }) {
  const [thumbnail, setThumbnail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const generateThumbnail = async () => {
      let arrayBuffer = null;

      // If we have a dataUrl, use it directly
      if (dataUrl) {
        try {
          const response = await fetch(dataUrl);
          arrayBuffer = await response.arrayBuffer();
        } catch (error) {
          console.error('Error fetching dataUrl:', error);
          setIsLoading(false);
          return;
        }
      }
      // If we have a filePath, download the document
      else if (filePath && downloadDocument) {
        try {
          const blob = await downloadDocument(filePath);
          arrayBuffer = await blob.arrayBuffer();
        } catch (error) {
          console.error('Error downloading document for thumbnail:', error);
          setIsLoading(false);
          return;
        }
      }
      // Try getDocumentUrl as fallback
      else if (filePath && getDocumentUrl) {
        try {
          const pdfUrl = getDocumentUrl(filePath);
          if (pdfUrl) {
            const response = await fetch(pdfUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch PDF: ${response.status}`);
            }
            arrayBuffer = await response.arrayBuffer();
          }
        } catch (error) {
          console.error('Error fetching PDF URL:', error);
          setIsLoading(false);
          return;
        }
      }

      if (!arrayBuffer) {
        setIsLoading(false);
        return;
      }

      try {
        // Load PDF
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        // Get first page
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.3 }); // Scale down for thumbnail

        // Create canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Render page to canvas
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

        // Convert to data URL
        const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.85);
        setThumbnail(thumbnailUrl);
      } catch (error) {
        console.error('Error generating thumbnail from PDF:', error);
        setThumbnail(null);
      } finally {
        setIsLoading(false);
      }
    };

    generateThumbnail();
  }, [dataUrl, filePath, docId, getDocumentUrl, downloadDocument]);

  if (isLoading) {
    return (
      <div style={{
        fontSize: '32px',
        height: '64px',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.4,
        background: '#2a2a2a',
        borderRadius: '4px',
        border: '1px solid #3a3a3a'
      }}>
        <Icon name="document" size={24} color="#999" />
      </div>
    );
  }

  if (thumbnail) {
    return (
      <img
        src={thumbnail}
        alt="PDF thumbnail"
        style={{
          width: '100%',
          maxHeight: '80px',
          objectFit: 'contain',
          borderRadius: '4px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          background: '#1a1a1a'
        }}
      />
    );
  }

  return (
    <div style={{
      height: '64px',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#2a2a2a',
      borderRadius: '4px',
      border: '1px solid #3a3a3a',
      opacity: 0.6
    }}>
      <Icon name="document" size={32} color="#999" />
    </div>
  );
}

// Dashboard Component with document management
const Dashboard = forwardRef(function Dashboard({ onDocumentSelect, onBack, documents, setDocuments, templates: externalTemplates = [], onTemplatesChange, onShowAuthModal, ballInCourtEntities, setBallInCourtEntities }, ref) {
  const fileInputRef = useRef();
  const projectFileInputRef = useRef();
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isMoveCopyDropdownOpen, setIsMoveCopyDropdownOpen] = useState(false);
  const moveCopyDropdownRef = useRef(null);
  const [templateName, setTemplateName] = useState('');
  const [templateVisibility, setTemplateVisibility] = useState('personal'); // 'personal' | 'shared'
  const [modules, setModules] = useState([]); // { id, name, categories: [ { id, name, checklist: [ { id, text } ] } ] }
  const [selectedModuleId, setSelectedModuleId] = useState(null); // Module selected from dropdown
  const [selectedTemplateCategoryId, setSelectedTemplateCategoryId] = useState(null); // Category selected in template modal
  const [addingModule, setAddingModule] = useState(false); // Show input when adding module
  const [newModuleName, setNewModuleName] = useState(''); // Temporary module name input
  const [addingCategory, setAddingCategory] = useState(false); // Show input when adding category
  const [newCategoryName, setNewCategoryName] = useState(''); // Temporary category name input
  const [editingModules, setEditingModules] = useState(false); // Edit mode for modules
  const [editingCategories, setEditingCategories] = useState(false); // Edit mode for categories
  const [editingModuleName, setEditingModuleName] = useState({}); // { moduleId: name } for editing module names
  const [editingCategoryName, setEditingCategoryName] = useState({}); // { categoryId: name } for editing category names
  const [selectedModuleIds, setSelectedModuleIds] = useState([]); // Selected modules for move/copy
  const [selectedCategoryIds, setSelectedCategoryIds] = useState([]); // Selected categories for move/copy
  const [selectedChecklistItemIds, setSelectedChecklistItemIds] = useState([]); // Selected checklist items for move/copy
  const initialTemplateStateRef = useRef(null);
  const [isMoveCopyModalOpen, setIsMoveCopyModalOpen] = useState(false);
  const [moveCopyType, setMoveCopyType] = useState(null); // 'module' | 'category' | 'checklistItem'
  const [moveCopyMode, setMoveCopyMode] = useState('copy'); // 'move' | 'copy'
  // Ball in Court entities: { id, name, color }
  // Auth state and user dropdown menu
  const { user, isAuthenticated, signOut, signInWithGoogle, features } = useAuth();
  const { isAuthenticated: isMSAuthenticated, login: msLogin, logout: msLogout, account: msAccount } = useMSGraph();
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const userDropdownRef = useRef(null);

  // Supabase hooks for data persistence
  const {
    projects: supabaseProjects,
    loading: projectsLoading,
    createProject: createSupabaseProject,
    updateProject: updateSupabaseProject,
    deleteProject: deleteSupabaseProject,
    refetch: refetchProjects
  } = useProjects();

  const {
    templates: supabaseTemplates,
    loading: templatesLoading,
    createTemplate: createSupabaseTemplate,
    updateTemplate: updateSupabaseTemplate,
    deleteTemplate: deleteSupabaseTemplate,
    refetch: refetchTemplates
  } = useTemplates();

  const { uploadDocument: uploadToStorage, uploadDataFile, deleteDocumentFile: deleteFromStorage, downloadDocument: downloadFromStorage, getDocumentUrl } = useStorage();


  const [selectedColorPickerId, setSelectedColorPickerId] = useState(null); // Track which color picker is selected
  const [colorPickerMode, setColorPickerMode] = useState('grid'); // 'grid' or 'advanced'
  const [tempColor, setTempColor] = useState(null); // Temporary color while picking
  const [opacityInputValue, setOpacityInputValue] = useState(null); // Temporary opacity input value (null = show current, '' = empty during typing, string = value)
  const [opacityInputFocused, setOpacityInputFocused] = useState(false); // Track if opacity input is focused
  const ballSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  );

  // Close user dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setShowUserDropdown(false);
      }
    };

    if (showUserDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserDropdown]);

  const [activeBallEntityId, setActiveBallEntityId] = useState(null);
  const activeBallEntity = useMemo(
    () => ballInCourtEntities.find((entity) => entity.id === activeBallEntityId) || null,
    [activeBallEntityId, ballInCourtEntities]
  );
  const handleBallDragStart = useCallback(({ active }) => {
    setActiveBallEntityId(active.id);
  }, []);
  const handleBallDragEnd = useCallback(({ active, over }) => {
    setActiveBallEntityId(null);
    if (!over || active.id === over.id) {
      return;
    }
    setBallInCourtEntities((prevEntities) => {
      const oldIndex = prevEntities.findIndex((entity) => entity.id === active.id);
      const newIndex = prevEntities.findIndex((entity) => entity.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        return prevEntities;
      }
      return arrayMove(prevEntities, oldIndex, newIndex);
    });
  }, []);
  const handleBallDragCancel = useCallback(() => {
    setActiveBallEntityId(null);
  }, []);
  const isAnyBallEntityDragging = Boolean(activeBallEntityId);
  useEffect(() => {
    if (isAnyBallEntityDragging) {
      document.body.classList.add('ball-in-court-dragging');
    } else {
      document.body.classList.remove('ball-in-court-dragging');
    }
    return () => {
      document.body.classList.remove('ball-in-court-dragging');
    };
  }, [isAnyBallEntityDragging]);
  const [projectName, setProjectName] = useState('');
  const [projectFiles, setProjectFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'uploadedAt', direction: 'desc' });
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [activeSection, setActiveSection] = useState('documents'); // 'documents' | 'projects' | 'templates'
  // Use Supabase projects instead of local state
  const projects = supabaseProjects || [];
  // Normalize Supabase templates so we retain the config plus the Supabase record id
  const templates = useMemo(() => {
    if (!Array.isArray(supabaseTemplates)) return [];
    return supabaseTemplates.map((templateRow) => {
      const config = templateRow?.config && typeof templateRow.config === 'object'
        ? templateRow.config
        : {};
      const templateId = config.id || templateRow.id;
      return {
        ...config,
        id: templateId,
        supabaseId: templateRow.id,
        name: config.name || templateRow.name || 'Untitled Template',
        createdAt: config.createdAt || templateRow.created_at || templateRow.updated_at || new Date().toISOString(),
        updatedAt: config.updatedAt || templateRow.updated_at || config.createdAt || templateRow.created_at || new Date().toISOString()
      };
    });
  }, [supabaseTemplates]);

  // Use ref to track if update is from external source (to prevent circular updates)
  const isExternalUpdateRef = useRef(false);

  const resolveSupabaseTemplateId = useCallback((templateOrId) => {
    if (!templateOrId) return null;
    if (typeof templateOrId === 'object' && templateOrId.supabaseId) {
      return templateOrId.supabaseId;
    }
    const templateId = typeof templateOrId === 'string' ? templateOrId : templateOrId.id;
    if (!templateId) return null;
    const match = templates.find(t => t.id === templateId);
    if (match?.supabaseId) return match.supabaseId;
    const supabaseMatch = (supabaseTemplates || []).find(t =>
      t.id === templateId || (t.config && t.config.id === templateId)
    );
    return supabaseMatch?.id || null;
  }, [templates, supabaseTemplates]);

  const sanitizeTemplateConfig = (template) => {
    if (!template || typeof template !== 'object') return template;
    const { supabaseId, ...rest } = template;
    return rest;
  };

  const updateTemplates = useCallback((updater) => {
    const currentTemplates = templates;
    const nextValue = typeof updater === 'function' ? updater(currentTemplates) : updater;
    const next = Array.isArray(nextValue) ? nextValue : [];

    // Only notify parent if this wasn't triggered by external templates changing
    if (!isExternalUpdateRef.current) {
      // Use setTimeout to avoid setState during render
      setTimeout(() => onTemplatesChange?.(next), 0);
    }
  }, [onTemplatesChange, templates]);

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [editingTemplateId, setEditingTemplateId] = useState(null); // Track which template is being edited

  // Documents hook - must be called after selectedProjectId is declared
  const {
    documents: supabaseDocuments,
    loading: documentsLoading,
    createDocument: createSupabaseDocument,
    updateDocument: updateSupabaseDocument,
    deleteDocument: deleteSupabaseDocument,
    refetch: refetchDocuments
  } = useDocuments(selectedProjectId);

  // Fetch all documents for file count display in project list
  const {
    documents: allDocuments,
    refetch: refetchAllDocuments
  } = useDocuments(null);

  const navIconWrapperStyle = {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  };

  const navLabelStyle = {
    fontSize: '14px',
    fontWeight: '500',
    lineHeight: '20px'
  };

  // Bulk selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]); // array of item ids currently selected

  // View mode dropdown state
  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false);
  const viewDropdownRef = useRef(null);
  const selectionModeActionsRef = useRef(null);

  // Load view mode from localStorage (only UI preference, not data)
  useEffect(() => {
    try {
      const storedView = localStorage.getItem('dashboardViewMode');
      if (storedView === 'grid' || storedView === 'table') setViewMode(storedView);
    } catch { }
  }, []);

  // Sync Supabase templates with parent component
  useEffect(() => {
    if (!Array.isArray(templates)) return;
    if (!isExternalUpdateRef.current) {
      isExternalUpdateRef.current = true;
      setTimeout(() => {
        onTemplatesChange?.(templates);
        isExternalUpdateRef.current = false;
      }, 0);
    }
  }, [templates, onTemplatesChange]);

  // Sync Supabase documents with parent component state
  useEffect(() => {
    if (!Array.isArray(supabaseDocuments)) return;
    console.log('Syncing documents from Supabase:', supabaseDocuments.length, supabaseDocuments);
    // Convert Supabase documents to the format expected by the UI
    const formattedDocs = supabaseDocuments.map(doc => ({
      id: doc.id,
      name: doc.name,
      size: doc.file_size || 0,
      uploadedAt: doc.created_at || doc.updated_at,
      type: 'application/pdf',
      filePath: doc.file_path,
      projectId: doc.project_id
    }));
    setDocuments(prev => {
      // Keep temporary documents that haven't been replaced by real ones yet
      const tempDocs = prev.filter(d =>
        d.id.startsWith('temp-') &&
        !formattedDocs.some(fd => fd.name === d.name && fd.size === d.size)
      );
      return [...tempDocs, ...formattedDocs];
    });
  }, [supabaseDocuments]);

  useEffect(() => {
    try { localStorage.setItem('dashboardViewMode', viewMode); } catch { }
  }, [viewMode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(event.target)) {
        setIsViewDropdownOpen(false);
      }
    };

    if (isViewDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isViewDropdownOpen]);

  // Close Move/Copy dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (moveCopyDropdownRef.current && !moveCopyDropdownRef.current.contains(event.target)) {
        setIsMoveCopyDropdownOpen(false);
      }
    };

    if (isMoveCopyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoveCopyDropdownOpen]);

  // Color picker closing is handled by the overlay onClick, no need for separate handler

  // Reset selected category when selected space changes
  useEffect(() => {
    setSelectedTemplateCategoryId(null);
  }, [selectedModuleId]);

  // Handle file upload via Electron dialog (preserves file path)
  const handleUploadClick = async () => {
    // In Electron, use dialog to get file path
    if (window.electronAPI && window.electronAPI.openFile) {
      try {
        const result = await window.electronAPI.openFile({
          title: 'Open PDF Document',
          filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
        });

        if (result.canceled) {
          return;
        }

        if (!user) {
          alert('Please sign in to upload documents');
          onShowAuthModal();
          return;
        }

        // Create File object
        const fileData = new Uint8Array(result.data);
        const file = new File([fileData], result.fileName, { type: 'application/pdf' });
        // Store the file path separately (File.path is read-only)
        const filePath = result.filePath;

        // Determine Project ID
        let projectId = null;
        if (selectedProjectId && activeSection === 'projects') {
          projectId = selectedProjectId;
        }

        // OPTIMISTIC UPLOAD: Open immediately
        file.uploadStartTime = performance.now();
        onDocumentSelect(file, filePath);

        // OPTIMISTIC LIST UPDATE
        const tempDoc = {
          id: `temp-${Date.now()}`,
          name: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          type: 'application/pdf',
          filePath: filePath,
          projectId: projectId,
          file: file
        };
        setDocuments(prev => [tempDoc, ...prev]);

        // Background Upload Process
        (async () => {
          try {
            // Upload file to Supabase Storage
            const uploadPromise = uploadToStorage(file, projectId || 'general');
            const pageCountPromise = (async () => {
              const arrayBuffer = await file.arrayBuffer();
              const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
              return pdfDoc.numPages;
            })();

            const [filePath, pageCount] = await Promise.all([uploadPromise, pageCountPromise]);

            // Create document record in Supabase
            const newDoc = await createSupabaseDocument({
              name: file.name,
              file_path: filePath,
              file_size: file.size,
              page_count: pageCount,
              project_id: projectId || null
            });

            // Refresh global document list to update counts
            refetchAllDocuments();

            console.log('Background upload completed for:', file.name, 'New Doc:', newDoc);
          } catch (err) {
            console.error('Error uploading file in background:', err);
            alert('Failed to save document to cloud: ' + (err.message || 'Unknown error'));
          }
        })();

      } catch (error) {
        console.error('Error opening file:', error);
        alert('Failed to open file: ' + error.message);
      }
    } else {
      // Fallback to browser file input
      fileInputRef.current?.click();
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    console.log('handleFileUpload called, file:', file);
    if (file && file.type === 'application/pdf') {
      console.log('File is valid PDF, name:', file.name, 'size:', file.size);

      if (!user) {
        alert('Please sign in to upload documents');
        onShowAuthModal();
        event.target.value = '';
        return;
      }

      // Determine Project ID
      let projectId = null;
      if (selectedProjectId && activeSection === 'projects') {
        projectId = selectedProjectId;
      }

      // OPTIMISTIC UPLOAD: Open immediately
      file.uploadStartTime = performance.now();
      onDocumentSelect(file);

      // OPTIMISTIC LIST UPDATE
      const tempDoc = {
        id: `temp-${Date.now()}`,
        name: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        type: 'application/pdf',
        filePath: null,
        projectId: projectId,
        file: file // Store local file for immediate access
      };
      setDocuments(prev => [tempDoc, ...prev]);

      // Background Upload Process
      (async () => {
        try {
          // Upload file to Supabase Storage
          // (projectId is captured from outer scope)

          // Parallelize upload and page counting
          const uploadPromise = uploadToStorage(file, projectId || 'general');
          const pageCountPromise = (async () => {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            return pdfDoc.numPages;
          })();

          const [filePath, pageCount] = await Promise.all([uploadPromise, pageCountPromise]);

          // Create document record in Supabase
          // This automatically updates the local state via useDocuments hook
          const newDoc = await createSupabaseDocument({
            name: file.name,
            file_path: filePath,
            file_size: file.size,
            page_count: pageCount,
            project_id: projectId || null
          });

          // Refresh global document list to update counts
          refetchAllDocuments();

          console.log('Background upload completed for:', file.name, 'New Doc:', newDoc);
        } catch (err) {
          console.error('Error uploading file in background:', err);
          alert('Failed to save document to cloud: ' + (err.message || 'Unknown error'));
        }
      })();

    } else {
      console.log('File is not a valid PDF or no file selected');
    }
    // Reset input
    event.target.value = '';
  };

  // Create Project flow
  const handleCreateProjectClick = () => {
    setProjectName('');
    setProjectFiles([]);
    setIsDragOver(false);
    setIsProjectModalOpen(true);
  };

  const handleProjectFilesSelected = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const onlyPDFs = files.filter(f => f.type === 'application/pdf');
    setProjectFiles(prev => [...prev, ...onlyPDFs]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    const onlyPDFs = files.filter(f => f.type === 'application/pdf');
    setProjectFiles(prev => [...prev, ...onlyPDFs]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const persistProject = async (name, files) => {
    if (!user) {
      const error = new Error('User not authenticated');
      error.code = 'NOT_AUTHENTICATED';
      throw error;
    }

    const trimmedName = name.trim();

    // Refetch projects to ensure we have the latest data
    const latestProjects = await refetchProjects() || supabaseProjects || [];
    console.log('Checking for name conflict. Current projects:', latestProjects.map(p => ({ id: p.id, name: p.name })));

    if (hasNameConflict(latestProjects, trimmedName, { getName: (project) => project?.name })) {
      const duplicateError = new Error('A project with this name already exists. Please choose a different name.');
      duplicateError.code = 'DUPLICATE_PROJECT_NAME';
      throw duplicateError;
    }

    let newProject = null;
    try {
      // Create project in Supabase first
      newProject = await createSupabaseProject({
        name: trimmedName
      });
      console.log('Project created successfully:', newProject);
    } catch (err) {
      console.error('Error creating project in database:', err);
      const error = new Error(`Failed to create project: ${err.message || 'Unknown error'}`);
      error.code = 'PROJECT_CREATE_FAILED';
      error.originalError = err;
      throw error;
    }

    // Upload files to Supabase Storage and create document records
    const uploadErrors = [];
    let successCount = 0;

    for (const file of files) {
      try {
        console.log(`Uploading file: ${file.name} (${file.size} bytes)`);

        // Upload file to storage
        const filePath = await uploadToStorage(file, newProject.id);
        console.log(`File uploaded to storage: ${filePath}`);

        // Get page count from PDF
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageCount = pdfDoc.numPages;
        console.log(`PDF has ${pageCount} pages`);

        // Create document record (this links the document to the project via project_id)
        const doc = await createSupabaseDocument({
          name: file.name,
          file_path: filePath,
          file_size: file.size,
          page_count: pageCount,
          project_id: newProject.id
        });
        console.log('Document record created:', doc);
        successCount++;
      } catch (err) {
        console.error(`Error uploading file ${file.name}:`, err);
        uploadErrors.push({ fileName: file.name, error: err.message || err.toString() });
        // Continue with other files even if one fails
      }
    }

    // If no files were successfully uploaded, throw an error
    if (successCount === 0) {
      const errorMessages = uploadErrors.map(e => `${e.fileName}: ${e.error}`).join('; ');
      const error = new Error(`Failed to upload any files. Errors: ${errorMessages}`);
      error.code = 'NO_FILES_UPLOADED';
      error.uploadErrors = uploadErrors;

      // Try to clean up the project if no files were uploaded
      try {
        await deleteSupabaseProject(newProject.id);
        console.log('Cleaned up project after failed uploads');
      } catch (cleanupErr) {
        console.error('Error cleaning up project:', cleanupErr);
      }

      throw error;
    }

    // Refresh global document list to update counts
    refetchAllDocuments();

    // Warn if some files failed but others succeeded
    if (uploadErrors.length > 0) {
      console.warn('Some files failed to upload:', uploadErrors);
    }

    console.log(`Successfully uploaded ${successCount} file(s) to project`);

    try {
      // Refetch projects and documents
      await refetchProjects();
      await refetchDocuments();
      console.log('Projects and documents refetched');
    } catch (err) {
      console.error('Error refetching data:', err);
      // Don't throw here - the project was created successfully, just refresh failed
    }
  };

  const handleConfirmCreateProject = async () => {
    if (!projectName.trim()) {
      alert('Please enter a project name.');
      return;
    }
    const trimmedProjectName = projectName.trim();

    // Refetch projects to ensure we have the latest data before checking for conflicts
    let latestProjects = supabaseProjects || [];
    try {
      const refetched = await refetchProjects();
      latestProjects = refetched || latestProjects;
    } catch (err) {
      console.error('Error refetching projects:', err);
    }

    console.log('Checking for name conflict. Current projects:', latestProjects.map(p => ({ id: p.id, name: p.name })));

    if (hasNameConflict(latestProjects, trimmedProjectName, { getName: (project) => project?.name })) {
      alert('A project with this name already exists. Please choose a different name.');
      return;
    }
    if (projectFiles.length === 0) {
      alert('Please add at least one PDF.');
      return;
    }
    try {
      await persistProject(trimmedProjectName, projectFiles);
      setIsProjectModalOpen(false);
      setProjectName('');
      setProjectFiles([]);
    } catch (err) {
      console.error('Error creating project:', err);

      if (err?.code === 'DUPLICATE_PROJECT_NAME') {
        alert(err.message);
        return;
      }

      if (err?.code === 'NOT_AUTHENTICATED') {
        alert('Please sign in to create projects.');
        onShowAuthModal();
        return;
      }

      if (err?.code === 'NO_FILES_UPLOADED') {
        const errorDetails = err.uploadErrors?.map(e => `\n- ${e.fileName}: ${e.error}`).join('') || '';
        alert(`Failed to upload files:${errorDetails}\n\nPlease check your file sizes and try again.`);
        return;
      }

      if (err?.code === 'PROJECT_CREATE_FAILED' || err?.code === 'PROJECT_UPDATE_FAILED') {
        const errorMsg = err.originalError?.message || err.message || 'Unknown error';
        alert(`Failed to save project: ${errorMsg}\n\nPlease check your connection and try again.`);
        return;
      }

      // Generic error message with more details if available
      const errorMsg = err.message || err.toString() || 'Unknown error';
      alert(`There was an error creating the project: ${errorMsg}\n\nPlease try again or check the console for more details.`);
    }
  };

  const handleCancelCreateProject = () => {
    setIsProjectModalOpen(false);
  };

  // Helpers for selection/bulk actions
  const getCurrentContextKey = () => {
    if (activeSection === 'projects') {
      return selectedProjectId ? 'projectFiles' : 'projects';
    }
    if (activeSection === 'templates') {
      return selectedTemplateId ? 'templateFiles' : 'templates';
    }
    return 'documents';
  };

  const getCurrentItems = () => {
    const ctx = getCurrentContextKey();
    if (ctx === 'documents') return sortedDocuments;
    if (ctx === 'projects') return sortedProjects;
    if (ctx === 'projectFiles') {
      // Use supabaseDocuments when a project is selected
      if (selectedProjectId && supabaseDocuments) {
        return supabaseDocuments.map(doc => ({
          id: doc.id,
          name: doc.name,
          size: doc.file_size || 0,
          uploadedAt: doc.created_at || doc.updated_at,
          type: 'application/pdf',
          filePath: doc.file_path,
          projectId: doc.project_id
        }));
      }
      return [];
    }
    if (ctx === 'templates') return sortedTemplates;
    if (ctx === 'templateFiles') return (templates.find(t => t.id === selectedTemplateId)?.pdfs || []);
    return [];
  };

  const isItemSelected = (id) => selectedIds.includes(id);

  const toggleSelectItem = (id, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleEnterSelectionMode = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsSelectionMode(true);
    setSelectedIds([]);
  };

  const selectAllCurrent = () => {
    const items = getCurrentItems();
    setSelectedIds(items.map(i => i.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const exitSelectionMode = useCallback(() => { setIsSelectionMode(false); setSelectedIds([]); }, []);

  // Document-level click handler to exit selection mode when clicking outside items
  useEffect(() => {
    if (!isSelectionMode || (activeSection !== 'documents' && activeSection !== 'projects' && activeSection !== 'templates')) {
      return;
    }

    const handleDocumentClick = (e) => {
      const target = e.target;
      
      // Check if clicking within the selection mode actions container
      const isInSelectionModeActions = selectionModeActionsRef.current && selectionModeActionsRef.current.contains(target);
      
      // Check if clicking on an item container (grid item div or table row)
      const isItemContainer = target.closest('tr[style*="cursor: pointer"]') || 
                             (target.closest('div[style*="cursor: pointer"]') && 
                              target.closest('div[style*="cursor: pointer"]')?.style?.cursor === 'pointer' &&
                              !target.closest('div[style*="cursor: pointer"]')?.closest('button'));
      
      // Only prevent exit if clicking within selection mode actions OR on an item container
      const shouldPreventExit = isInSelectionModeActions || isItemContainer;

      if (!shouldPreventExit) {
        exitSelectionMode();
      }
    };

    // Use capture phase to catch clicks before they're handled by other elements
    document.addEventListener('click', handleDocumentClick, true);
    
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [isSelectionMode, activeSection, exitSelectionMode]);

  // Handle clicking outside items to exit selection mode (container-level handler as backup)
  const handleContainerClick = (e) => {
    // Only exit if we're in selection mode and in one of the relevant sections
    if (isSelectionMode && (activeSection === 'documents' || activeSection === 'projects' || activeSection === 'templates')) {
      const target = e.target;
      
      // Check if clicking within the selection mode actions container (Select All, Move/Copy, Share, Delete, Cancel buttons)
      const isInSelectionModeActions = selectionModeActionsRef.current && selectionModeActionsRef.current.contains(target);
      
      // Check if clicking on an item container (grid item div or table row)
      // Items have onClick handlers that stop propagation, but we check here as a safety measure
      const isItemContainer = target.closest('tr[style*="cursor: pointer"]') || 
                             (target.closest('div[style*="cursor: pointer"]') && 
                              target.closest('div[style*="cursor: pointer"]')?.style?.cursor === 'pointer' &&
                              !target.closest('div[style*="cursor: pointer"]')?.closest('button'));
      
      // Only prevent exit if clicking within selection mode actions OR on an item container
      // All other clicks (including other buttons like settings, upload, create project, etc.) should exit
      const shouldPreventExit = isInSelectionModeActions || isItemContainer;

      if (!shouldPreventExit) {
        exitSelectionMode();
      }
    }
  };

  const handleSectionNavClick = (section, { resetProject = false, resetTemplate = false } = {}) => {
    if (section !== activeSection && isSelectionMode) {
      exitSelectionMode();
    }

    if (resetProject) {
      setSelectedProjectId(null);
    }

    if (resetTemplate) {
      setSelectedTemplateId(null);
    }

    setActiveSection(section);
  };

  // Persist projects to Supabase
  const persistProjects = async (projectsToSave) => {
    if (!user) {
      console.warn('User not authenticated, cannot save projects');
      return;
    }

    // This function is called with an array of projects
    // We need to sync each project to Supabase
    try {
      const currentProjectIds = new Set(projects.map(p => p.id));
      const newProjectIds = new Set(projectsToSave.map(p => p.id));

      // Delete projects that were removed
      for (const project of projects) {
        if (!newProjectIds.has(project.id)) {
          try {
            await deleteSupabaseProject(project.id);
          } catch (err) {
            console.error('Error deleting project:', err);
          }
        }
      }

      // Update or create projects
      for (const project of projectsToSave) {
        if (currentProjectIds.has(project.id)) {
          // Update existing project
          try {
            await updateSupabaseProject(project.id, {
              name: project.name,
              config: {
                pdfs: project.pdfs || [],
                createdAt: project.createdAt
              }
            });
          } catch (err) {
            console.error('Error updating project:', err);
          }
        } else {
          // Create new project
          try {
            await createSupabaseProject({
              name: project.name,
              config: {
                pdfs: project.pdfs || [],
                createdAt: project.createdAt
              }
            });
          } catch (err) {
            console.error('Error creating project:', err);
          }
        }
      }

      // Refetch to sync state
      await refetchProjects();
    } catch (err) {
      console.error('Error persisting projects:', err);
    }
  };

  // Persist templates to Supabase
  const persistTemplates = async (templatesToSave) => {
    if (!user) {
      console.warn('User not authenticated, cannot save templates');
      return;
    }

    try {
      const currentTemplateIds = new Set(templates.map(t => t.id));
      const newTemplateIds = new Set(templatesToSave.map(t => t.id));

      // Delete templates that were removed
      for (const template of templates) {
        if (!newTemplateIds.has(template.id)) {
          const supabaseId = resolveSupabaseTemplateId(template);
          if (!supabaseId) continue;
          try {
            await deleteSupabaseTemplate(supabaseId);
          } catch (err) {
            console.error('Error deleting template:', err);
          }
        }
      }

      // Update or create templates
      for (const template of templatesToSave) {
        const configPayload = sanitizeTemplateConfig(template);
        if (currentTemplateIds.has(template.id)) {
          // Update existing template
          const supabaseId = resolveSupabaseTemplateId(template);
          if (!supabaseId) {
            console.warn('Unable to resolve Supabase template id for update, creating new template instead.');
            try {
              await createSupabaseTemplate({
                name: template.name,
                config: configPayload
              });
            } catch (err) {
              console.error('Error creating template:', err);
            }
            continue;
          }
          try {
            await updateSupabaseTemplate(supabaseId, {
              name: template.name,
              config: configPayload // Store entire template structure in config JSONB
            });
          } catch (err) {
            console.error('Error updating template:', err);
          }
        } else {
          // Create new template
          try {
            await createSupabaseTemplate({
              name: template.name,
              config: configPayload // Store entire template structure in config JSONB
            });
          } catch (err) {
            console.error('Error creating template:', err);
          }
        }
      }

      // Refetch to sync state
      await refetchTemplates();
    } catch (err) {
      console.error('Error persisting templates:', err);
    }
  };

  const handleBulkDelete = async () => {
    const ctx = getCurrentContextKey();
    if (selectedIds.length === 0) return;

    if (!user) {
      alert('Please sign in to delete items');
      return;
    }

    try {
      if (ctx === 'documents') {
        // Delete documents from Supabase
        for (const docId of selectedIds) {
          try {
            // Get document to get file path
            const doc = supabaseDocuments.find(d => d.id === docId);
            if (doc?.file_path) {
              await deleteFromStorage(doc.file_path);
            }
            await deleteSupabaseDocument(docId);
          } catch (err) {
            console.error('Error deleting document:', err);
          }
        }
        await refetchDocuments();
      } else if (ctx === 'projects') {
        // Delete projects from Supabase
        for (const projectId of selectedIds) {
          try {
            await deleteSupabaseProject(projectId);
          } catch (err) {
            console.error('Error deleting project:', err);
          }
        }
        await refetchProjects();
      } else if (ctx === 'projectFiles') {
        const proj = projects.find(p => p.id === selectedProjectId);
        if (proj) {
          // Delete document records and files from Supabase
          for (const docId of selectedIds) {
            try {
              const doc = supabaseDocuments.find(d => d.id === docId);
              if (doc?.file_path) {
                await deleteFromStorage(doc.file_path);
              }
              await deleteSupabaseDocument(docId);
            } catch (err) {
              console.error('Error deleting document:', err);
            }
          }

          // Documents are automatically linked to projects via project_id foreign key
          // No need to update project config - documents will be refetched
          await refetchProjects();
          await refetchDocuments();
        }
      } else if (ctx === 'templates') {
        // Delete templates from Supabase
        for (const templateId of selectedIds) {
          const supabaseId = resolveSupabaseTemplateId(templateId);
          if (!supabaseId) continue;
          try {
            await deleteSupabaseTemplate(supabaseId);
          } catch (err) {
            console.error('Error deleting template:', err);
          }
        }
        await refetchTemplates();
      } else if (ctx === 'templateFiles') {
        const tmpl = templates.find(t => t.id === selectedTemplateId);
        if (tmpl) {
          // Update template config to remove PDFs
          const updatedPdfs = (Array.isArray(tmpl.pdfs) ? tmpl.pdfs : []).filter(f => !selectedIds.includes(f.id));
          const supabaseId = resolveSupabaseTemplateId(tmpl);
          if (supabaseId) {
            const updatedConfig = sanitizeTemplateConfig({ ...tmpl, pdfs: updatedPdfs });
            await updateSupabaseTemplate(supabaseId, {
              config: updatedConfig
            });
            await refetchTemplates();
          } else {
            console.warn('Unable to resolve Supabase template id for template files update.');
          }
        }
      }
      exitSelectionMode();
    } catch (err) {
      console.error('Error in bulk delete:', err);
      alert('Failed to delete items: ' + (err.message || 'Unknown error'));
    }
  };

  const handleBulkCopy = () => {
    const ctx = getCurrentContextKey();
    if (selectedIds.length === 0) return;
    if (ctx === 'documents') {
      const toCopy = sortedDocuments.filter(d => selectedIds.includes(d.id));
      const copies = toCopy.map(d => ({ ...d, id: `${Date.now()}-${Math.random()}`, name: `${d.name} (Copy)` }));
      setDocuments(prev => [...copies, ...prev]);
    } else if (ctx === 'projects') {
      const toCopy = projects.filter(p => selectedIds.includes(p.id));
      const usedProjectNames = new Set(
        projects
          .map(project => normalizeName(project?.name))
          .filter(Boolean)
      );
      const copies = toCopy.map(p => {
        const newProjectId = `${Date.now()}-${Math.random()}`;
        const newPdfs = (p.pdfs || []).map(f => ({ ...f, id: `${Date.now()}-${Math.random()}` }));
        const baseName = p?.name?.trim() || 'Untitled Project';
        const normalizedBaseName = normalizeName(baseName);
        let copyName = baseName;
        if (normalizedBaseName && usedProjectNames.has(normalizedBaseName)) {
          copyName = createCopyName(baseName, usedProjectNames);
        } else if (normalizedBaseName) {
          usedProjectNames.add(normalizedBaseName);
        }
        return { ...p, id: newProjectId, name: copyName, createdAt: new Date().toISOString(), pdfs: newPdfs };
      });
      const next = [...copies, ...projects];
      persistProjects(next);
    } else if (ctx === 'projectFiles') {
      const proj = projects.find(p => p.id === selectedProjectId);
      if (proj) {
        const toCopy = (proj.pdfs || []).filter(f => selectedIds.includes(f.id));
        const copies = toCopy.map(f => ({ ...f, id: `${Date.now()}-${Math.random()}`, name: `${f.name} (Copy)` }));
        const updated = { ...proj, pdfs: [...copies, ...(proj.pdfs || [])] };
        const next = projects.map(p => p.id === proj.id ? updated : p);
        persistProjects(next);
        // Also add to global documents list
        setDocuments(prev => [...copies, ...prev]);
      }
    } else if (ctx === 'templates') {
      const toCopy = templates.filter(t => selectedIds.includes(t.id));
      const usedTemplateNames = new Set(
        templates
          .map(template => normalizeName(template?.name))
          .filter(Boolean)
      );
      const copies = toCopy.map(t => {
        const newTemplateId = `${Date.now()}-${Math.random()}`;
        const newPdfs = (t.pdfs || []).map(f => ({ ...f, id: `${Date.now()}-${Math.random()}` }));
        const baseName = (t?.name?.trim()) || 'Template';
        const normalizedBaseName = normalizeName(baseName);
        let copyName = baseName;
        if (normalizedBaseName && usedTemplateNames.has(normalizedBaseName)) {
          copyName = createCopyName(baseName, usedTemplateNames);
        } else if (normalizedBaseName) {
          usedTemplateNames.add(normalizedBaseName);
        }
        return { ...t, id: newTemplateId, name: copyName, createdAt: new Date().toISOString(), pdfs: newPdfs };
      });
      const next = [...copies, ...templates];
      persistTemplates(next);
    } else if (ctx === 'templateFiles') {
      const tmpl = templates.find(t => t.id === selectedTemplateId);
      if (tmpl) {
        const toCopy = (tmpl.pdfs || []).filter(f => selectedIds.includes(f.id));
        const copies = toCopy.map(f => ({ ...f, id: `${Date.now()}-${Math.random()}`, name: `${f.name} (Copy)` }));
        const updated = { ...tmpl, pdfs: [...copies, ...(tmpl.pdfs || [])] };
        const next = templates.map(t => t.id === tmpl.id ? updated : t);
        persistTemplates(next);
      }
    }
    exitSelectionMode();
  };

  const handleBulkShare = () => {
    const ctx = getCurrentContextKey();
    if (selectedIds.length === 0) return;
    if (ctx === 'documents') {
      setDocuments(prev => prev.map(d => selectedIds.includes(d.id) ? { ...d, shared: true } : d));
    } else if (ctx === 'projects') {
      const next = projects.map(p => selectedIds.includes(p.id) ? { ...p, shared: true } : p);
      persistProjects(next);
    } else if (ctx === 'projectFiles') {
      const proj = projects.find(p => p.id === selectedProjectId);
      if (proj) {
        const updated = { ...proj, pdfs: (proj.pdfs || []).map(f => selectedIds.includes(f.id) ? { ...f, shared: true } : f) };
        const next = projects.map(p => p.id === proj.id ? updated : p);
        persistProjects(next);
      }
    } else if (ctx === 'templates') {
      const next = templates.map(t => selectedIds.includes(t.id) ? { ...t, shared: true } : t);
      persistTemplates(next);
    } else if (ctx === 'templateFiles') {
      const tmpl = templates.find(t => t.id === selectedTemplateId);
      if (tmpl) {
        const updated = { ...tmpl, pdfs: (tmpl.pdfs || []).map(f => selectedIds.includes(f.id) ? { ...f, shared: true } : f) };
        const next = templates.map(t => t.id === tmpl.id ? updated : t);
        persistTemplates(next);
      }
    }
    alert(`Shared ${selectedIds.length} item(s)`);
    exitSelectionMode();
  };

  const handleBulkMove = () => {
    if (selectedIds.length === 0) return;
    setIsMoveModalOpen(true);
  };

  const handleMoveToProject = async (projectId, isNewProject = false, moveToDocuments = false) => {
    if (selectedIds.length === 0) return;

    const ctx = getCurrentContextKey();

    // Get selected documents based on context
    let docsToMove = [];
    if (ctx === 'documents') {
      docsToMove = sortedDocuments.filter(d => selectedIds.includes(d.id));
    } else if (ctx === 'projectFiles') {
      // Get files from the current project
      const currentProject = projects.find(p => p.id === selectedProjectId);
      if (currentProject) {
        docsToMove = (currentProject.pdfs || []).filter(f => selectedIds.includes(f.id));
      }
    }

    if (docsToMove.length === 0) return;

    // Handle moving to Documents tab
    if (moveToDocuments) {
      // Remove from source location
      if (ctx === 'documents') {
        setDocuments(prev => prev.filter(d => !selectedIds.includes(d.id)));
      } else if (ctx === 'projectFiles') {
        const proj = projects.find(p => p.id === selectedProjectId);
        if (proj) {
          const updated = { ...proj, pdfs: (proj.pdfs || []).filter(f => !selectedIds.includes(f.id)) };
          const next = projects.map(p => p.id === proj.id ? updated : p);
          persistProjects(next);
        }
        // Also update documents list
        setDocuments(prev => prev.filter(d => !selectedIds.includes(d.id)));
      }

      // Add to documents list (with new IDs to avoid conflicts)
      const docsWithNewIds = docsToMove.map(d => ({
        ...d,
        id: `${Date.now()}-${Math.random()}`
      }));
      setDocuments(prev => [...docsWithNewIds, ...prev]);

      setIsMoveModalOpen(false);
      setProjectName('');
      exitSelectionMode();
      return;
    }

    if (isNewProject) {
      // Create new project with selected documents
      // Add documents to new project (with new IDs to avoid conflicts when moving from projectFiles)
      const docsWithNewIds = docsToMove.map(d => ({
        ...d,
        id: `${Date.now()}-${Math.random()}`
      }));

      if (!user) {
        alert('Please sign in to create projects');
        return;
      }

      // Create new project in Supabase
      const createdProject = await createSupabaseProject({
        name: projectName.trim() || 'New Project',
        config: {
          pdfs: docsWithNewIds,
          createdAt: new Date().toISOString()
        }
      });

      // Update documents to associate with project
      for (const doc of docsToMove) {
        try {
          // Find the actual document in Supabase
          const actualDoc = supabaseDocuments.find(d =>
            (d.id === doc.id) || (d.name === doc.name && !d.project_id)
          );
          if (actualDoc) {
            await updateSupabaseDocument(actualDoc.id, {
              project_id: createdProject.id
            });
          }
        } catch (err) {
          console.error('Error updating document:', err);
        }
      }

      await refetchProjects();
      await refetchDocuments();

      // Remove from source location
      if (ctx === 'documents') {
        setDocuments(prev => prev.filter(d => !selectedIds.includes(d.id)));
      } else if (ctx === 'projectFiles') {
        const proj = projects.find(p => p.id === selectedProjectId);
        if (proj) {
          const updated = { ...proj, pdfs: (proj.pdfs || []).filter(f => !selectedIds.includes(f.id)) };
          const next = projects.map(p => p.id === proj.id ? updated : p);
          persistProjects(next);
        }
      }
    } else {
      // Move to existing project
      const targetProj = projects.find(p => p.id === projectId);
      if (targetProj) {
        // Add documents to target project (with new IDs to avoid conflicts)
        const docsWithNewIds = docsToMove.map(d => ({
          ...d,
          id: `${Date.now()}-${Math.random()}`
        }));

        // Update documents to move to target project
        if (!user) {
          alert('Please sign in to move documents');
          return;
        }

        for (const doc of docsToMove) {
          try {
            const actualDoc = supabaseDocuments.find(d =>
              (d.id === doc.id) || (d.name === doc.name)
            );
            if (actualDoc) {
              await updateSupabaseDocument(actualDoc.id, {
                project_id: projectId
              });
            }
          } catch (err) {
            console.error('Error updating document:', err);
          }
        }

        // Documents are automatically linked to projects via project_id foreign key
        // No need to update project config - documents will be refetched

        await refetchProjects();
        await refetchDocuments();
      }
    }

    setIsMoveModalOpen(false);
    setProjectName('');
    exitSelectionMode();
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 1) {
      const hours = Math.floor(diffTime / (1000 * 60 * 60));
      if (hours < 1) {
        const minutes = Math.floor(diffTime / (1000 * 60));
        return minutes < 1 ? 'Just now' : `${minutes} min ago`;
      }
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString();
  };

  const handleSort = (key) => {
    setSortConfig(prevConfig => ({
      key,
      direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const sortedDocuments = useMemo(() => {
    let filteredDocs = documents;

    if (searchQuery) {
      filteredDocs = documents.filter(doc =>
        doc.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return [...filteredDocs].sort((a, b) => {
      if (!sortConfig.key) return 0;

      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'uploadedAt') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      }


      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [documents, sortConfig, searchQuery]);

  const sortedProjects = useMemo(() => {
    let filtered = projects;
    if (searchQuery) {
      filtered = projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    // Default sort by created_at desc (Supabase uses snake_case)
    return [...filtered].sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0));
  }, [projects, searchQuery]);

  const sortedTemplates = useMemo(() => {
    let filtered = templates;
    if (searchQuery) {
      filtered = templates.filter(t => (t.name || '').toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return [...filtered].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [templates, searchQuery]);

  // Derived state for selection mode availability
  const hasItems = activeSection === 'documents'
    ? sortedDocuments.length > 0
    : activeSection === 'projects'
      ? projects.length > 0
      : templates.length > 0;

  const handleDocumentClick = async (doc) => {
    try {
      // 1. Check if we have a local file object (e.g. from optimistic upload)
      if (doc.file) {
        onDocumentSelect(doc.file);
        return;
      }

      // 2. Check if doc has filePath (formatted) or file_path (raw Supabase)
      const filePath = doc.filePath || doc.file_path;

      if (filePath) {
        // Download from Supabase storage
        // Note: onDocumentSelect will handle tab switching if file is already open
        // We need to reconstruct the File object to match what onDocumentSelect expects

        // First check if this document is already open in a tab to avoid re-downloading
        // We can't easily check tabs here without the file object, but onDocumentSelect does it.
        // So we'll proceed with download. Optimization: Check tabs by name/size if possible?
        // For now, let's download. The browser cache might help.

        const blob = await downloadFromStorage(filePath);
        const file = new File([blob], doc.name, { type: 'application/pdf' });

        // Add path/size properties to match what handleDocumentSelect expects for uniqueness check
        // (File object already has name and size, but we ensure they match doc)

        onDocumentSelect(file);
      } else if (doc.dataUrl) {
        // Legacy: Convert dataUrl back to blob, then to File
        const response = await fetch(doc.dataUrl);
        const blob = await response.blob();
        const file = new File([blob], doc.name, { type: 'application/pdf' });
        onDocumentSelect(file);
      } else {
        console.error('Document structure:', doc);
        throw new Error('Document has no filePath, file_path, or dataUrl');
      }
    } catch (error) {
      console.error('Error opening document:', error);
      alert('Error opening document: ' + error.message + '. Please try again.');
    }
  };

  const handleDeleteDocument = async (docId, event) => {
    event.stopPropagation();

    if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }

    try {
      // Optimistic update
      setDocuments(prev => prev.filter(doc => doc.id !== docId));

      // Find the document to get the file path
      const doc = documents.find(d => d.id === docId);

      if (doc?.file_path) {
        await deleteFromStorage(doc.file_path);
      } else if (doc?.filePath) {
        await deleteFromStorage(doc.filePath);
      }

      await deleteSupabaseDocument(docId);
      await refetchDocuments();
      console.log('Document deleted successfully');
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Failed to delete document: ' + error.message);
      // Revert optimistic update if needed, but refetching should handle it
      await refetchDocuments();
    }
  };

  // Template builders: helpers
  const handleAddModuleClick = () => {
    setAddingModule(true);
  };

  const handleSaveModule = () => {
    const trimmedModuleName = newModuleName.trim();
    if (!trimmedModuleName) {
      alert('Please enter a module name.');
      return;
    }
    if (hasNameConflict(modules, trimmedModuleName, { getName: (module) => module?.name })) {
      alert('A module with this name already exists. Please choose a different name.');
      return;
    }
    const newModule = {
      id: `module-${Date.now()}-${Math.random()}`,
      name: trimmedModuleName,
      categories: []
    };
    setModules(prev => [...prev, newModule]);
    setSelectedModuleId(newModule.id);
    setAddingModule(false);
    setNewModuleName('');
    setSelectedTemplateCategoryId(null); // Reset category selection when module changes
  };

  const handleCancelAddModule = () => {
    setAddingModule(false);
    setNewModuleName('');
  };

  const handleModuleSelect = (moduleId) => {
    if (!editingModules) {
      setSelectedModuleId(moduleId);
      setSelectedTemplateCategoryId(null); // Reset category when module changes
    }
  };

  const deleteModule = (moduleId) => {
    const moduleToDelete = modules.find(m => m.id === moduleId);

    setModules(prev => prev.filter(m => m.id !== moduleId));
    setSelectedModuleIds(prev => prev.filter(id => id !== moduleId));

    if (selectedModuleId === moduleId) {
      setSelectedModuleId(null);
      setSelectedTemplateCategoryId(null);
    }

    if (moduleToDelete) {
      const categoryIds = (moduleToDelete.categories || []).map(cat => cat.id);
      if (categoryIds.length > 0) {
        setSelectedCategoryIds(prev => prev.filter(id => !categoryIds.includes(id)));
        setEditingCategoryName(prev => {
          const next = { ...prev };
          categoryIds.forEach(id => {
            if (next[id] !== undefined) {
              delete next[id];
            }
          });
          return next;
        });
        if (categoryIds.includes(selectedTemplateCategoryId)) {
          setSelectedTemplateCategoryId(null);
        }
      }
    }

    if (moveCopyDestinationModuleId === moduleId) {
      setMoveCopyDestinationModuleId(null);
      setMoveCopyNewCategoryName('');
    }

    // Clean up editing state
    setEditingModuleName(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });

    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const removeModuleById = (collection) =>
        (collection || []).filter(m => m.id !== moduleId);
      return {
        ...prev,
        modules: removeModuleById(prev.modules),
        spaces: removeModuleById(prev.spaces)
      };
    });

    updateTemplates(prevTemplates => {
      const next = prevTemplates.map(t => ({
        ...t,
        modules: (t.modules || []).filter(m => m.id !== moduleId),
        spaces: (t.spaces || []).filter(s => s.id !== moduleId)
      }));
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  // Batch deletion function for multiple modules
  const deleteModules = (moduleIds) => {
    if (!moduleIds || moduleIds.length === 0) return;

    const modulesToDelete = modules.filter(m => moduleIds.includes(m.id));
    const allCategoryIds = modulesToDelete.flatMap(m => (m.categories || []).map(cat => cat.id));

    // Remove modules in a single state update
    setModules(prev => prev.filter(m => !moduleIds.includes(m.id)));
    setSelectedModuleIds(prev => prev.filter(id => !moduleIds.includes(id)));

    // Clear selected module if it's being deleted
    if (moduleIds.includes(selectedModuleId)) {
      setSelectedModuleId(null);
      setSelectedTemplateCategoryId(null);
    }

    // Clean up category selections and editing state
    if (allCategoryIds.length > 0) {
      setSelectedCategoryIds(prev => prev.filter(id => !allCategoryIds.includes(id)));
      setEditingCategoryName(prev => {
        const next = { ...prev };
        allCategoryIds.forEach(id => {
          if (next[id] !== undefined) {
            delete next[id];
          }
        });
        return next;
      });
      if (selectedTemplateCategoryId && allCategoryIds.includes(selectedTemplateCategoryId)) {
        setSelectedTemplateCategoryId(null);
      }
    }

    // Clean up move/copy destination
    if (moveCopyDestinationModuleId && moduleIds.includes(moveCopyDestinationModuleId)) {
      setMoveCopyDestinationModuleId(null);
      setMoveCopyNewCategoryName('');
    }

    // Clean up editing state for modules
    setEditingModuleName(prev => {
      const next = { ...prev };
      moduleIds.forEach(id => {
        if (next[id] !== undefined) {
          delete next[id];
        }
      });
      return next;
    });

    // Update selectedTemplate
    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const removeModulesById = (collection) =>
        (collection || []).filter(m => !moduleIds.includes(m.id));
      return {
        ...prev,
        modules: removeModulesById(prev.modules),
        spaces: removeModulesById(prev.spaces)
      };
    });

    // Update templates array and persist to localStorage
    updateTemplates(prevTemplates => {
      const next = prevTemplates.map(t => ({
        ...t,
        modules: (t.modules || []).filter(m => !moduleIds.includes(m.id)),
        spaces: (t.spaces || []).filter(s => !moduleIds.includes(s.id))
      }));
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  const handleModuleNameChange = (moduleId, newName) => {
    setEditingModuleName(prev => ({ ...prev, [moduleId]: newName }));
  };

  const saveModuleEdit = (moduleId) => {
    const newName = editingModuleName[moduleId]?.trim();
    if (!newName) {
      alert('Module name cannot be empty.');
      return;
    }
    if (hasNameConflict(modules, newName, { getName: (module) => module?.name, ignoreId: moduleId })) {
      alert('A module with this name already exists. Please choose a different name.');
      return;
    }
    setModules(prev => prev.map(m => m.id === moduleId ? { ...m, name: newName } : m));
    setEditingModuleName(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
  };

  const cancelModuleEdit = (moduleId) => {
    setEditingModuleName(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
  };

  const handleEditModules = () => {
    setEditingModules(true);
    setSelectedModuleIds([]);
    // Initialize editing state with current module names
    const initialNames = {};
    modules.forEach(module => {
      initialNames[module.id] = module.name;
    });
    setEditingModuleName(initialNames);
  };

  const moduleSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  const [activeModuleId, setActiveModuleId] = useState(null);

  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) || null,
    [activeModuleId, modules]
  );

  const handleModuleDragStart = useCallback(({ active }) => {
    setActiveModuleId(active.id);
  }, []);

  const handleModuleDragEnd = useCallback(({ active, over }) => {
    setActiveModuleId(null);
    if (!over || active.id === over.id) {
      return;
    }

    setModules((prevModules) => {
      const oldIndex = prevModules.findIndex((mod) => mod.id === active.id);
      const newIndex = prevModules.findIndex((mod) => mod.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return prevModules;
      }

      return arrayMove(prevModules, oldIndex, newIndex);
    });
  }, []);

  const handleModuleDragCancel = useCallback(() => {
    setActiveModuleId(null);
  }, []);

  const handleModuleInputKeyDown = useCallback((moduleId, event) => {
    if (event.key === 'Enter') {
      saveModuleEdit(moduleId);
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelModuleEdit(moduleId);
      event.currentTarget.blur();
    }
  }, [saveModuleEdit, cancelModuleEdit]);

  const handleSaveEditModules = () => {
    if (!editingModules) {
      return;
    }

    const proposedNamesById = {};
    const seenNames = new Map();

    for (const module of modules) {
      if (!module) continue;
      const rawValue = Object.prototype.hasOwnProperty.call(editingModuleName, module.id)
        ? editingModuleName[module.id]
        : module.name;
      const trimmedName = (rawValue || '').trim();

      if (!trimmedName) {
        alert('Module name cannot be empty.');
        return;
      }

      const normalized = normalizeName(trimmedName);
      if (normalized) {
        const existingId = seenNames.get(normalized);
        if (existingId && existingId !== module.id) {
          const conflictingModule = modules.find((m) => m.id === existingId);
          const conflictingName = (Object.prototype.hasOwnProperty.call(editingModuleName, existingId)
            ? editingModuleName[existingId]
            : conflictingModule?.name) || trimmedName;
          alert(`Module names must be unique. "${trimmedName}" conflicts with "${conflictingName}".`);
          return;
        }
        seenNames.set(normalized, module.id);
      }

      proposedNamesById[module.id] = trimmedName;
    }

    setModules((prev) =>
      prev.map((module) => {
        const nextName = proposedNamesById[module.id];
        if (typeof nextName === 'undefined' || nextName === module.name) {
          return module;
        }
        return { ...module, name: nextName };
      })
    );

    setEditingModules(false);
    setEditingModuleName({});
    setSelectedModuleIds([]);
  };

  const toggleModuleSelection = (moduleId) => {
    setSelectedModuleIds(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const handleMoveCopyModules = () => {
    if (selectedModuleIds.length === 0) {
      alert('Please select at least one module to move/copy.');
      return;
    }
    setMoveCopyType('module');
    setMoveCopyMode('copy');
    setIsMoveCopyModalOpen(true);
  };

  const handleDuplicateModules = () => {
    if (selectedModuleIds.length === 0) {
      alert('Please select at least one module to duplicate.');
      return;
    }

    const selectedSet = new Set(selectedModuleIds);
    const duplicateIds = [];
    const newEditingEntries = {};

    setModules(prevModules => {
      const usedNames = new Set(
        prevModules
          .map(m => (m.name || '').trim().toLowerCase())
          .filter(Boolean)
      );

      const nextModules = [];

      prevModules.forEach(module => {
        nextModules.push(module);

        if (selectedSet.has(module.id)) {
          const duplicatedCategories = (module.categories || []).map(category => {
            const duplicatedChecklist = (category.checklist || []).map(item => ({
              ...item,
              id: generateUniqueId('item')
            }));

            return {
              ...category,
              id: generateUniqueId('cat'),
              checklist: duplicatedChecklist
            };
          });

          const duplicateName = createCopyName(module.name || 'Untitled Module', usedNames);
          const duplicateModule = {
            ...module,
            id: generateUniqueId('module'),
            name: duplicateName,
            categories: duplicatedCategories
          };

          nextModules.push(duplicateModule);
          duplicateIds.push(duplicateModule.id);
          newEditingEntries[duplicateModule.id] = duplicateName;
        }
      });

      return nextModules;
    });

    if (duplicateIds.length > 0) {
      setSelectedModuleIds(duplicateIds);
      setEditingModuleName(prev => ({ ...prev, ...newEditingEntries }));
    }
  };

  const handleAddCategoryClick = () => {
    if (!selectedModuleId) return;
    setAddingCategory(true);
  };

  const handleSaveCategory = () => {
    const trimmedCategoryName = newCategoryName.trim();
    if (!trimmedCategoryName) {
      alert('Please enter a category name.');
      return;
    }
    if (!selectedModuleId) return;
    const selectedModule = modules.find(m => m.id === selectedModuleId);
    if (!selectedModule) return;
    if (hasNameConflict(selectedModule.categories, trimmedCategoryName, { getName: (category) => category?.name })) {
      alert('A category with this name already exists in this module. Please choose a different name.');
      return;
    }

    setModules(prev => prev.map(m => {
      if (m.id !== selectedModuleId) return m;
      const newCat = {
        id: `cat-${Date.now()}-${Math.random()}`,
        name: trimmedCategoryName,
        checklist: []
      };
      return { ...m, categories: [...m.categories, newCat] };
    }));

    setAddingCategory(false);
    setNewCategoryName('');
  };

  const handleCancelAddCategory = () => {
    setAddingCategory(false);
    setNewCategoryName('');
  };

  const handleCategorySelect = (categoryId) => {
    if (!editingCategories) {
      setSelectedTemplateCategoryId(categoryId);
    }
  };

  const handleCategoryNameChange = (categoryId, newName) => {
    setEditingCategoryName(prev => ({ ...prev, [categoryId]: newName }));
  };

  const saveCategoryEdit = (moduleId, categoryId) => {
    const newName = editingCategoryName[categoryId]?.trim();
    if (!newName) {
      alert('Category name cannot be empty.');
      return;
    }
    const parentModule = modules.find(m => m.id === moduleId);
    if (!parentModule) return;
    if (hasNameConflict(parentModule.categories, newName, { getName: (category) => category?.name, ignoreId: categoryId })) {
      alert('A category with this name already exists in this module. Please choose a different name.');
      return;
    }
    setModules(prev => prev.map(m => {
      if (m.id !== moduleId) return m;
      return {
        ...m,
        categories: m.categories.map(c => c.id === categoryId ? { ...c, name: newName } : c)
      };
    }));
    setEditingCategoryName(prev => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
  };

  const cancelCategoryEdit = (categoryId) => {
    setEditingCategoryName(prev => {
      const next = { ...prev };
      delete next[categoryId];
      return next;
    });
  };

  const handleEditCategories = () => {
    if (!selectedModuleId) return;
    setEditingCategories(true);
    setSelectedCategoryIds([]);
    // Initialize editing state with current category names for selected module
    const selectedModule = modules.find(m => m.id === selectedModuleId);
    if (selectedModule) {
      const initialNames = {};
      (selectedModule.categories || []).forEach(cat => {
        initialNames[cat.id] = cat.name;
      });
      setEditingCategoryName(initialNames);
    }
  };

  const selectedModuleForCategories = useMemo(
    () => modules.find((m) => m.id === selectedModuleId) || null,
    [modules, selectedModuleId]
  );

  const categorySensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  const [activeCategoryId, setActiveCategoryId] = useState(null);

  const activeCategory = useMemo(() => {
    const categories = selectedModuleForCategories?.categories || [];
    return categories.find((cat) => cat.id === activeCategoryId) || null;
  }, [activeCategoryId, selectedModuleForCategories]);

  const handleCategoryDragStart = useCallback(({ active }) => {
    setActiveCategoryId(active.id);
  }, []);

  const handleCategoryDragEnd = useCallback(({ active, over }) => {
    setActiveCategoryId(null);

    if (!over || active.id === over.id || !selectedModuleId) {
      return;
    }

    setModules((prevModules) =>
      prevModules.map((module) => {
        if (module.id !== selectedModuleId) {
          return module;
        }

        const categories = module.categories || [];
        const oldIndex = categories.findIndex((cat) => cat.id === active.id);
        const newIndex = categories.findIndex((cat) => cat.id === over.id);

        if (oldIndex === -1 || newIndex === -1) {
          return module;
        }

        return {
          ...module,
          categories: arrayMove(categories, oldIndex, newIndex)
        };
      })
    );
  }, [selectedModuleId]);

  const handleCategoryDragCancel = useCallback(() => {
    setActiveCategoryId(null);
  }, []);

  const handleCategoryInputKeyDown = useCallback((categoryId, event) => {
    if (event.key === 'Enter') {
      if (selectedModuleId) {
        saveCategoryEdit(selectedModuleId, categoryId);
      }
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      cancelCategoryEdit(categoryId);
      event.currentTarget.blur();
    }
  }, [selectedModuleId, saveCategoryEdit, cancelCategoryEdit]);

  const handleSaveEditCategories = () => {
    if (!editingCategories) {
      return;
    }

    if (!selectedModuleId) {
      setEditingCategories(false);
      setEditingCategoryName({});
      setSelectedCategoryIds([]);
      return;
    }

    const selectedModule = modules.find((module) => module.id === selectedModuleId);
    if (!selectedModule) {
      setEditingCategories(false);
      setEditingCategoryName({});
      setSelectedCategoryIds([]);
      return;
    }

    const proposedNamesById = {};
    const seenNames = new Map();

    for (const category of selectedModule.categories || []) {
      if (!category) continue;
      const rawValue = Object.prototype.hasOwnProperty.call(editingCategoryName, category.id)
        ? editingCategoryName[category.id]
        : category.name;
      const trimmedName = (rawValue || '').trim();

      if (!trimmedName) {
        alert('Category name cannot be empty.');
        return;
      }

      const normalized = normalizeName(trimmedName);
      if (normalized) {
        const existingId = seenNames.get(normalized);
        if (existingId && existingId !== category.id) {
          const conflictingCategory = (selectedModule.categories || []).find((cat) => cat.id === existingId);
          const conflictingName = (Object.prototype.hasOwnProperty.call(editingCategoryName, existingId)
            ? editingCategoryName[existingId]
            : conflictingCategory?.name) || trimmedName;
          alert(`Category names within a module must be unique. "${trimmedName}" conflicts with "${conflictingName}".`);
          return;
        }
        seenNames.set(normalized, category.id);
      }

      proposedNamesById[category.id] = trimmedName;
    }

    setModules((prevModules) =>
      prevModules.map((module) => {
        if (module.id !== selectedModuleId) {
          return module;
        }

        const updatedCategories = (module.categories || []).map((category) => {
          const nextName = proposedNamesById[category.id];
          if (typeof nextName === 'undefined' || nextName === category.name) {
            return category;
          }
          return { ...category, name: nextName };
        });

        return { ...module, categories: updatedCategories };
      })
    );

    setEditingCategories(false);
    setEditingCategoryName({});
    setSelectedCategoryIds([]);
  };

  const toggleCategorySelection = (categoryId) => {
    setSelectedCategoryIds(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleMoveCopyCategories = () => {
    if (selectedCategoryIds.length === 0) {
      alert('Please select at least one category to move/copy.');
      return;
    }
    setMoveCopyType('category');
    setMoveCopyMode('copy');
    setIsMoveCopyModalOpen(true);
  };

  const handleDuplicateCategories = () => {
    if (!selectedModuleId) {
      alert('Please select a module before duplicating categories.');
      return;
    }
    if (selectedCategoryIds.length === 0) {
      alert('Please select at least one category to duplicate.');
      return;
    }

    const selectedSet = new Set(selectedCategoryIds);
    const duplicateIds = [];
    const newEditingEntries = {};

    setModules(prevModules =>
      prevModules.map(module => {
        if (module.id !== selectedModuleId) {
          return module;
        }

        const usedNames = new Set(
          (module.categories || [])
            .map(cat => (cat.name || '').trim().toLowerCase())
            .filter(Boolean)
        );

        const updatedCategories = [];

        (module.categories || []).forEach(category => {
          updatedCategories.push(category);

          if (selectedSet.has(category.id)) {
            const duplicatedChecklist = (category.checklist || []).map(item => ({
              ...item,
              id: generateUniqueId('item')
            }));

            const duplicateName = createCopyName(category.name || 'Untitled Category', usedNames);
            const duplicatedCategory = {
              ...category,
              id: generateUniqueId('cat'),
              name: duplicateName,
              checklist: duplicatedChecklist
            };

            updatedCategories.push(duplicatedCategory);
            duplicateIds.push(duplicatedCategory.id);
            newEditingEntries[duplicatedCategory.id] = duplicateName;
          }
        });

        return {
          ...module,
          categories: updatedCategories
        };
      })
    );

    if (duplicateIds.length > 0) {
      setSelectedCategoryIds(duplicateIds);
      setEditingCategoryName(prev => ({ ...prev, ...newEditingEntries }));
    }
  };

  // Move/Copy handlers
  const [moveCopyDestinationTemplateId, setMoveCopyDestinationTemplateId] = useState(null);
  const [moveCopyDestinationModuleId, setMoveCopyDestinationModuleId] = useState(null);
  const [moveCopyDestinationCategoryId, setMoveCopyDestinationCategoryId] = useState(null);
  const [moveCopyNewTemplateName, setMoveCopyNewTemplateName] = useState('');
  const [moveCopyNewModuleName, setMoveCopyNewModuleName] = useState('');
  const [moveCopyNewCategoryName, setMoveCopyNewCategoryName] = useState('');

  const selectedModuleForMoveCopy = useMemo(() => {
    return modules.find(m => m.id === selectedModuleId) || null;
  }, [modules, selectedModuleId]);

  const selectedCategoriesForMoveCopy = useMemo(() => {
    if (!selectedModuleForMoveCopy) return [];
    return (selectedModuleForMoveCopy.categories || []).filter(c => selectedCategoryIds.includes(c.id));
  }, [selectedModuleForMoveCopy, selectedCategoryIds]);

  const destinationModuleForMoveCopy = useMemo(() => {
    return modules.find(m => m.id === moveCopyDestinationModuleId) || null;
  }, [modules, moveCopyDestinationModuleId]);

  const hasCategoryNameConflict = useMemo(() => {
    if (!destinationModuleForMoveCopy) return false;
    const existingNames = new Set(
      (destinationModuleForMoveCopy.categories || []).map(cat => (cat.name || '').trim().toLowerCase())
    );
    return selectedCategoriesForMoveCopy.some(cat =>
      existingNames.has((cat.name || '').trim().toLowerCase())
    );
  }, [destinationModuleForMoveCopy, selectedCategoriesForMoveCopy]);

  const shouldShowRenameInput =
    moveCopyType === 'category' &&
    moveCopyDestinationModuleId &&
    moveCopyDestinationModuleId !== 'new' &&
    (moveCopyMode === 'copy' || hasCategoryNameConflict);

  useEffect(() => {
    if (!shouldShowRenameInput && moveCopyNewCategoryName) {
      setMoveCopyNewCategoryName('');
    }
  }, [shouldShowRenameInput, moveCopyNewCategoryName]);

  const executeMoveCopy = () => {
    if (moveCopyType === 'module') {
      if (selectedModuleIds.length === 0) return;

      const modulesToMove = modules.filter(m => selectedModuleIds.includes(m.id));

      if (moveCopyDestinationTemplateId === 'new') {
        // Create new template
        const trimmedTemplateName = moveCopyNewTemplateName.trim();
        if (!trimmedTemplateName) {
          alert('Please enter a template name.');
          return;
        }

        // Deep clone modules to move/copy
        const clonedModules = modulesToMove.map(module => ({
          id: moveCopyMode === 'move' ? module.id : `module-${Date.now()}-${Math.random()}`,
          name: module.name,
          categories: (module.categories || []).map(cat => ({
            id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
            name: cat.name,
            checklist: (cat.checklist || []).map(item => ({
              id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
              text: item.text
            }))
          }))
        }));

        const newTemplate = {
          id: `${Date.now()}-${Math.random()}`,
          name: trimmedTemplateName,
          visibility: 'personal',
          modules: clonedModules,
          spaces: clonedModules,
          createdAt: new Date().toISOString(),
          ballInCourtEntities: []
        };

        // Save new template
        const existingRaw = localStorage.getItem('templates');
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        if (hasNameConflict(existing, trimmedTemplateName, { getName: (template) => template?.name })) {
          alert('A template with this name already exists. Please choose a different name.');
          return;
        }
        existing.unshift(newTemplate);
        localStorage.setItem('templates', JSON.stringify(existing));
        updateTemplates(existing);

        if (moveCopyMode === 'move') {
          // Remove modules from current template
          setModules(prev => prev.filter(m => !selectedModuleIds.includes(m.id)));
          setSelectedModuleIds([]);
        }
      } else {
        // Move/copy to existing template
        const existingRaw = localStorage.getItem('templates');
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const targetTemplate = existing.find(t => t.id === moveCopyDestinationTemplateId);

        if (targetTemplate) {
          const usedModuleNames = new Set(
            (targetTemplate.modules || [])
              .map(existingModule => normalizeName(existingModule?.name))
              .filter(Boolean)
          );
          const clonedModules = modulesToMove.map(module => {
            const baseName = module?.name?.trim() || 'Untitled Module';
            let finalName = baseName;
            const normalizedModuleName = normalizeName(finalName);
            if (normalizedModuleName && usedModuleNames.has(normalizedModuleName)) {
              finalName = createCopyName(baseName, usedModuleNames);
            } else if (normalizedModuleName) {
              usedModuleNames.add(normalizedModuleName);
            }
            return {
              ...module,
              id: moveCopyMode === 'move' ? module.id : `module-${Date.now()}-${Math.random()}`,
              name: finalName,
              categories: (module.categories || []).map(cat => ({
                id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
                name: cat.name,
                checklist: (cat.checklist || []).map(item => ({
                  id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
                  text: item.text
                }))
              }))
            };
          });

          const mergedModules = [...(targetTemplate.modules || []), ...clonedModules];
          targetTemplate.modules = mergedModules;
          targetTemplate.spaces = mergedModules;
          localStorage.setItem('templates', JSON.stringify(existing));
          updateTemplates(existing);

          if (moveCopyMode === 'move') {
            setModules(prev => prev.filter(m => !selectedModuleIds.includes(m.id)));
            setSelectedModuleIds([]);
          }
        }
      }
    } else if (moveCopyType === 'category') {
      if (selectedCategoryIds.length === 0 || !selectedModuleId) return;

      const selectedModule = modules.find(m => m.id === selectedModuleId);
      if (!selectedModule) return;

      const categoriesToMove = (selectedModule.categories || []).filter(c => selectedCategoryIds.includes(c.id));

      if (moveCopyDestinationModuleId === 'new') {
        // Create new module in current template
        const trimmedModuleName = moveCopyNewModuleName.trim();
        if (!trimmedModuleName) {
          alert('Please enter a module name.');
          return;
        }

        if (hasNameConflict(modules, trimmedModuleName, { getName: (module) => module?.name })) {
          alert('A module with this name already exists. Please choose a different name.');
          return;
        }

        const clonedCategories = categoriesToMove.map(cat => ({
          id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
          name: cat.name,
          checklist: (cat.checklist || []).map(item => ({
            id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
            text: item.text
          }))
        }));

        const newModule = {
          id: `module-${Date.now()}-${Math.random()}`,
          name: trimmedModuleName,
          categories: clonedCategories
        };

        setModules(prev => {
          const updated = [...prev, newModule];
          if (moveCopyMode === 'move') {
            return updated.map(m => {
              if (m.id === selectedModuleId) {
                return {
                  ...m,
                  categories: (m.categories || []).filter(c => !selectedCategoryIds.includes(c.id))
                };
              }
              return m;
            });
          }
          return updated;
        });

        if (moveCopyMode === 'move') {
          setSelectedCategoryIds([]);
        }
      } else {
        // Move/copy to existing module
        const destinationModule = modules.find(m => m.id === moveCopyDestinationModuleId);
        if (!destinationModule) {
          alert('Selected destination module could not be found. Please choose another destination.');
          return;
        }

        const isMoveWithinSameModule = moveCopyMode === 'move' && moveCopyDestinationModuleId === selectedModuleId;
        const trimmedRename = moveCopyNewCategoryName.trim();
        const renameMap = new Map();

        if (!isMoveWithinSameModule) {
          const existingCategoryNames = new Set(
            (destinationModule.categories || []).map(cat => (cat.name || '').trim().toLowerCase())
          );
          const conflictingCategories = categoriesToMove.filter(cat =>
            existingCategoryNames.has((cat.name || '').trim().toLowerCase())
          );

          if (conflictingCategories.length > 0) {
            if (categoriesToMove.length > 1 || conflictingCategories.length > 1) {
              alert('Multiple selected categories conflict with existing names. Please move or copy them one at a time and provide unique names.');
              return;
            }

            if (!trimmedRename) {
              alert('A category with the same name already exists in the destination. Please provide a new name before continuing.');
              return;
            }

            renameMap.set(conflictingCategories[0].id, trimmedRename);
          } else if (trimmedRename) {
            if (categoriesToMove.length > 1) {
              alert('Renaming during move/copy is only supported when a single category is selected.');
              return;
            }
            renameMap.set(categoriesToMove[0].id, trimmedRename);
          }
        }

        const clonedCategories = categoriesToMove.map(cat => ({
          id: moveCopyMode === 'move' ? cat.id : `cat-${Date.now()}-${Math.random()}`,
          name: renameMap.get(cat.id) || cat.name,
          checklist: (cat.checklist || []).map(item => ({
            id: moveCopyMode === 'move' ? item.id : `item-${Date.now()}-${Math.random()}`,
            text: item.text
          }))
        }));

        setModules(prev => prev.map(m => {
          if (m.id === moveCopyDestinationModuleId) {
            return {
              ...m,
              categories: [...(m.categories || []), ...clonedCategories]
            };
          }
          if (moveCopyMode === 'move' && m.id === selectedModuleId) {
            return {
              ...m,
              categories: (m.categories || []).filter(c => !selectedCategoryIds.includes(c.id))
            };
          }
          return m;
        }));

        if (moveCopyMode === 'move') {
          setSelectedCategoryIds([]);
        }
      }
    }

    // Close modal and reset
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');
  };

  const addCategory = (spaceId) => {
    // Legacy function - keeping for compatibility but redirecting to new flow
    handleAddCategoryClick();
  };

  const renameCategory = (spaceId, categoryId, name) => {
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, name } : c) } : s));
  };

  const deleteCategory = (spaceId, categoryId) => {
    const moduleIndex = modules.findIndex(m => m.id === spaceId);
    if (moduleIndex !== -1) {
      const moduleToUpdate = modules[moduleIndex];
      const updatedCategories = (moduleToUpdate.categories || []).filter(c => c.id !== categoryId);

      if (updatedCategories.length !== (moduleToUpdate.categories || []).length) {
        setModules(prev =>
          prev.map(m =>
            m.id === spaceId
              ? { ...m, categories: updatedCategories }
              : m
          )
        );
        setSelectedCategoryIds(prev => prev.filter(id => id !== categoryId));
        setEditingCategoryName(prev => {
          const next = { ...prev };
          if (next[categoryId] !== undefined) {
            delete next[categoryId];
          }
          return next;
        });
        if (moveCopyDestinationCategoryId === categoryId) {
          setMoveCopyDestinationCategoryId(null);
        }
        if (moveCopyNewCategoryName) {
          setMoveCopyNewCategoryName('');
        }
      }
    }

    if (selectedTemplateCategoryId === categoryId) {
      setSelectedTemplateCategoryId(null);
    }

    // Update selectedTemplate and templates in separate state updates
    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const pruneCategory = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => c.id !== categoryId)
            }
            : entry
        );
      return {
        ...prev,
        modules: pruneCategory(prev.modules || []),
        spaces: pruneCategory(prev.spaces || [])
      };
    });

    // Update templates array and persist to localStorage
    updateTemplates(prevTemplates => {
      const pruneCategory = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => c.id !== categoryId)
            }
            : entry
        );
      const next = prevTemplates.map(t => ({
        ...t,
        modules: pruneCategory(t.modules || []),
        spaces: pruneCategory(t.spaces || [])
      }));
      // Persist to localStorage
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  // Batch deletion function for multiple categories
  const deleteCategories = (spaceId, categoryIds) => {
    if (!categoryIds || categoryIds.length === 0) return;

    const moduleToUpdate = modules.find(m => m.id === spaceId);
    if (!moduleToUpdate) return;

    const updatedCategories = (moduleToUpdate.categories || []).filter(c => !categoryIds.includes(c.id));

    // Only update if categories were actually removed
    if (updatedCategories.length !== (moduleToUpdate.categories || []).length) {
      // Remove categories in a single state update
      setModules(prev =>
        prev.map(m =>
          m.id === spaceId
            ? { ...m, categories: updatedCategories }
            : m
        )
      );

      setSelectedCategoryIds(prev => prev.filter(id => !categoryIds.includes(id)));

      setEditingCategoryName(prev => {
        const next = { ...prev };
        categoryIds.forEach(id => {
          if (next[id] !== undefined) {
            delete next[id];
          }
        });
        return next;
      });

      if (moveCopyDestinationCategoryId && categoryIds.includes(moveCopyDestinationCategoryId)) {
        setMoveCopyDestinationCategoryId(null);
      }
      if (moveCopyNewCategoryName) {
        setMoveCopyNewCategoryName('');
      }
    }

    // Clear selected template category if it's being deleted
    if (selectedTemplateCategoryId && categoryIds.includes(selectedTemplateCategoryId)) {
      setSelectedTemplateCategoryId(null);
    }

    // Update selectedTemplate
    setSelectedTemplate(prev => {
      if (!prev) return prev;
      const pruneCategories = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => !categoryIds.includes(c.id))
            }
            : entry
        );
      return {
        ...prev,
        modules: pruneCategories(prev.modules || []),
        spaces: pruneCategories(prev.spaces || [])
      };
    });

    // Update templates array and persist to localStorage
    updateTemplates(prevTemplates => {
      const pruneCategories = (collection = []) =>
        collection.map(entry =>
          entry.id === spaceId
            ? {
              ...entry,
              categories: (entry.categories || []).filter(c => !categoryIds.includes(c.id))
            }
            : entry
        );
      const next = prevTemplates.map(t => ({
        ...t,
        modules: pruneCategories(t.modules || []),
        spaces: pruneCategories(t.spaces || [])
      }));
      // Persist to localStorage
      try {
        localStorage.setItem('templates', JSON.stringify(next));
      } catch (e) {
        console.error('Error persisting templates:', e);
      }
      return next;
    });
  };

  const copyCategoriesBetweenSpaces = (fromSpaceId, toSpaceId) => {
    if (fromSpaceId === toSpaceId) return;
    const from = modules.find(s => s.id === fromSpaceId);
    if (!from) return;
    const clonedCats = (from.categories || []).map(c => ({ id: `cat-${Date.now()}-${Math.random()}`, name: c.name, checklist: (c.checklist || []).map(it => ({ id: `item-${Date.now()}-${Math.random()}`, text: it.text })) }));
    setModules(prev => prev.map(s => s.id === toSpaceId ? { ...s, categories: [...s.categories, ...clonedCats] } : s));
  };

  const addChecklistItem = (spaceId, categoryId) => {
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, checklist: [...c.checklist, { id: `item-${Date.now()}-${Math.random()}`, text: '' }] } : c) } : s));
  };

  const updateChecklistItem = (spaceId, categoryId, itemId, text) => {
    const valueToPersist = typeof text === 'string' ? text : '';
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, checklist: c.checklist.map(i => i.id === itemId ? { ...i, text: valueToPersist } : i) } : c) } : s));
  };

  const deleteChecklistItem = (spaceId, categoryId, itemId) => {
    setModules(prev => prev.map(s => s.id === spaceId ? { ...s, categories: s.categories.map(c => c.id === categoryId ? { ...c, checklist: c.checklist.filter(i => i.id !== itemId) } : c) } : s));
  };

  // Ball in Court entity helpers
  const addBallInCourtEntity = () => {
    setBallInCourtEntities(prev => {
      const usedNames = new Set(
        prev.map(entity => normalizeName(entity?.name)).filter(Boolean)
      );
      let counter = prev.length + 1;
      let candidateName = `Entity ${counter}`;
      while (usedNames.has(normalizeName(candidateName))) {
        counter += 1;
        candidateName = `Entity ${counter}`;
      }
      const newEntity = {
        id: `entity-${Date.now()}-${Math.random()}`,
        name: candidateName,
        color: hexToRgba('#E3D1FB', 0.2) // Default color with 20% opacity (for entity definition display)
      };
      return [...prev, newEntity];
    });
  };

  const updateBallInCourtEntity = (entityId, updates) => {
    setBallInCourtEntities(prev =>
      prev.map(entity =>
        entity.id === entityId ? { ...entity, ...updates } : entity
      )
    );
  };

  const deleteBallInCourtEntity = (entityId) => {
    setBallInCourtEntities(prev => prev.filter(e => e.id !== entityId));
  };

  const handleBallColorPickerOpen = (entityId, hex, opacity) => {
    setSelectedColorPickerId(entityId);
    setColorPickerMode('grid');
    setTempColor({ hex, opacity });
    setOpacityInputValue(null);
    setOpacityInputFocused(false);
  };

  const handleBallEntityDelete = (entityId) => {
    deleteBallInCourtEntity(entityId);
    if (selectedColorPickerId === entityId) {
      setSelectedColorPickerId(null);
    }
  };

  const handleBallEntityNameChange = (entityId, name) => {
    updateBallInCourtEntity(entityId, { name });
  };

  const getTemplateSnapshot = useCallback(() => ({
    templateName: templateName.trim(),
    templateVisibility,
    modules: modules.map((module) => ({
      ...module,
      categories: (module.categories || []).map((category) => ({
        ...category,
        checklist: (category.checklist || []).map((item) => ({ ...item }))
      }))
    })),
    ballInCourtEntities: ballInCourtEntities.map((entity) => ({ ...entity }))
  }), [templateName, templateVisibility, modules, ballInCourtEntities]);

  useEffect(() => {
    if (isTemplateModalOpen) {
      if (!initialTemplateStateRef.current) {
        initialTemplateStateRef.current = JSON.stringify(getTemplateSnapshot());
      }
    } else {
      initialTemplateStateRef.current = null;
    }
  }, [isTemplateModalOpen, getTemplateSnapshot]);

  const hasUnsavedTemplateChanges = useMemo(() => {
    if (!isTemplateModalOpen || !initialTemplateStateRef.current) {
      return false;
    }
    const currentSnapshot = JSON.stringify(getTemplateSnapshot());
    return currentSnapshot !== initialTemplateStateRef.current;
  }, [isTemplateModalOpen, getTemplateSnapshot]);

  const openTemplateModal = () => {
    setTemplateName('');
    setTemplateVisibility('personal');
    setModules([]);
    setSelectedModuleId(null);
    setSelectedTemplateCategoryId(null);
    setEditingTemplateId(null);
    setSelectedColorPickerId(null);
    setAddingModule(false);
    setNewModuleName('');
    setAddingCategory(false);
    setNewCategoryName('');
    setEditingModules(false);
    setEditingCategories(false);
    setEditingModuleName({});
    setEditingCategoryName({});
    setSelectedModuleIds([]);
    setSelectedCategoryIds([]);
    setSelectedChecklistItemIds([]);
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');
    // Initialize with default Ball in Court entities (entity definitions use 20% opacity for display, highlights use 40%)
    setBallInCourtEntities([
      { id: `entity-${Date.now()}-1`, name: 'GC', color: hexToRgba('#E3D1FB', 0.2) },
      { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: hexToRgba('#FFF5C3', 0.2) },
      { id: `entity-${Date.now()}-3`, name: 'My Company', color: hexToRgba('#CBDCFF', 0.2) },
      { id: `entity-${Date.now()}-4`, name: '100% Complete', color: hexToRgba('#B2FFB2', 0.2) },
      { id: `entity-${Date.now()}-5`, name: 'Removed', color: hexToRgba('#BBBBBB', 0.2) }
    ]);
    setIsTemplateModalOpen(true);
  };
  useImperativeHandle(ref, () => ({
    openTemplateModal,
    openEditTemplateModal,
    closeTemplateModal: () => setIsTemplateModalOpen(false),
    exitSelectionMode
  }));

  const openEditTemplateModal = (templateId, options = {}) => {
    const { moduleId: focusModuleId, startAddingCategory = false } = options || {};
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      alert('Template not found.');
      return;
    }

    // Pre-populate all fields with template data
    setTemplateName(template.name || '');
    setTemplateVisibility(template.visibility || 'personal');

    // Deep clone modules to avoid mutating the original
    const clonedModules = (template.modules || template.spaces || []).map(module => ({
      id: module.id,
      name: module.name,
      categories: (module.categories || []).map(cat => ({
        id: cat.id,
        name: cat.name,
        checklist: (cat.checklist || []).map(item => ({
          id: item.id,
          text: item.text
        }))
      }))
    }));

    setModules(clonedModules);
    const targetModuleId = focusModuleId && clonedModules.some(m => m.id === focusModuleId)
      ? focusModuleId
      : (clonedModules.length > 0 ? clonedModules[0].id : null);
    setSelectedModuleId(targetModuleId);
    setSelectedTemplateCategoryId(null);
    setAddingModule(false);
    setNewModuleName('');
    const shouldStartAddingCategory = Boolean(startAddingCategory && targetModuleId);
    setAddingCategory(shouldStartAddingCategory);
    setNewCategoryName('');
    setEditingModules(false);
    setEditingCategories(false);
    setEditingModuleName({});
    setEditingCategoryName({});
    setSelectedModuleIds([]);
    setSelectedCategoryIds([]);
    setSelectedChecklistItemIds([]);
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');

    // Load Ball in Court entities from template, or use defaults
    const defaultEntities = [
      { id: `entity-${Date.now()}-1`, name: 'GC', color: hexToRgba('#E3D1FB', 0.2) },
      { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: hexToRgba('#FFF5C3', 0.2) },
      { id: `entity-${Date.now()}-3`, name: 'My Company', color: hexToRgba('#CBDCFF', 0.2) },
      { id: `entity-${Date.now()}-4`, name: '100% Complete', color: hexToRgba('#B2FFB2', 0.2) },
      { id: `entity-${Date.now()}-5`, name: 'Removed', color: hexToRgba('#BBBBBB', 0.2) }
    ];
    const loadedEntities = template.ballInCourtEntities || defaultEntities;
    // Ensure all loaded entities have rgba format with 20% opacity
    const normalizedEntities = loadedEntities.map(entity => {
      if (!entity.color) {
        return entity;
      }

      // If color is hex, convert to rgba with default 20% opacity (legacy data)
      if (entity.color.startsWith('#')) {
        return { ...entity, color: hexToRgba(entity.color, 0.2) };
      }

      // If color is rgba, preserve whatever opacity was previously saved
      const rgbaMatch = entity.color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:,\s*([\d.]+))?\s*\)/i);
      if (rgbaMatch) {
        const opacity = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
        const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
        return {
          ...entity,
          color: `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${clampedOpacity})`
        };
      }

      return entity;
    });
    setBallInCourtEntities(normalizedEntities);

    setEditingTemplateId(templateId);
    setIsTemplateModalOpen(true);
  };

  const cancelTemplateModal = () => {
    setIsTemplateModalOpen(false);
    setEditingTemplateId(null);
    setSelectedTemplateCategoryId(null);
    setSelectedColorPickerId(null);
    setAddingModule(false);
    setNewModuleName('');
    setAddingCategory(false);
    setNewCategoryName('');
    setEditingModules(false);
    setEditingCategories(false);
    setEditingModuleName({});
    setEditingCategoryName({});
    setSelectedModuleIds([]);
    setSelectedCategoryIds([]);
    setSelectedChecklistItemIds([]);
    setIsMoveCopyModalOpen(false);
    setMoveCopyDestinationTemplateId(null);
    setMoveCopyDestinationModuleId(null);
    setMoveCopyDestinationCategoryId(null);
    setMoveCopyNewTemplateName('');
    setMoveCopyNewModuleName('');
    setMoveCopyNewCategoryName('');
  };

  const handleTemplateOverlayClick = useCallback((event) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (hasUnsavedTemplateChanges) {
      const shouldClose = window.confirm('You have unsaved changes. If you close now, all changes will be lost. Continue?');
      if (!shouldClose) {
        return;
      }
    }

    cancelTemplateModal();
  }, [hasUnsavedTemplateChanges, cancelTemplateModal]);

  const saveTemplate = async () => {
    const trimmedTemplateName = templateName.trim();
    if (!trimmedTemplateName) {
      alert('Please enter a template name.');
      return;
    }
    if (hasNameConflict(templates, trimmedTemplateName, { getName: (template) => template?.name, ignoreId: editingTemplateId })) {
      alert('A template with this name already exists. Please choose a different name.');
      return;
    }

    for (const module of modules) {
      const moduleName = (module?.name || 'Module').trim() || 'Module';
      for (const category of module?.categories || []) {
        const categoryName = (category?.name || 'Category').trim() || 'Category';
        const seenChecklistNames = new Set();
        for (const item of category?.checklist || []) {
          const trimmedItemName = (item?.text || '').trim();
          if (!trimmedItemName) {
            continue;
          }
          const normalizedItemName = normalizeName(trimmedItemName);
          if (seenChecklistNames.has(normalizedItemName)) {
            alert(`Checklist items within "${categoryName}" (${moduleName}) must have unique names. Please update duplicates before saving.`);
            return;
          }
          seenChecklistNames.add(normalizedItemName);
        }
      }
    }

    const cleanedModules = modules.map(m => ({
      id: m.id,
      name: m.name.trim() || 'Untitled Module',
      categories: (m.categories || []).map(c => ({
        id: c.id,
        name: c.name.trim() || 'Untitled Category',
        checklist: (c.checklist || []).map(i => ({ id: i.id, text: (i.text || '').trim() })).filter(i => i.text)
      }))
    }));

    const trimmedBallNames = ballInCourtEntities
      .map(e => (e?.name || '').trim())
      .filter(Boolean);

    const hasDuplicateBallNames = trimmedBallNames.some((name, index) => {
      const normalized = normalizeName(name);
      return trimmedBallNames.findIndex(other => normalizeName(other) === normalized) !== index;
    });

    if (hasDuplicateBallNames) {
      alert('Each Ball in Court name must be unique. Please resolve duplicate names before saving.');
      return;
    }

    // Clean Ball in Court entities
    const cleanedBallInCourtEntities = ballInCourtEntities
      .filter(e => e.name.trim())
      .map(e => ({
        id: e.id,
        name: e.name.trim(),
        color: e.color
      }));

    const buildUpdatedTemplates = (sourceTemplates = []) => {
      const existingTemplates = Array.isArray(sourceTemplates) ? sourceTemplates : [];

      if (hasNameConflict(existingTemplates, trimmedTemplateName, { getName: (template) => template?.name, ignoreId: editingTemplateId })) {
        alert('A template with this name already exists. Please choose a different name.');
        return null;
      }

      const timestamp = new Date().toISOString();

      if (editingTemplateId) {
        let wasUpdated = false;
        const updatedTemplates = existingTemplates.map(template => {
          if (template.id !== editingTemplateId) return template;
          wasUpdated = true;
          return {
            ...template,
            id: editingTemplateId,
            name: trimmedTemplateName,
            visibility: templateVisibility,
            modules: cleanedModules,
            spaces: cleanedModules,
            ballInCourtEntities: cleanedBallInCourtEntities,
            updatedAt: timestamp,
            createdAt: template.createdAt || timestamp
          };
        });

        if (!wasUpdated) {
          const fallbackTemplate = {
            id: editingTemplateId,
            name: trimmedTemplateName,
            visibility: templateVisibility,
            modules: cleanedModules,
            spaces: cleanedModules,
            ballInCourtEntities: cleanedBallInCourtEntities,
            createdAt: timestamp,
            updatedAt: timestamp
          };
          return [fallbackTemplate, ...updatedTemplates];
        }

        return updatedTemplates;
      }

      const newTemplate = {
        id: `tpl-${Date.now()}`,
        name: trimmedTemplateName,
        visibility: templateVisibility,
        modules: cleanedModules,
        spaces: cleanedModules,
        ballInCourtEntities: cleanedBallInCourtEntities,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return [newTemplate, ...existingTemplates];
    };

    try {
      if (user) {
        const sourceTemplates = Array.isArray(templates) ? templates : [];
        const nextTemplates = buildUpdatedTemplates(sourceTemplates);
        if (!nextTemplates) {
          return;
        }
        updateTemplates(nextTemplates);
        await persistTemplates(nextTemplates);
      } else {
        const raw = localStorage.getItem('templates');
        const existing = raw ? JSON.parse(raw) : [];
        const nextTemplates = buildUpdatedTemplates(existing);
        if (!nextTemplates) {
          return;
        }
        localStorage.setItem('templates', JSON.stringify(nextTemplates));
        updateTemplates(nextTemplates);
      }

      setIsTemplateModalOpen(false);
      setEditingTemplateId(null);
    } catch (e) {
      console.error('Failed to save template', e);
      alert('Failed to save template.');
    }
  };

  return (
    <div
      onClick={handleContainerClick}
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        background: '#1E1E1E',
        fontFamily: FONT_FAMILY
      }}>
      {/* Sidebar */}
      <div style={{
        width: '200px',
        background: '#1E1E1E',
        color: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '2px 0 12px rgba(0,0,0,0.2), 1px 0 6px rgba(0,0,0,0.15)',
        height: '100%',
        position: 'relative',
        zIndex: 1
      }}>
        <div style={{
          padding: '0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          boxShadow: 'none',
          position: 'relative',
          width: '100%',
          zIndex: 2
        }}>
          <h2 style={{
            fontSize: '18px',
            fontWeight: '600',
            letterSpacing: '-0.5px',
            margin: 0,
            width: '100%',
            textAlign: 'center'
          }}>
            Survey
          </h2>
        </div>

        <nav style={{ flex: 1, padding: '16px 0' }}>
          <div
            onClick={() => handleSectionNavClick('documents')}
            style={{
              padding: '10px 16px',
              background: activeSection === 'documents' ? 'rgba(255,255,255,0.1)' : 'transparent',
              borderLeft: activeSection === 'documents' ? '3px solid #4A90E2' : '3px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <span style={navIconWrapperStyle}>
              <Icon name="document" size={20} color={activeSection === 'documents' ? '#4A90E2' : '#FFFFFF'} />
            </span>
            <span style={navLabelStyle}>Documents</span>
          </div>

          <div
            onClick={() => handleSectionNavClick('projects', { resetProject: true })}
            style={{
              padding: '10px 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              transition: 'background 0.2s',
              background: activeSection === 'projects' ? 'rgba(255,255,255,0.1)' : 'transparent',
              borderLeft: activeSection === 'projects' ? '3px solid #4A90E2' : '3px solid transparent'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = activeSection === 'projects' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = activeSection === 'projects' ? 'rgba(255,255,255,0.1)' : 'transparent'}
          >
            <span style={navIconWrapperStyle}>
              <Icon name="folder" size={20} color={activeSection === 'projects' ? '#4A90E2' : '#FFFFFF'} />
            </span>
            <span style={navLabelStyle}>Projects</span>
          </div>

          <div
            onClick={() => handleSectionNavClick('templates', { resetProject: true, resetTemplate: true })}
            style={{
              padding: '10px 16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              transition: 'background 0.2s',
              background: activeSection === 'templates' ? 'rgba(255,255,255,0.1)' : 'transparent',
              borderLeft: activeSection === 'templates' ? '3px solid #4A90E2' : '3px solid transparent'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = activeSection === 'templates' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}
            onMouseLeave={(e) => e.currentTarget.style.background = activeSection === 'templates' ? 'rgba(255,255,255,0.1)' : 'transparent'}
          >
            <span style={navIconWrapperStyle}>
              <Icon name="template" size={20} color={activeSection === 'templates' ? '#4A90E2' : '#FFFFFF'} />
            </span>
            <span style={navLabelStyle}>Templates</span>
          </div>

        </nav>

        <div
          onClick={() => setShowAccountSettings(true)}
          style={{
            padding: '10px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            transition: 'background 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <span style={navIconWrapperStyle}>
            <Icon name="settings" size={20} color="#FFFFFF" />
          </span>
          <span style={navLabelStyle}>Settings</span>
        </div>

        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          position: 'relative'
        }} ref={userDropdownRef}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              transition: 'background 0.2s'
            }}
            onClick={() => {
              if (isAuthenticated) {
                setShowUserDropdown(!showUserDropdown);
              } else {
                onShowAuthModal?.();
              }
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <div style={{
              width: '32px',
              height: '32px',
              minWidth: '32px',
              minHeight: '32px',
              borderRadius: '50%',
              background: isAuthenticated ? '#4A90E2' : '#666',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: '600',
              color: '#FFFFFF',
              flexShrink: 0,
              lineHeight: '1'
            }}>
              {isAuthenticated && user?.user_metadata?.first_name && user?.user_metadata?.last_name
                ? `${user.user_metadata.first_name.charAt(0)}${user.user_metadata.last_name.charAt(0)}`
                : isAuthenticated && user?.email
                  ? user.email.charAt(0).toUpperCase()
                  : '?'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '500' }}>
                {isAuthenticated && user?.user_metadata?.full_name
                  ? user.user_metadata.full_name
                  : isAuthenticated
                    ? 'User'
                    : 'Sign In'}
              </div>
            </div>
          </div>

          {/* Dropdown menu when logged in */}
          {showUserDropdown && isAuthenticated && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: '16px',
              right: '16px',
              marginBottom: '8px',
              background: '#2a2a2a',
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
              overflow: 'hidden',
              zIndex: 1000
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAccountSettings(true);
                  setShowUserDropdown(false);
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: '14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon name="user" size={16} color="#fff" />
                Account
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await signOut();
                    setShowUserDropdown(false);
                  } catch (error) {
                    console.error('Sign out error:', error);
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: '14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon name="logout" size={16} color="#fff" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          background: '#252525',
          padding: '0 32px',
          borderBottom: '1px solid #3A3A3A',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          height: '56px',
          boxSizing: 'border-box',
          boxShadow: 'none',
          position: 'relative',
          marginLeft: '-24px',
          paddingLeft: '56px',
          zIndex: 2
        }}>
          <h1 style={{
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
            letterSpacing: '-0.5px',
            color: '#FFFFFF'
          }}>
            {activeSection === 'documents' ? 'Documents' : activeSection === 'projects' ? (selectedProjectId ? 'Project Files' : 'Projects') : (selectedTemplateId ? 'Template Files' : 'Templates')}
          </h1>
          {activeSection === 'projects' && selectedProjectId && (
            <button
              onClick={() => setSelectedProjectId(null)}
              className="btn btn-secondary btn-md"
            >
              <Icon name="arrowLeft" size={14} style={{ marginRight: '4px' }} /> Back to Projects
            </button>
          )}
          {activeSection === 'templates' && selectedTemplateId && (
            <button
              onClick={() => setSelectedTemplateId(null)}
              className="btn btn-secondary btn-md"
            >
              <Icon name="arrowLeft" size={14} style={{ marginRight: '4px' }} /> Back to Templates
            </button>
          )}

          <div style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            maxWidth: '400px',
            margin: '0 auto',
            position: 'relative'
          }}>
            <input
              type="text"
              placeholder={activeSection === 'documents' ? 'Search documents...' : activeSection === 'projects' ? (selectedProjectId ? 'Search files in project...' : 'Search projects...') : (selectedTemplateId ? 'Search files in template...' : 'Search templates...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 16px 10px 40px',
                border: '1px solid #3A3A3A',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: FONT_FAMILY,
                outline: 'none',
                background: '#1E1E1E',
                color: '#FFFFFF'
              }}
            />
            <span style={{
              position: 'absolute',
              left: '14px',
              top: '50%',
              transform: 'translateY(-50%)',
              opacity: 0.5,
              display: 'flex',
              alignItems: 'center'
            }}>
              <Icon name="search" size={16} color="currentColor" />
            </span>
          </div>
        </div>

        {/* Action Cards */}
        <div style={{
          padding: '24px 32px',
          display: 'flex',
          gap: '16px'
        }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <input
            ref={projectFileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleProjectFilesSelected}
            multiple
            style={{ display: 'none' }}
          />

          <button
            onClick={handleUploadClick}
            className="btn-card"
            style={{ borderColor: '#4A90E2' }}
          >
            <Icon name="upload" size={24} color="#4A90E2" className="icon" />
            <span className="label">Upload PDF</span>
          </button>

          <button
            onClick={handleCreateProjectClick}
            className="btn-card"
            style={{ borderColor: '#4A90E2' }}
          >
            <Icon name="folder" size={24} color="#4A90E2" className="icon" />
            <span className="label">Create Project</span>
          </button>

          <button
            onClick={openTemplateModal}
            className="btn-card"
            style={{ borderColor: '#4A90E2' }}
          >
            <Icon name="template" size={24} color="#4A90E2" className="icon" />
            <span className="label">Create Template</span>
          </button>
        </div>

        {/* View Options below action cards */}
        <div style={{
          padding: '0 32px 16px 32px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          justifyContent: 'flex-start'
        }}>
          {!isSelectionMode && (activeSection === 'documents' || activeSection === 'projects' || activeSection === 'templates') && (
            <button
              onClick={handleEnterSelectionMode}
              className="btn btn-secondary btn-md"
              disabled={!hasItems}
              style={!hasItems ? {
                opacity: 0.5,
                cursor: 'not-allowed'
              } : {}}
            >
              Select
            </button>
          )}
          {(activeSection === 'documents' || activeSection === 'projects' || activeSection === 'templates') && !isSelectionMode && (
            <div ref={viewDropdownRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setIsViewDropdownOpen(!isViewDropdownOpen)}
                className="btn btn-secondary btn-md"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                  {viewMode === 'grid' ? (
                    // Grid/Tiles icon (2x2 squares)
                    <>
                      <rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <rect x="9" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    </>
                  ) : (
                    // List icon (three horizontal lines with dots)
                    <>
                      <circle cx="3" cy="4" r="1" fill="currentColor" />
                      <line x1="6" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="3" cy="8" r="1" fill="currentColor" />
                      <line x1="6" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="3" cy="12" r="1" fill="currentColor" />
                      <line x1="6" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </>
                  )}
                </svg>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, opacity: 0.6 }}>
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isViewDropdownOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: '#1b1b1b',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                  padding: '4px',
                  minWidth: '140px',
                  zIndex: 1000,
                  border: '1px solid #333'
                }}>
                  <button
                    onClick={() => {
                      setViewMode('grid');
                      setIsViewDropdownOpen(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: viewMode === 'grid' ? 'rgba(74, 144, 226, 0.15)' : 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '400',
                      color: '#eaeaea',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      textAlign: 'left',
                      fontFamily: FONT_FAMILY,
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (viewMode !== 'grid') {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (viewMode !== 'grid') {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, opacity: 0.8 }}>
                      <rect x="2" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <rect x="9" y="2" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <rect x="2" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                      <rect x="9" y="9" width="5" height="5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    </svg>
                    <span>Grid</span>
                  </button>

                  <button
                    onClick={() => {
                      setViewMode('list');
                      setIsViewDropdownOpen(false);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: viewMode === 'list' ? 'rgba(74, 144, 226, 0.15)' : 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '400',
                      color: '#eaeaea',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      textAlign: 'left',
                      fontFamily: FONT_FAMILY,
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (viewMode !== 'list') {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (viewMode !== 'list') {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, opacity: 0.8 }}>
                      <circle cx="3" cy="4" r="1" fill="currentColor" />
                      <line x1="6" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="3" cy="8" r="1" fill="currentColor" />
                      <line x1="6" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <circle cx="3" cy="12" r="1" fill="currentColor" />
                      <line x1="6" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Table
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selection Mode Actions */}
        {
          isSelectionMode && (
            <div 
              ref={selectionModeActionsRef}
              style={{
                padding: '0 32px 16px 32px',
                display: 'flex',
                gap: '4px',
                alignItems: 'center',
                justifyContent: 'flex-start',
                flexWrap: 'nowrap'
              }}>
              <button
                onClick={selectAllCurrent}
                style={{
                  padding: '4px 5px',
                  background: 'rgb(68, 68, 68)',
                  color: 'rgb(221, 221, 221)',
                  border: '1px solid rgb(74, 144, 226)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  width: '70px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgb(68, 68, 68)';
                }}
              >
                Select All
              </button>
              <div ref={moveCopyDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setIsMoveCopyDropdownOpen(!isMoveCopyDropdownOpen)}
                  style={{
                    padding: '4px 5px',
                    background: 'rgb(68, 68, 68)',
                    color: 'rgb(221, 221, 221)',
                    border: '1px solid rgb(74, 144, 226)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '400',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    width: '85px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#444';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgb(68, 68, 68)';
                  }}
                >
                  Move/Copy
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                    <path d="M2 3L4 5L6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {isMoveCopyDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '4px',
                    background: '#1b1b1b',
                    borderRadius: '4px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                    border: '1px solid #333',
                    zIndex: 1000,
                    minWidth: '100px',
                    overflow: 'hidden'
                  }}>
                    <button
                      onClick={() => {
                        handleBulkMove();
                        setIsMoveCopyDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '0',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '400',
                        color: '#eaeaea',
                        display: 'flex',
                        alignItems: 'center',
                        textAlign: 'left',
                        fontFamily: FONT_FAMILY,
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      Move
                    </button>
                    <div style={{ width: '100%', height: '1px', background: '#333' }} />
                    <button
                      onClick={() => {
                        handleBulkCopy();
                        setIsMoveCopyDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '0',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '400',
                        color: '#eaeaea',
                        display: 'flex',
                        alignItems: 'center',
                        textAlign: 'left',
                        fontFamily: FONT_FAMILY,
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      Copy
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={handleBulkShare}
                style={{
                  padding: '4px 5px',
                  background: 'rgb(68, 68, 68)',
                  color: 'rgb(221, 221, 221)',
                  border: '1px solid rgb(74, 144, 226)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  width: '70px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgb(68, 68, 68)';
                }}
              >
                Share
              </button>
              <button
                onClick={handleBulkDelete}
                style={{
                  padding: '4px 5px',
                  background: 'rgb(68, 68, 68)',
                  color: 'rgb(255, 102, 102)',
                  border: '1px solid rgb(204, 68, 68)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  width: '70px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#444';
                  e.currentTarget.style.color = '#ff6666';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgb(68, 68, 68)';
                  e.currentTarget.style.color = 'rgb(255, 102, 102)';
                }}
              >
                Delete
              </button>
              <button
                onClick={exitSelectionMode}
                style={{
                  padding: '4px 5px',
                  background: 'rgb(68, 68, 68)',
                  color: 'rgb(221, 221, 221)',
                  border: '1px solid rgb(74, 144, 226)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  width: '70px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgb(68, 68, 68)';
                }}
              >
                Cancel
              </button>
            </div>
          )
        }

        {
          isProjectModalOpen && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999
            }}>
              <div style={{
                width: '560px',
                background: '#1f1f1f',
                color: '#eaeaea',
                borderRadius: '16px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
                border: '1px solid #2a2a2a',
                padding: '24px'
              }}>
                <div style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  textAlign: 'center',
                  marginBottom: '20px'
                }}>Create New Project</div>

                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Project Name</div>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter a descriptive name for your project"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid #333',
                    outline: 'none',
                    background: '#141414',
                    color: '#eaeaea',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '18px'
                  }}
                />

                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Upload PDFs</div>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  style={{
                    padding: '24px',
                    borderRadius: '12px',
                    border: `2px dashed ${isDragOver ? '#4A90E2' : '#3a3a3a'}`,
                    background: isDragOver ? 'rgba(74, 144, 226, 0.08)' : '#161616',
                    textAlign: 'center',
                    transition: 'all 0.15s'
                  }}
                >
                  <button
                    onClick={() => projectFileInputRef.current?.click()}
                    style={{
                      padding: '10px 14px',
                      background: '#2a2a2a',
                      color: '#eaeaea',
                      border: '1px solid #3a3a3a',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center'
                    }}
                  >
                    <Icon name="document" size={24} style={{ marginRight: '8px' }} /> Select Files
                  </button>
                  <div style={{ color: '#9a9a9a', fontSize: '13px', marginTop: '10px' }}>
                    or drag and drop PDFs here
                  </div>
                  <div style={{ color: '#6f6f6f', fontSize: '12px', marginTop: '4px' }}>
                    You can add multiple files
                  </div>

                  {projectFiles.length > 0 && (
                    <div style={{
                      marginTop: '14px',
                      textAlign: 'left',
                      maxHeight: '160px',
                      overflow: 'auto',
                      borderTop: '1px solid #2a2a2a',
                      paddingTop: '10px'
                    }}>
                      {projectFiles.map((f, i) => (
                        <div key={`${f.name}-${i}`} style={{ fontSize: '13px', color: '#cfcfcf', marginBottom: '6px' }}>
                          <Icon name="document" size={14} style={{ marginRight: '6px', display: 'inline-block', verticalAlign: 'middle' }} /> {f.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '22px' }}>
                  <button
                    onClick={handleCancelCreateProject}
                    style={{
                      padding: '10px 14px',
                      background: '#2a2a2a',
                      color: '#eaeaea',
                      border: '1px solid #3a3a3a',
                      borderRadius: '10px',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmCreateProject}
                    style={{
                      padding: '10px 14px',
                      background: '#4A90E2',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      opacity: projectName.trim() && projectFiles.length > 0 ? 1 : 0.7
                    }}
                  >
                    Create Project
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {
          isTemplateModalOpen && (
            <div
              onMouseDown={handleTemplateOverlayClick}
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
                zIndex: 9999
              }}>
              <div style={{
                width: '700px',
                maxHeight: '90vh',
                overflow: 'auto',
                background: '#1f1f1f',
                color: '#eaeaea',
                borderRadius: '12px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
                border: '1px solid #2a2a2a',
                padding: '16px'
              }}>
                <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>
                  {editingTemplateId ? 'Edit Template' : 'Create Template'}
                </div>

                {/* Template Name and Save Options - Inline */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', marginBottom: '16px', alignItems: 'end' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#aaa' }}>Template Name</div>
                    <input
                      type="text"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="e.g., Security"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #333', outline: 'none', background: '#141414', color: '#eaeaea', fontFamily: FONT_FAMILY, fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px', color: '#aaa' }}>Visibility</div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setTemplateVisibility('personal')}
                        style={{ padding: '8px 12px', background: templateVisibility === 'personal' ? '#3498db' : '#2a2a2a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '12px' }}
                      >
                        Personal
                      </button>
                      <button
                        onClick={() => setTemplateVisibility('shared')}
                        title="Shared is a placeholder for team sharing"
                        style={{ padding: '8px 12px', background: templateVisibility === 'shared' ? '#6C757D' : '#2a2a2a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '12px', opacity: 0.9 }}
                      >
                        Shared
                      </button>
                    </div>
                  </div>
                </div>

                {/* Spaces - Visible after template name */}
                {templateName.trim() && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa' }}>Modules</div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {!editingModules ? (
                        <>
                          <select
                            value={selectedModuleId || ''}
                            onChange={(e) => handleModuleSelect(e.target.value || null)}
                            disabled={modules.length === 0}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              paddingRight: '30px',
                              borderRadius: '6px',
                              border: '1px solid #333',
                              outline: 'none',
                              background: '#141414',
                              backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath fill=\'none\' stroke=\'%23eaeaea\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M1 1l5 5 5-5\'/%3E%3C/svg%3E")',
                              backgroundRepeat: 'no-repeat',
                              backgroundPosition: 'right 12px center',
                              backgroundSize: '12px',
                              color: '#eaeaea',
                              fontFamily: FONT_FAMILY,
                              cursor: 'pointer',
                              fontSize: '13px',
                              appearance: 'none',
                              WebkitAppearance: 'none',
                              MozAppearance: 'none'
                            }}
                          >
                            <option value="">Select a module...</option>
                            {modules.map(module => (
                              <option key={module.id} value={module.id}>{module.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={handleAddModuleClick}
                            className="btn btn-secondary"
                            style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                          >
                            Add
                          </button>
                          {modules.length > 0 && (
                            <button
                              onClick={handleEditModules}
                              className="btn btn-secondary"
                              style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                            >
                              Edit
                            </button>
                          )}
                        </>
                      ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <DndContext
                            sensors={moduleSensors}
                            collisionDetection={closestCenter}
                            onDragStart={handleModuleDragStart}
                            onDragEnd={handleModuleDragEnd}
                            onDragCancel={handleModuleDragCancel}
                          >
                            <SortableContext
                              items={modules.map((module) => module.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {modules.map((module) => (
                                  <TemplateModuleSortableRow
                                    key={module.id}
                                    module={module}
                                    isSelected={selectedModuleIds.includes(module.id)}
                                    nameValue={
                                      editingModuleName[module.id] !== undefined
                                        ? editingModuleName[module.id]
                                        : module.name
                                    }
                                    onToggleSelect={toggleModuleSelection}
                                    onNameChange={handleModuleNameChange}
                                    onNameKeyDown={handleModuleInputKeyDown}
                                    disabled={!editingModules}
                                  />
                                ))}
                              </div>
                            </SortableContext>
                            <DragOverlay>
                              {activeModule && <TemplateDragOverlayItem label={activeModule.name} />}
                            </DragOverlay>
                          </DndContext>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                            <button
                              onClick={handleDuplicateModules}
                              disabled={selectedModuleIds.length === 0}
                              className="btn btn-secondary"
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                opacity: selectedModuleIds.length === 0 ? 0.5 : 1,
                                cursor: selectedModuleIds.length === 0 ? 'not-allowed' : 'pointer'
                              }}
                            >
                              Duplicate
                            </button>
                            <button
                              onClick={handleMoveCopyModules}
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}
                            >
                              Move/Copy
                            </button>
                            <button
                              onClick={handleSaveEditModules}
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                if (selectedModuleIds.length === 0) return;

                                const moduleNames = modules
                                  .filter(m => selectedModuleIds.includes(m.id))
                                  .map(m => m.name)
                                  .join(', ');

                                const confirmMessage = selectedModuleIds.length === 1
                                  ? `Are you sure you want to delete the module "${moduleNames}"? This will also delete all categories and checklist items within it.`
                                  : `Are you sure you want to delete ${selectedModuleIds.length} modules (${moduleNames})? This will also delete all categories and checklist items within them.`;

                                if (window.confirm(confirmMessage)) {
                                  deleteModules(selectedModuleIds);
                                  setSelectedModuleIds([]);
                                }
                              }}
                              disabled={selectedModuleIds.length === 0}
                              className="btn btn-danger"
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                opacity: selectedModuleIds.length === 0 ? 0.5 : 1,
                                cursor: selectedModuleIds.length === 0 ? 'not-allowed' : 'pointer'
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Add Space Input */}
                    {addingModule && !editingModules && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                        <input
                          type="text"
                          value={newModuleName}
                          onChange={(e) => setNewModuleName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveModule();
                            } else if (e.key === 'Escape') {
                              handleCancelAddModule();
                            }
                          }}
                          placeholder="Enter module name..."
                          autoFocus
                          style={{
                            flex: 1,
                            padding: '8px 10px',
                            borderRadius: '6px',
                            border: '1px solid #4A90E2',
                            outline: 'none',
                            background: '#141414',
                            color: '#eaeaea',
                            fontFamily: FONT_FAMILY,
                            fontSize: '13px'
                          }}
                        />
                        <button
                          onClick={handleSaveModule}
                          className="btn btn-secondary"
                          style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelAddModule}
                          className="btn btn-secondary"
                          style={{ padding: '8px 12px', borderRadius: '6px', background: '#2a2a2a', fontSize: '12px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Categories - Visible only after module is selected */}
                {templateName.trim() && selectedModuleId && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa' }}>Categories</div>
                    {(() => {
                      const selectedModule = modules.find(m => m.id === selectedModuleId);
                      if (!selectedModule) return null;

                      return (
                        <>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {!editingCategories ? (
                              <>
                                <select
                                  value={selectedTemplateCategoryId || ''}
                                  onChange={(e) => handleCategorySelect(e.target.value || null)}
                                  disabled={(selectedModule.categories || []).length === 0}
                                  style={{
                                    flex: 1,
                                    padding: '8px 10px',
                                    paddingRight: '30px',
                                    borderRadius: '6px',
                                    border: '1px solid #333',
                                    outline: 'none',
                                    background: '#141414',
                                    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\' viewBox=\'0 0 12 8\'%3E%3Cpath fill=\'none\' stroke=\'%23eaeaea\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\' d=\'M1 1l5 5 5-5\'/%3E%3C/svg%3E")',
                                    backgroundRepeat: 'no-repeat',
                                    backgroundPosition: 'right 12px center',
                                    backgroundSize: '12px',
                                    color: '#eaeaea',
                                    fontFamily: FONT_FAMILY,
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    appearance: 'none',
                                    WebkitAppearance: 'none',
                                    MozAppearance: 'none'
                                  }}
                                >
                                  <option value="">Select a category...</option>
                                  {(selectedModule.categories || []).map(cat => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                  ))}
                                </select>
                                <button
                                  onClick={handleAddCategoryClick}
                                  className="btn btn-secondary"
                                  style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                                >
                                  Add
                                </button>
                                {(selectedModule.categories || []).length > 0 && (
                                  <button
                                    onClick={handleEditCategories}
                                    className="btn btn-secondary"
                                    style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                                  >
                                    Edit
                                  </button>
                                )}
                              </>
                            ) : (
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <DndContext
                                  sensors={categorySensors}
                                  collisionDetection={closestCenter}
                                  onDragStart={handleCategoryDragStart}
                                  onDragEnd={handleCategoryDragEnd}
                                  onDragCancel={handleCategoryDragCancel}
                                >
                                  <SortableContext
                                    items={(selectedModule.categories || []).map((cat) => cat.id)}
                                    strategy={verticalListSortingStrategy}
                                  >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      {(selectedModule.categories || []).map((cat) => (
                                        <TemplateCategorySortableRow
                                          key={cat.id}
                                          category={cat}
                                          isSelected={selectedCategoryIds.includes(cat.id)}
                                          nameValue={
                                            editingCategoryName[cat.id] !== undefined
                                              ? editingCategoryName[cat.id]
                                              : cat.name
                                          }
                                          onToggleSelect={toggleCategorySelection}
                                          onNameChange={handleCategoryNameChange}
                                          onNameKeyDown={handleCategoryInputKeyDown}
                                          disabled={!editingCategories}
                                        />
                                      ))}
                                    </div>
                                  </SortableContext>
                                  <DragOverlay>
                                    {activeCategory && <TemplateDragOverlayItem label={activeCategory.name} />}
                                  </DragOverlay>
                                </DndContext>
                                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                                  <button
                                    onClick={handleDuplicateCategories}
                                    disabled={selectedCategoryIds.length === 0}
                                    className="btn btn-secondary"
                                    style={{
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      fontSize: '12px',
                                      opacity: selectedCategoryIds.length === 0 ? 0.5 : 1,
                                      cursor: selectedCategoryIds.length === 0 ? 'not-allowed' : 'pointer'
                                    }}
                                  >
                                    Duplicate
                                  </button>
                                  <button
                                    onClick={handleMoveCopyCategories}
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}
                                  >
                                    Move/Copy
                                  </button>
                                  <button
                                    onClick={handleSaveEditCategories}
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (selectedCategoryIds.length === 0 || !selectedModuleId) return;

                                      const selectedModule = modules.find(m => m.id === selectedModuleId);
                                      if (!selectedModule) return;

                                      const categoryNames = (selectedModule.categories || [])
                                        .filter(c => selectedCategoryIds.includes(c.id))
                                        .map(c => c.name)
                                        .join(', ');

                                      const confirmMessage = selectedCategoryIds.length === 1
                                        ? `Are you sure you want to delete the category "${categoryNames}"? This will also delete all checklist items within it.`
                                        : `Are you sure you want to delete ${selectedCategoryIds.length} categories (${categoryNames})? This will also delete all checklist items within them.`;

                                      if (window.confirm(confirmMessage)) {
                                        deleteCategories(selectedModuleId, selectedCategoryIds);
                                        setSelectedCategoryIds([]);
                                      }
                                    }}
                                    disabled={selectedCategoryIds.length === 0}
                                    className="btn btn-danger"
                                    style={{
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      fontSize: '12px',
                                      opacity: selectedCategoryIds.length === 0 ? 0.5 : 1,
                                      cursor: selectedCategoryIds.length === 0 ? 'not-allowed' : 'pointer'
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Add Category Input */}
                          {addingCategory && !editingCategories && (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                              <input
                                type="text"
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveCategory();
                                  } else if (e.key === 'Escape') {
                                    handleCancelAddCategory();
                                  }
                                }}
                                placeholder="Enter category name..."
                                autoFocus
                                style={{
                                  flex: 1,
                                  padding: '8px 10px',
                                  borderRadius: '6px',
                                  border: '1px solid #4A90E2',
                                  outline: 'none',
                                  background: '#141414',
                                  color: '#eaeaea',
                                  fontFamily: FONT_FAMILY,
                                  fontSize: '13px'
                                }}
                              />
                              <button
                                onClick={handleSaveCategory}
                                className="btn btn-secondary"
                                style={{ padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}
                              >
                                Save
                              </button>
                              <button
                                onClick={handleCancelAddCategory}
                                className="btn btn-secondary"
                                style={{ padding: '8px 12px', borderRadius: '6px', background: '#2a2a2a', fontSize: '12px' }}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Checklist Items - Visible only after template + space + category are all selected */}
                {templateName.trim() && selectedModuleId && selectedTemplateCategoryId && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa' }}>Checklist Items</div>
                    {(() => {
                      const selectedModule = modules.find(m => m.id === selectedModuleId);
                      if (!selectedModule) return null;
                      const selectedCategory = (selectedModule.categories || []).find(cat => cat.id === selectedTemplateCategoryId);
                      if (!selectedCategory) return null;

                      return (
                        <div style={{ padding: '10px', background: '#141414', borderRadius: '8px', border: '1px solid #2a2a2a' }}>
                          <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '8px', color: '#cfcfcf' }}>
                            {selectedCategory.name}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                            {(selectedCategory.checklist || []).map(item => (
                              <div key={item.id} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <input
                                  type="text"
                                  value={item.text}
                                  onChange={(e) => updateChecklistItem(selectedModuleId, selectedCategory.id, item.id, e.target.value)}
                                  placeholder="Checklist item (e.g., Cable pulled)"
                                  style={{
                                    flex: 1,
                                    padding: '6px 8px',
                                    background: '#1b1b1b',
                                    color: '#ddd',
                                    border: '1px solid #2f2f2f',
                                    borderRadius: '6px',
                                    outline: 'none',
                                    fontFamily: FONT_FAMILY,
                                    fontSize: '13px'
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Are you sure you want to delete the checklist item "${item.text || 'Untitled Item'}"?`)) {
                                      deleteChecklistItem(selectedModuleId, selectedCategory.id, item.id);
                                    }
                                  }}
                                  title="Delete"
                                  className="btn btn-danger btn-icon-only btn-sm"
                                  style={{ padding: '6px', minWidth: '28px', minHeight: '28px' }}
                                >
                                  <Icon name="close" size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => addChecklistItem(selectedModuleId, selectedCategory.id)}
                            className="btn btn-secondary"
                            style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}
                          >
                            + Add Item
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Ball in Court Section */}
                <div style={{ marginTop: '16px', padding: '12px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Ball in Court</div>
                    <button onClick={addBallInCourtEntity} className="btn btn-secondary btn-sm" style={{ padding: '6px 10px', fontSize: '12px' }}>+ Add Entity</button>
                  </div>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px' }}>
                    Define entities and their highlight colors for responsibility tracking
                  </div>
                  <style>{`
                  body.ball-in-court-dragging [data-ball-delete] {
                    display: none !important;
                  }
                `}</style>
                  <DndContext
                    sensors={ballSensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleBallDragStart}
                    onDragEnd={handleBallDragEnd}
                    onDragCancel={handleBallDragCancel}
                  >
                    <SortableContext
                      items={ballInCourtEntities.map((entity) => entity.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {ballInCourtEntities.map((entity) => (
                          <BallInCourtSortableRow
                            key={entity.id}
                            entity={entity}
                            selectedColorPickerId={selectedColorPickerId}
                            onOpenColorPicker={handleBallColorPickerOpen}
                            onNameChange={handleBallEntityNameChange}
                            onDelete={() => handleBallEntityDelete(entity.id)}
                            isAnyDragging={isAnyBallEntityDragging}
                          />
                        ))}
                        {ballInCourtEntities.length === 0 && (
                          <div style={{ color: '#888', fontSize: '13px', fontStyle: 'italic', padding: '12px' }}>
                            No entities defined. Add at least one entity for Ball in Court tracking.
                          </div>
                        )}
                      </div>
                    </SortableContext>
                    <DragOverlay>
                      {activeBallEntity && <BallInCourtDragOverlayItem entity={activeBallEntity} />}
                    </DragOverlay>
                  </DndContext>
                </div>

                {/* Color Picker Dialog */}
                {selectedColorPickerId && (() => {
                  const entity = ballInCourtEntities.find(e => e.id === selectedColorPickerId);
                  if (!entity) return null;

                  const getHexFromColor = (color) => {
                    if (color.startsWith('rgba')) {
                      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
                      if (match) {
                        const r = parseInt(match[1]).toString(16).padStart(2, '0');
                        const g = parseInt(match[2]).toString(16).padStart(2, '0');
                        const b = parseInt(match[3]).toString(16).padStart(2, '0');
                        return `#${r}${g}${b}`;
                      }
                    }
                    if (color.startsWith('#')) return color;
                    return '#E3D1FB';
                  };

                  const currentHex = tempColor ? tempColor.hex : getHexFromColor(entity.color);
                  const currentOpacity = tempColor ? tempColor.opacity : getOpacityFromBallColor(entity.color);
                  const rgb = hexToRgb(currentHex);
                  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

                  // Update temp color when HSL changes
                  const updateColorFromHsl = (h, s, l, opacity = currentOpacity) => {
                    const newRgb = hslToRgb(h, s, l);
                    const newHex = `#${newRgb.r.toString(16).padStart(2, '0')}${newRgb.g.toString(16).padStart(2, '0')}${newRgb.b.toString(16).padStart(2, '0')}`;
                    setTempColor({ hex: newHex, opacity });
                  };

                  const swatches = generateColorSwatches();

                  return (
                    <div
                      onClick={(e) => {
                        // Only close if clicking directly on the overlay background (not any child elements)
                        if (e.target === e.currentTarget) {
                          setSelectedColorPickerId(null);
                          setTempColor(null);
                          setOpacityInputValue(null);
                          setOpacityInputFocused(false);
                        }
                      }}
                      style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.7)',
                        zIndex: 10004,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        data-color-picker-dialog
                        style={{
                          background: '#2b2b2b',
                          border: '1px solid #444',
                          borderRadius: '8px',
                          padding: '20px',
                          width: colorPickerMode === 'grid' ? '520px' : '420px',
                          maxWidth: '90vw',
                          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
                        }}
                      >
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                          <div style={{ fontSize: '16px', fontWeight: '600', color: '#fff', fontFamily: FONT_FAMILY }}>
                            Choose Color
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => {
                                setColorPickerMode('grid');
                                setOpacityInputValue(null);
                                setOpacityInputFocused(false);
                              }}
                              style={{
                                width: '32px',
                                height: '32px',
                                background: colorPickerMode === 'grid' ? '#555' : '#333',
                                border: '1px solid #444',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0
                              }}
                              title="Grid View"
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <rect x="2" y="2" width="5" height="5" fill="#fff" />
                                <rect x="9" y="2" width="5" height="5" fill="#fff" />
                                <rect x="2" y="9" width="5" height="5" fill="#fff" />
                                <rect x="9" y="9" width="5" height="5" fill="#fff" />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                setColorPickerMode('advanced');
                                setOpacityInputValue(null);
                                setOpacityInputFocused(false);
                              }}
                              style={{
                                width: '32px',
                                height: '32px',
                                background: colorPickerMode === 'advanced' ? '#555' : '#333',
                                border: '1px solid #444',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0
                              }}
                              title="Advanced Picker"
                            >
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <path d="M8 2L10 6L14 8L10 10L8 14L6 10L2 8L6 6L8 2Z" fill="#fff" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Grid Mode */}
                        {colorPickerMode === 'grid' && (
                          <div>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(8, 1fr)',
                              gap: '4px',
                              marginBottom: '20px'
                            }}>
                              {swatches.map((swatch, idx) => {
                                const isSelected = currentHex.toLowerCase() === swatch.toLowerCase();
                                return (
                                  <div
                                    key={idx}
                                    onClick={() => {
                                      // Use current opacity from slider
                                      const finalOpacity = tempColor ? tempColor.opacity : currentOpacity;
                                      const newRgba = hexToRgba(swatch, finalOpacity / 100);
                                      updateBallInCourtEntity(entity.id, { color: newRgba });
                                      setSelectedColorPickerId(null);
                                      setTempColor(null);
                                    }}
                                    style={{
                                      width: '100%',
                                      aspectRatio: '1',
                                      background: swatch,
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      border: isSelected ? '2px solid #4A90E2' : '1px solid #444',
                                      boxSizing: 'border-box',
                                      transition: 'border 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isSelected) {
                                        e.currentTarget.style.border = '2px solid #666';
                                      }
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isSelected) {
                                        e.currentTarget.style.border = '1px solid #444';
                                      }
                                    }}
                                  />
                                );
                              })}
                            </div>

                            {/* Opacity Slider */}
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <label style={{ fontSize: '13px', color: '#999', minWidth: '60px' }}>
                                Opacity:
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={currentOpacity}
                                onChange={(e) => {
                                  const newOpacity = parseFloat(e.target.value);
                                  setTempColor({ hex: currentHex, opacity: newOpacity });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  flex: 1,
                                  height: '4px',
                                  background: `linear-gradient(to right, transparent, ${currentHex})`,
                                  borderRadius: '2px',
                                  outline: 'none',
                                  cursor: 'pointer'
                                }}
                              />
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={opacityInputFocused ? (opacityInputValue !== null ? opacityInputValue.toString() : '') : Math.round(currentOpacity).toString()}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // Allow empty string for clearing
                                  if (value === '') {
                                    setOpacityInputValue('');
                                    return;
                                  }
                                  // Only allow digits
                                  if (/^\d+$/.test(value)) {
                                    const numValue = parseInt(value, 10);
                                    if (!isNaN(numValue)) {
                                      const newOpacity = Math.max(0, Math.min(100, numValue));
                                      setOpacityInputValue(value); // Keep the typed value as string
                                      setTempColor({ hex: currentHex, opacity: newOpacity });
                                    }
                                  }
                                }}
                                onBlur={(e) => {
                                  setOpacityInputFocused(false);
                                  const value = e.target.value.trim();
                                  if (value === '' || isNaN(parseInt(value, 10))) {
                                    // Reset to current opacity on blur if empty/invalid
                                    setOpacityInputValue(null);
                                    const final = tempColor ? tempColor.opacity : currentOpacity;
                                    setTempColor({ hex: currentHex, opacity: final });
                                  } else {
                                    const numValue = parseInt(value, 10);
                                    const newOpacity = Math.max(0, Math.min(100, numValue));
                                    setOpacityInputValue(null);
                                    setTempColor({ hex: currentHex, opacity: newOpacity });
                                  }
                                }}
                                onFocus={(e) => {
                                  e.stopPropagation();
                                  setOpacityInputFocused(true);
                                  e.target.select();
                                  // Set to current opacity value when focused
                                  const current = tempColor ? tempColor.opacity : currentOpacity;
                                  setOpacityInputValue(Math.round(current).toString());
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.target.select();
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  // Allow delete, backspace, arrow keys, etc.
                                  if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                                    return;
                                  }
                                  // Allow digits
                                  if (/^\d$/.test(e.key)) {
                                    return;
                                  }
                                  // Allow Ctrl/Cmd combinations
                                  if (e.ctrlKey || e.metaKey) {
                                    return;
                                  }
                                  // Prevent other keys
                                  e.preventDefault();
                                }}
                                style={{
                                  width: '60px',
                                  padding: '6px 8px',
                                  background: '#141414',
                                  color: '#ddd',
                                  border: '1px solid #2f2f2f',
                                  borderRadius: '6px',
                                  outline: 'none',
                                  fontSize: '13px',
                                  fontFamily: 'monospace',
                                  textAlign: 'center'
                                }}
                              />
                              <span style={{ color: '#ddd', fontWeight: '500', fontSize: '13px' }}>
                                %
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Advanced Mode */}
                        {colorPickerMode === 'advanced' && (
                          <div>
                            {/* Saturation/Lightness Square */}
                            <div style={{ position: 'relative', marginBottom: '16px' }}>
                              <div
                                style={{
                                  width: '100%',
                                  aspectRatio: '1',
                                  borderRadius: '6px',
                                  position: 'relative',
                                  cursor: 'crosshair',
                                  border: '1px solid #444',
                                  overflow: 'hidden'
                                }}
                                onMouseDown={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const x = (e.clientX - rect.left) / rect.width;
                                  const y = (e.clientY - rect.top) / rect.height;
                                  const s = Math.max(0, Math.min(100, x * 100));
                                  const l = Math.max(0, Math.min(100, (1 - y) * 100));
                                  updateColorFromHsl(hsl.h, s, l, currentOpacity);
                                }}
                                onMouseMove={(e) => {
                                  if (e.buttons === 1) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = (e.clientX - rect.left) / rect.width;
                                    const y = (e.clientY - rect.top) / rect.height;
                                    const s = Math.max(0, Math.min(100, x * 100));
                                    const l = Math.max(0, Math.min(100, (1 - y) * 100));
                                    updateColorFromHsl(hsl.h, s, l, currentOpacity);
                                  }
                                }}
                              >
                                {/* Base hue color */}
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  background: `hsl(${hsl.h}, 100%, 50%)`
                                }} />
                                {/* White to transparent (saturation) */}
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  background: `linear-gradient(to right, white, transparent)`,
                                  mixBlendMode: 'multiply'
                                }} />
                                {/* Transparent to black (lightness) */}
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  background: `linear-gradient(to bottom, transparent, black)`
                                }} />
                                {/* Selection indicator */}
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: `${hsl.s}%`,
                                    top: `${100 - hsl.l}%`,
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    border: '2px solid white',
                                    background: currentHex,
                                    transform: 'translate(-50%, -50%)',
                                    pointerEvents: 'none',
                                    boxShadow: '0 0 0 1px rgba(0,0,0,0.3)'
                                  }}
                                />
                              </div>
                            </div>

                            {/* Hue Slider */}
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
                              <div style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                  <path d="M8 2L10 6L14 8L10 10L8 14L6 10L2 8L6 6L8 2Z" fill={currentHex} stroke="#fff" strokeWidth="1" />
                                </svg>
                              </div>
                              <div style={{ flex: 1, position: 'relative', height: '24px', background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)', borderRadius: '4px', border: '1px solid #444' }}>
                                <input
                                  type="range"
                                  min="0"
                                  max="360"
                                  step="1"
                                  value={hsl.h}
                                  onChange={(e) => {
                                    const newH = parseFloat(e.target.value);
                                    updateColorFromHsl(newH, hsl.s, hsl.l, currentOpacity);
                                  }}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    background: 'transparent',
                                    outline: 'none',
                                    cursor: 'pointer',
                                    WebkitAppearance: 'none',
                                    appearance: 'none',
                                    margin: 0,
                                    padding: 0
                                  }}
                                />
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: `${(hsl.h / 360) * 100}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '4px',
                                    height: '24px',
                                    background: 'white',
                                    borderRadius: '2px',
                                    pointerEvents: 'none',
                                    boxShadow: '0 0 2px rgba(0,0,0,0.5)'
                                  }}
                                />
                              </div>
                            </div>

                            {/* Hex Input */}
                            <div style={{ marginBottom: '16px' }}>
                              <input
                                type="text"
                                value={currentHex.toUpperCase()}
                                onChange={(e) => {
                                  let hexValue = e.target.value.trim().toUpperCase();
                                  // Allow typing partial hex values
                                  if (!hexValue.startsWith('#')) {
                                    hexValue = '#' + hexValue;
                                  }
                                  // Allow any valid hex characters while typing
                                  if (/^#[0-9A-F]{0,6}$/.test(hexValue)) {
                                    // If it's a complete 6-digit hex, update the color
                                    if (hexValue.length === 7) {
                                      try {
                                        const newRgb = hexToRgb(hexValue);
                                        const newHsl = rgbToHsl(newRgb.r, newRgb.g, newRgb.b);
                                        setTempColor({ hex: hexValue, opacity: currentOpacity });
                                      } catch (e) {
                                        // Invalid hex, keep current
                                      }
                                    } else {
                                      // Store partial hex for display
                                      setTempColor(prev => ({ ...prev, hex: hexValue, opacity: currentOpacity }));
                                    }
                                  }
                                }}
                                onBlur={(e) => {
                                  // On blur, ensure we have a valid hex
                                  let hexValue = e.target.value.trim().toUpperCase();
                                  if (!hexValue.startsWith('#')) {
                                    hexValue = '#' + hexValue;
                                  }
                                  if (/^#[0-9A-F]{6}$/.test(hexValue)) {
                                    try {
                                      const newRgb = hexToRgb(hexValue);
                                      const newHsl = rgbToHsl(newRgb.r, newRgb.g, newRgb.b);
                                      setTempColor({ hex: hexValue, opacity: currentOpacity });
                                    } catch (e) {
                                      // Invalid, reset to current
                                      setTempColor({ hex: currentHex, opacity: currentOpacity });
                                    }
                                  } else {
                                    // Invalid, reset to current
                                    setTempColor({ hex: currentHex, opacity: currentOpacity });
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onFocus={(e) => e.stopPropagation()}
                                style={{
                                  width: '100%',
                                  padding: '8px 12px',
                                  background: '#141414',
                                  color: '#ddd',
                                  border: '1px solid #2f2f2f',
                                  borderRadius: '6px',
                                  outline: 'none',
                                  fontFamily: 'monospace',
                                  fontSize: '14px'
                                }}
                                placeholder="#00FF00"
                              />
                            </div>

                            {/* Opacity Slider */}
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <label style={{ fontSize: '13px', color: '#999', minWidth: '60px' }}>
                                Opacity:
                              </label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={currentOpacity}
                                onChange={(e) => {
                                  const newOpacity = parseFloat(e.target.value);
                                  setTempColor({ hex: currentHex, opacity: newOpacity });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                style={{
                                  flex: 1,
                                  height: '4px',
                                  background: `linear-gradient(to right, rgba(128,128,128,0.3), ${currentHex})`,
                                  borderRadius: '2px',
                                  outline: 'none',
                                  cursor: 'pointer',
                                  WebkitAppearance: 'none',
                                  appearance: 'none'
                                }}
                              />
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={opacityInputFocused ? (opacityInputValue !== null ? opacityInputValue.toString() : '') : Math.round(currentOpacity).toString()}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // Allow empty string for clearing
                                  if (value === '') {
                                    setOpacityInputValue('');
                                    return;
                                  }
                                  // Only allow digits
                                  if (/^\d+$/.test(value)) {
                                    const numValue = parseInt(value, 10);
                                    if (!isNaN(numValue)) {
                                      const newOpacity = Math.max(0, Math.min(100, numValue));
                                      setOpacityInputValue(value); // Keep the typed value as string
                                      setTempColor({ hex: currentHex, opacity: newOpacity });
                                    }
                                  }
                                }}
                                onBlur={(e) => {
                                  setOpacityInputFocused(false);
                                  const value = e.target.value.trim();
                                  if (value === '' || isNaN(parseInt(value, 10))) {
                                    // Reset to current opacity on blur if empty/invalid
                                    setOpacityInputValue(null);
                                    const final = tempColor ? tempColor.opacity : currentOpacity;
                                    setTempColor({ hex: currentHex, opacity: final });
                                  } else {
                                    const numValue = parseInt(value, 10);
                                    const newOpacity = Math.max(0, Math.min(100, numValue));
                                    setOpacityInputValue(null);
                                    setTempColor({ hex: currentHex, opacity: newOpacity });
                                  }
                                }}
                                onFocus={(e) => {
                                  e.stopPropagation();
                                  setOpacityInputFocused(true);
                                  e.target.select();
                                  // Set to current opacity value when focused
                                  const current = tempColor ? tempColor.opacity : currentOpacity;
                                  setOpacityInputValue(Math.round(current).toString());
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.target.select();
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  // Allow delete, backspace, arrow keys, etc.
                                  if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                                    return;
                                  }
                                  // Allow digits
                                  if (/^\d$/.test(e.key)) {
                                    return;
                                  }
                                  // Allow Ctrl/Cmd combinations
                                  if (e.ctrlKey || e.metaKey) {
                                    return;
                                  }
                                  // Prevent other keys
                                  e.preventDefault();
                                }}
                                style={{
                                  width: '60px',
                                  padding: '6px 8px',
                                  background: '#141414',
                                  color: '#ddd',
                                  border: '1px solid #2f2f2f',
                                  borderRadius: '6px',
                                  outline: 'none',
                                  fontSize: '13px',
                                  fontFamily: 'monospace',
                                  textAlign: 'center'
                                }}
                              />
                              <span style={{ color: '#ddd', fontWeight: '500', fontSize: '13px' }}>
                                %
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
                          <button
                            onClick={() => {
                              setSelectedColorPickerId(null);
                              setTempColor(null);
                              setOpacityInputValue(null);
                              setOpacityInputFocused(false);
                            }}
                            style={{
                              padding: '8px 16px',
                              background: '#333',
                              color: '#fff',
                              border: '1px solid #444',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontFamily: FONT_FAMILY
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const finalOpacity = tempColor ? tempColor.opacity : currentOpacity;
                              const newRgba = hexToRgba(currentHex, finalOpacity / 100);
                              updateBallInCourtEntity(entity.id, { color: newRgba });
                              setSelectedColorPickerId(null);
                              setTempColor(null);
                              setOpacityInputValue(null);
                              setOpacityInputFocused(false);
                            }}
                            style={{
                              padding: '8px 16px',
                              background: '#4A90E2',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontFamily: FONT_FAMILY,
                              fontWeight: '500'
                            }}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #2a2a2a' }}>
                  <button onClick={cancelTemplateModal} className="btn btn-secondary" style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px' }}>Cancel</button>
                  <button onClick={saveTemplate} className="btn btn-primary" disabled={!templateName.trim()} style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px' }}>
                    {editingTemplateId ? 'Save Changes' : 'Save Template'}
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {/* Move/Copy Modal */}
        {
          isMoveCopyModalOpen && (
            <div style={{
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
            }}>
              <div style={{
                width: '600px',
                maxHeight: '85vh',
                overflow: 'auto',
                background: '#1f1f1f',
                color: '#eaeaea',
                borderRadius: '12px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
                border: '1px solid #2a2a2a',
                padding: '16px'
              }}>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
                  {moveCopyType === 'module' ? 'Move/Copy Modules' : moveCopyType === 'category' ? 'Move/Copy Categories' : 'Move/Copy Checklist Items'}
                </div>

                {/* Move/Copy Mode Selection */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa' }}>Action</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setMoveCopyMode('copy')}
                      style={{
                        padding: '8px 16px',
                        background: moveCopyMode === 'copy' ? '#4A90E2' : '#2a2a2a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 500,
                        fontSize: '12px'
                      }}
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => setMoveCopyMode('move')}
                      style={{
                        padding: '8px 16px',
                        background: moveCopyMode === 'move' ? '#4A90E2' : '#2a2a2a',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 500,
                        fontSize: '12px'
                      }}
                    >
                      Move
                    </button>
                  </div>
                </div>

                {/* Destination Selection */}
                {moveCopyType === 'module' && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa' }}>Destination Template</div>
                    <select
                      value={moveCopyDestinationTemplateId || ''}
                      onChange={(e) => {
                        setMoveCopyDestinationTemplateId(e.target.value);
                        setMoveCopyNewTemplateName('');
                      }}
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
                      <option value="">Select destination template...</option>
                      <option value="new">Create New Template</option>
                      {templates.filter(t => editingTemplateId ? t.id !== editingTemplateId : true).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {moveCopyDestinationTemplateId === 'new' && (
                      <input
                        type="text"
                        value={moveCopyNewTemplateName}
                        onChange={(e) => setMoveCopyNewTemplateName(e.target.value)}
                        placeholder="New template name..."
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid #4A90E2',
                          outline: 'none',
                          background: '#141414',
                          color: '#eaeaea',
                          fontFamily: FONT_FAMILY,
                          fontSize: '13px',
                          marginTop: '8px'
                        }}
                      />
                    )}
                  </div>
                )}

                {moveCopyType === 'category' && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '6px', color: '#aaa' }}>Destination Space</div>
                    <select
                      value={moveCopyDestinationModuleId || ''}
                      onChange={(e) => {
                        setMoveCopyDestinationModuleId(e.target.value);
                        setMoveCopyNewModuleName('');
                        setMoveCopyNewCategoryName('');
                      }}
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
                      {modules.filter(m => m.id !== selectedModuleId).map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    {moveCopyDestinationModuleId === 'new' && (
                      <input
                        type="text"
                        value={moveCopyNewModuleName}
                        onChange={(e) => setMoveCopyNewModuleName(e.target.value)}
                        placeholder="New module name..."
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid #4A90E2',
                          outline: 'none',
                          background: '#141414',
                          color: '#eaeaea',
                          fontFamily: FONT_FAMILY,
                          fontSize: '13px',
                          marginTop: '8px'
                        }}
                      />
                    )}
                    {shouldShowRenameInput && (
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 500, color: '#aaa' }}>
                          New category name{hasCategoryNameConflict ? ' (required to resolve duplicate)' : ''}
                        </label>
                        <input
                          type="text"
                          value={moveCopyNewCategoryName}
                          onChange={(e) => setMoveCopyNewCategoryName(e.target.value)}
                          placeholder={moveCopyMode === 'copy'
                            ? 'Name to use for the copied category...'
                            : 'New name before moving into destination module...'}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: '6px',
                            border: '1px solid #333',
                            outline: 'none',
                            background: '#141414',
                            color: '#eaeaea',
                            fontFamily: FONT_FAMILY,
                            fontSize: '13px'
                          }}
                        />
                        {moveCopyMode === 'copy' && (
                          <div style={{ fontSize: '11px', color: '#6f6f6f' }}>
                            Only the copied category uses this name; the original keeps its current name.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #2a2a2a' }}>
                  <button
                    onClick={() => {
                      setIsMoveCopyModalOpen(false);
                      setMoveCopyDestinationTemplateId(null);
                      setMoveCopyDestinationModuleId(null);
                      setMoveCopyDestinationCategoryId(null);
                      setMoveCopyNewTemplateName('');
                      setMoveCopyNewModuleName('');
                      setMoveCopyNewCategoryName('');
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={executeMoveCopy}
                    className="btn btn-primary"
                    disabled={
                      (moveCopyType === 'module' && !moveCopyDestinationTemplateId) ||
                      (moveCopyType === 'module' && moveCopyDestinationTemplateId === 'new' && !moveCopyNewTemplateName.trim()) ||
                      (moveCopyType === 'category' && !moveCopyDestinationModuleId) ||
                      (moveCopyType === 'category' && moveCopyDestinationModuleId === 'new' && !moveCopyNewModuleName.trim())
                    }
                    style={{ padding: '8px 16px', borderRadius: '6px', fontSize: '13px' }}
                  >
                    {moveCopyMode === 'move' ? 'Move' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {
          isMoveModalOpen && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999
            }}>
              <div style={{
                width: '560px',
                background: '#1f1f1f',
                color: '#eaeaea',
                borderRadius: '16px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
                border: '1px solid #2a2a2a',
                padding: '24px'
              }}>
                <div style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  textAlign: 'center',
                  marginBottom: '20px'
                }}>Move {selectedIds.length} document(s)</div>

                {/* Only show "Move to Documents" option when in projectFiles context */}
                {getCurrentContextKey() === 'projectFiles' && (
                  <>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Move to Documents</div>
                    <button
                      onClick={() => handleMoveToProject(null, false, true)}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        background: '#28A745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        marginBottom: '20px',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#218838';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#28A745';
                      }}
                    >
                      <Icon name="document" size={14} style={{ marginRight: '6px' }} /> Move to Documents Tab
                    </button>
                    <div style={{
                      borderTop: '1px solid #3a3a3a',
                      paddingTop: '20px',
                      marginBottom: '20px'
                    }}></div>
                  </>
                )}

                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Move to existing project</div>
                {(() => {
                  // Filter out current project when in projectFiles context
                  const availableProjects = getCurrentContextKey() === 'projectFiles'
                    ? projects.filter(p => p.id !== selectedProjectId)
                    : projects;

                  return availableProjects.length === 0 ? (
                    <div style={{ color: '#888', fontSize: '13px', marginBottom: '20px', fontStyle: 'italic' }}>
                      {getCurrentContextKey() === 'projectFiles' ? 'No other projects available' : 'No existing projects'}
                    </div>
                  ) : (
                    <div style={{ maxHeight: '200px', overflow: 'auto', marginBottom: '20px' }}>
                      {availableProjects.map(proj => (
                        <button
                          key={proj.id}
                          onClick={() => handleMoveToProject(proj.id, false)}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            background: '#2a2a2a',
                            color: '#eaeaea',
                            border: '1px solid #3a3a3a',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            marginBottom: '8px',
                            textAlign: 'left',
                            transition: 'all 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#4A90E2';
                            e.currentTarget.style.borderColor = '#4A90E2';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#2a2a2a';
                            e.currentTarget.style.borderColor = '#3a3a3a';
                          }}
                        >
                          <div style={{ fontSize: '14px', fontWeight: 600 }}>{proj.name}</div>
                          <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                            {(allDocuments || []).filter(d => d.project_id === proj.id).length} file(s)
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                })()}

                <div style={{
                  borderTop: '1px solid #3a3a3a',
                  paddingTop: '20px',
                  marginBottom: '20px'
                }}></div>

                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Create new project</div>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name"
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    border: '1px solid #333',
                    outline: 'none',
                    background: '#141414',
                    color: '#eaeaea',
                    fontFamily: FONT_FAMILY,
                    marginBottom: '18px'
                  }}
                />

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setIsMoveModalOpen(false); setProjectName(''); }}
                    className="btn btn-secondary btn-md"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleMoveToProject(null, true)}
                    className="btn btn-primary btn-md"
                    disabled={!projectName.trim()}
                  >
                    Create & Move
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {/* Content Section */}
        <div
          onClick={handleContainerClick}
          style={{
            flex: 1,
            padding: '32px',
            overflow: 'auto',
            background: '#1E1E1E'
          }}>
          {/* Empty State switching */}
          {activeSection === 'documents' && sortedDocuments.length === 0 ? (
            <div style={{
              background: 'transparent',
              borderRadius: '12px',
              padding: '80px 60px',
              textAlign: 'center',
              color: '#9A9A9A'
            }}>
              <div style={{ display: 'block', marginBottom: '24px', opacity: 0.6 }}>
                <Icon name="document" size={64} />
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                margin: '0 0 8px 0',
                color: '#FFFFFF'
              }}>
                No documents yet
              </h3>
              <p style={{ fontSize: '14px', color: '#9A9A9A', margin: 0 }}>
                Upload your first PDF to get started
              </p>
            </div>
          ) : activeSection === 'projects' && !selectedProjectId && sortedProjects.length === 0 ? (
            <div style={{
              background: 'transparent',
              borderRadius: '12px',
              padding: '80px 60px',
              textAlign: 'center',
              color: '#9A9A9A'
            }}>
              <div style={{ display: 'block', marginBottom: '24px', opacity: 0.6 }}>
                <Icon name="folder" size={64} />
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                margin: '0 0 8px 0',
                color: '#FFFFFF'
              }}>
                No projects yet
              </h3>
              <p style={{ fontSize: '14px', color: '#9A9A9A', margin: 0 }}>
                Create your first project to organize PDFs
              </p>
            </div>
          ) : activeSection === 'projects' && selectedProjectId && (!supabaseDocuments || supabaseDocuments.length === 0) ? (
            <div style={{
              background: 'transparent',
              borderRadius: '12px',
              padding: '80px 60px',
              textAlign: 'center',
              color: '#9A9A9A'
            }}>
              <Icon name="document" size={48} />
              <h3 style={{ fontSize: '18px', fontWeight: '500', margin: '16px 0 8px', color: '#666' }}>No files in this project</h3>
              <p style={{ fontSize: '14px' }}>Add PDFs to this project from the create project dialog</p>
            </div>
          ) : activeSection === 'templates' && !selectedTemplateId && sortedTemplates.length === 0 ? (
            <div style={{
              background: 'transparent',
              borderRadius: '12px',
              padding: '80px 60px',
              textAlign: 'center',
              color: '#9A9A9A'
            }}>
              <div style={{ display: 'block', marginBottom: '24px', opacity: 0.6 }}>
                <Icon name="template" size={64} />
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                margin: '0 0 8px 0',
                color: '#FFFFFF'
              }}>
                No templates yet
              </h3>
              <p style={{ fontSize: '14px', color: '#9A9A9A', margin: 0 }}>
                Create a template to reuse annotations and layouts
              </p>
            </div>
          ) : activeSection === 'templates' && selectedTemplateId && (templates.find(t => t.id === selectedTemplateId)?.pdfs || []).length === 0 ? (
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '60px',
              textAlign: 'center',
              color: '#999'
            }}>
              <Icon name="document" size={48} />
              <h3 style={{ fontSize: '18px', fontWeight: '500', margin: '16px 0 8px', color: '#666' }}>No files in this template</h3>
              <p style={{ fontSize: '14px' }}>Add PDFs to this template to start editing</p>
            </div>
          ) : viewMode === 'grid' ? (
            <div
              onClick={handleContainerClick}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '12px'
              }}>
              {(activeSection === 'documents' ? sortedDocuments : activeSection === 'projects' ? (selectedProjectId ? (supabaseDocuments || []).map(doc => ({
                id: doc.id,
                name: doc.name,
                size: doc.file_size || 0,
                uploadedAt: doc.created_at || doc.updated_at,
                type: 'application/pdf',
                filePath: doc.file_path,
                projectId: doc.project_id
              })) : sortedProjects) : (selectedTemplateId ? (templates.find(t => t.id === selectedTemplateId)?.pdfs || []) : sortedTemplates)).filter(item => {
                if (!searchQuery) return true;
                if (activeSection === 'projects' && !selectedProjectId) {
                  return item.name.toLowerCase().includes(searchQuery.toLowerCase());
                }
                if (activeSection === 'templates' && !selectedTemplateId) {
                  return (item.name || '').toLowerCase().includes(searchQuery.toLowerCase());
                }
                return (item.name || '').toLowerCase().includes(searchQuery.toLowerCase());
              }).map(item => (
                activeSection === 'documents' ? (
                  <div
                    key={item.id}
                    onClick={(e) => {
                      if (isSelectionMode) {
                        // Prevent default behavior in selection mode
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelectItem(item.id);
                      } else {
                        handleDocumentClick(item);
                      }
                    }}
                    style={{
                      background: '#252525',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35)';
                      e.currentTarget.style.borderColor = '#4A90E2';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
                      e.currentTarget.style.borderColor = '#333';
                    }}
                  >
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectItem(item.id, e);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: 'absolute', right: '6px', top: '6px', zIndex: 10 }}
                      />
                    )}
                    <PDFThumbnail dataUrl={item.dataUrl} filePath={item.filePath} docId={item.id} getDocumentUrl={getDocumentUrl} downloadDocument={downloadFromStorage} />
                    <div style={{ textAlign: 'center', width: '100%' }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: '500',
                        color: '#eaeaea',
                        marginBottom: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>{item.name}</div>
                      <div style={{ fontSize: '9px', color: '#888' }}>{formatFileSize(item.size)}</div>
                      <div style={{ fontSize: '9px', color: '#888', marginTop: '1px' }}>{formatDate(item.uploadedAt)}</div>
                    </div>
                  </div>
                ) : activeSection === 'projects' && !selectedProjectId ? (
                  <div
                    key={item.id}
                    onClick={() => (isSelectionMode ? toggleSelectItem(item.id) : setSelectedProjectId(item.id))}
                    style={{
                      background: '#252525',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#4A90E2';
                      e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#333';
                      e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
                    }}
                  >
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={(e) => toggleSelectItem(item.id, e)}
                        style={{ position: 'absolute', right: '6px', top: '6px' }}
                      />
                    )}
                    <Icon name="folder" size={24} color="#FFFFFF" />
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#eaeaea', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', width: '100%' }}>{item.name}</div>
                    <div style={{ fontSize: '9px', color: '#888', marginTop: '2px', textAlign: 'center' }}>{(allDocuments || []).filter(d => d.project_id === item.id).length} files • {formatDate(item.created_at || item.createdAt)}</div>
                  </div>
                ) : activeSection === 'projects' && selectedProjectId ? (
                  <div
                    key={item.id}
                    onClick={(e) => {
                      if (isSelectionMode) {
                        // Prevent default behavior in selection mode
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelectItem(item.id);
                      } else {
                        handleDocumentClick(item);
                      }
                    }}
                    style={{
                      background: '#252525',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35)';
                      e.currentTarget.style.borderColor = '#4A90E2';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
                      e.currentTarget.style.borderColor = '#333';
                    }}
                  >
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectItem(item.id, e);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: 'absolute', right: '6px', top: '6px', zIndex: 10 }}
                      />
                    )}
                    <PDFThumbnail dataUrl={item.dataUrl} filePath={item.filePath} docId={item.id} getDocumentUrl={getDocumentUrl} downloadDocument={downloadFromStorage} />
                    <div style={{ textAlign: 'center', width: '100%' }}>
                      <div style={{ fontSize: '11px', fontWeight: '500', color: '#eaeaea', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      <div style={{ fontSize: '9px', color: '#888' }}>{formatFileSize(item.size || item.file_size || 0)}</div>
                      <div style={{ fontSize: '9px', color: '#888', marginTop: '1px' }}>{formatDate(item.uploadedAt || item.created_at || item.updated_at)}</div>
                    </div>
                  </div>
                ) : activeSection === 'templates' && !selectedTemplateId ? (
                  <div
                    key={item.id}
                    onClick={() => (isSelectionMode ? toggleSelectItem(item.id) : openEditTemplateModal(item.id))}
                    style={{
                      background: '#252525',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#4A90E2';
                      e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#333';
                      e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
                    }}
                  >
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={(e) => toggleSelectItem(item.id, e)}
                        style={{ position: 'absolute', right: '6px', top: '6px' }}
                      />
                    )}
                    <Icon name="template" size={24} color="#FFFFFF" />
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#eaeaea', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', width: '100%' }}>{item.name || 'Untitled Template'}</div>
                    <div style={{ fontSize: '9px', color: '#888', marginTop: '2px', textAlign: 'center' }}>{formatDate(item.createdAt || new Date().toISOString())}</div>
                  </div>
                ) : activeSection === 'templates' && selectedTemplateId ? (
                  <div
                    key={item.id}
                    onClick={(e) => {
                      if (isSelectionMode) {
                        // Prevent default behavior in selection mode
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelectItem(item.id);
                      } else {
                        handleDocumentClick(item);
                      }
                    }}
                    style={{
                      background: '#252525',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.3s',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,0.35)';
                      e.currentTarget.style.borderColor = '#4A90E2';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
                      e.currentTarget.style.borderColor = '#333';
                    }}
                  >
                    {isSelectionMode && (
                      <input
                        type="checkbox"
                        checked={isItemSelected(item.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelectItem(item.id, e);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: 'absolute', right: '6px', top: '6px', zIndex: 10 }}
                      />
                    )}
                    <PDFThumbnail dataUrl={item.dataUrl} filePath={item.filePath} docId={item.id} getDocumentUrl={getDocumentUrl} downloadDocument={downloadFromStorage} />
                    <div style={{ textAlign: 'center', width: '100%' }}>
                      <div style={{ fontSize: '11px', fontWeight: '500', color: '#eaeaea', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                      <div style={{ fontSize: '9px', color: '#888' }}>{formatFileSize(item.size)}</div>
                      <div style={{ fontSize: '9px', color: '#888', marginTop: '1px' }}>{formatDate(item.uploadedAt)}</div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={item.id}
                    style={{
                      background: '#252525',
                      border: '1px solid #333',
                      borderRadius: '8px',
                      padding: '8px',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Icon name="template" size={24} color="#FFFFFF" />
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#eaeaea', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', width: '100%' }}>{item.name || 'Untitled Template'}</div>
                    <div style={{ fontSize: '9px', color: '#888', marginTop: '2px', textAlign: 'center' }}>{formatDate(item.createdAt || new Date().toISOString())}</div>
                  </div>
                )
              ))}
            </div>
          ) : (
            <div
              onClick={handleContainerClick}
              style={{
                background: '#2a2a2a',
                borderRadius: '12px',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
              }}>
              {activeSection === 'documents' ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#333' }}>
                      {isSelectionMode && (<th style={{ width: '44px' }}></th>)}
                      <th onClick={() => handleSort('name')} style={{
                        padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf', cursor: 'pointer', userSelect: 'none'
                      }}>
                        Document Name {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('size')} style={{
                        padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf', cursor: 'pointer', userSelect: 'none'
                      }}>
                        Size {sortConfig.key === 'size' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th onClick={() => handleSort('uploadedAt')} style={{
                        padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf', cursor: 'pointer', userSelect: 'none'
                      }}>
                        Last Modified {sortConfig.key === 'uploadedAt' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      {isSelectionMode && <th style={{ padding: '12px 16px', width: '60px' }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDocuments.map(doc => (
                      <tr
                        key={doc.id}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSelectItem(doc.id);
                          } else {
                            handleDocumentClick(doc);
                          }
                        }}
                        style={{ borderTop: '1px solid #3a3a3a', cursor: 'pointer', transition: 'background 0.2s', background: 'transparent' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        {isSelectionMode && (
                          <td style={{ padding: '14px 8px' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isItemSelected(doc.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectItem(doc.id, e);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px', fontSize: '14px', color: '#eaeaea', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Icon name="document" size={20} />
                          {doc.name}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatFileSize(doc.size)}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatDate(doc.uploadedAt)}</td>
                        {isSelectionMode && (
                          <td style={{ padding: '14px 16px' }}>
                            <button
                              onClick={(e) => handleDeleteDocument(doc.id, e)}
                              className="btn btn-danger btn-sm"
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeSection === 'projects' && !selectedProjectId ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#333' }}>
                      {isSelectionMode && (<th style={{ width: '44px' }}></th>)}
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Project</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Files</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProjects.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(p => (
                      <tr key={p.id} onClick={() => (isSelectionMode ? toggleSelectItem(p.id) : setSelectedProjectId(p.id))} style={{ borderTop: '1px solid #3a3a3a', cursor: 'pointer', background: 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.background = '#333'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        {isSelectionMode && (
                          <td style={{ padding: '14px 8px' }}>
                            <input type="checkbox" checked={isItemSelected(p.id)} onChange={(e) => toggleSelectItem(p.id, e)} />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px', fontSize: '14px', color: '#eaeaea', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Icon name="folder" size={20} />
                          {p.name}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{(allDocuments || []).filter(d => d.project_id === p.id).length}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatDate(p.created_at || p.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeSection === 'projects' && selectedProjectId ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#333' }}>
                      {isSelectionMode && (<th style={{ width: '44px' }}></th>)}
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>File</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Size</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(supabaseDocuments || []).filter(f => !searchQuery || (f.name || '').toLowerCase().includes(searchQuery.toLowerCase())).map(f => (
                      <tr
                        key={f.id}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSelectItem(f.id);
                          } else {
                            handleDocumentClick(f);
                          }
                        }}
                        style={{ borderTop: '1px solid #3a3a3a', cursor: 'pointer', background: 'transparent' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        {isSelectionMode && (
                          <td style={{ padding: '14px 8px' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isItemSelected(f.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectItem(f.id, e);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px', fontSize: '14px', color: '#eaeaea', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Icon name="document" size={20} />
                          {f.name}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatFileSize(f.file_size || 0)}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatDate(f.created_at || f.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : activeSection === 'templates' && !selectedTemplateId ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#333' }}>
                      {isSelectionMode && (<th style={{ width: '44px' }}></th>)}
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Template</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Categories</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTemplates.filter(t => !searchQuery || (t.name || '').toLowerCase().includes(searchQuery.toLowerCase())).map(t => (
                      <tr key={t.id} onClick={() => (isSelectionMode ? toggleSelectItem(t.id) : openEditTemplateModal(t.id))} style={{ borderTop: '1px solid #3a3a3a', cursor: 'pointer', background: 'transparent' }} onMouseEnter={(e) => e.currentTarget.style.background = '#333'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        {isSelectionMode && (
                          <td style={{ padding: '14px 8px' }}>
                            <input type="checkbox" checked={isItemSelected(t.id)} onChange={(e) => toggleSelectItem(t.id, e)} />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px', fontSize: '14px', color: '#eaeaea', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Icon name="template" size={24} />
                          {t.name || 'Untitled Template'}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{
                          (() => {
                            const uniqueCategoryNames = new Set();
                            const containers = (t.modules || t.spaces || []);
                            containers.forEach(container => {
                              (container.categories || []).forEach(cat => {
                                if (cat?.name) {
                                  uniqueCategoryNames.add(cat.name);
                                }
                              });
                            });
                            return uniqueCategoryNames.size;
                          })()
                        }</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatDate(t.createdAt || new Date().toISOString())}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#333' }}>
                      {isSelectionMode && (<th style={{ width: '44px' }}></th>)}
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>File</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Size</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#cfcfcf' }}>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(templates.find(t => t.id === selectedTemplateId)?.pdfs || []).filter(f => !searchQuery || (f.name || '').toLowerCase().includes(searchQuery.toLowerCase())).map(f => (
                      <tr
                        key={f.id}
                        onClick={(e) => {
                          if (isSelectionMode) {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleSelectItem(f.id);
                          } else {
                            handleDocumentClick(f);
                          }
                        }}
                        style={{ borderTop: '1px solid #3a3a3a', cursor: 'pointer', background: 'transparent' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        {isSelectionMode && (
                          <td style={{ padding: '14px 8px' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isItemSelected(f.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectItem(f.id, e);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                        )}
                        <td style={{ padding: '14px 16px', fontSize: '14px', color: '#eaeaea', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Icon name="document" size={20} />
                          {f.name}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatFileSize(f.size)}</td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#9a9a9a' }}>{formatDate(f.uploadedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div >

      {/* Account Settings Modal */}
      < AccountSettings
        isOpen={showAccountSettings}
        onClose={() => setShowAccountSettings(false)}
      />
    </div >
  );
});

// PDF Viewer Component with improved typography
function PDFViewer({ pdfFile, pdfFilePath, onBack, tabId, onPageDrop, onUpdatePDFFile, onRequestCreateTemplate, initialViewState, onViewStateChange, templates = [], onTemplatesChange, user, isMSAuthenticated, msLogin, graphClient, msAccount, ballInCourtEntities, setBallInCourtEntities, onUnsavedAnnotationsChange }) {
  const containerRef = useRef();
  const contentRef = useRef();
  const pageContainersRef = useRef({});
  const canvasRef = useRef({});

  const renderTasksRef = useRef({});
  const isNavigatingRef = useRef(false);
  const isZoomingRef = useRef(false);
  const observerRef = useRef(null);
  const targetPageRef = useRef(null);
  const [showLocateModal, setShowLocateModal] = useState(false);
  const [locateSearchQuery, setLocateSearchQuery] = useState('');
  const scrollDataRef = useRef({ left: 0, top: 0 });
  const pageInputRef = useRef(null);
  const zoomInputRef = useRef(null);
  const pageRenderCacheRef = useRef(new PageRenderCache(100)); // Cache up to 100 pages
  const preRenderQueueRef = useRef(new Set()); // Track pages being pre-rendered
  const lastScaleRef = useRef(1.0); // Track last scale for cache management

  const { uploadDataFile, downloadDocument: downloadFromStorage } = useStorage();
  const { updateDocument: updateSupabaseDocument } = useDocuments(null);
  const { features } = useAuth();

  const initialZoomPrefsRef = useRef(null);
  if (!initialZoomPrefsRef.current) {
    const storedPrefs = loadZoomPreferences();
    let sessionManualScale = null;
    if (typeof window !== 'undefined') {
      try {
        const sessionValue = window.sessionStorage.getItem(MANUAL_ZOOM_SESSION_KEY);
        if (sessionValue) {
          const parsed = parseFloat(sessionValue);
          if (!Number.isNaN(parsed)) {
            sessionManualScale = clampScale(parsed);
          }
        }
      } catch (error) {
        console.warn('[PDFViewer] Unable to read session manual zoom level:', error);
      }
    }
    initialZoomPrefsRef.current = {
      mode: storedPrefs.mode,
      manualScale: sessionManualScale ?? storedPrefs.manualScale
    };
  }
  const initialZoomPreferences = initialZoomPrefsRef.current;

  // PDF state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(initialViewState?.pageNum || 1);
  const [pageInputValue, setPageInputValue] = useState(String(initialViewState?.pageNum || 1));
  const [isPageInputDirty, setIsPageInputDirty] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(initialViewState?.scale || initialZoomPreferences.manualScale);
  const [zoomMode, setZoomMode] = useState(initialViewState?.zoomMode || initialZoomPreferences.mode);
  const [manualZoomScale, setManualZoomScale] = useState(initialViewState?.scale || initialZoomPreferences.manualScale);
  const [zoomInputValue, setZoomInputValue] = useState(String(Math.round((initialViewState?.scale || initialZoomPreferences.manualScale) * 100)));
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [scrollMode, setScrollMode] = useState('continuous');
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [renderedPages, setRenderedPages] = useState(new Set());
  const [mountedPages, setMountedPages] = useState(new Set([1])); // Track which pages should be mounted (DOM created)
  const [pageHeights, setPageHeights] = useState({});
  const [pageSizes, setPageSizes] = useState({}); // { [page]: { width, height } }
  const [canPan, setCanPan] = useState(false);
  const [isLoadingPDF, setIsLoadingPDF] = useState(true);

  // Annotation tools state
  const [activeTool, setActiveTool] = useState('pan');
  const [strokeColor, setStrokeColor] = useState('#ff0000');
  const [strokeOpacity, setStrokeOpacity] = useState(100);
  const [fillColor, setFillColor] = useState('#ff0000');
  const [fillOpacity, setFillOpacity] = useState(100);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [annotationsByPage, setAnnotationsByPage] = useState({}); // Fabric.js canvas annotations
  const [unsupportedAnnotationTypes, setUnsupportedAnnotationTypes] = useState([]); // PDF annotation types we can't edit
  const [showUnsupportedNotice, setShowUnsupportedNotice] = useState(false); // Show notification about unsupported annotations
  const [annotationLayerVisibility, setAnnotationLayerVisibility] = useState({
    'native': true,
    'pdf-annotations': true
  }); // Layer visibility toggles
  const [eraserMode, setEraserMode] = useState(() => {
    try {
      const saved = localStorage.getItem('eraserMode');
      return saved || 'partial';
    } catch (e) {
      return 'partial';
    }
  }); // 'partial' | 'entire'
  const [eraserSize, setEraserSize] = useState(20); // Default 20px radius
  const [eraserCursorPos, setEraserCursorPos] = useState({ x: 0, y: 0, visible: false });
  const [showEraserMenu, setShowEraserMenu] = useState(false);
  const eraserMenuRef = useRef(null);

  // Spacebar Pan state
  const previousToolRef = useRef(null);
  const isPanningRef = useRef(false);
  // Track canvas mouse down for pan tool empty space panning
  const canvasMouseDownRef = useRef(null);

  const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
  const [showAnnotationColorPicker, setShowAnnotationColorPicker] = useState(false);
  const [annotationColorPickerTab, setAnnotationColorPickerTab] = useState('stroke'); // 'stroke' | 'fill'
  const [annotationColorPickerMode, setAnnotationColorPickerMode] = useState('grid'); // 'grid' | 'advanced'
  const [annotationTempColor, setAnnotationTempColor] = useState(null); // Temporary color while picking
  const [annotationOpacityInputValue, setAnnotationOpacityInputValue] = useState(null);
  const [annotationOpacityInputFocused, setAnnotationOpacityInputFocused] = useState(false);
  const [pageObjects, setPageObjects] = useState({}); // Store PDF page objects for text layer
  const [newHighlightsByPage, setNewHighlightsByPage] = useState({}); // { [pageNumber]: [{x, y, width, height}] }
  const [highlightsToRemoveByPage, setHighlightsToRemoveByPage] = useState({}); // { [pageNumber]: [{x, y, width, height}] }

  // Search state
  const [searchResults, setSearchResults] = useState([]); // Array of search match results
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1); // Current active match index
  const searchZoomLevelRef = useRef(null); // Store zoom level before search zoom
  const isNavigatingToMatchRef = useRef(false); // Flag to prevent recursive navigation

  // Survey/Template state
  const [activeCategoryDropdown, setActiveCategoryDropdown] = useState(null); // 'draw' | 'shape' | 'review' | 'survey'
  const [showSurveyPanel, setShowSurveyPanel] = useState(false);
  const [isSurveyPanelCollapsed, setIsSurveyPanelCollapsed] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(true);
  const [showTemplateSelection, setShowTemplateSelection] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedModuleId, setSelectedModuleId] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);

  const [lastDrawTool, setLastDrawTool] = useState(() => {
    try {
      return localStorage.getItem('lastDrawTool') || 'pen';
    } catch (e) {
      return 'pen';
    }
  });
  const [lastShapeTool, setLastShapeTool] = useState(() => {
    try {
      return localStorage.getItem('lastShapeTool') || 'rect';
    } catch (e) {
      return 'rect';
    }
  });
  const [lastReviewTool, setLastReviewTool] = useState(() => {
    try {
      return localStorage.getItem('lastReviewTool') || 'text';
    } catch (e) {
      return 'text';
    }
  });

  // Track last used tool for each category to keep icons persistent
  useEffect(() => {
    if (['pen', 'highlighter', 'eraser'].includes(activeTool)) {
      setLastDrawTool(activeTool);
      try {
        localStorage.setItem('lastDrawTool', activeTool);
      } catch (e) { }
    } else if (['rect', 'ellipse', 'line', 'arrow'].includes(activeTool)) {
      setLastShapeTool(activeTool);
      try {
        localStorage.setItem('lastShapeTool', activeTool);
      } catch (e) { }
    } else if (['text', 'note', 'underline', 'strikeout', 'squiggly'].includes(activeTool)) {
      setLastReviewTool(activeTool);
      try {
        localStorage.setItem('lastReviewTool', activeTool);
      } catch (e) { }
    }
  }, [activeTool]);

  // Close eraser menu when tool changes
  useEffect(() => {
    if (activeTool !== 'eraser') {
      setShowEraserMenu(false);
    }
  }, [activeTool]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Close export menu
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setShowExportMenu(false);
      }
      // Close eraser menu
      // Don't close if clicking on the eraser button itself (let the button handler manage it)
      const isEraserButton = event.target.closest('[data-eraser-button]');
      if (eraserMenuRef.current && !eraserMenuRef.current.contains(event.target) && !isEraserButton) {
        setShowEraserMenu(false);
      }
    };

    if (showExportMenu || showEraserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportMenu, showEraserMenu]);

  // Persist eraser mode
  useEffect(() => {
    try {
      localStorage.setItem('eraserMode', eraserMode);
    } catch (e) {
      console.error('Error saving eraser mode:', e);
    }
  }, [eraserMode]);

  // Spacebar Pan feature
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Only handle space key
      if (e.key !== ' ' && e.code !== 'Space') {
        return;
      }

      // Check if user is focused on an input, textarea, or contenteditable element
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.contentEditable === 'true'
      );

      if (isInputFocused) {
        return; // Don't trigger tool switch if focused on input
      }

      // CRITICAL: Prevent default browser scrolling behavior BEFORE any early returns
      // This must happen even when e.repeat is true to prevent continuous scrolling
      e.preventDefault();
      e.stopImmediatePropagation(); // Stop all other handlers from processing this event

      // Prevent re-firing tool switch logic if key is being held (event.repeat)
      // But we still prevent default above to stop scrolling
      if (e.repeat) {
        return;
      }

      // Only switch if not already panning
      if (!isPanningRef.current) {
        // Save current tool and switch to pan
        previousToolRef.current = activeTool;
        isPanningRef.current = true;
        setActiveTool('pan');
      }
    };

    const handleKeyUp = (e) => {
      // Only handle space key
      if (e.key !== ' ' && e.code !== 'Space') {
        return;
      }

      // Restore previous tool if panning was active
      if (isPanningRef.current) {
        isPanningRef.current = false;
        if (previousToolRef.current !== null) {
          setActiveTool(previousToolRef.current);
          previousToolRef.current = null;
        }
      }
    };

    const handleWindowBlur = () => {
      // Reset panning state if window loses focus (e.g., Alt-Tab)
      if (isPanningRef.current) {
        isPanningRef.current = false;
        if (previousToolRef.current !== null) {
          setActiveTool(previousToolRef.current);
          previousToolRef.current = null;
        }
      }
    };

    // Attach event listeners to document for global key handling
    // Use { capture: true, passive: false } to ensure preventDefault works properly
    // Capture phase ensures we catch the event before any other handlers
    document.addEventListener('keydown', handleKeyDown, { capture: true, passive: false });
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [activeTool]);

  const [pendingLocationItem, setPendingLocationItem] = useState(null);
  const topToolbarRef = useRef(null);
  const bottomToolbarRef = useRef(null);
  const statusBarRef = useRef(null);
  const middleAreaRef = useRef(null);
  const { updateTemplate: updateSupabaseTemplate } = useTemplates();
  const hasSwitchedToHighlightRef = useRef(false);
  const [toolbarHeights, setToolbarHeights] = useState({ top: 56, bottom: 56 });
  const [middleAreaBounds, setMiddleAreaBounds] = useState({ top: 56, height: 500 });
  const appTemplates = templates;
  const handleTemplatesChange = onTemplatesChange;

  // Restore scroll position when PDF loads
  useEffect(() => {
    if (initialViewState && containerRef.current) {
      // Small delay to ensure content is rendered
      setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollLeft = initialViewState.scrollLeft || 0;
          containerRef.current.scrollTop = initialViewState.scrollTop || 0;
        }
      }, 100);
    }
  }, [initialViewState, pdfDoc]); // Run when PDF doc is loaded

  // Emit view state changes
  useEffect(() => {
    if (!onViewStateChange || !containerRef.current) return;

    const handleScroll = () => {
      if (containerRef.current) {
        onViewStateChange({
          pageNum,
          scale,
          zoomMode,
          scrollLeft: containerRef.current.scrollLeft,
          scrollTop: containerRef.current.scrollTop
        });
      }
    };

    // Debounce scroll updates
    let timeoutId;
    const debouncedHandleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleScroll, 500);
    };

    const container = containerRef.current;
    container.addEventListener('scroll', debouncedHandleScroll);

    // Also emit on page/zoom changes immediately
    handleScroll();

    return () => {
      container.removeEventListener('scroll', debouncedHandleScroll);
      clearTimeout(timeoutId);
    };
  }, [pageNum, scale, zoomMode, onViewStateChange]);

  // Legacy state (to be migrated)
  const [surveyResponses, setSurveyResponses] = useState({}); // { [itemId]: { selection: 'Y'|'N'|'N/A', note: { text, photos, videos } } }
  const [noteDialogOpen, setNoteDialogOpen] = useState(null); // null or itemId
  const [noteDialogContent, setNoteDialogContent] = useState({ text: '', photos: [], videos: [] });
  const [pendingHighlight, setPendingHighlight] = useState(null); // { pageNumber, x, y, width, height, id }
  const [showSpaceSelection, setShowSpaceSelection] = useState(false);
  const [highlightAnnotations, setHighlightAnnotations] = useState({}); // { [highlightId]: { pageNumber, bounds, categoryId, spaceId, checklistResponses: { [itemId]: { selection, note } } } }
  const [expandedCategories, setExpandedCategories] = useState({}); // { [categoryId]: boolean }
  const [expandedHighlights, setExpandedHighlights] = useState({}); // { [highlightId]: boolean }
  const [selectedCategoryId, setSelectedCategoryId] = useState(null); // Category selected for highlighting
  const [selectedSpaceId, setSelectedSpaceId] = useState(null); // Currently selected space for survey interactions
  const [pendingHighlightName, setPendingHighlightName] = useState(null); // { highlight, categoryId } when prompting for name
  const [highlightNameInput, setHighlightNameInput] = useState(''); // Temporary name input value
  const [pendingBallInCourtSelection, setPendingBallInCourtSelection] = useState(null); // { highlight, categoryId } when prompting for Ball in Court entity

  // NEW: Item and Annotation system state
  const [pdfId, setPdfId] = useState(null);
  const [items, setItems] = useState({}); // { [itemId]: Item }
  const [annotations, setAnnotations] = useState({}); // { [annotationId]: Annotation }

  // Per-document, per-tool preferences hook
  const {
    toolPreferences,
    updateToolPreference,
    getToolPreference,
  } = useDocumentToolPreferences(pdfId, pdfFile?.id);

  // Input field state for stroke width (fixes "Sticky 1" bug)
  // Separate state allows input to be empty while typing
  const [strokeWidthInputValue, setStrokeWidthInputValue] = useState(String(strokeWidth));
  const [isStrokeWidthFocused, setIsStrokeWidthFocused] = useState(false);

  // Input field state for eraser size (similar to stroke width)
  const [eraserSizeInputValue, setEraserSizeInputValue] = useState(String(eraserSize));
  const [isEraserSizeFocused, setIsEraserSizeFocused] = useState(false);

  // Sync tool properties when activeTool or pdfId changes (load per-tool preferences)
  useEffect(() => {
    if (!pdfId) return;
    const toolPrefs = getToolPreference(activeTool);
    if (toolPrefs.strokeColor !== undefined) setStrokeColor(toolPrefs.strokeColor);
    if (toolPrefs.strokeOpacity !== undefined) setStrokeOpacity(toolPrefs.strokeOpacity);
    if (toolPrefs.fillColor !== undefined) setFillColor(toolPrefs.fillColor);
    if (toolPrefs.fillOpacity !== undefined) setFillOpacity(toolPrefs.fillOpacity);
    if (toolPrefs.strokeWidth !== undefined) {
      setStrokeWidth(toolPrefs.strokeWidth);
      if (!isStrokeWidthFocused) {
        setStrokeWidthInputValue(String(toolPrefs.strokeWidth));
      }
    }
  }, [activeTool, pdfId, toolPreferences]);

  // Sync strokeWidthInputValue when strokeWidth changes (but not while focused)
  useEffect(() => {
    if (!isStrokeWidthFocused) {
      setStrokeWidthInputValue(String(strokeWidth));
    }
  }, [strokeWidth, isStrokeWidthFocused]);

  // Sync eraserSizeInputValue when eraserSize changes (but not while focused)
  useEffect(() => {
    if (!isEraserSizeFocused) {
      setEraserSizeInputValue(String(eraserSize));
    }
  }, [eraserSize, isEraserSizeFocused]);

  // Handlers to update both local state AND persist to tool preferences
  const handleStrokeColorChange = useCallback((color) => {
    setStrokeColor(color);
    if (pdfId) updateToolPreference(activeTool, { strokeColor: color });
  }, [activeTool, pdfId, updateToolPreference]);

  const handleStrokeOpacityChange = useCallback((opacity) => {
    setStrokeOpacity(opacity);
    if (pdfId) updateToolPreference(activeTool, { strokeOpacity: opacity });
  }, [activeTool, pdfId, updateToolPreference]);

  const handleFillColorChange = useCallback((color) => {
    setFillColor(color);
    if (pdfId) updateToolPreference(activeTool, { fillColor: color });
  }, [activeTool, pdfId, updateToolPreference]);

  const handleFillOpacityChange = useCallback((opacity) => {
    setFillOpacity(opacity);
    if (pdfId) updateToolPreference(activeTool, { fillOpacity: opacity });
  }, [activeTool, pdfId, updateToolPreference]);

  const handleStrokeWidthChange = useCallback((width) => {
    setStrokeWidth(width);
    if (pdfId) updateToolPreference(activeTool, { strokeWidth: width });
  }, [activeTool, pdfId, updateToolPreference]);

  // Handle width input changes (allows empty string while typing)
  const handleStrokeWidthInputChange = useCallback((e) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === '' || /^\d+$/.test(value)) {
      setStrokeWidthInputValue(value);
    }
  }, []);

  // Commit width value on blur (clamp to valid range)
  const handleStrokeWidthInputBlur = useCallback(() => {
    setIsStrokeWidthFocused(false);
    const parsed = parseInt(strokeWidthInputValue, 10);
    if (isNaN(parsed) || parsed < 1) {
      // Reset to minimum if empty or invalid
      setStrokeWidthInputValue('1');
      handleStrokeWidthChange(1);
    } else {
      const clamped = Math.min(Math.max(parsed, 1), 50);
      setStrokeWidthInputValue(String(clamped));
      handleStrokeWidthChange(clamped);
    }
  }, [strokeWidthInputValue, handleStrokeWidthChange]);

  // Handle eraser size input changes (allows empty string while typing)
  const handleEraserSizeInputChange = useCallback((e) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === '' || /^\d+$/.test(value)) {
      setEraserSizeInputValue(value);
    }
  }, []);

  // Commit eraser size value on blur (clamp to valid range)
  const handleEraserSizeInputBlur = useCallback(() => {
    setIsEraserSizeFocused(false);
    const parsed = parseInt(eraserSizeInputValue, 10);
    if (isNaN(parsed) || parsed < 1) {
      // Reset to minimum if empty or invalid
      setEraserSizeInputValue('1');
      setEraserSize(1);
    } else {
      const clamped = Math.min(Math.max(parsed, 1), 100);
      setEraserSizeInputValue(String(clamped));
      setEraserSize(clamped);
    }
  }, [eraserSizeInputValue]);

  // Item copy state (was transfer)
  const [transferState, setTransferState] = useState(null); // { mode: 'select'|'prompt'|'checklist', sourceSpaceId, items, destSpaceId }

  // Item selection state for Copy to Spaces feature
  const [copiedItemSelection, setCopiedItemSelection] = useState({}); // { [highlightId]: boolean }
  const [showCopyToSpacesModal, setShowCopyToSpacesModal] = useState(false);
  const [copyModeActive, setCopyModeActive] = useState(false); // Whether copy mode is enabled

  // Category-level selection state
  const [categorySelectModeActive, setCategorySelectModeActive] = useState(false); // Whether category-level select mode is enabled
  const [selectedCategories, setSelectedCategories] = useState({}); // { [categoryId]: boolean }
  const [categorySelectModeForCategory, setCategorySelectModeForCategory] = useState(null); // Category ID for which category select mode is active

  // Item-level selection state (within a category)
  const [itemSelectModeActive, setItemSelectModeActive] = useState({}); // { [categoryId]: boolean } - per-category item select mode
  const [selectedItemsInCategory, setSelectedItemsInCategory] = useState({}); // { [categoryId]: { [highlightId]: boolean } } - selected items per category

  // File watcher state
  const [fileWatcherActive, setFileWatcherActive] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState('');
  const fileWatcherCleanupRef = useRef(null);

  // Auto-push to Excel state
  const [autoPushToExcel, setAutoPushToExcel] = useState(false);
  const [lastPushMessage, setLastPushMessage] = useState('');
  const pushTimeoutRef = useRef(null);

  // Export/Sync modal states
  const [showExportLocationModal, setShowExportLocationModal] = useState(false);
  const [showMSLoginModal, setShowMSLoginModal] = useState(false);
  const [exportPendingData, setExportPendingData] = useState(null); // Store Excel data while waiting for user choice

  const zoomControllerRef = useRef(null);
  const zoomMenuRef = useRef(null);
  const zoomPreferencesRef = useRef(initialZoomPreferences);
  const scaleRef = useRef(initialZoomPreferences.manualScale);
  const pageNumRef = useRef(1);
  const pageSizesRef = useRef({});
  const manualZoomScaleRef = useRef(initialZoomPreferences.manualScale);

  const persistZoomPreferences = useCallback((overrides = {}) => {
    const merged = {
      ...zoomPreferencesRef.current,
      ...overrides
    };
    saveZoomPreferences(merged);
    zoomPreferencesRef.current = merged;
  }, []);

  const zoomDropdownLabel = useMemo(() => {
    if (zoomMode === ZOOM_MODES.MANUAL) {
      return `Manual ${Math.round((manualZoomScale || 1) * 100)}%`;
    }
    return ZOOM_MODE_LABELS[zoomMode] || 'Zoom Mode';
  }, [zoomMode, manualZoomScale]);

  const toggleZoomMenu = useCallback(() => {
    setIsZoomMenuOpen((prev) => !prev);
  }, []);

  const handleZoomModeSelect = useCallback((mode) => {
    const controller = zoomControllerRef.current;
    if (!controller) return;
    setIsZoomMenuOpen(false);
    if (mode === ZOOM_MODES.MANUAL) {
      controller.setMode(ZOOM_MODES.MANUAL, { scale: manualZoomScaleRef.current });
    } else {
      controller.setMode(mode);
    }
  }, []);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    pageNumRef.current = pageNum;
  }, [pageNum]);

  useEffect(() => {
    pageSizesRef.current = pageSizes;
  }, [pageSizes]);

  useEffect(() => {
    manualZoomScaleRef.current = manualZoomScale;
  }, [manualZoomScale]);

  useEffect(() => {
    zoomPreferencesRef.current = {
      mode: zoomMode,
      manualScale: manualZoomScale
    };
  }, [zoomMode, manualZoomScale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(MANUAL_ZOOM_SESSION_KEY, manualZoomScaleRef.current.toString());
    } catch (error) {
      console.warn('[PDFViewer] Unable to persist manual zoom level in sessionStorage:', error);
    }
  }, [manualZoomScale]);

  useEffect(() => {
    if (!isZoomMenuOpen) return;

    const handleClickOutside = (event) => {
      if (!zoomMenuRef.current) return;
      if (!zoomMenuRef.current.contains(event.target)) {
        setIsZoomMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsZoomMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isZoomMenuOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      zoomControllerRef.current?.applyZoom({ persist: false, force: true });
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      zoomControllerRef.current?.applyZoom({ persist: false, force: true });
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!pdfDoc) return;
    if (!zoomControllerRef.current) return;
    if (!pageSizes || Object.keys(pageSizes).length === 0) return;
    zoomControllerRef.current.applyZoom({ persist: false, force: true });
  }, [pdfDoc, pageSizes]);

  useEffect(() => {
    if (zoomMode !== ZOOM_MODES.MANUAL) {
      zoomControllerRef.current?.applyZoom({ persist: false, force: true });
    }
  }, [pageNum, zoomMode]);

  useEffect(() => {
    zoomControllerRef.current?.applyZoom({ persist: false, force: true });
  }, [tabId]);

  useEffect(() => {
    zoomControllerRef.current?.applyZoom({ persist: false, force: true });
  }, [scrollMode]);

  // Sidebar state: Pages, Bookmarks, Spaces
  const [pageNames, setPageNames] = useState({}); // { [pageNumber]: name }
  const [bookmarks, setBookmarks] = useState([]); // Array of { id, name, type: 'bookmark'|'folder', pageIds: [], parentId: null, children: [] }
  const [spaces, setSpaces] = useState([]); // Array of { id, name, assignedPages: [{ pageId, wholePageIncluded, regions: [] }] }
  const [activeSpaceId, setActiveSpaceId] = useState(null); // Currently active space for filtering
  const [showRegionSelection, setShowRegionSelection] = useState(false); // Show region selection tool
  const [regionSelectionPage, setRegionSelectionPage] = useState(null); // Page for region selection

  // Clipboard state for cut/copy operations
  const [clipboardPage, setClipboardPage] = useState(null);
  const [clipboardType, setClipboardType] = useState(null); // 'cut' | 'copy'

  // Page transformations state: { [pageNumber]: { rotation: 0|90|180|270, mirrorH: boolean, mirrorV: boolean } }
  const [pageTransformations, setPageTransformations] = useState({});

  // Helper function to get transform CSS for a page
  const getPageTransform = useCallback((pageNumber) => {
    const transform = pageTransformations[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
    const transforms = [];
    if (transform.rotation) {
      transforms.push(`rotate(${transform.rotation}deg)`);
    }
    if (transform.mirrorH) {
      transforms.push('scaleX(-1)');
    }
    if (transform.mirrorV) {
      transforms.push('scaleY(-1)');
    }
    return transforms.length > 0 ? transforms.join(' ') : 'none';
  }, [pageTransformations]);

  // Load sidebar data from localStorage
  useEffect(() => {
    if (!pdfId) return;
    try {
      const sidebarData = JSON.parse(localStorage.getItem(`pdfSidebar_${pdfId}`) || '{}');
      setPageNames(sidebarData.pageNames || {});
      setBookmarks(sidebarData.bookmarks || []);
      setSpaces(sidebarData.spaces || []);
      // Always start in regular mode when opening a PDF; do not restore an active space
      setActiveSpaceId(null);
      setPageTransformations(sidebarData.pageTransformations || {});
    } catch (e) {
      console.error('Error loading sidebar data:', e);
    }
  }, [pdfId]);

  // Save sidebar data to localStorage
  useEffect(() => {
    if (!pdfId) return;
    try {
      localStorage.setItem(`pdfSidebar_${pdfId}`, JSON.stringify({
        pageNames,
        bookmarks,
        spaces,
        activeSpaceId,
        pageTransformations
      }));
    } catch (e) {
      console.error('Error saving sidebar data:', e);
    }
  }, [pdfId, pageNames, bookmarks, spaces, activeSpaceId, pageTransformations]);

  // Sidebar handlers
  const handleDuplicatePage = useCallback(async (pageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      alert('PDF file not available for manipulation');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Get the page to duplicate (convert from 1-based to 0-based)
      const pages = pdfDoc.getPages();
      const pageToDuplicate = pages[pageNumber - 1];

      if (!pageToDuplicate) {
        alert(`Page ${pageNumber} not found`);
        return;
      }

      // Copy the page and insert it directly after the original
      const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [pageNumber - 1]);
      pdfDoc.insertPage(pageNumber, copiedPage); // Insert after original (pageNumber is 1-based, insertPage uses 0-based)

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });

      // Update the PDF file
      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error duplicating page:', error);
      alert(`Error duplicating page: ${error.message}`);
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleRenamePage = useCallback((pageNumber, newName) => {
    setPageNames(prev => ({ ...prev, [pageNumber]: newName }));
  }, []);

  const handleDeletePage = useCallback(async (pageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      alert('PDF file not available for manipulation');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Remove the page (convert from 1-based to 0-based)
      pdfDoc.removePage(pageNumber - 1);

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });

      // Update the PDF file
      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error deleting page:', error);
      alert(`Error deleting page: ${error.message}`);
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleCutPage = useCallback((pageNumber) => {
    setClipboardPage(pageNumber);
    setClipboardType('cut');
  }, []);

  const handleCopyPage = useCallback((pageNumber) => {
    setClipboardPage(pageNumber);
    setClipboardType('copy');
  }, []);

  const handlePastePage = useCallback(async (targetPageNumber, sourcePageNumber, pasteType) => {
    if (!pdfFile || !onUpdatePDFFile) {
      alert('PDF file not available for manipulation');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Copy the source page
      const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [sourcePageNumber - 1]);

      // Insert after target page (convert from 1-based to 0-based)
      const insertIndex = targetPageNumber; // Insert after targetPageNumber
      pdfDoc.insertPage(insertIndex, copiedPage);

      // If it was a cut operation, remove the source page
      if (pasteType === 'cut') {
        // After inserting, the source page index may have shifted
        const sourceIndex = sourcePageNumber - 1;
        if (sourceIndex < insertIndex) {
          // Source was before insert point, so it's still at the same index
          pdfDoc.removePage(sourceIndex);
        } else {
          // Source was after insert point, so it shifted by 1
          pdfDoc.removePage(sourceIndex + 1);
        }
        setClipboardPage(null);
        setClipboardType(null);
      }

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });

      // Update the PDF file
      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error pasting page:', error);
      alert(`Error pasting page: ${error.message}`);
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleReorderPages = useCallback((sourcePageNumber, targetPageNumber) => {
    // Reorder pages by swapping their positions
    // Note: This is a simplified implementation - actual PDF reordering would require PDF manipulation
    // For now, we'll update page names to reflect the new order
    const newPageNames = { ...pageNames };
    const sourceName = pageNames[sourcePageNumber] || `Page ${sourcePageNumber}`;
    const targetName = pageNames[targetPageNumber] || `Page ${targetPageNumber}`;

    newPageNames[sourcePageNumber] = targetName;
    newPageNames[targetPageNumber] = sourceName;

    setPageNames(newPageNames);

    // If we're on one of the reordered pages, navigate to maintain context
    if (pageNum === sourcePageNumber) {
      setPageNum(targetPageNumber);
    } else if (pageNum === targetPageNumber) {
      setPageNum(sourcePageNumber);
    }
  }, [pageNames, pageNum]);

  const handleRotatePage = useCallback((pageNumber) => {
    setPageTransformations(prev => {
      const current = prev[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
      const newRotation = (current.rotation + 90) % 360;
      return {
        ...prev,
        [pageNumber]: {
          ...current,
          rotation: newRotation
        }
      };
    });
  }, []);

  const handleMirrorPage = useCallback((pageNumber, direction) => {
    setPageTransformations(prev => {
      const current = prev[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
      return {
        ...prev,
        [pageNumber]: {
          ...current,
          [direction === 'horizontal' ? 'mirrorH' : 'mirrorV']: !current[direction === 'horizontal' ? 'mirrorH' : 'mirrorV']
        }
      };
    });
  }, []);

  const handleResetPage = useCallback((pageNumber) => {
    setPageTransformations(prev => {
      const newTransformations = { ...prev };
      delete newTransformations[pageNumber];
      return newTransformations;
    });
  }, []);

  const handleBookmarkCreate = useCallback((bookmark) => {
    setBookmarks(prev => {
      const type = bookmark?.type === 'folder' ? 'folder' : 'bookmark';
      const trimmedName = typeof bookmark?.name === 'string' ? bookmark.name.trim() : '';
      if (!trimmedName) {
        alert(`Please enter a ${type === 'folder' ? 'bookmark group' : 'bookmark'} name.`);
        return prev;
      }
      if (hasNameConflict(prev, trimmedName, {
        predicate: (item) => item?.type === type
      })) {
        alert(`A ${type === 'folder' ? 'bookmark group' : 'bookmark'} with this name already exists. Please choose a different name.`);
        return prev;
      }
      const newBookmark = {
        ...bookmark,
        name: trimmedName,
        id: bookmark?.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        parentId: bookmark?.parentId || null,
        children: bookmark?.children || []
      };
      return [...prev, newBookmark];
    });
  }, []);

  const handleBookmarkUpdate = useCallback((id, updates) => {
    setBookmarks(prev => {
      const targetBookmark = prev.find(bookmark => bookmark.id === id);
      if (!targetBookmark) {
        return prev;
      }

      let sanitizedUpdates = { ...updates };

      if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
        const trimmedName = typeof updates.name === 'string' ? updates.name.trim() : '';
        if (!trimmedName) {
          alert(`${targetBookmark.type === 'folder' ? 'Bookmark group' : 'Bookmark'} name cannot be empty.`);
          return prev;
        }
        if (hasNameConflict(prev, trimmedName, {
          predicate: (item) => item?.type === targetBookmark.type,
          ignoreId: id
        })) {
          alert(`A ${targetBookmark.type === 'folder' ? 'bookmark group' : 'bookmark'} with this name already exists. Please choose a different name.`);
          return prev;
        }
        sanitizedUpdates = { ...sanitizedUpdates, name: trimmedName };
      }

      return prev.map(bookmark => bookmark.id === id ? { ...bookmark, ...sanitizedUpdates } : bookmark);
    });
  }, []);

  const handleBookmarkDelete = useCallback((id) => {
    setBookmarks(prev => {
      // First, collect all IDs to delete (the folder itself and all its descendants)
      const idsToDelete = new Set([id]);
      let foundNew = true;

      // Recursively find all bookmarks that belong to this folder or its subfolders
      while (foundNew) {
        foundNew = false;
        prev.forEach(b => {
          if (b.parentId && idsToDelete.has(b.parentId) && !idsToDelete.has(b.id)) {
            idsToDelete.add(b.id);
            foundNew = true;
          }
        });
      }

      // Filter out all bookmarks with IDs in the set
      return prev.filter(b => !idsToDelete.has(b.id));
    });
  }, []);

  const handleSpaceCreate = useCallback((space) => {
    setSpaces(prev => {
      const trimmedName = typeof space?.name === 'string' ? space.name.trim() : '';
      let finalName = trimmedName;

      if (trimmedName) {
        if (hasNameConflict(prev, trimmedName, { getName: (entry) => entry?.name })) {
          alert('A space with this name already exists. Please choose a different name.');
          return prev;
        }
      } else {
        let counter = prev.length + 1;
        let generatedName = `Space ${counter}`;
        while (hasNameConflict(prev, generatedName, { getName: (entry) => entry?.name })) {
          counter += 1;
          generatedName = `Space ${counter}`;
        }
        finalName = generatedName;
      }

      const newSpace = {
        ...space,
        name: finalName,
        id: space?.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        assignedPages: Array.isArray(space?.assignedPages) ? space.assignedPages : []
      };
      return [...prev, newSpace];
    });
  }, []);

  const handleSpaceUpdate = useCallback((id, updates) => {
    setSpaces(prev => {
      const targetSpace = prev.find(space => space.id === id);
      if (!targetSpace) {
        return prev;
      }

      let sanitizedUpdates = { ...updates };

      if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
        const trimmedName = typeof updates.name === 'string' ? updates.name.trim() : '';
        if (!trimmedName) {
          alert('Space name cannot be empty.');
          return prev;
        }
        if (hasNameConflict(prev, trimmedName, { getName: (space) => space?.name, ignoreId: id })) {
          alert('A space with this name already exists. Please choose a different name.');
          return prev;
        }
        sanitizedUpdates = { ...sanitizedUpdates, name: trimmedName };
      }

      return prev.map(space => space.id === id ? { ...space, ...sanitizedUpdates } : space);
    });
  }, []);

  const handleSpaceAssignPages = useCallback((spaceId, pageNumbers) => {
    if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) {
      return;
    }

    setSpaces(prev => prev.map(space => {
      if (space.id !== spaceId) {
        return space;
      }

      const existingEntries = new Map(
        (space.assignedPages || []).map(entry => [
          entry.pageId,
          {
            pageId: entry.pageId,
            label: typeof entry.label === 'string' && entry.label.trim().length > 0
              ? entry.label.trim()
              : `Region ${entry.pageId}`,
            wholePageIncluded: entry.wholePageIncluded !== false ? true : false,
            regions: Array.isArray(entry.regions) ? entry.regions : []
          }
        ])
      );

      pageNumbers.forEach(pageNumber => {
        if (!Number.isInteger(pageNumber)) {
          return;
        }

        if (!existingEntries.has(pageNumber)) {
          existingEntries.set(pageNumber, {
            pageId: pageNumber,
            label: `Region ${pageNumber}`,
            wholePageIncluded: true,
            regions: []
          });
        }
      });

      const updatedPages = Array.from(existingEntries.values())
        .filter(entry => typeof entry.pageId === 'number' && !Number.isNaN(entry.pageId))
        .sort((a, b) => a.pageId - b.pageId);

      return {
        ...space,
        assignedPages: updatedPages
      };
    }));
  }, []);

  const handleSpaceRemovePage = useCallback((spaceId, pageId) => {
    // First, remove all highlight annotations associated with this space and page
    setHighlightAnnotations(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(highlightId => {
        const highlight = updated[highlightId];
        if (highlight.spaceId === spaceId && highlight.pageNumber === pageId) {
          delete updated[highlightId];
        }
      });
      return updated;
    });

    // Then update the spaces to remove the page
    setSpaces(prev => {
      const nextSpaces = prev.map(space => {
        if (space.id !== spaceId) {
          return space;
        }

        const filteredPages = (space.assignedPages || []).filter(p => p.pageId !== pageId);
        return {
          ...space,
          assignedPages: filteredPages
        };
      });

      if (activeSpaceId === spaceId) {
        const target = nextSpaces.find(s => s.id === spaceId);
        if (!target || (target.assignedPages || []).length === 0) {
          setActiveSpaceId(null);
        }
      }

      return nextSpaces;
    });
  }, [activeSpaceId]);

  const handleSpaceRenamePage = useCallback((spaceId, pageId, newLabel) => {
    const trimmedLabel = typeof newLabel === 'string' ? newLabel.trim() : '';
    setSpaces(prev => prev.map(space => {
      if (space.id !== spaceId) {
        return space;
      }

      const assignedPages = space.assignedPages || [];
      const defaultLabel = `Region ${pageId}`;
      const candidateLabel = trimmedLabel.length > 0 ? trimmedLabel : defaultLabel;
      const getExistingLabel = (page) => (
        typeof page.label === 'string' && page.label.trim().length > 0
          ? page.label.trim()
          : `Region ${page.pageId}`
      );

      if (hasNameConflict(assignedPages, candidateLabel, {
        getName: getExistingLabel,
        getId: (page) => page?.pageId,
        ignoreId: pageId
      })) {
        alert('A region with this name already exists in this space. Please choose a different name.');
        return space;
      }

      const updatedPages = assignedPages.map(page => {
        if (page.pageId !== pageId) {
          return {
            ...page,
            label: getExistingLabel(page)
          };
        }

        return {
          ...page,
          label: candidateLabel
        };
      });

      return {
        ...space,
        assignedPages: updatedPages
      };
    }));
  }, []);

  const handleSpaceClearRegions = useCallback((spaceId, pageId) => {
    console.log('[App] ===== handleSpaceClearRegions CALLED =====', { spaceId, pageId });

    setSpaces(prev => {
      const beforeSpace = prev.find(s => s.id === spaceId);
      const beforePage = beforeSpace?.assignedPages?.find(p => p.pageId === pageId);
      console.log('[App] Before update - space found:', !!beforeSpace, 'page found:', !!beforePage);
      console.log('[App] Before update - page entry:', beforePage);

      const updated = prev.map(space => {
        if (space.id !== spaceId) {
          return space;
        }

        const assignedPages = space.assignedPages || [];
        const pageIndex = assignedPages.findIndex(page => page.pageId === pageId);

        let updatedPages;
        if (pageIndex >= 0) {
          // Page exists, update it
          console.log('[App] Updating existing page entry at index', pageIndex, { pageId, wholePageIncluded: true, regions: [] });
          updatedPages = assignedPages.map((page, index) => {
            if (index === pageIndex) {
              return {
                ...page,
                wholePageIncluded: true,
                regions: []
              };
            }
            return page;
          });
        } else {
          // Page doesn't exist, create it
          console.log('[App] Creating new page entry', { pageId, wholePageIncluded: true, regions: [] });
          updatedPages = [
            ...assignedPages,
            {
              pageId: pageId,
              wholePageIncluded: true,
              regions: []
            }
          ];
        }

        const afterPage = updatedPages.find(p => p.pageId === pageId);
        console.log('[App] After update - page entry:', afterPage);
        console.log('[App] ===== handleSpaceClearRegions COMPLETED =====');

        return {
          ...space,
          assignedPages: updatedPages
        };
      });

      return updated;
    });
  }, []);

  const handleReorderSpaces = useCallback((fromIndex, toIndex) => {
    setSpaces(prev => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const reordered = arrayMove(prev, fromIndex, toIndex);
      return [...reordered];
    });
  }, []);

  // Helper function to get user initials
  const getUserInitials = useCallback(() => {
    if (!user) return '';

    let firstName = user.user_metadata?.first_name || user.user_metadata?.firstName || '';
    let lastName = user.user_metadata?.last_name || user.user_metadata?.lastName || '';

    // If first/last name missing, try to parse full_name or name
    if (!firstName && !lastName) {
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name || '';
      if (fullName) {
        const parts = fullName.split(' ');
        if (parts.length > 0) {
          firstName = parts[0];
          if (parts.length > 1) {
            lastName = parts[parts.length - 1];
          }
        }
      }
    }

    const firstInitial = firstName ? firstName.charAt(0).toUpperCase() : '';
    const lastInitial = lastName ? lastName.charAt(0).toUpperCase() : '';

    return `${firstInitial}${lastInitial}`;
  }, [user]);

  // Sync user profile data if missing (e.g. from Google login)
  useEffect(() => {
    if (user && (!user.user_metadata?.first_name || !user.user_metadata?.last_name)) {
      const fullName = user.user_metadata?.full_name || user.user_metadata?.name;
      if (fullName) {
        const parts = fullName.split(' ');
        if (parts.length > 0) {
          const firstName = parts[0];
          const lastName = parts.length > 1 ? parts[parts.length - 1] : '';

          // Only update if we actually found something new
          if (firstName) {
            supabase.auth.updateUser({
              data: {
                first_name: firstName,
                last_name: lastName,
                full_name: fullName // Ensure full_name is consistent
              }
            }).then(({ error }) => {
              if (error) console.error('Error syncing user profile:', error);
            });
          }
        }
      }
    }
  }, [user]);

  // Helper function to ensure highlight has changedBy and changedDate
  const ensureHighlightMetadata = useCallback((highlight) => {
    const now = new Date().toISOString();
    const initials = getUserInitials();

    return {
      ...highlight,
      changedBy: highlight.changedBy || initials,
      changedDate: highlight.changedDate || now
    };
  }, [getUserInitials]);

  const handleExportSurveyToExcel = useCallback(async (targetPath = null) => {
    if (!features?.excelExport) {
      alert('Excel Export is a Pro feature. Please upgrade to use this tool.');
      return;
    }
    // If called from event handler, targetPath will be the event object
    if (targetPath && typeof targetPath !== 'string') targetPath = null;
    if (!selectedTemplate) {
      alert('Please select a survey template before exporting.');
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const modulesList = selectedTemplate.modules || selectedTemplate.spaces || [];
      const sheetNames = new Set();

      const createSheetName = (categoryName, moduleName) => {
        const rawName = `${categoryName || 'Category'} - ${moduleName || 'Module'}`.trim() || 'Sheet';
        const invalidChars = /[\\/?*[\]:]/g;
        const cleaned = rawName.replace(invalidChars, '').substring(0, 31) || 'Sheet';

        let candidate = cleaned;
        let counter = 2;
        while (sheetNames.has(candidate)) {
          const suffix = ` (${counter})`;
          const base = cleaned.substring(0, Math.max(0, 31 - suffix.length));
          candidate = `${base}${suffix}`;
          counter += 1;
        }

        sheetNames.add(candidate);
        return candidate;
      };

      if (modulesList.length === 0) {
        workbook.addWorksheet('Survey');
      } else {
        modulesList.forEach((module) => {
          const moduleName = module?.name || 'Module';
          const moduleId = module?.id;
          const categories = module?.categories || [];

          if (categories.length === 0) {
            const sheetName = createSheetName('General', moduleName);
            workbook.addWorksheet(sheetName);
            return;
          }

          categories.forEach((category) => {
            const sheetName = createSheetName(category?.name || 'Category', moduleName);
            const worksheet = workbook.addWorksheet(sheetName);

            // Get checklist items from category
            const checklistItems = category?.checklist || [];

            // Get module data key for accessing item data
            const moduleDataKey = getModuleDataKey(moduleName);
            const categoryName = getCategoryName(selectedTemplate, moduleId, category.id);

            // Get all highlights for this category and module (same logic as sidebar)
            const categoryHighlights = [];
            console.log(`Exporting Module: ${moduleName} (ID: ${moduleId})`);
            console.log(`Exporting Category: ${category.name} (ID: ${category.id})`);
            console.log('Total highlightAnnotations:', Object.keys(highlightAnnotations).length);

            Object.entries(highlightAnnotations).forEach(([highlightId, highlight]) => {
              const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId

              // Debug logging for first few items
              if (categoryHighlights.length < 3) {
                console.log(`Checking highlight ${highlightId}:`, {
                  highlightModuleId,
                  targetModuleId: moduleId,
                  highlightCategoryId: highlight.categoryId,
                  targetCategoryId: category.id,
                  matchModule: highlightModuleId == moduleId, // Loose equality check
                  matchCategory: highlight.categoryId == category.id // Loose equality check
                });
              }

              // Use loose equality (==) to handle potential string/number mismatches
              if (highlightModuleId == moduleId && highlight.categoryId == category.id) {
                categoryHighlights.push({
                  ...highlight,
                  id: highlightId  // Use the key, not highlight.id
                });
              }
            });
            console.log(`Found ${categoryHighlights.length} highlights for this category.`);

            // Build header row: Changed By, Changed Date, Item, [checklist items], Ball in Court, Notes
            const headerRow = ['Changed By', 'Changed Date', 'Item'];
            checklistItems.forEach(checklistItem => {
              headerRow.push(checklistItem.text || '');
            });
            headerRow.push('Ball in Court');
            headerRow.push('Notes');

            // Get ball in court entities from template
            const ballInCourtEntities = selectedTemplate?.ballInCourtEntities || [];
            const ballInCourtNames = ballInCourtEntities.map(e => e.name).filter(Boolean);

            // Build data rows
            const dataRows = [headerRow];

            categoryHighlights.forEach((highlight) => {
              const row = [];

              // Get the ACTUAL highlight from highlightAnnotations to ensure we have all data
              const highlightId = highlight?.id;
              let actualHighlight = highlightId ? highlightAnnotations[highlightId] : highlight;

              // Ensure highlight has metadata (add if missing)
              actualHighlight = ensureHighlightMetadata(actualHighlight);

              // Changed By - get user initials
              const changedBy = actualHighlight?.changedBy || '';
              row.push(changedBy);

              // Changed Date - format as MM/DD/YYYY
              const changedDate = actualHighlight?.changedDate || '';
              const formattedDate = changedDate ? new Date(changedDate).toLocaleDateString('en-US') : '';
              row.push(formattedDate);

              // Item name from highlight
              const highlightName = highlight?.name || '';
              row.push(highlightName);

              // Get checklist responses from highlight annotation
              const highlightChecklistResponses = actualHighlight?.checklistResponses || {};

              // Try to find matching item for fallback data
              const matchingItem = Object.values(items).find(item => {
                return item.name === highlightName &&
                  item.itemType === categoryName;
              });

              // Get module-specific data for this item (for ball in court fallback)
              const moduleData = matchingItem?.[moduleDataKey] || {};

              // Checklist responses (Y/N/N/A) - use highlight annotation data
              checklistItems.forEach(checklistItem => {
                const response = highlightChecklistResponses[checklistItem.id];
                const selection = response?.selection || '';
                row.push(selection);
              });

              // Ball in Court - check highlight annotation first, then item module data
              const ballInCourtEntityId = actualHighlight?.ballInCourtEntityId || moduleData.ballInCourtEntityId;
              const ballInCourtName = actualHighlight?.ballInCourtEntityName ||
                moduleData.ballInCourtEntityName || '';
              row.push(ballInCourtName);

              // Get ball in court color - try multiple sources
              let ballInCourtColor = null;

              // First, try to get color directly from highlight annotation
              if (actualHighlight?.ballInCourtColor) {
                ballInCourtColor = getHexFromColor(actualHighlight.ballInCourtColor);
              }

              // If not found, try to get from entity lookup
              if (!ballInCourtColor && ballInCourtEntityId) {
                const entity = ballInCourtEntities.find(e => e.id === ballInCourtEntityId);
                if (entity && entity.color) {
                  ballInCourtColor = getHexFromColor(entity.color);
                }
              }

              // If still not found, try from module data
              if (!ballInCourtColor && moduleData.ballInCourtColor) {
                ballInCourtColor = getHexFromColor(moduleData.ballInCourtColor);
              }

              // Notes - get item-level note from highlight annotation
              const itemNote = actualHighlight?.note?.text || '';
              row.push(itemNote);

              dataRows.push(row);
            });

            // Add rows to worksheet
            dataRows.forEach((row, rowIndex) => {
              const excelRow = worksheet.addRow(row);

              // Style header row
              if (rowIndex === 0) {
                excelRow.eachCell({ includeEmpty: true }, (cell) => {
                  cell.alignment = { horizontal: 'center', vertical: 'middle' };
                  cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFBFBFBF' }
                  };
                  cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                  };
                });
              } else {
                // Add borders and alignment to data cells
                const lastChecklistCol = headerRow.length - 2; // -2 for Ball in Court and Notes
                const ballInCourtColIndex = headerRow.length - 1; // Second to last column

                excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                  cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                  };

                  // Center align specific columns:
                  // Columns 1-3: Changed By, Changed Date, Item names
                  // Columns 4 to lastChecklistCol: Checklist items (Y/N/N/A)
                  // Column ballInCourtColIndex: Ball in Court entities
                  if (colNumber >= 1 && colNumber <= 3) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                  } else if ((colNumber >= 4 && colNumber <= lastChecklistCol) || colNumber === ballInCourtColIndex) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                  }
                });
              }
            });

            // Calculate column indices
            // Header structure: Changed By (1), Changed Date (2), Item (3), Checklist items (4...N), Ball in Court (N+1), Notes (N+2)
            const firstChecklistCol = 4; // Checklist items start at column 4
            const lastChecklistCol = headerRow.length - 2; // -2 for Ball in Court and Notes
            const ballInCourtColIndex = headerRow.length - 1; // Second to last column
            const itemColIndex = 3; // Item column (1-indexed in ExcelJS)

            // Add Data Validation for Checklist Items
            if (lastChecklistCol >= firstChecklistCol) { // At least one checklist column exists
              for (let col = firstChecklistCol; col <= lastChecklistCol; col++) {
                const colLetter = String.fromCharCode(64 + col); // Convert to letter (A, B, C...)
                worksheet.getColumn(col).eachCell((cell, rowNum) => {
                  if (rowNum > 1) { // Skip header
                    cell.dataValidation = {
                      type: 'list',
                      allowBlank: true,
                      formulae: ['"Y,N,N/A"'],
                      showErrorMessage: true,
                      errorStyle: 'error',
                      errorTitle: 'Invalid Selection',
                      error: 'Please select Y, N, or N/A'
                    };
                  }
                });
              }
            }

            // Add Data Validation for Ball in Court
            if (ballInCourtNames.length > 0) {
              const validationFormula = `"${ballInCourtNames.join(',')}"`;
              if (validationFormula.length <= 255) {
                worksheet.getColumn(ballInCourtColIndex).eachCell((cell, rowNum) => {
                  if (rowNum > 1) { // Skip header
                    cell.dataValidation = {
                      type: 'list',
                      allowBlank: true,
                      formulae: [validationFormula],
                      showErrorMessage: true,
                      errorStyle: 'error',
                      errorTitle: 'Invalid Selection',
                      error: 'Please select a valid entity from the list.'
                    };
                  }
                });
              } else {
                console.warn('Ball in Court validation list exceeds 255 characters. Validation skipped.');
              }
            }

            // Add Conditional Formatting for Checklist Items (Y, N, N/A)
            if (lastChecklistCol >= firstChecklistCol) {
              for (let col = firstChecklistCol; col <= lastChecklistCol; col++) {
                const colLetter = String.fromCharCode(64 + col);
                const range = `${colLetter}2:${colLetter}1000`;

                // Y = Green
                worksheet.addConditionalFormatting({
                  ref: range,
                  rules: [
                    {
                      type: 'cellIs',
                      operator: 'equal',
                      formulae: ['"Y"'],
                      style: {
                        fill: {
                          type: 'pattern',
                          pattern: 'solid',
                          bgColor: { argb: 'FFCEEED0' }
                        }
                      },
                      priority: 1
                    }
                  ]
                });

                // N = Red
                worksheet.addConditionalFormatting({
                  ref: range,
                  rules: [
                    {
                      type: 'cellIs',
                      operator: 'equal',
                      formulae: ['"N"'],
                      style: {
                        fill: {
                          type: 'pattern',
                          pattern: 'solid',
                          bgColor: { argb: 'FFF6C9CE' }
                        }
                      },
                      priority: 2
                    }
                  ]
                });

                // N/A = Grey
                worksheet.addConditionalFormatting({
                  ref: range,
                  rules: [
                    {
                      type: 'cellIs',
                      operator: 'equal',
                      formulae: ['"N/A"'],
                      style: {
                        fill: {
                          type: 'pattern',
                          pattern: 'solid',
                          bgColor: { argb: 'FFA6A6A6' }
                        }
                      },
                      priority: 3
                    }
                  ]
                });
              }
            }

            // Add Conditional Formatting for Ball in Court entities
            ballInCourtEntities.forEach((entity, index) => {
              if (!entity.name || !entity.color) return;

              const ballInCourtColLetter = String.fromCharCode(64 + ballInCourtColIndex);
              const range = `${ballInCourtColLetter}2:${ballInCourtColLetter}1000`;

              let hexColor = getHexFromColor(entity.color);
              if (hexColor && hexColor.startsWith('#')) {
                hexColor = hexColor.substring(1);
              }

              if (hexColor) {
                worksheet.addConditionalFormatting({
                  ref: range,
                  rules: [
                    {
                      type: 'cellIs',
                      operator: 'equal',
                      formulae: [`"${entity.name}"`],
                      style: {
                        fill: {
                          type: 'pattern',
                          pattern: 'solid',
                          bgColor: { argb: 'FF' + hexColor.toUpperCase() }
                        }
                      },
                      priority: 10 + index
                    }
                  ]
                });
              }
            });

            // Add Conditional Formatting for Duplicate Names (Column C = Item)
            const itemColLetter = 'C';
            const duplicateRange = `${itemColLetter}2:${itemColLetter}1000`;

            worksheet.addConditionalFormatting({
              ref: duplicateRange,
              rules: [
                {
                  type: 'expression',
                  formulae: [`COUNTIF($${itemColLetter}:$${itemColLetter}, ${itemColLetter}2)>1`],
                  style: {
                    fill: {
                      type: 'pattern',
                      pattern: 'solid',
                      bgColor: { argb: 'FFFFC7CF' } // Light Red Fill
                    },
                    font: {
                      color: { argb: 'FF9B0007' } // Dark Red Text
                    }
                  },
                  priority: 1000 // High priority to override other formatting
                }
              ]
            });

            // Set column widths
            // Column 1: Changed By (width 15)
            worksheet.getColumn(1).width = 15;

            // Column 2: Changed Date (width 15)
            worksheet.getColumn(2).width = 15;

            // Column 3: Item (width 15)
            worksheet.getColumn(3).width = 15;

            // Columns 4 to lastChecklistCol: Checklist items (width 15 each)
            for (let col = firstChecklistCol; col <= lastChecklistCol; col++) {
              worksheet.getColumn(col).width = 15;
            }

            // Ball in Court column (width 15)
            worksheet.getColumn(ballInCourtColIndex).width = 15;

            // Notes column (width 50)
            const notesColIndex = headerRow.length; // Last column
            worksheet.getColumn(notesColIndex).width = 50;
          });
        });
      }

      // Write workbook to buffer
      const workbookBuffer = await workbook.xlsx.writeBuffer();

      if (window.electronAPI) {
        if (targetPath) {
          // Silent save (Sync to Excel) - handled by handleSyncToExcel
          try {
            // Check if this is a OneDrive file
            if (selectedTemplate?.isOneDrive) {
              // Use OneDrive API to upload
              if (!graphClient) {
                alert('Please sign in to Microsoft to sync with OneDrive.');
                return;
              }
              await uploadExcelFile(graphClient, targetPath, workbookBuffer);
            } else {
              // Use local filesystem
              await window.electronAPI.writeFile(targetPath, workbookBuffer);
            }

            const updatedTemplate = {
              ...selectedTemplate,
              linkedExcelPath: targetPath,
              lastSyncTime: new Date().toISOString()
            };
            setSelectedTemplate(updatedTemplate);

            const supabaseTemplateId = selectedTemplate?.supabaseId || selectedTemplate?.id;
            if (updateSupabaseTemplate && supabaseTemplateId) {
              try {
                await updateSupabaseTemplate(supabaseTemplateId, {
                  linked_excel_path: targetPath,
                  last_sync_time: updatedTemplate.lastSyncTime
                });
              } catch (err) {
                console.warn('Failed to update template in Supabase (local export successful):', err);
              }
            }

            alert('Sync to Excel successful!');
          } catch (err) {
            console.error('Failed to write file:', err);
            // Check for OneDrive locked file error
            if (err.message && err.message.includes('locked')) {
              alert('Failed to sync: The Excel file is locked. Please close it in Excel or OneDrive and try again.');
            } else {
              alert('Failed to sync to Excel file. It might be open in another program.');
            }
            return;
          }
        } else {
          // Export - show location choice modal
          const fileName = sanitizeFilename(selectedTemplate?.name || 'survey', 'survey');
          setExportPendingData({
            buffer: workbookBuffer,
            fileName: fileName
          });
          setShowExportLocationModal(true);
          return; // Exit - modal will handle the actual save
        }
      } else {
        const blob = new Blob([workbookBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${sanitizeFilename(selectedTemplate?.name || 'survey', 'survey')}_export.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (error) {
      console.error('Failed to create Excel export', error);
      alert('Unable to create the Excel file. Please try again.');
    }
  }, [selectedTemplate, items, highlightAnnotations, graphClient]);

  const handleOpenExcel = useCallback(async () => {
    if (!selectedTemplate?.linkedExcelPath) {
      alert('No Excel file linked to this survey.');
      return;
    }

    if (window.electronAPI) {
      await window.electronAPI.openPath(selectedTemplate.linkedExcelPath);
    }
  }, [selectedTemplate]);

  const handleSyncToExcel = useCallback(async () => {
    if (!selectedTemplate?.linkedExcelPath) {
      alert('No Excel file linked to this survey.');
      return;
    }

    // Step A: Authentication Check
    if (!isMSAuthenticated) {
      setShowMSLoginModal(true);
      return;
    }

    // Step B: File Location Check
    if (!selectedTemplate.isOneDrive) {
      alert('This file is saved locally. Please move it to OneDrive or Microsoft Teams to enable syncing.\n\nLocal files cannot be synced while open. Move the file to a OneDrive or Teams folder to use real-time sync.');
      return;
    }

    // Proceed with sync
    await handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
  }, [selectedTemplate, handleExportSurveyToExcel, isMSAuthenticated]);

  const handleSyncFromExcel = useCallback(async () => {
    if (!selectedTemplate?.linkedExcelPath) {
      alert('No Excel file linked to this survey.');
      return;
    }

    if (window.electronAPI) {
      try {
        let fileData;
        if (selectedTemplate?.isOneDrive) {
          // Use OneDrive API to download
          if (!graphClient) {
            alert('Please sign in to Microsoft to sync with OneDrive.');
            return;
          }
          fileData = await downloadExcelFileByPath(graphClient, selectedTemplate.linkedExcelPath);
        } else {
          // Use local filesystem
          fileData = await window.electronAPI.readFile(selectedTemplate.linkedExcelPath);
        }
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fileData);

        const newHighlightAnnotations = { ...highlightAnnotations };
        let updatesCount = 0;

        workbook.worksheets.forEach(worksheet => {
          const sheetName = worksheet.name;

          // Convert worksheet to array of arrays
          const jsonData = [];
          worksheet.eachRow((row, rowNumber) => {
            const rowData = [];
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
              rowData[colNumber - 1] = cell.value;
            });
            jsonData.push(rowData);
          });

          if (jsonData.length < 2) return; // No data

          const headerRow = jsonData[0];

          // Iterate all modules and categories in selectedTemplate to find match
          let matchedCategory = null;
          let matchedModuleId = null;

          const modules = selectedTemplate.modules || selectedTemplate.spaces || [];
          for (const mod of modules) {
            if (matchedCategory) break;
            const categories = mod.categories || [];
            for (const cat of categories) {
              const rawName = `${cat.name || 'Category'} - ${mod.name || 'Module'}`.trim() || 'Sheet';
              const invalidChars = /[\\/?*[\]:]/g;
              const cleaned = rawName.replace(invalidChars, '').substring(0, 31) || 'Sheet';

              if (cleaned === sheetName) {
                matchedCategory = cat;
                matchedModuleId = mod.id;
                break;
              }
            }
          }

          if (!matchedCategory) return;

          // Map header columns to checklist item IDs
          const colToChecklistId = {};
          const checklistItems = matchedCategory.checklist || [];
          console.log('Checklist items in category:', checklistItems.length);

          headerRow.forEach((colText, index) => {
            // Skip non-checklist columns
            if (colText === 'Changed By' || colText === 'Changed Date' || colText === 'Item') return;
            if (colText === 'Ball in Court' || colText === 'Notes') return;

            const checklistItem = checklistItems.find(c => c.text === colText);
            if (checklistItem) {
              colToChecklistId[index] = checklistItem.id;
            }
          });

          console.log('Column to checklist ID mapping:', colToChecklistId);
          const itemColumnIndex = headerRow.indexOf('Item');
          const ballInCourtIndex = headerRow.indexOf('Ball in Court');
          const notesIndex = headerRow.indexOf('Notes');
          console.log('Column indices:', { itemColumnIndex, ballInCourtIndex, notesIndex });

          // Iterate data rows
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            const itemName = row[itemColumnIndex];
            if (!itemName) continue;

            console.log(`Processing row ${i}: itemName="${itemName}"`);

            // Find matching highlight by name
            let matchedHighlightKey = null;

            Object.entries(newHighlightAnnotations).forEach(([key, ann]) => {
              const annModuleId = ann.moduleId || ann.spaceId;
              if (annModuleId === matchedModuleId &&
                ann.categoryId === matchedCategory.id &&
                ann.name === itemName) {
                matchedHighlightKey = key;
                console.log('✓ Found highlight by name:', key);
              }
            });

            if (matchedHighlightKey) {
              // Update existing highlight
              const key = matchedHighlightKey;
              const ann = newHighlightAnnotations[key];
              let changed = false;

              // Update checklist responses
              if (!ann.checklistResponses) ann.checklistResponses = {};

              Object.entries(colToChecklistId).forEach(([colIndex, checklistId]) => {
                const value = row[colIndex];
                const currentVal = ann.checklistResponses[checklistId]?.selection;
                console.log(`  Col ${colIndex} (${checklistId}): Excel="${value}" Current="${currentVal}"`);

                if (value !== undefined && value !== currentVal) {
                  ann.checklistResponses[checklistId] = {
                    ...ann.checklistResponses[checklistId],
                    selection: value
                  };
                  changed = true;
                  console.log(`    UPDATED to "${value}"`);
                }
              });

              // Update Ball in Court
              if (ballInCourtIndex !== -1) {
                const bicName = row[ballInCourtIndex];
                if (bicName && bicName !== ann.ballInCourtEntityName) {
                  const entities = selectedTemplate.ballInCourtEntities || [];
                  const entity = entities.find(e => e.name === bicName);
                  if (entity) {
                    ann.ballInCourtEntityId = entity.id;
                    ann.ballInCourtEntityName = entity.name;
                    ann.ballInCourtColor = entity.color;
                    changed = true;
                  } else if (bicName === '') {
                    // Clear if empty string
                    ann.ballInCourtEntityId = null;
                    ann.ballInCourtEntityName = null;
                    ann.ballInCourtColor = null;
                    changed = true;
                  }
                }
              }

              // Update Notes
              if (notesIndex !== -1) {
                const noteText = row[notesIndex];
                if (noteText !== undefined) {
                  if (!ann.note) ann.note = {};
                  if (ann.note.text !== noteText) {
                    ann.note.text = noteText;
                    changed = true;
                  }
                }
              }

              if (changed) {
                updatesCount++;
                newHighlightAnnotations[key] = { ...ann };
              }
            } else {
              // Create new highlight for new row
              console.log(`Creating new highlight for item: "${itemName}"`);

              const newHighlightId = `highlight-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

              // Build checklist responses from Excel row
              const checklistResponses = {};
              Object.entries(colToChecklistId).forEach(([colIndex, checklistId]) => {
                const value = row[colIndex];
                if (value !== undefined && value !== '') {
                  checklistResponses[checklistId] = {
                    selection: value
                  };
                }
              });

              // Get Ball in Court entity
              let ballInCourtEntityId = null;
              let ballInCourtEntityName = null;
              let ballInCourtColor = null;

              if (ballInCourtIndex !== -1) {
                const bicName = row[ballInCourtIndex];
                if (bicName) {
                  const entities = selectedTemplate.ballInCourtEntities || [];
                  const entity = entities.find(e => e.name === bicName);
                  if (entity) {
                    ballInCourtEntityId = entity.id;
                    ballInCourtEntityName = entity.name;
                    ballInCourtColor = entity.color;
                  }
                }
              }

              // Get notes
              let noteText = '';
              if (notesIndex !== -1) {
                noteText = row[notesIndex] || '';
              }

              // Create new highlight annotation
              const newHighlight = {
                id: newHighlightId,
                name: itemName,
                categoryId: matchedCategory.id,
                moduleId: matchedModuleId,
                checklistResponses: checklistResponses,
                ballInCourtEntityId,
                ballInCourtEntityName,
                ballInCourtColor,
                note: noteText ? { text: noteText } : {},
                changedBy: '',
                changedDate: new Date().toISOString(),
                // Note: These items won't have PDF coordinates since they're created from Excel
                // They will appear in the sidebar but won't have a highlight on the PDF
                pageNumber: null,
                bounds: null
              };

              newHighlightAnnotations[newHighlightId] = newHighlight;
              updatesCount++;
              console.log(`✓ Created new highlight:`, newHighlightId);
            }
          }
        });

        if (updatesCount > 0) {
          setHighlightAnnotations(newHighlightAnnotations);
          alert(`Sync complete! Updated ${updatesCount} items.`);
        } else {
          alert('Sync complete! No changes found.');
        }

      } catch (error) {
        console.error('Failed to sync from Excel:', error);
        alert('Failed to read or parse the linked Excel file.');
      }
    }
  }, [selectedTemplate, highlightAnnotations, graphClient]);

  // Auto-sync from Excel when file changes (file watcher)
  const handleAutoSyncFromExcel = useCallback(async () => {
    console.log('=== handleAutoSyncFromExcel called ===');
    if (!selectedTemplate?.linkedExcelPath) {
      console.log('No linked Excel path');
      return;
    }

    console.log('Linked Excel path:', selectedTemplate.linkedExcelPath);

    if (window.electronAPI) {
      try {
        console.log('Reading Excel file...');
        let fileData;
        if (selectedTemplate?.isOneDrive) {
          // Use OneDrive API to download
          if (!graphClient) {
            console.log('Not authenticated with Microsoft, skipping auto-sync');
            return;
          }
          fileData = await downloadExcelFileByPath(graphClient, selectedTemplate.linkedExcelPath);
        } else {
          // Use local filesystem
          fileData = await window.electronAPI.readFile(selectedTemplate.linkedExcelPath);
        }
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fileData);

        console.log('Excel loaded, worksheets:', workbook.worksheets.length);

        const newHighlightAnnotations = { ...highlightAnnotations };
        let updatesCount = 0;

        workbook.worksheets.forEach(worksheet => {
          const sheetName = worksheet.name;
          console.log('Processing worksheet:', sheetName);

          // Convert worksheet to array of arrays
          const jsonData = [];
          worksheet.eachRow((row, rowNumber) => {
            const rowData = [];
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
              rowData[colNumber - 1] = cell.value;
            });
            jsonData.push(rowData);
          });

          if (jsonData.length < 2) return; // No data

          const headerRow = jsonData[0];

          // Iterate all modules and categories in selectedTemplate to find match
          let matchedCategory = null;
          let matchedModuleId = null;

          const modules = selectedTemplate.modules || selectedTemplate.spaces || [];
          for (const mod of modules) {
            if (matchedCategory) break;
            const categories = mod.categories || [];
            for (const cat of categories) {
              const rawName = `${cat.name || 'Category'} - ${mod.name || 'Module'}`.trim() || 'Sheet';
              const invalidChars = /[\\/?*[\]:]/g;
              const cleaned = rawName.replace(invalidChars, '').substring(0, 31) || 'Sheet';

              if (cleaned === sheetName) {
                matchedCategory = cat;
                matchedModuleId = mod.id;
                break;
              }
            }
          }

          if (!matchedCategory) return;

          // Map header columns to checklist item IDs
          const colToChecklistId = {};
          const checklistItems = matchedCategory.checklist || [];
          console.log('Checklist items in category:', checklistItems.length);

          headerRow.forEach((colText, index) => {
            // Skip non-checklist columns
            if (colText === 'Changed By' || colText === 'Changed Date' || colText === 'Item') return;
            if (colText === 'Ball in Court' || colText === 'Notes') return;

            const checklistItem = checklistItems.find(c => c.text === colText);
            if (checklistItem) {
              colToChecklistId[index] = checklistItem.id;
            }
          });

          console.log('Column to checklist ID mapping:', colToChecklistId);
          const itemColumnIndex = headerRow.indexOf('Item');
          const ballInCourtIndex = headerRow.indexOf('Ball in Court');
          const notesIndex = headerRow.indexOf('Notes');
          console.log('Column indices:', { itemColumnIndex, ballInCourtIndex, notesIndex });

          // Iterate data rows
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            const itemName = row[itemColumnIndex];
            if (!itemName) continue;

            console.log(`Processing row ${i}: itemName="${itemName}"`);

            // Find matching highlight by name
            let matchedHighlightKey = null;

            Object.entries(newHighlightAnnotations).forEach(([key, ann]) => {
              const annModuleId = ann.moduleId || ann.spaceId;
              if (annModuleId === matchedModuleId &&
                ann.categoryId === matchedCategory.id &&
                ann.name === itemName) {
                matchedHighlightKey = key;
                console.log('✓ Found highlight by name:', key);
              }
            });

            if (matchedHighlightKey) {
              // Update existing highlight
              const key = matchedHighlightKey;
              const ann = newHighlightAnnotations[key];
              let changed = false;

              // Update checklist responses
              if (!ann.checklistResponses) ann.checklistResponses = {};

              Object.entries(colToChecklistId).forEach(([colIndex, checklistId]) => {
                const value = row[colIndex];
                const currentVal = ann.checklistResponses[checklistId]?.selection;
                console.log(`  Col ${colIndex} (${checklistId}): Excel="${value}" Current="${currentVal}"`);

                if (value !== undefined && value !== currentVal) {
                  ann.checklistResponses[checklistId] = {
                    ...ann.checklistResponses[checklistId],
                    selection: value
                  };
                  changed = true;
                  console.log(`    UPDATED to "${value}"`);
                }
              });

              // Update Ball in Court
              if (ballInCourtIndex !== -1) {
                const bicName = row[ballInCourtIndex];
                if (bicName && bicName !== ann.ballInCourtEntityName) {
                  const entities = selectedTemplate.ballInCourtEntities || [];
                  const entity = entities.find(e => e.name === bicName);
                  if (entity) {
                    ann.ballInCourtEntityId = entity.id;
                    ann.ballInCourtEntityName = entity.name;
                    ann.ballInCourtColor = entity.color;
                    changed = true;
                  } else if (bicName === '') {
                    // Clear if empty string
                    ann.ballInCourtEntityId = null;
                    ann.ballInCourtEntityName = null;
                    ann.ballInCourtColor = null;
                    changed = true;
                  }
                }
              }

              // Update Notes
              if (notesIndex !== -1) {
                const noteText = row[notesIndex];
                if (noteText !== undefined) {
                  if (!ann.note) ann.note = {};
                  if (ann.note.text !== noteText) {
                    ann.note.text = noteText;
                    changed = true;
                  }
                }
              }

              if (changed) {
                updatesCount++;
                newHighlightAnnotations[key] = { ...ann };
              }
            } else {
              // Create new highlight for new row
              console.log(`Creating new highlight for item: "${itemName}"`);

              const newHighlightId = `highlight-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

              // Build checklist responses from Excel row
              const checklistResponses = {};
              Object.entries(colToChecklistId).forEach(([colIndex, checklistId]) => {
                const value = row[colIndex];
                if (value !== undefined && value !== '') {
                  checklistResponses[checklistId] = {
                    selection: value
                  };
                }
              });

              // Get Ball in Court entity
              let ballInCourtEntityId = null;
              let ballInCourtEntityName = null;
              let ballInCourtColor = null;

              if (ballInCourtIndex !== -1) {
                const bicName = row[ballInCourtIndex];
                if (bicName) {
                  const entities = selectedTemplate.ballInCourtEntities || [];
                  const entity = entities.find(e => e.name === bicName);
                  if (entity) {
                    ballInCourtEntityId = entity.id;
                    ballInCourtEntityName = entity.name;
                    ballInCourtColor = entity.color;
                  }
                }
              }

              // Get notes
              let noteText = '';
              if (notesIndex !== -1) {
                noteText = row[notesIndex] || '';
              }

              // Create new highlight annotation
              const newHighlight = {
                id: newHighlightId,
                name: itemName,
                categoryId: matchedCategory.id,
                moduleId: matchedModuleId,
                checklistResponses: checklistResponses,
                ballInCourtEntityId,
                ballInCourtEntityName,
                ballInCourtColor,
                note: noteText ? { text: noteText } : {},
                changedBy: '',
                changedDate: new Date().toISOString(),
                // Note: These items won't have PDF coordinates since they're created from Excel
                // They will appear in the sidebar but won't have a highlight on the PDF
                pageNumber: null,
                bounds: null
              };

              newHighlightAnnotations[newHighlightId] = newHighlight;
              updatesCount++;
              console.log(`✓ Created new highlight:`, newHighlightId);
            }
          }
        });

        if (updatesCount > 0) {
          setHighlightAnnotations(newHighlightAnnotations);
          setLastSyncMessage(`Auto-synced ${updatesCount} items from Excel`);
          // Clear message after 5 seconds
          setTimeout(() => setLastSyncMessage(''), 5000);
        }

      } catch (error) {
        console.error('Failed to auto-sync from Excel:', error);
        setLastSyncMessage('Auto-sync failed');
        setTimeout(() => setLastSyncMessage(''), 5000);
      }
    }
  }, [selectedTemplate, highlightAnnotations, graphClient]);

  // Set up file watcher when Excel file is linked
  useEffect(() => {
    if (!window.electronAPI || !selectedTemplate?.linkedExcelPath) {
      // Clean up if no file to watch
      if (fileWatcherCleanupRef.current) {
        fileWatcherCleanupRef.current();
        fileWatcherCleanupRef.current = null;
      }
      setFileWatcherActive(false);
      return;
    }

    const watchId = `excel-watcher-${selectedTemplate.id}`;

    // Start watching the file
    window.electronAPI.startFileWatcher(selectedTemplate.linkedExcelPath, watchId)
      .then(() => {
        setFileWatcherActive(true);
        console.log('File watcher started for:', selectedTemplate.linkedExcelPath);
      })
      .catch(error => {
        console.error('Failed to start file watcher:', error);
      });

    // Set up event listeners
    const removeChangeListener = window.electronAPI.onFileChanged(({ watchId: changedWatchId, filePath }) => {
      console.log('File changed event received:', { changedWatchId, watchId, filePath });
      if (changedWatchId === watchId) {
        console.log('Excel file changed, auto-syncing...', filePath);
        handleAutoSyncFromExcel();
      }
    });

    const removeErrorListener = window.electronAPI.onFileWatcherError(({ watchId: errorWatchId, error }) => {
      if (errorWatchId === watchId) {
        console.error('File watcher error:', error);
        setFileWatcherActive(false);
      }
    });

    // Store cleanup function
    fileWatcherCleanupRef.current = () => {
      removeChangeListener();
      removeErrorListener();
      window.electronAPI.stopFileWatcher(watchId);
    };

    // Cleanup on unmount or when dependencies change
    return () => {
      if (fileWatcherCleanupRef.current) {
        fileWatcherCleanupRef.current();
        fileWatcherCleanupRef.current = null;
      }
    };
  }, [selectedTemplate?.id, selectedTemplate?.linkedExcelPath, handleAutoSyncFromExcel]);

  // Auto-push to Excel when highlight annotations change
  useEffect(() => {
    if (!autoPushToExcel || !selectedTemplate?.linkedExcelPath || !window.electronAPI) {
      return;
    }

    // Clear any existing timeout
    if (pushTimeoutRef.current) {
      clearTimeout(pushTimeoutRef.current);
    }

    // Debounce the push to avoid too frequent writes
    pushTimeoutRef.current = setTimeout(async () => {
      console.log('Auto-pushing to Excel...');
      try {
        await handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
        setLastPushMessage('Pushed to Excel');
        setTimeout(() => setLastPushMessage(''), 3000);
      } catch (error) {
        console.error('Failed to auto-push to Excel:', error);
        setLastPushMessage('Push failed');
        setTimeout(() => setLastPushMessage(''), 3000);
      }
    }, 2000); // Wait 2 seconds after last change before pushing

    return () => {
      if (pushTimeoutRef.current) {
        clearTimeout(pushTimeoutRef.current);
      }
    };
  }, [autoPushToExcel, selectedTemplate?.linkedExcelPath, highlightAnnotations, handleExportSurveyToExcel]);

  const handleExportSpaceToCSV = useCallback((spaceId) => {
    if (!features?.excelExport) {
      alert('CSV/Excel Export is a Pro feature. Please upgrade to use this tool.');
      return;
    }
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
      alert('Space not found.');
      return;
    }

    const assignedPages = space.assignedPages || [];
    if (assignedPages.length === 0) {
      alert('This space has no pages to export.');
      return;
    }

    const headers = [
      'Space Name',
      'Page',
      'Mode',
      'Region Count',
      'Annotation Type',
      'Annotation ID',
      'Left',
      'Top',
      'Width',
      'Height',
      'Stroke Color',
      'Fill Color',
      'Stroke Width',
      'Notes',
      'Checklist Items',
      'Status',
      'Attachments'
    ];

    const rows = [headers.map(escapeCSVValue).join(',')];

    assignedPages.forEach(page => {
      const pageNumber = page.pageId;
      if (!pageNumber) {
        return;
      }

      const mode = page.wholePageIncluded === false ? 'region' : 'full';
      const regions = Array.isArray(page.regions) ? page.regions : [];
      const pageAnnotations = annotationsByPage[pageNumber]?.objects || [];

      pageAnnotations.forEach(obj => {
        if (!obj) return;
        const objSpaceId = obj.spaceId || null;
        if (space.id && objSpaceId && objSpaceId !== space.id) {
          return;
        }

        const width = (obj.width || 0) * (obj.scaleX || 1);
        const height = (obj.height || 0) * (obj.scaleY || 1);
        const centerX = (obj.left || 0) + width / 2;
        const centerY = (obj.top || 0) + height / 2;

        if (mode === 'region' && regions.length > 0) {
          const inRegion = regions.some(region => regionContainsPoint(centerX, centerY, region, scale));
          if (!inRegion) {
            return;
          }
        }

        const attachmentsCount = Array.isArray(obj.attachments) ? obj.attachments.length : '';
        const row = [
          escapeCSVValue(space.name || ''),
          escapeCSVValue(pageNumber),
          escapeCSVValue(mode),
          escapeCSVValue(regions.length),
          escapeCSVValue(obj.type || ''),
          escapeCSVValue(obj.id || ''),
          escapeCSVValue(typeof obj.left === 'number' ? obj.left.toFixed(2) : obj.left || ''),
          escapeCSVValue(typeof obj.top === 'number' ? obj.top.toFixed(2) : obj.top || ''),
          escapeCSVValue(width ? width.toFixed(2) : ''),
          escapeCSVValue(height ? height.toFixed(2) : ''),
          escapeCSVValue(obj.stroke || ''),
          escapeCSVValue(obj.fill || ''),
          escapeCSVValue(obj.strokeWidth || ''),
          escapeCSVValue(obj.note || ''),
          escapeCSVValue((obj.checklistItems || []).join?.('; ') || ''),
          escapeCSVValue(obj.status || ''),
          escapeCSVValue(attachmentsCount)
        ];
        rows.push(row.join(','));
      });
    });

    if (Array.isArray(space.categories)) {
      space.categories.forEach(category => {
        const checklistCount = category?.checklist?.length || 0;
        const row = [
          escapeCSVValue(space.name || ''),
          '',
          'category',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          escapeCSVValue(category?.name || ''),
          escapeCSVValue(checklistCount),
          '',
          ''
        ];
        rows.push(row.join(','));
      });
    }

    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilename(space.name || 'space', 'space')}_export.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [spaces, annotationsByPage, scale]);

  const handleExportSpaceToPDF = useCallback(async (spaceId) => {
    if (!features?.excelExport) {
      alert('Space PDF Export is a Pro feature. Please upgrade.');
      return;
    }
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
      alert('Space not found.');
      return;
    }

    if (!pdfDoc) {
      alert('PDF is not ready yet. Please wait for the document to load.');
      return;
    }

    const assignedPages = space.assignedPages || [];
    if (assignedPages.length === 0) {
      alert('This space has no pages to export.');
      return;
    }

    try {
      const exportDoc = await PDFDocument.create();

      for (const pageEntry of assignedPages) {
        const pageNumber = pageEntry.pageId;
        if (!pageNumber) continue;

        const sourcePage = await pdfDoc.getPage(pageNumber);
        const viewport = sourcePage.getViewport({ scale: 1 });
        const { width: pageWidth, height: pageHeight } = viewport;

        const canvas = document.createElement('canvas');
        canvas.width = pageWidth;
        canvas.height = pageHeight;
        const context = canvas.getContext('2d');
        await sourcePage.render({
          canvasContext: context,
          viewport
        }).promise;

        if (pageEntry.wholePageIncluded === false && Array.isArray(pageEntry.regions) && pageEntry.regions.length > 0) {
          applyRegionMaskToCanvasContext(context, pageEntry.regions, 1);
        }

        const dataUrl = canvas.toDataURL('image/png');
        const imageBytes = dataURLToUint8Array(dataUrl);
        const pngImage = await exportDoc.embedPng(imageBytes);
        const exportPage = exportDoc.addPage([pageWidth, pageHeight]);
        exportPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight
        });
      }

      const pdfBytes = await exportDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFilename(space.name || 'space', 'space')}_export.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting space to PDF:', error);
      alert('Unable to export this space to PDF. Please try again.');
    }
  }, [spaces, pdfDoc]);

  const handleSpaceDelete = useCallback((id) => {
    setSpaces(prev => prev.filter(s => s.id !== id));
    if (activeSpaceId === id) {
      setActiveSpaceId(null);
    }
  }, [activeSpaceId]);

  const handleSetActiveSpace = useCallback((spaceId) => {
    setActiveSpaceId(spaceId);
  }, []);

  const handleExitSpaceMode = useCallback(() => {
    setActiveSpaceId(null);
  }, []);

  // Active space pages - compute which pages are included in the active space
  const activeSpacePages = useMemo(() => {
    if (!activeSpaceId) return null;
    const space = spaces.find(s => s.id === activeSpaceId);
    if (!space) return [];
    const pageSet = new Set(
      (space.assignedPages || [])
        .map(p => p?.pageId)
        .filter(pageId => typeof pageId === 'number' && !Number.isNaN(pageId))
    );
    return Array.from(pageSet).sort((a, b) => a - b);
  }, [activeSpaceId, spaces]);

  const annotationSpaceId = activeSpaceId ?? selectedSpaceId ?? null;

  useEffect(() => {
    if (!selectedTemplate || !selectedModuleId) return;
    const moduleName = getModuleName(selectedTemplate, selectedModuleId);
    /* console.log('[Survey Debug] Active module updated', {
      moduleId: selectedModuleId,
      moduleName,
      activeSpaceId,
      selectedSpaceId,
      effectiveAnnotationSpaceId: annotationSpaceId
    }); */
  }, [selectedModuleId, selectedTemplate, activeSpaceId, selectedSpaceId, annotationSpaceId]);

  useEffect(() => {
    const moduleName = selectedTemplate && selectedModuleId
      ? getModuleName(selectedTemplate, selectedModuleId)
      : null;
    /* console.log('[Survey Debug] Space context updated', {
      activeSpaceId,
      selectedSpaceId,
      effectiveAnnotationSpaceId: annotationSpaceId,
      moduleId: selectedModuleId,
      moduleName
    }); */
  }, [activeSpaceId, selectedSpaceId, annotationSpaceId, selectedModuleId, selectedTemplate]);

  // Navigation functions
  const goToPage = useCallback((targetPage, options = {}) => {
    const { fallback = 'nearest' } = options;
    let desiredPage = targetPage;

    if (activeSpaceId) {
      if (!activeSpacePages || activeSpacePages.length === 0) {
        return;
      }

      if (!activeSpacePages.includes(desiredPage)) {
        if (fallback === 'next') {
          const next = activeSpacePages.find(page => page > desiredPage);
          if (!next) {
            return;
          }
          desiredPage = next;
        } else if (fallback === 'previous') {
          const prev = [...activeSpacePages].reverse().find(page => page < desiredPage);
          if (!prev) {
            return;
          }
          desiredPage = prev;
        } else {
          const next = activeSpacePages.find(page => page > desiredPage);
          const prev = [...activeSpacePages].reverse().find(page => page < desiredPage);
          desiredPage = next ?? prev ?? activeSpacePages[0];
        }
      }
    }

    if (desiredPage < 1 || desiredPage > numPages) return;

    if (scrollMode === 'single') {
      setPageNum(desiredPage);
    } else {
      isNavigatingRef.current = true;
      targetPageRef.current = desiredPage;

      const targetContainer = pageContainersRef.current[desiredPage];
      const container = containerRef.current;
      if (targetContainer && container) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = targetContainer.getBoundingClientRect();
        const computedStyles = window.getComputedStyle(container);
        const paddingTop = parseFloat(computedStyles.paddingTop || '0');
        const deltaTop = targetRect.top - containerRect.top;
        const nextScrollTop = Math.max(deltaTop + container.scrollTop - paddingTop, 0);

        container.scrollTo({
          top: nextScrollTop,
          behavior: 'smooth'
        });

        setTimeout(() => {
          setPageNum(desiredPage);
          // Force input value to match the target page immediately
          // This ensures consistency even if IntersectionObserver hasn't detected it yet
          setPageInputValue(String(desiredPage));
          setIsPageInputDirty(false);
          // Keep navigation flag briefly to prevent IntersectionObserver from interfering
          // Wait for smooth scroll animation to complete
          setTimeout(() => {
            isNavigatingRef.current = false;
            targetPageRef.current = null;
            // One more sync after navigation fully completes to ensure consistency
            setPageNum(prev => prev !== desiredPage ? desiredPage : prev);
          }, 150);
        }, 300);
      } else {
        // If container not found, still update pageNum immediately
        setPageNum(desiredPage);
        isNavigatingRef.current = false;
        targetPageRef.current = null;
        setPageInputValue(String(desiredPage));
        setIsPageInputDirty(false);
      }
    }
  }, [numPages, scrollMode, activeSpaceId, activeSpacePages]);

  // Compute search results grouped by page for efficient rendering
  const searchResultsByPage = useMemo(() => {
    if (!searchResults || searchResults.length === 0) {
      return {};
    }
    return searchResults.reduce((acc, result) => {
      if (!acc[result.pageNumber]) {
        acc[result.pageNumber] = [];
      }
      acc[result.pageNumber].push(result);
      return acc;
    }, {});
  }, [searchResults]);

  // Get current active match
  const currentMatch = useMemo(() => {
    if (currentMatchIndex >= 0 && currentMatchIndex < searchResults.length) {
      return searchResults[currentMatchIndex];
    }
    return null;
  }, [searchResults, currentMatchIndex]);

  const handleRequestRegionEdit = useCallback((spaceId, pageId) => {
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
      return;
    }

    const assignedPage = space.assignedPages?.find(p => p.pageId === pageId);
    if (!assignedPage) {
      return;
    }

    setActiveSpaceId(spaceId);
    setRegionSelectionPage(pageId);
    if (features?.advancedSurvey) {
      setShowRegionSelection(true);
    } else {
      alert('The Region Selection Tool is a Pro feature. Please upgrade to use this tool.');
    }
    goToPage(pageId, { fallback: 'nearest' });
  }, [spaces, goToPage]);

  const handleRegionSetFullPage = useCallback(() => {
    console.log('[App] ===== handleRegionSetFullPage CALLED =====', { activeSpaceId, regionSelectionPage });
    if (!activeSpaceId || !regionSelectionPage) {
      console.warn('[App] ERROR: Missing activeSpaceId or regionSelectionPage', { activeSpaceId, regionSelectionPage });
      return;
    }

    console.log('[App] Clearing all areas and setting full page mode');
    handleSpaceClearRegions(activeSpaceId, regionSelectionPage);

    // Close the region selection tool after setting full page
    console.log('[App] Closing region selection tool');
    setShowRegionSelection(false);
    setRegionSelectionPage(null);
    console.log('[App] ===== handleRegionSetFullPage COMPLETED =====');
  }, [activeSpaceId, regionSelectionPage, handleSpaceClearRegions]);

  const canSetRegionToFullPage = useMemo(() => {
    if (!activeSpaceId || !regionSelectionPage) return false;
    const space = spaces.find(s => s.id === activeSpaceId);
    if (!space) return false;
    const pageEntry = space.assignedPages?.find(p => p.pageId === regionSelectionPage);
    if (!pageEntry) return false;
    return pageEntry.wholePageIncluded === false;
  }, [spaces, activeSpaceId, regionSelectionPage]);

  const handleRegionComplete = useCallback((regions) => {
    if (!activeSpaceId || !regionSelectionPage) return;

    const space = spaces.find(s => s.id === activeSpaceId);
    if (!space) return;

    const updatedPages = [...(space.assignedPages || [])];
    const pageIndex = updatedPages.findIndex(p => p.pageId === regionSelectionPage);

    if (pageIndex >= 0) {
      updatedPages[pageIndex] = {
        ...updatedPages[pageIndex],
        wholePageIncluded: false,
        regions: Array.isArray(regions) ? regions : []
      };
    } else {
      updatedPages.push({
        pageId: regionSelectionPage,
        wholePageIncluded: false,
        regions: Array.isArray(regions) ? regions : []
      });
    }

    handleSpaceUpdate(activeSpaceId, { assignedPages: updatedPages });
    setShowRegionSelection(false);
    setRegionSelectionPage(null);
  }, [activeSpaceId, regionSelectionPage, spaces, handleSpaceUpdate]);

  // Templates are loaded from Supabase via Dashboard component
  // No need to load from localStorage here

  // Set PDF ID and load items/annotations when PDF changes
  useEffect(() => {
    // Reset to regular mode whenever the active PDF changes
    // Clear all PDF-specific state first to ensure clean transition
    setActiveSpaceId(null);
    setBookmarks([]);
    setSpaces([]);
    setPageNames({});
    setPageTransformations({});
    setShowSurveyPanel(false);
    setSelectedTemplate(null);
    setSelectedModuleId(null);
    setSelectedCategoryId(null);
    setShowRegionSelection(false);
    setRegionSelectionPage(null);
    setPendingHighlight(null);
    setPendingHighlightName(null);
    setHighlightNameInput('');
    setPendingBallInCourtSelection(null);
    setShowSpaceSelection(false);
    setShowTemplateSelection(false);
    setCopyModeActive(false);
    setCategorySelectModeActive(false);
    setCategorySelectModeForCategory(null);
    setSelectedCategories({});
    setItemSelectModeActive({});
    setSelectedItemsInCategory({});
    setShowCopyToSpacesModal(false);
    setTransferState(null);
    setCopiedItemSelection({});
    setSurveyResponses({});
    setNoteDialogOpen(null);
    setNoteDialogContent({ text: '', photos: [], videos: [] });
    setActiveTool('pan');


    if (!pdfFile) {
      setPdfId(null);
      setItems({});
      setAnnotations({});
      setHighlightAnnotations({});
      return;
    }

    const id = getPDFId(pdfFile);
    setPdfId(id);
    const data = loadPDFData(id);
    setItems(data.items);
    setAnnotations(data.annotations);
    // Load highlightAnnotations from localStorage
    const loadedHighlights = loadHighlightAnnotations(id);
    setHighlightAnnotations(loadedHighlights);
    // Load annotationsByPage from localStorage
    const loadedAnnotationsByPage = loadAnnotationsByPage(id);
    setAnnotationsByPage(loadedAnnotationsByPage);
    savedAnnotationsByPageRef.current = loadedAnnotationsByPage; // Track as saved
    setHasUnsavedAnnotations(false); // Reset unsaved flag
  }, [pdfFile]);

  // Save items and annotations to localStorage when they change
  useEffect(() => {
    if (!pdfId) return;
    savePDFData(pdfId, items, annotations);
  }, [pdfId, items, annotations]);

  // Save highlightAnnotations to localStorage when they change
  useEffect(() => {
    if (!pdfId) {
      // console.log('Skipping save - no pdfId');
      return;
    }
    // console.log('Saving highlightAnnotations to localStorage:', { pdfId, count: Object.keys(highlightAnnotations).length });
    saveHighlightAnnotations(pdfId, highlightAnnotations);
  }, [pdfId, highlightAnnotations]);

  // Track unsaved annotation changes
  const [hasUnsavedAnnotations, setHasUnsavedAnnotations] = useState(false);
  const savedAnnotationsByPageRef = useRef({});

  // Mark annotations as dirty when they change
  useEffect(() => {
    if (!pdfId) return;

    // Compare current with saved to detect changes
    const currentJson = JSON.stringify(annotationsByPage);
    const savedJson = JSON.stringify(savedAnnotationsByPageRef.current);

    if (currentJson !== savedJson && Object.keys(annotationsByPage).length > 0) {
      setHasUnsavedAnnotations(true);
      // Notify parent component
      if (onUnsavedAnnotationsChange) {
        onUnsavedAnnotationsChange(true);
      }
    } else {
      // Notify parent component when there are no unsaved changes
      if (onUnsavedAnnotationsChange) {
        onUnsavedAnnotationsChange(false);
      }
    }
  }, [pdfId, annotationsByPage, onUnsavedAnnotationsChange]);

  // Save survey data to Supabase Storage
  const saveSurveyDataToSupabase = useCallback(async (currentAnnotations, currentSpaces, currentTemplate) => {
    if (!pdfFile || !pdfFile.projectId || !pdfId) {
      console.log('Skipping Supabase save: missing context', { pdfFile, projectId: pdfFile?.projectId, pdfId });
      return;
    }

    try {
      console.log('Saving survey data to Supabase...');
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        pdfId,
        annotations: currentAnnotations, // highlightAnnotations
        annotationsByPage: annotationsByPage,
        spaces: currentSpaces,
        ballInCourtEntities: ballInCourtEntities,
        templateId: currentTemplate?.id || null,
        zoomLevel: scale,
        currentPage: pageNum
      };

      const jsonString = JSON.stringify(data);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const file = new File([blob], `${pdfFile.id}_data.json`, { type: 'application/json' });

      // Upload to storage: {projectId}/{documentId}_data.json
      const filePath = `${pdfFile.projectId}/${pdfFile.id}_data.json`;
      await uploadDataFile(file, filePath);

      // Update document metadata
      await updateSupabaseDocument(pdfFile.id, {
        current_page: pageNum,
        zoom_level: scale,
        template_id: currentTemplate?.id || null
      });

      console.log('Survey data saved to Supabase successfully');
    } catch (error) {
      console.error('Error saving survey data to Supabase:', error);
      // Don't alert here to avoid interrupting the user flow, just log
    }
  }, [pdfFile, pdfId, annotationsByPage, ballInCourtEntities, scale, pageNum, uploadDataFile, updateSupabaseDocument]);

  // Load survey data from Supabase Storage
  const loadSurveyDataFromSupabase = useCallback(async (doc) => {
    if (!doc || !doc.projectId) return;

    try {
      console.log('Loading survey data from Supabase for doc:', doc.id);
      const filePath = `${doc.projectId}/${doc.id}_data.json`;

      // Check if file exists by trying to get URL (or just try download and catch error)
      // We'll just try to download
      const dataBlob = await downloadFromStorage(filePath);
      if (!dataBlob) return;

      const text = await dataBlob.text();
      const data = JSON.parse(text);

      console.log('Loaded survey data:', data);

      // Verify it matches this PDF
      if (data.pdfId && data.pdfId !== getPDFId(pdfFile)) {
        console.warn('Loaded data PDF ID mismatch. Ignoring.');
        // return; // Optional: decide whether to load anyway or warn
      }

      // Restore state
      if (data.annotations) setHighlightAnnotations(data.annotations);
      if (data.annotationsByPage) {
        setAnnotationsByPage(data.annotationsByPage);
        savedAnnotationsByPageRef.current = data.annotationsByPage;
      }
      if (data.spaces) setSpaces(data.spaces);
      if (data.ballInCourtEntities) setBallInCourtEntities(data.ballInCourtEntities);

      // Restore view state if available
      if (data.zoomLevel) setScale(data.zoomLevel);
      if (data.currentPage) setPageNum(data.currentPage);

      // Template restoration is handled by the document's template_id usually, 
      // but we can fallback to data.templateId if needed.

    } catch (error) {
      // It's normal for new documents to not have data yet
      console.log('No existing survey data found or error loading:', error.message);
    }
  }, [downloadFromStorage, pdfFile]);

  // Save function for annotations (triggered by Cmd/Ctrl+S or auto-save)
  // silent=true skips alerts (for auto-save)
  const handleSaveDocument = useCallback(async (silent = false) => {
    // Feature Gate: Cloud Sync
    if (!features?.cloudSync) {
      if (!silent) console.log('Cloud sync skipped (Free Plan)');
      // Ensure we still save locally if possible
    }
    if (!pdfId || !pdfFile) return;

    try {
      console.log('Saving document with embedded annotations...', silent ? '(auto-save)' : '');
      console.log('PDF file path:', pdfFilePath);

      // Save PDF with embedded annotations (overwrites original file if path available)
      await savePDFWithAnnotationsPdfLib(pdfFile, annotationsByPage, pageSizes, pdfFilePath);

      // Also save to localStorage as backup (for loading next time)
      saveAnnotationsByPage(pdfId, annotationsByPage);
      savedAnnotationsByPageRef.current = { ...annotationsByPage };
      setHasUnsavedAnnotations(false);
      // Notify parent component that changes have been saved
      if (onUnsavedAnnotationsChange) {
        onUnsavedAnnotationsChange(false);
      }

      console.log('Document saved successfully');
      if (!silent) {
        alert('PDF saved with annotations! The file has been updated.');
      }

      // Sync survey data to Supabase (separate from PDF file)
      if (features?.cloudSync) {
        await saveSurveyDataToSupabase(highlightAnnotations, spaces, selectedTemplate);
      } else {
        console.log('Skipping Supabase sync (Free Plan)');
      }
    } catch (error) {
      console.error('Error saving document:', error);
      if (!silent) {
        alert('Error saving PDF: ' + error.message);
      }
    }
  }, [pdfId, pdfFile, annotationsByPage, pageSizes, pdfFilePath, onUnsavedAnnotationsChange]);

  // Auto-save every 30 seconds when there are unsaved changes and a file path is available
  useEffect(() => {
    // Only enable auto-save if we have a file path (local file) and unsaved changes
    if (!pdfFilePath || !hasUnsavedAnnotations) {
      return;
    }

    const autoSaveInterval = setInterval(() => {
      console.log('Auto-saving document...');
      handleSaveDocument(true); // silent=true for auto-save
    }, 30000); // 30 seconds

    return () => clearInterval(autoSaveInterval);
  }, [pdfFilePath, hasUnsavedAnnotations, handleSaveDocument]);

  // Handle app quit - save before closing
  useEffect(() => {
    if (!window.electronAPI?.onBeforeQuit) {
      return;
    }

    const handleBeforeQuit = async () => {
      console.log('App is quitting, saving document...');
      if (pdfFilePath && hasUnsavedAnnotations) {
        try {
          await handleSaveDocument(true); // silent=true
          console.log('Document saved before quit');
        } catch (error) {
          console.error('Error saving before quit:', error);
        }
      }
      // Notify main process that save is complete
      if (window.electronAPI?.notifySaveComplete) {
        window.electronAPI.notifySaveComplete();
      }
    };

    const removeListener = window.electronAPI.onBeforeQuit(handleBeforeQuit);
    return removeListener;
  }, [pdfFilePath, hasUnsavedAnnotations, handleSaveDocument]);

  // Load note content when note dialog opens
  useEffect(() => {
    if (!noteDialogOpen) {
      return;
    }

    // For item-level notes, noteDialogOpen is just the highlightId
    const highlightId = noteDialogOpen;

    console.log('Note dialog opened for item:', highlightId);

    const existingNote = highlightAnnotations[highlightId]?.note;

    console.log('Found item-level note:', existingNote);

    if (existingNote) {
      setNoteDialogContent({
        text: existingNote.text || '',
        photos: existingNote.photos || [],
        videos: existingNote.videos || []
      });
    } else {
      setNoteDialogContent({ text: '', photos: [], videos: [] });
    }
  }, [noteDialogOpen, highlightAnnotations]);

  // Migrate legacy highlights to new system (one-time, when template is selected)
  useEffect(() => {
    if (!selectedTemplate || !pdfId || Object.keys(highlightAnnotations).length === 0) return;
    if (Object.keys(items).length > 0) return; // Already migrated or has data

    const migrated = migrateLegacyHighlights(highlightAnnotations, items, annotations, selectedTemplate);
    if (Object.keys(migrated.items).length > 0) {
      setItems(migrated.items);
      setAnnotations(migrated.annotations);
      // Optionally clear legacy data
      // setHighlightAnnotations({});
    }
  }, [selectedTemplate, pdfId]); // Only run when template changes

  // Load PDF
  useEffect(() => {
    // console.log('PDFViewer useEffect triggered. pdfFile:', pdfFile);
    if (!pdfFile) {
      console.log('No PDF file provided to viewer');
      return;
    }

    const loadPDF = async () => {
      try {
        // Suppress PDF.js warnings
        pdfjsLib.verbosity = pdfjsLib.VerbosityLevel.ERRORS;

        setIsLoadingPDF(true);

        let arrayBuffer;
        if (typeof pdfFile.arrayBuffer === 'function') {
          // Local file
          arrayBuffer = await pdfFile.arrayBuffer();
        } else if (pdfFile.filePath) {
          // Supabase file - download it
          console.log('Downloading PDF from Supabase:', pdfFile.filePath);
          const blob = await downloadFromStorage(pdfFile.filePath);
          if (!blob) throw new Error('Failed to download PDF');
          arrayBuffer = await blob.arrayBuffer();
        } else {
          throw new Error('Invalid file object: missing arrayBuffer and filePath');
        }

        // console.log('ArrayBuffer created, size:', arrayBuffer.byteLength);
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        // console.log('PDF loaded successfully. Pages:', pdf.numPages);
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
        setPageNum(1);

        // Load project data from Supabase if available
        if (pdfFile.projectId) {
          await loadSurveyDataFromSupabase(pdfFile);
        }

        // Calculate page sizes for layout and annotation layer
        const heights = {};
        const sizes = {};
        const pages = {};
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.0 });
          heights[i] = viewport.height;
          sizes[i] = { width: viewport.width, height: viewport.height };
          pages[i] = page; // Store page object for text layer
        }
        // console.log('Page sizes calculated:', Object.keys(sizes).length, 'pages');
        setPageHeights(heights);
        setPageSizes(sizes);
        setPageObjects(pages);

        // Clear render cache when new PDF loads
        pageRenderCacheRef.current.clear();
        setRenderedPages(new Set());
        lastScaleRef.current = scale;

        // Import existing PDF annotations as editable Fabric.js objects
        try {
          console.log('Importing PDF annotations...');
          const { annotationsByPage: importedAnnotations, unsupportedTypes } = await importAnnotationsFromPdf(pdf);

          if (Object.keys(importedAnnotations).length > 0) {
            console.log(`Imported annotations from ${Object.keys(importedAnnotations).length} pages`);
            // Merge imported annotations with any existing annotations
            setAnnotationsByPage(prev => {
              const merged = { ...prev };
              Object.entries(importedAnnotations).forEach(([pageNum, pageData]) => {
                if (merged[pageNum]) {
                  // Merge objects, keeping existing and adding imported
                  merged[pageNum] = {
                    ...merged[pageNum],
                    objects: [
                      ...(merged[pageNum].objects || []),
                      ...(pageData.objects || [])
                    ]
                  };
                } else {
                  merged[pageNum] = pageData;
                }
              });
              return merged;
            });
          }

          // Track unsupported annotation types for notification
          if (unsupportedTypes.length > 0) {
            console.log('Unsupported annotation types found:', unsupportedTypes);
            setUnsupportedAnnotationTypes(unsupportedTypes);
            setShowUnsupportedNotice(true);
          }
        } catch (importError) {
          console.error('Error importing PDF annotations:', importError);
          // Don't block PDF loading if annotation import fails
        }

        // Worker-based rendering is disabled because pdfFile is loaded from Supabase Storage
        // as a URL/blob, not as a File object with an .id property.
        // The simple canvas rendering in PDFPageCanvas will handle rendering on the main thread.

        setIsLoadingPDF(false);

      } catch (error) {
        console.error('Error loading PDF:', error);
        console.error('Error stack:', error.stack);
        setIsLoadingPDF(false);
        alert('Error loading PDF: ' + error.message + '. Please try uploading the file again.');
      }
    };

    loadPDF();
  }, [pdfFile]);

  // Memoized render page function with caching
  // NOTE: Rendering is now handled by PDFPageCanvas. This function is kept for compatibility
  // with preRenderNearbyPages and IntersectionObserver logic, but it no longer draws to canvas directly.
  const renderPage = useCallback(async (pageNumber, priority = 'normal') => {
    if (!pdfDoc) return;

    // We can use this to trigger pre-fetching or other logic if needed,
    // but for now, PDFPageTiles handles the heavy lifting.
    // We might want to ensure the page is loaded in pageObjects though.

    // If we need to track "rendered" state for other logic:
    // setRenderedPages(prev => new Set([...prev, pageNumber]));

  }, [pdfDoc, scale]);

  // Pre-render nearby pages for instant display
  const preRenderNearbyPages = useCallback((currentPage) => {
    if (!pdfDoc || scrollMode !== 'continuous') return;

    const preRenderDistance = 2; // Pre-render 2 pages ahead and behind
    const pagesToPreRender = [];

    for (let i = Math.max(1, currentPage - preRenderDistance);
      i <= Math.min(numPages, currentPage + preRenderDistance);
      i++) {
      // Use functional approach to avoid renderedPages dependency
      if (i !== currentPage &&
        !preRenderQueueRef.current.has(i) &&
        !pageRenderCacheRef.current.has(i, scale)) {
        pagesToPreRender.push(i);
      }
    }

    // Pre-render pages in background (lower priority)
    pagesToPreRender.forEach(pageNum => {
      preRenderQueueRef.current.add(pageNum);
      // Use requestIdleCallback if available, otherwise setTimeout
      const scheduleRender = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));
      scheduleRender(() => {
        renderPage(pageNum, 'low').finally(() => {
          preRenderQueueRef.current.delete(pageNum);
        });
      });
    });
  }, [pdfDoc, scrollMode, numPages, scale, renderPage]);

  // Optimized IntersectionObserver with debouncing
  useEffect(() => {
    if (scrollMode !== 'continuous' || !pdfDoc) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    let visiblePages = new Map(); // Map of pageNumber -> intersectionRatio
    let updateTimer = null;

    const observer = new IntersectionObserver((entries) => {
      // Always process entries to ensure pages are rendered even during navigation.
      // We only gate the pageNum update below, not rendering.
      const pagesToMount = new Set();

      entries.forEach(entry => {
        const pageNumber = parseInt(entry.target.dataset.pageNum);

        if (entry.isIntersecting) {
          // Store the intersection ratio for this page
          visiblePages.set(pageNumber, entry.intersectionRatio);

          // Mount this page and nearby pages
          const mountDistance = 3; // Mount pages within 3 pages of visible
          for (let i = Math.max(1, pageNumber - mountDistance);
            i <= Math.min(numPages, pageNumber + mountDistance);
            i++) {
            pagesToMount.add(i);
          }

          setRenderedPages(prev => {
            if (!prev.has(pageNumber)) {
              // Check if canvas exists before trying to render
              const canvas = canvasRef.current[pageNumber];
              if (canvas) {
                renderPage(pageNumber, 'high'); // High priority for visible pages
              }
            }
            return prev;
          });

          // Pre-render nearby pages for instant scrolling
          preRenderNearbyPages(pageNumber);
        } else {
          visiblePages.delete(pageNumber);
        }
      });

      // Update mounted pages if any changes
      if (pagesToMount.size > 0) {
        setMountedPages(prev => {
          const newSet = new Set([...prev, ...pagesToMount]);
          return newSet.size === prev.size ? prev : newSet;
        });
      }

      // Debounce page number updates
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        // Only update pageNum if we're not navigating programmatically
        // and if there are visible pages to check
        if (visiblePages.size > 0 && !isNavigatingRef.current && targetPageRef.current === null && !isZoomingRef.current) {
          // Find the page with the highest intersection ratio (most visible)
          let maxRatio = 0;
          let mostVisiblePage = 1;
          visiblePages.forEach((ratio, pageNum) => {
            if (ratio > maxRatio) {
              maxRatio = ratio;
              mostVisiblePage = pageNum;
            }
          });
          // Only update if the detected page is different from current
          // This prevents unnecessary updates that might interfere with navigation
          setPageNum(prevPage => {
            if (prevPage !== mostVisiblePage) {
              return mostVisiblePage;
            }
            return prevPage;
          });
        }
      }, 50);
    }, {
      root: containerRef.current,
      rootMargin: '2000px', // Increased to pre-render pages earlier
      threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0]
    });

    observerRef.current = observer;

    // Use a small timeout to ensure DOM elements are mounted
    const setupTimer = setTimeout(() => {
      const containers = Object.values(pageContainersRef.current).filter(Boolean);
      // console.log('Setting up IntersectionObserver for', containers.length, 'page containers');
      containers.forEach(container => {
        if (container) {
          observer.observe(container);
        }
      });
    }, 100);

    // Failsafe: Reset navigation guards if they're stuck for too long
    // This ensures page number updates always resume after a reasonable timeout
    const failsafeTimer = setInterval(() => {
      if (isNavigatingRef.current || targetPageRef.current !== null || isZoomingRef.current) {
        console.warn('Navigation guards have been active for >2s, resetting for safety');
        isNavigatingRef.current = false;
        targetPageRef.current = null;
        isZoomingRef.current = false;
      }
    }, 2000);

    return () => {
      clearTimeout(setupTimer);
      clearInterval(failsafeTimer);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      clearTimeout(updateTimer);
    };
  }, [pdfDoc, scrollMode, renderPage, preRenderNearbyPages]);

  // Render single page mode with pre-rendering
  useEffect(() => {
    if (scrollMode !== 'single' || !pdfDoc) return;
    renderPage(pageNum);

    // Pre-render adjacent pages for instant navigation
    if (pageNum > 1) {
      renderPage(pageNum - 1, 'low');
    }
    if (pageNum < numPages) {
      renderPage(pageNum + 1, 'low');
    }
  }, [scrollMode, pdfDoc, pageNum, scale, renderPage, numPages]);

  // Render first page when PDF loads in continuous mode
  // NOTE: PDFPageCanvas handles rendering automatically when mounted.
  // We don't need to manually trigger renderPage(1) here anymore.
  useEffect(() => {
    // Legacy cleanup
  }, []);

  // Re-render all visible pages when scale changes
  useEffect(() => {
    if (!pdfDoc) return;

    // Clear cache for old scale (keep cache for other scales in case user zooms back)
    // Only clear if scale changed significantly
    const prevScale = lastScaleRef.current;
    if (Math.abs(prevScale - scale) > 0.1) {
      // Clear cache entries that are far from current scale
      lastScaleRef.current = scale;
    }

    setRenderedPages(new Set());

    if (scrollMode === 'single') {
      renderPage(pageNum);
    }
    // IntersectionObserver will handle continuous mode
  }, [scale, pdfDoc, scrollMode, pageNum, renderPage]);

  // Re-render pages when transformations change (CSS transforms apply automatically, but this ensures consistency)
  useEffect(() => {
    if (!pdfDoc) return;

    // CSS transforms will apply automatically, no need to re-render canvas
    // This effect is here for potential future enhancements
  }, [pageTransformations, pdfDoc]);

  // Check if panning is available
  useEffect(() => {
    const checkCanPan = () => {
      const container = containerRef.current;
      const content = contentRef.current || container;
      if (!container) return;

      const contentExceedsViewport =
        content.scrollWidth > container.clientWidth ||
        content.scrollHeight > container.clientHeight;

      setCanPan(contentExceedsViewport);
    };

    checkCanPan();

    window.addEventListener('resize', checkCanPan);
    return () => window.removeEventListener('resize', checkCanPan);
  }, [scale, pdfDoc, scrollMode]);

  // Store zoom adjustment data  
  const zoomDataRef = useRef(null);

  const goToPreviousPage = useCallback(() => {
    goToPage(pageNum - 1, { fallback: 'previous' });
  }, [goToPage, pageNum]);

  const goToNextPage = useCallback(() => {
    goToPage(pageNum + 1, { fallback: 'next' });
  }, [goToPage, pageNum]);

  const setScaleWithViewportPreservation = useCallback((incomingScale, options = {}) => {
    const container = containerRef.current;
    const previousScale = scaleRef.current || 1.0;
    const safeScale = clampScale(incomingScale);

    if (!container) {
      if (Math.abs(safeScale - previousScale) > 0.0001 || options.force) {
        scaleRef.current = safeScale;
        setScale(safeScale);
      }
      return;
    }

    if (Math.abs(safeScale - previousScale) < 0.0001 && !options.force) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const anchor = options.anchor || {};
    const anchorX = typeof anchor.x === 'number' ? anchor.x : rect.width / 2;
    const anchorY = typeof anchor.y === 'number' ? anchor.y : rect.height / 2;
    const oldScrollLeft = container.scrollLeft;
    const oldScrollTop = container.scrollTop;
    const safePreviousScale = previousScale || 1.0;
    const scaleFactor = safeScale / safePreviousScale;

    const newScrollLeft = (oldScrollLeft + anchorX) * scaleFactor - anchorX;
    const newScrollTop = (oldScrollTop + anchorY) * scaleFactor - anchorY;

    zoomDataRef.current = {
      newScrollLeft,
      newScrollTop
    };

    isZoomingRef.current = true;
    scaleRef.current = safeScale;
    setScale(safeScale);

    const applyScrollAdjustment = () => {
      const currentContainer = containerRef.current;
      if (!currentContainer || !currentContainer.isConnected || !zoomDataRef.current) return;

      const data = zoomDataRef.current;
      const currentRect = currentContainer.getBoundingClientRect();

      const maxScrollLeft = Math.max(0, currentContainer.scrollWidth - currentRect.width);
      const maxScrollTop = Math.max(0, currentContainer.scrollHeight - currentRect.height);

      const finalLeft = Math.max(0, Math.min(data.newScrollLeft, maxScrollLeft));
      const finalTop = Math.max(0, Math.min(data.newScrollTop, maxScrollTop));

      currentContainer.scrollLeft = finalLeft;
      currentContainer.scrollTop = finalTop;

      zoomDataRef.current = null;
      isZoomingRef.current = false;
    };

    setTimeout(applyScrollAdjustment, 0);
    setTimeout(applyScrollAdjustment, 16);
    setTimeout(applyScrollAdjustment, 50);
    setTimeout(applyScrollAdjustment, 100);
    requestAnimationFrame(() => {
      requestAnimationFrame(applyScrollAdjustment);
    });
  }, [setScale]);

  // Navigate to a search match with zoom and centering
  const navigateToMatch = useCallback((match, index) => {
    if (!match || !containerRef.current) return;

    // Prevent recursive navigation
    if (isNavigatingToMatchRef.current) return;
    isNavigatingToMatchRef.current = true;

    setCurrentMatchIndex(index);

    const pageNumber = match.pageNumber;
    const bounds = match.bounds;

    // First, navigate to the page
    if (scrollMode === 'single') {
      setPageNum(pageNumber);
    }

    // Calculate optimal zoom and scroll position
    const performZoomAndCenter = () => {
      const container = containerRef.current;
      const pageContainer = pageContainersRef.current[pageNumber];

      if (!container || !pageContainer) {
        isNavigatingToMatchRef.current = false;
        return;
      }

      // Get page dimensions
      const pageSize = pageSizes[pageNumber];
      if (!pageSize || !bounds) {
        // Just navigate to page if no bounds available
        if (scrollMode === 'continuous') {
          goToPage(pageNumber);
        }
        isNavigatingToMatchRef.current = false;
        return;
      }

      // Calculate optimal zoom level to show the match with context
      // Target: match should take up about 15-25% of viewport width
      const containerRect = container.getBoundingClientRect();
      const viewportWidth = containerRect.width * 0.7; // Account for sidebar
      const viewportHeight = containerRect.height * 0.7;

      // Add padding around the match bounds for context
      const paddingFactor = 3; // Show 3x the match size for context
      const targetWidth = Math.max(bounds.width * paddingFactor, 200);
      const targetHeight = Math.max(bounds.height * paddingFactor, 100);

      // Calculate zoom to fit the target area comfortably
      const zoomForWidth = viewportWidth / targetWidth;
      const zoomForHeight = viewportHeight / targetHeight;
      let targetZoom = Math.min(zoomForWidth, zoomForHeight);

      // Clamp zoom to reasonable bounds (don't zoom too far in or out)
      targetZoom = Math.max(1.0, Math.min(targetZoom, 3.0));

      // Only zoom if significantly different from current zoom
      const currentScale = scaleRef.current;
      const shouldZoom = Math.abs(targetZoom - currentScale) > 0.1 && targetZoom > currentScale;

      if (shouldZoom) {
        // Store original zoom level if not already stored
        if (searchZoomLevelRef.current === null) {
          searchZoomLevelRef.current = currentScale;
        }

        // Apply zoom
        setScaleWithViewportPreservation(targetZoom, { preserveCenter: false });
      }

      // Calculate scroll position to center the match
      const scrollToMatch = () => {
        const updatedScale = shouldZoom ? targetZoom : currentScale;
        const pageContainerCurrent = pageContainersRef.current[pageNumber];

        if (!pageContainerCurrent) {
          isNavigatingToMatchRef.current = false;
          return;
        }

        // Get the current positions
        const containerRectCurrent = container.getBoundingClientRect();
        const pageRect = pageContainerCurrent.getBoundingClientRect();

        // Calculate the match center position in viewport coordinates
        const matchCenterX = bounds.centerX * updatedScale;
        const matchCenterY = bounds.centerY * updatedScale;

        // Calculate the offset from page container to match center
        const pageOffsetX = pageRect.left - containerRectCurrent.left + container.scrollLeft;
        const pageOffsetY = pageRect.top - containerRectCurrent.top + container.scrollTop;

        // Calculate target scroll position to center the match
        const targetScrollX = pageOffsetX + matchCenterX - containerRectCurrent.width / 2;
        const targetScrollY = pageOffsetY + matchCenterY - containerRectCurrent.height / 2;

        // Smooth scroll to the match
        container.scrollTo({
          left: Math.max(0, targetScrollX),
          top: Math.max(0, targetScrollY),
          behavior: 'smooth'
        });

        // Clear navigation flag after scroll completes
        setTimeout(() => {
          isNavigatingToMatchRef.current = false;
        }, 400);
      };

      // If we zoomed, wait for the zoom to apply before scrolling
      if (shouldZoom) {
        setTimeout(scrollToMatch, 150);
      } else {
        // If in continuous mode, first navigate to page then scroll to match
        if (scrollMode === 'continuous') {
          const pageContainerTarget = pageContainersRef.current[pageNumber];
          if (pageContainerTarget) {
            const containerRectCurrent = container.getBoundingClientRect();
            const pageRect = pageContainerTarget.getBoundingClientRect();

            // Calculate position to center the match in viewport
            const matchCenterY = bounds.centerY * currentScale;
            const pageTopInContainer = pageRect.top - containerRectCurrent.top + container.scrollTop;
            const targetScrollY = pageTopInContainer + matchCenterY - containerRectCurrent.height / 2;

            container.scrollTo({
              top: Math.max(0, targetScrollY),
              behavior: 'smooth'
            });
          }
        }

        setTimeout(() => {
          isNavigatingToMatchRef.current = false;
        }, 400);
      }
    };

    // Execute zoom and center after a short delay to ensure page is rendered
    if (scrollMode === 'continuous') {
      // First scroll to page area, then fine-tune
      const pageContainer = pageContainersRef.current[pageNumber];
      if (pageContainer) {
        const container = containerRef.current;
        const containerRect = container.getBoundingClientRect();
        const pageRect = pageContainer.getBoundingClientRect();
        const paddingTop = parseFloat(window.getComputedStyle(container).paddingTop || '0');
        const deltaTop = pageRect.top - containerRect.top;
        const nextScrollTop = Math.max(deltaTop + container.scrollTop - paddingTop, 0);

        container.scrollTo({
          top: nextScrollTop,
          behavior: 'auto' // Instant scroll to page first
        });
      }
      setTimeout(performZoomAndCenter, 100);
    } else {
      setTimeout(performZoomAndCenter, 50);
    }
  }, [scrollMode, pageSizes, goToPage, setScaleWithViewportPreservation]);

  // Handler for search results change from SearchTextPanel
  const handleSearchResultsChange = useCallback((results) => {
    setSearchResults(results);
    // Reset zoom when search changes
    if (searchZoomLevelRef.current !== null && results.length === 0) {
      setScaleWithViewportPreservation(searchZoomLevelRef.current);
      searchZoomLevelRef.current = null;
    }
  }, [setScaleWithViewportPreservation]);

  // Handler for current match index change
  const handleCurrentMatchIndexChange = useCallback((index) => {
    setCurrentMatchIndex(index);
  }, []);

  if (!zoomControllerRef.current) {
    zoomControllerRef.current = createZoomController({
      initialMode: initialZoomPreferences.mode,
      initialManualScale: initialZoomPreferences.manualScale,
      getContainer: () => containerRef.current,
      getViewportSize: (containerEl) => {
        const containerNode = containerEl || containerRef.current;
        if (!containerNode) return null;
        if (typeof window === 'undefined') {
          return {
            width: containerNode.clientWidth,
            height: containerNode.clientHeight
          };
        }
        const computed = window.getComputedStyle(containerNode);
        const horizontalPadding =
          parseFloat(computed.paddingLeft || '0') + parseFloat(computed.paddingRight || '0');
        const verticalPadding =
          parseFloat(computed.paddingTop || '0') + parseFloat(computed.paddingBottom || '0');
        return {
          width: Math.max(containerNode.clientWidth - horizontalPadding, 0),
          height: Math.max(containerNode.clientHeight - verticalPadding, 0)
        };
      },
      getPageSize: () => {
        const sizes = pageSizesRef.current;
        if (!sizes) return null;
        const current = sizes[pageNumRef.current];
        if (current) return current;
        const firstKey = Object.keys(sizes)[0];
        return firstKey ? sizes[firstKey] : null;
      },
      getCurrentScale: () => scaleRef.current,
      setScale: (value, context) => setScaleWithViewportPreservation(value, context),
      onModeChange: (mode) => {
        setZoomMode((prev) => (prev === mode ? prev : mode));
      },
      onManualScaleChange: (value) => {
        setManualZoomScale((prev) => (Math.abs(prev - value) < 0.0001 ? prev : value));
      },
      persistPreferences: (prefs) => {
        persistZoomPreferences(prefs);
      }
    });
  }

  const zoomIn = useCallback(() => {
    const controller = zoomControllerRef.current;
    if (!controller) return;
    const basisScale = scaleRef.current || manualZoomScaleRef.current || 1.0;
    const nextScale = clampScale(basisScale * 1.2);
    controller.setScale(nextScale);
  }, []);

  const zoomOut = useCallback(() => {
    const controller = zoomControllerRef.current;
    if (!controller) return;
    const basisScale = scaleRef.current || manualZoomScaleRef.current || 1.0;
    const nextScale = clampScale(basisScale / 1.2);
    controller.setScale(nextScale);
  }, []);

  const resetZoom = useCallback(() => {
    const controller = zoomControllerRef.current;
    if (!controller) return;
    controller.setScale(DEFAULT_ZOOM_PREFERENCES.manualScale);
  }, []);

  // OPTIMIZED: Wheel handler with throttling
  const wheelTimerRef = useRef(null);
  const handleWheel = useCallback((e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      if (wheelTimerRef.current) return;

      wheelTimerRef.current = setTimeout(() => {
        wheelTimerRef.current = null;
      }, 50);

      const deltaFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const currentScale = scaleRef.current || manualZoomScaleRef.current || 1.0;
      const nextScale = clampScale(currentScale * deltaFactor);

      if (Math.abs(nextScale - currentScale) > 0.0001) {
        zoomControllerRef.current?.setScale(nextScale);
      }
    }
  }, []);

  // Attach wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const wheelHandler = (e) => {
      // Only handle if the event target is within our PDF container
      if (containerRef.current?.contains(e.target)) {
        handleWheel(e);
      }
    };

    // Listen on document with capture phase to catch events before they bubble
    document.addEventListener('wheel', wheelHandler, { passive: false, capture: true });

    return () => {
      document.removeEventListener('wheel', wheelHandler, { capture: true });
    };
  }, [handleWheel]);

  // Optimized pan handling
  const handleMouseDown = useCallback((e) => {
    // Only allow pan when:
    // 1. Pan tool is active
    // 2. Region selection is not active
    // 3. Can pan (content exceeds viewport)
    // 4. Left mouse button
    if (activeTool === 'pan' && !showRegionSelection && canPan && e.button === 0) {
      // Check if click is on an annotation layer canvas
      // Annotation layers use canvas elements for Fabric.js
      const target = e.target;
      const isOnAnnotationCanvas = target.tagName === 'CANVAS' && 
        target.closest('.page-container') !== null;
      
      if (isOnAnnotationCanvas) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:1194',message:'Canvas click detected in pan tool',data:{clientX:e.clientX,clientY:e.clientY,canPan:canPan,activeTool:activeTool},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // Track canvas mouse down - we'll start panning in handleMouseMove if mouse moves
        // (indicating empty space drag, not annotation interaction)
        canvasMouseDownRef.current = {
          x: e.clientX + containerRef.current.scrollLeft,
          y: e.clientY + containerRef.current.scrollTop,
          clientX: e.clientX,
          clientY: e.clientY
        };
        // Don't prevent default - let annotation layer handle it
        // If annotation layer prevents default (annotation interaction), it will handle it
        // If annotation layer doesn't prevent default (empty space), we'll pan on mouse move
        return;
      }

      // Click is on empty space or PDF background - allow container panning
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:11710',message:'Starting panning on non-canvas click',data:{clientX:e.clientX,clientY:e.clientY,targetTag:e.target.tagName},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      setIsPanning(true);
      setPanStart({
        x: e.clientX + containerRef.current.scrollLeft,
        y: e.clientY + containerRef.current.scrollTop
      });
      e.preventDefault();
    }
  }, [activeTool, showRegionSelection, canPan]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning) {
      const container = containerRef.current;
      if (container) {
        container.scrollLeft = panStart.x - e.clientX;
        container.scrollTop = panStart.y - e.clientY;
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:11723',message:'Panning active',data:{scrollLeft:container?.scrollLeft,scrollTop:container?.scrollTop,clientX:e.clientX,clientY:e.clientY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
    } else if (activeTool === 'pan' && !showRegionSelection && canPan && canvasMouseDownRef.current) {
      // Check if mouse has moved enough to start panning (empty space drag on canvas)
      const start = canvasMouseDownRef.current;
      const moveDistance = Math.sqrt(
        Math.pow(e.clientX - start.clientX, 2) + 
        Math.pow(e.clientY - start.clientY, 2)
      );
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:11729',message:'Canvas drag detected, checking distance',data:{moveDistance:moveDistance.toFixed(2),threshold:5,willStartPanning:moveDistance>5,clientX:e.clientX,clientY:e.clientY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      // Start panning if mouse moved more than 5px (same threshold as annotation selection)
      if (moveDistance > 5) {
        setIsPanning(true);
        setPanStart({
          x: start.x,
          y: start.y
        });
        canvasMouseDownRef.current = null; // Clear after starting pan
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ca82909f-645c-4959-9621-26884e513e65',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.jsx:11736',message:'Starting panning from canvas drag',data:{panStartX:start.x,panStartY:start.y},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
      }
    }
  }, [isPanning, panStart, activeTool, showRegionSelection, canPan]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    canvasMouseDownRef.current = null; // Clear canvas mouse down tracking
  }, []);

  // Stop panning if tool changes away from pan or region selection becomes active
  useEffect(() => {
    if (activeTool !== 'pan' || showRegionSelection) {
      setIsPanning(false);
    }
  }, [activeTool, showRegionSelection]);

  // Track eraser cursor position when eraser tool is active
  useEffect(() => {
    if (activeTool !== 'eraser') {
      setEraserCursorPos(prev => ({ ...prev, visible: false }));
      return;
    }

    const handleMouseMove = (e) => {
      // Check if cursor is within the PDF container viewport
      const pdfContainer = document.querySelector('[data-testid="pdf-container"]');
      let isWithinViewport = false;

      if (pdfContainer) {
        const rect = pdfContainer.getBoundingClientRect();
        isWithinViewport = (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        );
      }

      setEraserCursorPos({
        x: e.clientX,
        y: e.clientY,
        visible: isWithinViewport
      });
    };

    const handleMouseLeave = () => {
      setEraserCursorPos(prev => ({ ...prev, visible: false }));
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [activeTool]);

  // Input handlers with validation
  const handlePageInputChange = useCallback((e) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    setPageInputValue(digitsOnly);
    setIsPageInputDirty(true);
  }, []);

  const commitPageInput = useCallback(() => {
    const value = parseInt(pageInputValue);
    if (!isNaN(value) && value >= 1 && value <= numPages) {
      // Navigate first, then update input value will be synced by useEffect when pageNum updates
      goToPage(value);
      // Also set it immediately for visual feedback, but useEffect will ensure it's correct
      setPageInputValue(String(value));
      setIsPageInputDirty(false);
    } else {
      // Reset to current pageNum if invalid
      setPageInputValue(String(pageNum));
      setIsPageInputDirty(false);
    }
  }, [pageInputValue, numPages, goToPage, pageNum]);

  const handlePageInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPageInput();
      e.target.blur();
    }
  }, [commitPageInput]);

  const handlePageInputBlur = useCallback(() => {
    commitPageInput();
  }, [commitPageInput]);

  // Sync input value when pageNum changes from other sources (prev/next buttons, IntersectionObserver, etc.)
  // But only if the input is not currently focused (user isn't typing)
  useEffect(() => {
    const inputElement = pageInputRef.current;
    if (!inputElement) {
      // If ref not attached yet, still update the value
      setPageInputValue(String(pageNum));
      setIsPageInputDirty(false);
      return;
    }

    // Always sync to the current pageNum when it changes
    // This ensures the input reflects the actual current page
    // We use a functional update to avoid stale closures
    setPageInputValue(prevValue => {
      const currentPageStr = String(pageNum);
      // Only update if it's actually different to avoid unnecessary re-renders
      if (prevValue !== currentPageStr) {
        if (document.activeElement === inputElement && isPageInputDirty) {
          return prevValue;
        }
        setIsPageInputDirty(false);
        return currentPageStr;
      }
      return prevValue;
    });
  }, [pageNum, isPageInputDirty]);

  useEffect(() => {
    const inputElement = zoomInputRef.current;
    if (!inputElement) {
      setZoomInputValue(String(Math.round(scale * 100)));
      return;
    }

    const isInputFocused = document.activeElement === inputElement;
    if (isInputFocused) {
      return;
    }

    setZoomInputValue(String(Math.round(scale * 100)));
  }, [scale]);

  const handleZoomInputChange = useCallback((e) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    setZoomInputValue(digitsOnly);
  }, []);

  const commitZoomInput = useCallback(() => {
    if (!zoomInputValue) {
      setZoomInputValue(String(Math.round(scale * 100)));
      return;
    }

    const parsed = parseInt(zoomInputValue, 10);
    if (isNaN(parsed)) {
      setZoomInputValue(String(Math.round(scale * 100)));
      return;
    }

    const clamped = Math.min(Math.max(parsed, 50), 500);
    const controller = zoomControllerRef.current;
    if (controller) {
      const normalized = clampScale(clamped / 100);
      controller.setScale(normalized);
      setZoomInputValue(String(Math.round(normalized * 100)));
    } else {
      setZoomInputValue(String(clamped));
    }
  }, [zoomInputValue, scale]);

  const handleZoomInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitZoomInput();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setZoomInputValue(String(Math.round(scale * 100)));
      e.currentTarget.blur();
    }
  }, [commitZoomInput, scale]);

  const handleZoomInputBlur = useCallback(() => {
    commitZoomInput();
  }, [commitZoomInput]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeElement = document.activeElement;
      const isFormField =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.isContentEditable);

      if (!isFormField && (e.metaKey || e.ctrlKey)) {
        const key = e.key.toLowerCase();

        if (!e.altKey) {
          // Save document (Cmd/Ctrl+S)
          if (key === 's') {
            e.preventDefault();
            handleSaveDocument();
            return;
          }
          if (key === '0') {
            e.preventDefault();
            zoomControllerRef.current?.setMode(ZOOM_MODES.FIT_PAGE);
            return;
          }
          if (key === '1') {
            e.preventDefault();
            zoomControllerRef.current?.setMode(ZOOM_MODES.FIT_WIDTH);
            return;
          }
          if (key === '2') {
            e.preventDefault();
            zoomControllerRef.current?.setMode(ZOOM_MODES.FIT_HEIGHT);
            return;
          }
          if (key === '=' || key === '+') {
            e.preventDefault();
            zoomIn();
            return;
          }
          if (key === '-') {
            e.preventDefault();
            zoomOut();
            return;
          }
          if (key === 'm') {
            e.preventDefault();
            zoomControllerRef.current?.setMode(ZOOM_MODES.MANUAL, { scale: scaleRef.current });
            return;
          }
        }
      }

      if (scrollMode === 'single') {
        if (e.key === 'ArrowLeft') {
          goToPreviousPage();
        } else if (e.key === 'ArrowRight') {
          goToNextPage();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNextPage, goToPreviousPage, scrollMode, zoomIn, zoomOut, handleSaveDocument]);

  // Mode toggle
  const toggleScrollMode = useCallback(() => {
    setScrollMode(prev => prev === 'continuous' ? 'single' : 'continuous');
  }, []);

  // Memoized styles for performance
  const containerStyle = useMemo(() => {
    // Only show grab cursor when pan tool is active and region selection is not active
    const shouldShowGrabCursor = activeTool === 'pan' && !showRegionSelection;

    return {
      flex: 1,
      overflow: 'auto',
      cursor: shouldShowGrabCursor ? (isPanning ? 'grabbing' : (canPan ? 'grab' : 'default')) : 'default',
      background: '#2b2b2b',
      padding: '20px',
      position: 'relative',
      fontFamily: FONT_FAMILY,
      minHeight: 0,
      minWidth: 0
    };
  }, [isPanning, canPan, activeTool, showRegionSelection]);

  const contentStyle = useMemo(() => ({
    minWidth: 'max-content',
    minHeight: scrollMode === 'single' ? '100%' : 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: scrollMode === 'continuous' ? '20px' : '0',
    alignItems: 'center',
    ...(scrollMode === 'single' && { justifyContent: 'center' })
  }), [scrollMode]);

  const handleSaveAnnotations = useCallback((pageNumber, json) => {
    setAnnotationsByPage(prev => ({ ...prev, [pageNumber]: json }));
  }, []);

  // Helper function to check if two bounds match (with tolerance for floating point)
  const boundsMatch = (bounds1, bounds2, tolerance = 5) => {
    if (!bounds1 || !bounds2) return false;
    return (
      Math.abs((bounds1.x || bounds1.left) - (bounds2.x || bounds2.left)) < tolerance &&
      Math.abs((bounds1.y || bounds1.top) - (bounds2.y || bounds2.top)) < tolerance &&
      Math.abs((bounds1.width || bounds1.right - bounds1.left) - (bounds2.width || bounds2.right - bounds2.left)) < tolerance &&
      Math.abs((bounds1.height || bounds1.bottom - bounds1.top) - (bounds2.height || bounds2.bottom - bounds2.top)) < tolerance
    );
  };

  // Navigate to survey item when highlight is clicked (reverse navigation)
  const handleHighlightClicked = useCallback((highlightId) => {
    if (!highlightId || !selectedTemplate) return;

    const highlight = highlightAnnotations[highlightId];
    if (!highlight) return;

    const moduleId = highlight.moduleId || highlight.spaceId;

    // 1. Switch to module
    setSelectedModuleId(moduleId);

    // 2. Expand category
    setExpandedCategories(prev => ({
      ...prev,
      [highlight.categoryId]: true
    }));

    // 3. Ensure Survey Panel is open
    if (!showSurveyPanel || isSurveyPanelCollapsed) {
      setShowSurveyPanel(true);
      setIsSurveyPanelCollapsed(false);
    }

    // 4. Scroll to item
    setTimeout(() => {
      const element = document.getElementById(`highlight-item-${highlightId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash effect
        element.style.transition = 'box-shadow 0.5s';
        element.style.boxShadow = '0 0 0 2px #4A90E2';
        setTimeout(() => {
          element.style.boxShadow = 'none';
        }, 2000);
      }
    }, 300);
  }, [highlightAnnotations, selectedTemplate, showSurveyPanel, isSurveyPanelCollapsed]);

  // Locate item on PDF (Forward Navigation)
  const handleLocateItemOnPDF = useCallback((highlight) => {
    if (!highlight) return;
    const { pageNumber, bounds } = highlight;

    // Zoom in a little (e.g., 1.5x or +20% depending on current scale, but user asked for "zooming in on it a little")
    // Let's set a target scale. If current scale is small, zoom in.
    // If we have a zoomController, use it.
    if (zoomControllerRef.current) {
      // Zoom to 1.5x or current scale if higher
      const targetScale = Math.max(scale, 1.5);
      if (targetScale !== scale) {
        setScale(targetScale);
      }
    }

    if (scrollMode === 'single') {
      setPageNum(pageNumber);
    } else {
      // Continuous mode
      // We need to wait for zoom to apply if we changed it, but React state updates might be async.
      // However, scrolling happens on container which might need layout update.
      // Let's use setTimeout to allow render cycle if scale changed.

      // Use double requestAnimationFrame to ensure DOM has updated after scale change
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const targetContainer = pageContainersRef.current[pageNumber];
          const container = containerRef.current;

          if (targetContainer && container) {
            // First, ensure the page is in view using scrollIntoView (won't scroll if already visible)
            targetContainer.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });

            // Wait for scrollIntoView to complete, then calculate positions
            // Use double RAF to ensure layout has settled
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                // Now get accurate measurements after scrollIntoView
                const containerRect = container.getBoundingClientRect();
                const targetRect = targetContainer.getBoundingClientRect();
                const computedStyles = window.getComputedStyle(container);
                const paddingTop = parseFloat(computedStyles.paddingTop || '0');
                const paddingLeft = parseFloat(computedStyles.paddingLeft || '0');
                const containerWidth = container.clientWidth;
                const containerHeight = container.clientHeight;

                // Calculate page container's position in scroll coordinates
                // Now that element is in view, getBoundingClientRect() will work correctly
                const pageContainerScrollTop = container.scrollTop + (targetRect.top - containerRect.top);
                const pageContainerScrollLeft = container.scrollLeft + (targetRect.left - containerRect.left);

                let scrollTop = pageContainerScrollTop - paddingTop;
                let scrollLeft = pageContainerScrollLeft - paddingLeft;

                // Add bounds offset if available
                if (bounds) {
                  const currentScale = zoomControllerRef.current ? zoomControllerRef.current.getScale() : scale;
                  const boundsY = bounds.y || bounds.top;
                  const boundsX = bounds.x || bounds.left;
                  const boundsHeight = bounds.height || (bounds.bottom ? bounds.bottom - bounds.top : 0);
                  const boundsWidth = bounds.width || (bounds.right ? bounds.right - bounds.left : 0);
                  const scaledTop = boundsY * currentScale;
                  const scaledLeft = boundsX * currentScale;
                  const scaledHeight = boundsHeight * currentScale;
                  const scaledWidth = boundsWidth * currentScale;

                  // Vertical positioning: add bounds offset and center
                  scrollTop += scaledTop;
                  const centerOffsetY = (containerHeight / 2) - (scaledHeight / 2);
                  scrollTop -= centerOffsetY;

                  // Horizontal positioning: Calculate using scroll coordinates
                  // Get page container dimensions
                  const pageContainerWidth = targetContainer.offsetWidth;

                  // Find the PDF canvas to get its actual width
                  const pdfCanvas = targetContainer.querySelector('canvas');
                  let pdfPageWidth = pageContainerWidth;

                  if (pdfCanvas) {
                    const canvasRect = pdfCanvas.getBoundingClientRect();
                    pdfPageWidth = canvasRect.width;
                  } else {
                    // Fallback: estimate PDF page width from pageHeights if available
                    if (pageHeights[pageNumber]) {
                      pdfPageWidth = pageHeights[pageNumber] * 0.7 * currentScale;
                    }
                  }

                  // Calculate where the PDF page starts within the page container
                  // Since pages are centered (justifyContent: 'center'), PDF starts at: (containerWidth - pdfPageWidth) / 2 from container left
                  const pdfPageLeftOffsetInContainer = (pageContainerWidth - pdfPageWidth) / 2;

                  // PDF page's left edge in scroll coordinates
                  const pdfPageLeftInScroll = pageContainerScrollLeft + pdfPageLeftOffsetInContainer;

                  // Calculate highlight center position
                  const highlightCenterX = boundsX + (boundsWidth / 2);
                  const scaledHighlightCenterX = highlightCenterX * currentScale;

                  // Highlight center in scroll coordinates
                  const highlightCenterInScroll = pdfPageLeftInScroll + scaledHighlightCenterX;

                  // To center the highlight, we want: highlightCenterInScroll = scrollLeft + (containerWidth / 2)
                  // Therefore: scrollLeft = highlightCenterInScroll - (containerWidth / 2)
                  scrollLeft = highlightCenterInScroll - (containerWidth / 2);
                } else {
                }

                const finalScrollTop = Math.max(0, Math.min(scrollTop, container.scrollHeight - container.clientHeight));
                const finalScrollLeft = Math.max(0, Math.min(scrollLeft, container.scrollWidth - container.clientWidth));
                container.scrollTo({
                  top: finalScrollTop,
                  left: finalScrollLeft,
                  behavior: 'smooth'
                });
              });
            });
          } else {
            // If page not mounted, fallback to standard page navigation
            goToPage(pageNumber);
          }
        });
      });
    }
  }, [scale, scrollMode, goToPage]);

  // Handle highlight deletion from PDF (via eraser tool)
  const handleHighlightDeleted = useCallback((pageNumber, bounds, highlightId = null) => {
    console.log('[App] handleHighlightDeleted called', { pageNumber, bounds, highlightId, selectedModuleId, selectedTemplate });
    if (!selectedModuleId || !selectedTemplate) {
      console.warn('[App] handleHighlightDeleted aborted: Missing module or template');
      return;
    }

    // Find matching highlights in highlightAnnotations
    const matchingHighlightIds = [];

    if (highlightId) {
      // If highlightId is provided, use it directly (most reliable)
      if (highlightAnnotations[highlightId]) {
        const highlight = highlightAnnotations[highlightId];
        const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId
        if (highlightModuleId === selectedModuleId && highlight.pageNumber === pageNumber) {
          matchingHighlightIds.push(highlightId);
        }
      }
    } else {
      // Fall back to bounds matching if no highlightId
      Object.entries(highlightAnnotations).forEach(([id, highlight]) => {
        const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId
        if (highlightModuleId === selectedModuleId &&
          highlight.pageNumber === pageNumber &&
          boundsMatch(highlight.bounds, bounds)) {
          matchingHighlightIds.push(id);
        }
      });
    }

    // Delete matching highlights from highlightAnnotations
    if (matchingHighlightIds.length > 0) {
      // Get highlight data before deleting (since state updates are async)
      const highlightsToDelete = matchingHighlightIds
        .map(id => ({ id, highlight: highlightAnnotations[id] }))
        .filter(({ highlight }) => highlight != null);

      // Delete from highlightAnnotations
      setHighlightAnnotations(prev => {
        const updated = { ...prev };
        matchingHighlightIds.forEach(id => delete updated[id]);
        return updated;
      });

      // Also remove highlights from newHighlightsByPage to prevent re-adding to canvas
      // Batch all updates into a single state update to avoid race conditions
      setNewHighlightsByPage(prev => {
        const updated = { ...prev };
        let hasChanges = false;

        highlightsToDelete.forEach(({ id, highlight }) => {
          if (highlight && highlight.pageNumber) {
            const pageHighlights = updated[highlight.pageNumber] || [];
            // Remove highlight by highlightId or by bounds match
            const filtered = pageHighlights.filter(h => {
              if (h.highlightId === id) return false;
              if (highlight.bounds && h.x !== undefined && h.y !== undefined) {
                return !boundsMatch(
                  { x: h.x, y: h.y, width: h.width, height: h.height },
                  highlight.bounds
                );
              }
              return true;
            });

            if (filtered.length !== pageHighlights.length) {
              hasChanges = true;
              if (filtered.length === 0) {
                delete updated[highlight.pageNumber];
              } else {
                updated[highlight.pageNumber] = filtered;
              }
            }
          }
        });

        return hasChanges ? updated : prev;
      });

      // For each matching highlight, find and delete associated items and annotations
      highlightsToDelete.forEach(({ id, highlight }) => {
        if (!highlight) return;

        // Find associated item by matching name and category
        const categoryName = getCategoryName(selectedTemplate, highlight.spaceId || highlight.moduleId, highlight.categoryId);
        const matchingItem = Object.values(items).find(item =>
          item.name === highlight.name &&
          item.itemType === categoryName
        );

        if (matchingItem) {
          // Find and delete annotations for this item in this space
          setAnnotations(prev => {
            const updated = { ...prev };
            Object.values(updated).forEach(ann => {
              const annSpaceId = ann.spaceId || ann.moduleId; // Support legacy spaceId
              const highlightSpaceId = highlight.spaceId || highlight.moduleId; // Support legacy spaceId
              if (ann.itemId === matchingItem.itemId && annSpaceId === highlightSpaceId) {
                // Also check if coordinates match
                if (ann.pdfCoordinates && boundsMatch(ann.pdfCoordinates, bounds)) {
                  delete updated[ann.annotationId];
                }
              }
            });
            return updated;
          });

          // Check if item has data in other modules - if not, delete the item
          const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId
          const moduleName = getModuleName(selectedTemplate, highlightModuleId);
          const dataKey = getModuleDataKey(moduleName);
          const item = items[matchingItem.itemId];

          if (item) {
            // Remove the module-specific data
            const updatedItem = { ...item };
            delete updatedItem[dataKey];

            // Check if item has any module data left
            const allModules = selectedTemplate?.modules || selectedTemplate?.spaces || [];
            const hasOtherModuleData = allModules.some(module => {
              const moduleId = module.id;
              if (moduleId === highlightModuleId) return false;
              const otherModuleName = getModuleName(selectedTemplate, moduleId);
              const otherDataKey = getModuleDataKey(otherModuleName);
              return updatedItem[otherDataKey] && Object.keys(updatedItem[otherDataKey]).length > 0;
            });

            if (hasOtherModuleData) {
              // Item exists in other modules, just remove this module's data
              setItems(prev => ({
                ...prev,
                [matchingItem.itemId]: updatedItem
              }));
            } else {
              // Item doesn't exist in other spaces, delete it entirely
              setItems(prev => {
                const updated = { ...prev };
                delete updated[matchingItem.itemId];
                return updated;
              });
            }
          }
        }
      });
    }
  }, [selectedModuleId, selectedTemplate, highlightAnnotations, items]);

  // Handle deletion of a highlight item (from survey panel)
  const handleDeleteHighlightItem = useCallback((highlightId) => {
    console.log('[App] handleDeleteHighlightItem called', { highlightId });
    const highlight = highlightAnnotations[highlightId];
    if (!highlight) {
      console.warn('[App] handleDeleteHighlightItem aborted: Highlight not found', highlightId);
      return;
    }

    // 1. Remove from canvas
    if (highlight.pageNumber && highlight.bounds) {
      setHighlightsToRemoveByPage(prev => ({
        ...prev,
        [highlight.pageNumber]: [...(prev[highlight.pageNumber] || []), highlight.bounds]
      }));
    }

    // 2. Delete from highlightAnnotations
    setHighlightAnnotations(prev => {
      const updated = { ...prev };
      delete updated[highlightId];
      return updated;
    });

    // 2.5. Remove from newHighlightsByPage to prevent re-adding to canvas
    setNewHighlightsByPage(prev => {
      if (!highlight.pageNumber) return prev;

      const updated = { ...prev };
      const pageHighlights = updated[highlight.pageNumber] || [];

      // Remove highlight by highlightId or by bounds match
      const filtered = pageHighlights.filter(h => {
        if (h.highlightId === highlightId) return false;
        if (highlight.bounds && h.x !== undefined && h.y !== undefined) {
          return !boundsMatch(
            { x: h.x, y: h.y, width: h.width, height: h.height },
            highlight.bounds
          );
        }
        return true;
      });

      if (filtered.length === 0) {
        delete updated[highlight.pageNumber];
      } else {
        updated[highlight.pageNumber] = filtered;
      }

      return updated;
    });

    // 3. Delete associated items and annotations (reusing logic from handleHighlightDeleted would be ideal, but for now duplicating for safety/clarity)
    if (selectedTemplate) {
      const highlightModuleId = highlight.moduleId || highlight.spaceId;
      const categoryName = getCategoryName(selectedTemplate, highlightModuleId, highlight.categoryId);
      const matchingItem = Object.values(items).find(item =>
        item.name === highlight.name &&
        item.itemType === categoryName
      );

      if (matchingItem) {
        // Delete annotations
        setAnnotations(prev => {
          const updated = { ...prev };
          Object.values(updated).forEach(ann => {
            if (ann.itemId === matchingItem.itemId && (ann.spaceId === highlightModuleId || ann.moduleId === highlightModuleId)) {
              if (ann.pdfCoordinates && highlight.bounds && boundsMatch(ann.pdfCoordinates, highlight.bounds)) {
                delete updated[ann.annotationId];
              }
            }
          });
          return updated;
        });

        // Update/Delete Item
        const moduleName = getModuleName(selectedTemplate, highlightModuleId);
        const dataKey = getModuleDataKey(moduleName);
        const item = items[matchingItem.itemId];

        if (item) {
          const updatedItem = { ...item };
          delete updatedItem[dataKey];

          const allModules = selectedTemplate?.modules || selectedTemplate?.spaces || [];
          const hasOtherModuleData = allModules.some(module => {
            const moduleId = module.id;
            if (moduleId === highlightModuleId) return false;
            const otherModuleName = getModuleName(selectedTemplate, moduleId);
            const otherDataKey = getModuleDataKey(otherModuleName);
            return updatedItem[otherDataKey] && Object.keys(updatedItem[otherDataKey]).length > 0;
          });

          if (hasOtherModuleData) {
            setItems(prev => ({
              ...prev,
              [matchingItem.itemId]: updatedItem
            }));
          } else {
            setItems(prev => {
              const updated = { ...prev };
              delete updated[matchingItem.itemId];
              return updated;
            });
          }
        }
      }
    }
  }, [highlightAnnotations, selectedTemplate, items]);

  // Handle highlight creation from annotation tool
  const handleHighlightCreated = useCallback((pageNumber, bounds) => {
    // Only handle if survey mode is active
    if (!selectedTemplate) {
      return;
    }

    // If no module is selected, try to default to the first one
    let effectiveModuleId = selectedModuleId;
    if (!effectiveModuleId) {
      const modules = selectedTemplate.modules || selectedTemplate.spaces || [];
      if (modules.length > 0) {
        effectiveModuleId = modules[0].id;
        setSelectedModuleId(effectiveModuleId);
      } else {
        return;
      }
    }

    // Handle locating a pending item (from "Locate" button on unlocated item)
    if (pendingLocationItem) {
      const highlightId = pendingLocationItem.id;

      // Update highlight annotations
      setHighlightAnnotations(prev => {
        const existing = prev[highlightId] || {};
        // If it's a new annotation for an existing item, ensure we have all necessary data
        return {
          ...prev,
          [highlightId]: {
            ...pendingLocationItem, // Base on the item data
            ...existing, // Override with any existing annotation data
            pageNumber,
            bounds,
            moduleId: effectiveModuleId,
            spaceId: activeSpaceId ?? selectedSpaceId // Ensure spaceId is set
          }
        };
      });

      // Add to canvas immediately
      setNewHighlightsByPage(prev => ({
        ...prev,
        [pageNumber]: [
          ...(prev[pageNumber] || []),
          {
            ...bounds,
            highlightId,
            moduleId: effectiveModuleId,
            color: pendingLocationItem.ballInCourtColor, // Use BIC color if available
            needsBIC: !pendingLocationItem.ballInCourtColor // Dashed if no color
          }
        ]
      }));

      // Check if Ball in Court needs to be assigned (only if not already set from Excel)
      const hasBallInCourt = pendingLocationItem.ballInCourtEntityId || pendingLocationItem.ballInCourtColor;
      const ballInCourtEntities = selectedTemplate?.ballInCourtEntities || [];

      if (!hasBallInCourt && ballInCourtEntities.length > 0) {
        // Prompt for Ball in Court since it wasn't set in Excel
        setPendingBallInCourtSelection({
          highlight: {
            id: highlightId,
            pageNumber,
            bounds,
            moduleId: effectiveModuleId
          },
          categoryId: pendingLocationItem.categoryId
        });
      }

      setPendingLocationItem(null);
      return;
    }

    // Create a unique ID for this highlight
    const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const moduleName = getModuleName(selectedTemplate, effectiveModuleId);
    const debugSpaceId = activeSpaceId ?? selectedSpaceId ?? null;
    /* console.log('[Survey Debug] Highlight created', {
      highlightId,
      pageNumber,
      bounds,
      moduleId: effectiveModuleId,
      moduleName,
      activeSpaceId,
      selectedSpaceId,
      effectiveSpaceId: debugSpaceId
    }); */

    // Immediately add highlight to canvas (always show selection feedback)
    // This ensures the user sees their selection regardless of category selection state
    setNewHighlightsByPage(prev => {
      // Filter previous highlights to only keep ones from the current module
      const filteredPrev = {};
      Object.entries(prev).forEach(([page, highlights]) => {
        const filteredHighlights = highlights.filter(h => h.moduleId === effectiveModuleId);
        if (filteredHighlights.length > 0) {
          filteredPrev[page] = filteredHighlights;
        }
      });

      return {
        ...filteredPrev,
        [pageNumber]: [
          ...(filteredPrev[pageNumber] || []),
          {
            ...bounds,
            highlightId: highlightId,
            moduleId: effectiveModuleId,
            needsCategory: !selectedCategoryId, // Flag to indicate it needs category selection
            needsBIC: true // Use needsBIC rendering style (transparent with dashed outline) initially
          }
        ]
      };
    });

    // If a category is already selected, show Ball in Court dialog first
    if (selectedCategoryId) {
      // Check if template has Ball in Court entities
      const ballInCourtEntities = selectedTemplate?.ballInCourtEntities || [];
      if (ballInCourtEntities.length > 0) {
        // Show Ball in Court selection dialog
        setPendingBallInCourtSelection({
          highlight: {
            id: highlightId,
            pageNumber,
            bounds,
            moduleId: effectiveModuleId
          },
          categoryId: selectedCategoryId
        });
      } else {
        // No Ball in Court entities, go directly to name prompt
        setPendingHighlightName({
          highlight: {
            id: highlightId,
            pageNumber,
            bounds,
            moduleId: effectiveModuleId
          },
          categoryId: selectedCategoryId
        });
        setHighlightNameInput(''); // Reset input
      }

      // Reset selected category
      setSelectedCategoryId(null);
      setShowSurveyPanel(true);
    } else {
      // No category selected, show category selection modal (only if survey panel is visible)
      if (showSurveyPanel) {
        setPendingHighlight({
          id: highlightId,
          pageNumber,
          bounds,
          moduleId: effectiveModuleId
        });
      }
    }
  }, [selectedModuleId, selectedTemplate, selectedCategoryId, showSurveyPanel, pendingLocationItem, activeSpaceId, selectedSpaceId]);

  // Auto-switch to highlight tool when template is selected in survey mode (only on initial entry)
  useEffect(() => {
    // Only auto-switch once when first entering survey mode, then allow user to switch tools freely
    if (showSurveyPanel && selectedTemplate && selectedModuleId && !hasSwitchedToHighlightRef.current) {
      setActiveTool('highlight');
      hasSwitchedToHighlightRef.current = true;
    }
    // Reset the flag when exiting survey mode
    if (!showSurveyPanel) {
      hasSwitchedToHighlightRef.current = false;
    }
  }, [showSurveyPanel, selectedTemplate, selectedModuleId]);

  // Measure toolbar heights and middle area bounds for survey panel positioning
  useEffect(() => {
    const updateDimensions = () => {
      if (topToolbarRef.current && bottomToolbarRef.current && statusBarRef.current) {
        const topHeight = topToolbarRef.current.getBoundingClientRect().height;
        const bottomToolbarHeight = bottomToolbarRef.current.getBoundingClientRect().height;
        const statusBarHeight = statusBarRef.current.getBoundingClientRect().height;
        const combinedBottomHeight = bottomToolbarHeight + statusBarHeight;
        setToolbarHeights({ top: topHeight, bottom: combinedBottomHeight });
      }

      if (middleAreaRef.current) {
        const rect = middleAreaRef.current.getBoundingClientRect();
        setMiddleAreaBounds({ top: rect.top, height: rect.height });
      }
    };

    // Delay measurement slightly to ensure layout is complete
    const timeoutId = setTimeout(updateDimensions, 0);

    window.addEventListener('resize', updateDimensions);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateDimensions);
    };
  }, [showSurveyPanel]);

  // Auto-adjust PDF zoom when sidebars expand/collapse or survey panel opens/closes
  useEffect(() => {
    requestAnimationFrame(() => {
      zoomControllerRef.current?.applyZoom({ persist: false, force: true });
    });
  }, [showSurveyPanel, isLeftSidebarCollapsed, isSurveyPanelCollapsed]);

  // Ensure survey panel always opens in expanded state
  useEffect(() => {
    if (showSurveyPanel) {
      setIsSurveyPanelCollapsed(false);
    }
  }, [showSurveyPanel]);

  // Note: Removed auto-switch to highlight tool when category is selected
  // Users can now freely switch between annotation tools in survey mode

  // Handle text selection - create highlights
  const handleTextSelected = useCallback((pageNumber, selectedText, highlights) => {
    if (!selectedText || !highlights || highlights.length === 0) return;

    // Set new highlights to trigger addition in PageAnnotationLayer
    setNewHighlightsByPage(prev => ({
      ...prev,
      [pageNumber]: highlights
    }));

    // Clear the highlights after a brief delay to allow re-selection
    setTimeout(() => {
      setNewHighlightsByPage(prev => {
        const updated = { ...prev };
        delete updated[pageNumber];
        return updated;
      });
    }, 100);
  }, []);

  // Filter annotations by active module for rendering on PDF
  const filteredAnnotationsForPages = useMemo(() => {
    if (!selectedModuleId) return {};

    const filtered = filterAnnotationsByModule(annotations, selectedModuleId);
    const byPage = {};

    Object.values(filtered).forEach(ann => {
      // Extract page number from pdfCoordinates if available
      // For now, assume all annotations are on page 1 if not specified
      const pageNum = ann.pdfCoordinates?.page || 1;
      if (!byPage[pageNum]) byPage[pageNum] = [];
      byPage[pageNum].push(ann.pdfCoordinates);
    });

    return byPage;
  }, [annotations, selectedModuleId]);

  // Restore highlights when switching modules
  // This merges saved highlights from highlightAnnotations with any pending highlights
  useEffect(() => {
    if (!selectedModuleId) {
      // Don't clear highlights when no module is selected - preserve pending highlights
      return;
    }

    // Rebuild newHighlightsByPage by merging:
    // 1. Pending highlights (not yet in highlightAnnotations) for current module
    // 2. Saved highlights from highlightAnnotations for current module
    setNewHighlightsByPage(prev => {
      const highlightsByPage = {};

      // First, preserve pending highlights for this module (not yet saved to highlightAnnotations)
      Object.entries(prev).forEach(([pageNum, highlights]) => {
        highlights.forEach(highlight => {
          const highlightModuleId = highlight.moduleId;
          if (highlightModuleId === selectedModuleId && highlight.highlightId) {
            // Check if this highlight is already saved in highlightAnnotations
            const isSaved = highlightAnnotations && highlightAnnotations[highlight.highlightId];
            if (!isSaved) {
              // This is a pending highlight, preserve it
              const pageNumber = parseInt(pageNum);
              if (!highlightsByPage[pageNumber]) {
                highlightsByPage[pageNumber] = [];
              }
              // Avoid duplicates
              const exists = highlightsByPage[pageNumber].some(h => h.highlightId === highlight.highlightId);
              if (!exists) {
                highlightsByPage[pageNumber].push(highlight);
              }
            }
          }
        });
      });

      // Now add saved highlights from highlightAnnotations for this module
      if (highlightAnnotations && Object.keys(highlightAnnotations).length > 0) {
        Object.entries(highlightAnnotations).forEach(([highlightId, highlight]) => {
          // Check if this highlight belongs to the current module
          const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId
          if (highlightModuleId !== selectedModuleId) {
            return; // Skip highlights from other modules
          }

          // Skip if highlight doesn't have required properties
          if (!highlight.pageNumber || !highlight.bounds) {
            return;
          }

          const pageNumber = highlight.pageNumber;
          if (!highlightsByPage[pageNumber]) {
            highlightsByPage[pageNumber] = [];
          }

          // Check if this highlight is already in the list (avoid duplicates)
          const exists = highlightsByPage[pageNumber].some(h => h.highlightId === highlightId);
          if (exists) {
            return; // Already added (either as pending or from a previous iteration)
          }

          // Determine if highlight needs BIC (Ball in Court) assignment
          const needsBIC = !highlight.ballInCourtColor && !highlight.ballInCourtEntityId;

          // Determine highlight color
          const highlightColor = highlight.ballInCourtColor
            ? (normalizeHighlightColor(highlight.ballInCourtColor) || highlight.ballInCourtColor)
            : null;

          // Add highlight to the page array
          highlightsByPage[pageNumber].push({
            x: highlight.bounds.x,
            y: highlight.bounds.y,
            width: highlight.bounds.width,
            height: highlight.bounds.height,
            highlightId: highlightId,
            moduleId: highlightModuleId,
            ...(needsBIC && { needsBIC: true }),
            ...(highlightColor && { color: highlightColor })
          });
        });
      }

      // Return merged highlights (pending + saved), or empty object if no highlights
      return Object.keys(highlightsByPage).length > 0 ? highlightsByPage : prev;
    });
  }, [selectedModuleId, highlightAnnotations]);



  // Space filtering logic - determine which pages should be visible
  const shouldShowPage = useCallback((pageNumber) => {
    if (!activeSpaceId) {
      return true;
    }

    if (!activeSpacePages || activeSpacePages.length === 0) {
      return false;
    }

    return activeSpacePages.includes(pageNumber);
  }, [activeSpaceId, activeSpacePages]);

  useEffect(() => {
    if (!activeSpaceId) {
      return;
    }
    if (!activeSpacePages || activeSpacePages.length === 0) {
      return;
    }
    if (!activeSpacePages.includes(pageNum)) {
      goToPage(activeSpacePages[0], { fallback: 'nearest' });
    }
  }, [activeSpaceId, activeSpacePages, pageNum, goToPage]);

  // Debug: Log page visibility
  useEffect(() => {
    if (numPages > 0) {
      const visiblePages = Array.from({ length: numPages }, (_, i) => i + 1)
        .filter(pageNumber => shouldShowPage(pageNumber));
      /* console.log('Pages visibility check:', {
        totalPages: numPages,
        visiblePages: visiblePages.length,
        activeSpaceId,
        visiblePageNumbers: visiblePages
      }); */
    }
  }, [numPages, activeSpaceId, shouldShowPage, spaces]);

  // Get regions for a page in the active space
  const getPageRegions = useCallback((pageNumber) => {
    if (!activeSpaceId) return null;

    const space = spaces.find(s => s.id === activeSpaceId);
    if (!space) return null;

    const assignedPage = space.assignedPages?.find(p => p.pageId === pageNumber);
    if (!assignedPage) return null;

    if (assignedPage.wholePageIncluded !== false) {
      return null;
    }

    if (!assignedPage.regions || assignedPage.regions.length === 0) {
      return null;
    }

    return assignedPage.regions;
  }, [activeSpaceId, spaces]);

  // Show loading state when PDF is not loaded yet
  if (!pdfDoc || isLoadingPDF) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'row',
        background: '#2b2b2b',
        color: '#ddd',
        fontFamily: FONT_FAMILY
      }}>
        {/* Sidebar - keep visible during loading */}
        <PDFSidebar
          pdfDoc={null}
          numPages={0}
          pageNum={1}
          onNavigateToPage={() => { }}
          onDuplicatePage={() => { }}
          onDeletePage={() => { }}
          onCutPage={() => { }}
          onCopyPage={() => { }}
          onPastePage={() => { }}
          clipboardPage={null}
          clipboardType={null}
          onRotatePage={() => { }}
          onMirrorPage={() => { }}
          onResetPage={() => { }}
          onReorderPages={() => { }}
          pageTransformations={{}}
          bookmarks={[]}
          onBookmarkCreate={() => { }}
          onBookmarkUpdate={() => { }}
          onBookmarkDelete={() => { }}
          spaces={[]}
          onSpaceCreate={() => { }}
          onSpaceUpdate={() => { }}
          onSpaceDelete={() => { }}
          activeSpaceId={null}
          onSetActiveSpace={() => { }}
          onExitSpaceMode={() => { }}
          scale={1}
          onToggleCollapse={() => { }}
        />
        {/* Loading content */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: '15px',
          letterSpacing: '-0.2px'
        }}>
          {isLoadingPDF ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'center' }}>
                <Icon name="document" size={48} />
              </div>
              <div style={{ fontSize: '18px', color: '#999' }}>Loading PDF...</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>
                {pdfFile?.name || 'document.pdf'}
              </div>
            </div>
          ) : (
            'Loading PDF...'
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Unsupported Annotations Notice */}
      {showUnsupportedNotice && unsupportedAnnotationTypes.length > 0 && (
        <UnsupportedAnnotationsNotice
          unsupportedTypes={unsupportedAnnotationTypes}
          onDismiss={() => setShowUnsupportedNotice(false)}
        />
      )}

      {/* Eraser Cursor Overlay */}
      {activeTool === 'eraser' && eraserCursorPos.visible && (
        <div
          style={{
            position: 'fixed',
            left: eraserCursorPos.x - (eraserSize * scale),
            top: eraserCursorPos.y - (eraserSize * scale),
            width: eraserSize * 2 * scale,
            height: eraserSize * 2 * scale,
            borderRadius: '50%',
            backgroundColor: 'rgba(128, 128, 128, 0.2)',
            border: `${Math.max(1, 2 * scale)}px solid rgba(100, 100, 100, 0.6)`,
            pointerEvents: 'none',
            zIndex: 99999,
            transition: 'width 0.1s ease, height 0.1s ease, left 0.1s ease, top 0.1s ease, border-width 0.1s ease'
          }}
        />
      )}
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#2b2b2b',
        color: '#ddd',
        fontFamily: FONT_FAMILY
      }}>
        {/* Toolbar with improved typography + Annotation tools */}
        <div
          ref={topToolbarRef}
          style={{
            padding: '4px 12px',
            background: '#2d2d2d',
            borderBottom: '1px solid #3d3d3d',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontFamily: FONT_FAMILY,
            flexShrink: 0
          }}
        >
          <button
            onClick={onBack}
            className="btn btn-default btn-sm"
          >
            <Icon name="arrowLeft" size={14} style={{ marginRight: '4px' }} /> Back
          </button>

          <div style={{ width: '1px', height: '16px', background: '#555' }} />

          {/* Survey Button */}
          <button
            onClick={() => {
              if (!showSurveyPanel) {
                // Show template selection modal
                setShowTemplateSelection(true);
              } else {
                setShowSurveyPanel(false);
                setSelectedTemplate(null);
                setSelectedModuleId(null);
              }
            }}
            className={`btn btn-md ${showSurveyPanel ? 'btn-active' : 'btn-default'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: '600',
              padding: '4px 10px',
              marginLeft: 'auto',
              transition: 'all 0.2s ease',
              background: showSurveyPanel ? 'rgba(74, 144, 226, 0.1)' : 'rgba(255, 255, 255, 0.05)',
              border: showSurveyPanel ? '1px solid #4A90E2' : '1px solid #555',
              color: showSurveyPanel ? '#4A90E2' : '#FFF'
            }}
          >
            <Icon name="survey" size={18} />
            Survey
          </button>
        </div>

        {/* Floating Tooltip */}
        {tooltip.visible && (
          <div style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
            background: '#222',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: FONT_FAMILY,
            pointerEvents: 'none',
            zIndex: 10000,
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}>
            {tooltip.text}
          </div>
        )}

        {/* Region Selection Tool */}
        {showRegionSelection && (
          <RegionSelectionTool
            active={showRegionSelection}
            onRegionComplete={handleRegionComplete}
            onCancel={() => {
              setShowRegionSelection(false);
              setRegionSelectionPage(null);
            }}
            currentSpaceId={activeSpaceId}
            currentPageId={regionSelectionPage}
            scale={scale}
            initialRegions={regionSelectionPage ? (getPageRegions(regionSelectionPage) || []) : []}
            onSetFullPage={handleRegionSetFullPage}
            canSetFullPage={canSetRegionToFullPage}
          />
        )}

        {/* Middle Area: Sidebar + PDF Container */}
        <div
          ref={middleAreaRef}
          style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
            marginRight: showSurveyPanel ? (isSurveyPanelCollapsed ? '48px' : '320px') : '0'
          }}>

          {/* Pending Location Banner */}
          {pendingLocationItem && (
            <div style={{
              position: 'absolute',
              top: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2000,
              background: 'rgba(74, 144, 226, 0.9)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: '20px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              pointerEvents: 'none'
            }}>
              <Icon name="search" size={16} />
              <span style={{ fontWeight: 500 }}>
                Draw a box on the PDF to locate "{pendingLocationItem.name || 'Item'}"
              </span>
              <button
                style={{
                  pointerEvents: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer',
                  marginLeft: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                onClick={() => setPendingLocationItem(null)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}

          {/* Sidebar */}
          <PDFSidebar
            features={features}
            pdfDoc={pdfDoc}
            numPages={numPages}
            pageNum={pageNum}
            onNavigateToPage={goToPage}
            onNavigateToMatch={navigateToMatch}
            searchResults={searchResults}
            currentMatchIndex={currentMatchIndex}
            onSearchResultsChange={handleSearchResultsChange}
            onCurrentMatchIndexChange={handleCurrentMatchIndexChange}
            onDuplicatePage={handleDuplicatePage}
            onDeletePage={handleDeletePage}
            onCutPage={handleCutPage}
            onCopyPage={handleCopyPage}
            onPastePage={handlePastePage}
            clipboardPage={clipboardPage}
            clipboardType={clipboardType}
            onRotatePage={handleRotatePage}
            onMirrorPage={handleMirrorPage}
            onResetPage={handleResetPage}
            onReorderPages={handleReorderPages}
            pageTransformations={pageTransformations}
            bookmarks={bookmarks}
            onBookmarkCreate={handleBookmarkCreate}
            onBookmarkUpdate={handleBookmarkUpdate}
            onBookmarkDelete={handleBookmarkDelete}
            spaces={spaces}
            onSpaceCreate={handleSpaceCreate}
            onSpaceUpdate={handleSpaceUpdate}
            onSpaceDelete={handleSpaceDelete}
            activeSpaceId={activeSpaceId}
            onSetActiveSpace={handleSetActiveSpace}
            onExitSpaceMode={handleExitSpaceMode}
            onRequestRegionEdit={handleRequestRegionEdit}
            onSpaceAssignPages={handleSpaceAssignPages}
            onSpaceRenamePage={handleSpaceRenamePage}
            onSpaceRemovePage={handleSpaceRemovePage}
            onReorderSpaces={handleReorderSpaces}
            onExportSpaceCSV={handleExportSpaceToCSV}
            onExportSpacePDF={handleExportSpaceToPDF}
            isRegionSelectionActive={showRegionSelection}
            shouldShowPage={shouldShowPage}
            activeSpacePages={activeSpacePages}
            scale={scale}
            tabId={tabId}
            onPageDrop={onPageDrop}
            onToggleCollapse={(isCollapsed) => {
              setIsLeftSidebarCollapsed(isCollapsed);
              requestAnimationFrame(() => {
                zoomControllerRef.current?.applyZoom({ persist: false, force: true });
              });
            }}
          />

          {/* PDF Container - Optimized */}
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={containerStyle}
            data-testid="pdf-container"
          >
            <div
              ref={contentRef}
              style={contentStyle}>
              {scrollMode === 'continuous' ? (
                numPages > 0 ? Array.from({ length: numPages }, (_, i) => i + 1)
                  .filter(pageNumber => shouldShowPage(pageNumber))
                  .map(pageNumber => {
                    const pageRegions = getPageRegions(pageNumber);
                    const isMounted = mountedPages.has(pageNumber);

                    return (
                      <div
                        key={pageNumber}
                        ref={el => pageContainersRef.current[pageNumber] = el}
                        data-page-num={pageNumber}
                        style={{
                          minHeight: pageHeights[pageNumber] ? `${pageHeights[pageNumber] * scale}px` : '800px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          position: 'relative'
                        }}
                      >
                        {isMounted ? (
                          <div style={{
                            position: 'relative',
                            transform: getPageTransform(pageNumber),
                            transformOrigin: 'center center'
                          }}>
                            <PDFPageCanvas
                              page={pageObjects[pageNumber]}
                              scale={scale}
                              onFinishRender={() => {
                                setRenderedPages(prev => new Set([...prev, pageNumber]));
                              }}
                            />
                            {pageSizes[pageNumber] && pageObjects[pageNumber] && (
                              <TextLayer
                                pageNumber={pageNumber}
                                page={pageObjects[pageNumber]}
                                scale={scale}
                                width={pageSizes[pageNumber].width}
                                height={pageSizes[pageNumber].height}
                                onTextSelected={handleTextSelected}
                                isSelectionMode={activeTool === 'pan' || activeTool === 'text-select'}
                              />
                            )}
                            {/* Search Highlight Layer */}
                            {pageSizes[pageNumber] && searchResultsByPage[pageNumber] && searchResultsByPage[pageNumber].length > 0 && (
                              <SearchHighlightLayer
                                pageNumber={pageNumber}
                                width={pageSizes[pageNumber].width}
                                height={pageSizes[pageNumber].height}
                                scale={scale}
                                highlights={searchResultsByPage[pageNumber]}
                                activeMatchId={currentMatch?.id}
                                isActiveMatchOnThisPage={currentMatch?.pageNumber === pageNumber}
                              />
                            )}
                            {pageSizes[pageNumber] && (
                              <PageAnnotationLayer
                                pageNumber={pageNumber}
                                width={pageSizes[pageNumber].width}
                                height={pageSizes[pageNumber].height}
                                scale={scale}
                                tool={activeTool}
                                strokeColor={strokeColor}
                                strokeWidth={Number(strokeWidth) || 3}
                                annotations={annotationsByPage[pageNumber]}
                                onSaveAnnotations={handleSaveAnnotations}
                                newHighlights={newHighlightsByPage[pageNumber]}
                                highlightsToRemove={highlightsToRemoveByPage[pageNumber]}
                                onHighlightCreated={handleHighlightCreated}
                                onHighlightDeleted={handleHighlightDeleted}
                                onHighlightClicked={handleHighlightClicked}
                                selectedSpaceId={annotationSpaceId}
                                selectedModuleId={selectedModuleId}
                                selectedCategoryId={selectedCategoryId}
                                activeRegions={pageRegions}
                                eraserMode={eraserMode}
                                eraserSize={eraserSize}
                                showSurveyPanel={showSurveyPanel}
                                layerVisibility={annotationLayerVisibility}
                              />
                            )}
                            {/* Space Region Dimming Overlay */}
                            {pageRegions && pageRegions.length > 0 && !(showRegionSelection && regionSelectionPage === pageNumber) && (
                              <SpaceRegionOverlay
                                pageNumber={pageNumber}
                                regions={pageRegions}
                                width={pageSizes[pageNumber]?.width || 0}
                                height={pageSizes[pageNumber]?.height || 0}
                                scale={scale}
                              />
                            )}
                            {/* Region Selection Overlay for this specific page */}
                            {showRegionSelection && regionSelectionPage === pageNumber && (
                              <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: `${(pageSizes[pageNumber]?.width || 0) * scale}px`,
                                height: `${(pageSizes[pageNumber]?.height || 0) * scale}px`,
                                pointerEvents: 'none',
                                zIndex: 1000
                              }}>
                                <div id="region-selection-target" style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  width: '100%',
                                  height: '100%'
                                }} />
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Lightweight placeholder for unmounted pages */
                          <div style={{
                            width: pageHeights[pageNumber] ? `${pageHeights[pageNumber] * 0.7 * scale}px` : '595px',
                            height: pageHeights[pageNumber] ? `${pageHeights[pageNumber] * scale}px` : '800px',
                            background: '#f5f5f5',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#999',
                            fontSize: '14px'
                          }}>
                            Page {pageNumber}
                          </div>
                        )}
                      </div>
                    );
                  }) : (
                  <div style={{
                    padding: '40px',
                    textAlign: 'center',
                    color: '#999',
                    fontSize: '14px'
                  }}>
                    {numPages === 0 ? 'No pages to display' : 'No pages match the current filter'}
                  </div>
                )
              ) : (
                shouldShowPage(pageNum) && (() => {
                  const pageRegions = getPageRegions(pageNum);
                  return (
                    <div
                      style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <div style={{
                        position: 'relative',
                        transform: getPageTransform(pageNum),
                        transformOrigin: 'center center'
                      }}>
                        <canvas
                          ref={el => canvasRef.current[pageNum] = el}
                          style={{
                            display: 'block',
                            background: '#fff',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                          }}
                        />
                        {pageSizes[pageNum] && pageObjects[pageNum] && (
                          <TextLayer
                            pageNumber={pageNum}
                            page={pageObjects[pageNum]}
                            scale={scale}
                            width={pageSizes[pageNum].width}
                            height={pageSizes[pageNum].height}
                            onTextSelected={handleTextSelected}
                            isSelectionMode={activeTool === 'pan' || activeTool === 'text-select'}
                          />
                        )}
                        {/* Search Highlight Layer */}
                        {pageSizes[pageNum] && searchResultsByPage[pageNum] && searchResultsByPage[pageNum].length > 0 && (
                          <SearchHighlightLayer
                            pageNumber={pageNum}
                            width={pageSizes[pageNum].width}
                            height={pageSizes[pageNum].height}
                            scale={scale}
                            highlights={searchResultsByPage[pageNum]}
                            activeMatchId={currentMatch?.id}
                            isActiveMatchOnThisPage={currentMatch?.pageNumber === pageNum}
                          />
                        )}
                        {pageSizes[pageNum] && (
                          <PageAnnotationLayer
                            pageNumber={pageNum}
                            width={pageSizes[pageNum].width}
                            height={pageSizes[pageNum].height}
                            scale={scale}
                            tool={activeTool}
                            strokeColor={strokeColor}
                            strokeWidth={Number(strokeWidth) || 3}
                            annotations={annotationsByPage[pageNum]}
                            onSaveAnnotations={handleSaveAnnotations}
                            newHighlights={newHighlightsByPage[pageNum]}
                            highlightsToRemove={highlightsToRemoveByPage[pageNum]}
                            onHighlightCreated={handleHighlightCreated}
                            onHighlightDeleted={handleHighlightDeleted}
                            onHighlightClicked={handleHighlightClicked}
                            selectedSpaceId={annotationSpaceId}
                            selectedModuleId={selectedModuleId}
                            selectedCategoryId={selectedCategoryId}
                            activeRegions={pageRegions}
                            eraserMode={eraserMode}
                            eraserSize={eraserSize}
                            showSurveyPanel={showSurveyPanel}
                            layerVisibility={annotationLayerVisibility}
                          />
                        )}
                        {/* Space Region Dimming Overlay */}
                        {pageRegions && pageRegions.length > 0 && !(showRegionSelection && regionSelectionPage === pageNum) && (
                          <SpaceRegionOverlay
                            pageNumber={pageNum}
                            regions={pageRegions}
                            width={pageSizes[pageNum]?.width || 0}
                            height={pageSizes[pageNum]?.height || 0}
                            scale={scale}
                          />
                        )}
                        {/* Region Selection Overlay for this specific page */}
                        {showRegionSelection && regionSelectionPage === pageNum && (
                          <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: `${(pageSizes[pageNum]?.width || 0) * scale}px`,
                            height: `${(pageSizes[pageNum]?.height || 0) * scale}px`,
                            pointerEvents: 'none',
                            zIndex: 1000
                          }}>
                            <div id="region-selection-target" style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%'
                            }} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        </div>

        {/* Secondary Sub-Toolbar (Drawboard Style) */}
        {activeCategoryDropdown && (
          <div
            style={{
              width: '100%',
              height: '52px',
              background: 'transparent',
              borderBottom: '1px solid #3a3a3a',
              borderTop: '1px solid #3a3a3a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              zIndex: 10,
              boxSizing: 'border-box'
            }}
          >
            {activeCategoryDropdown === 'draw' && (
              <>
                {[
                  { id: 'pen', label: 'Pen', iconName: 'pen' },
                  { id: 'highlighter', label: 'Highlighter', iconName: 'highlighter' },
                  { id: 'eraser', label: 'Eraser', iconName: 'eraser' }
                ].map(t => (
                  <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <button
                      data-eraser-button={t.id === 'eraser' ? 'true' : undefined}
                      onClick={() => {
                        if (t.id === 'eraser') {
                          if (activeTool === 'eraser') {
                            // If eraser is already active, toggle the menu
                            setShowEraserMenu(!showEraserMenu);
                          } else {
                            // If eraser is not active, set it as active and open the menu
                            setActiveTool(t.id);
                            setShowEraserMenu(true);
                          }
                        } else {
                          setActiveTool(t.id);
                          if (t.id !== 'eraser') setShowEraserMenu(false);
                        }
                      }}
                      className={`btn ${activeTool === t.id ? 'btn-active' : 'btn-ghost'}`}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '6px',
                        gap: '4px',
                        minWidth: '40px',
                        width: '40px'
                      }}
                      title={t.label}
                    >
                      <Icon name={t.iconName} size={20} />
                      {t.id === 'eraser' && activeTool === 'eraser' && (
                        <div
                          data-eraser-button="true"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowEraserMenu(!showEraserMenu);
                          }}
                          style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(12px, -50%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '2px',
                            pointerEvents: 'auto'
                          }}
                        >
                          <Icon name="chevronUp" size={12} />
                        </div>
                      )}
                    </button>

                    {/* Eraser Mode Popup specific to the Eraser tool in sub-toolbar */}
                    {t.id === 'eraser' && activeTool === 'eraser' && showEraserMenu && (
                      <div
                        ref={eraserMenuRef}
                        style={{
                          position: 'absolute',
                          bottom: '100%',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          marginBottom: '6px',
                          background: '#1e1e1e',
                          border: '1px solid #333',
                          borderRadius: '6px',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                          zIndex: 1000,
                          display: 'flex',
                          flexDirection: 'column',
                          padding: '4px',
                          minWidth: '140px'
                        }}
                      >
                        <div style={{
                          padding: '4px 8px',
                          fontSize: '10px',
                          color: '#888',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          borderBottom: '1px solid #333',
                          marginBottom: '4px'
                        }}>
                          Eraser Type
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEraserMode('partial');
                            setShowEraserMenu(false);
                          }}
                          className={`btn ${eraserMode === 'partial' ? 'btn-active' : 'btn-ghost'}`}
                          style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '6px 10px', fontSize: '12px' }}
                        >
                          Partial Eraser
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEraserMode('entire');
                            setShowEraserMenu(false);
                          }}
                          className={`btn ${eraserMode === 'entire' ? 'btn-active' : 'btn-ghost'}`}
                          style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '6px 10px', fontSize: '12px' }}
                        >
                          Entire Eraser
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {activeCategoryDropdown === 'shape' && (
              <>
                {[
                  { id: 'rect', label: 'Rectangle', iconName: 'rect' },
                  { id: 'ellipse', label: 'Ellipse', iconName: 'ellipse' },
                  { id: 'line', label: 'Line', iconName: 'line' },
                  { id: 'arrow', label: 'Arrow', iconName: 'arrow' }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTool(t.id)}
                    className={`btn ${activeTool === t.id ? 'btn-active' : 'btn-ghost'}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px',
                      gap: '4px',
                      minWidth: '40px'
                    }}
                    title={t.label}
                  >
                    <Icon name={t.iconName} size={20} />
                  </button>
                ))}
              </>
            )}

            {activeCategoryDropdown === 'review' && (
              <>
                {[
                  { id: 'text', label: 'Text', iconName: 'text' },
                  { id: 'note', label: 'Note', iconName: 'note' },
                  { id: 'underline', label: 'Underline', iconName: 'underline' },
                  { id: 'strikeout', label: 'Strikeout', iconName: 'strikeout' },
                  { id: 'squiggly', label: 'Squiggly', iconName: 'squiggly' }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTool(t.id)}
                    className={`btn ${activeTool === t.id ? 'btn-active' : 'btn-ghost'}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px',
                      gap: '4px',
                      minWidth: '40px'
                    }}
                    title={t.label}
                  >
                    <Icon name={t.iconName} size={20} />
                  </button>
                ))}
              </>
            )}

            {activeCategoryDropdown === 'survey' && (
              <button
                onClick={() => setActiveTool('highlight')}
                className={`btn ${activeTool === 'highlight' ? 'btn-active' : 'btn-ghost'}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px',
                  gap: '4px',
                  minWidth: '40px'
                }}
                title="Highlight Area"
              >
                <Icon name="highlighter" size={20} />
              </button>
            )}
          </div>
        )}

        {/* Annotation Toolbar Footer */}
        <div
          ref={bottomToolbarRef}
          style={{
            padding: '11px 20px 12px 20px',
            background: 'transparent',
            borderTop: '1px solid #444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            fontSize: '14px',
            fontFamily: FONT_FAMILY,
            flexShrink: 0,
            position: 'relative'
          }}
        >
          {/* Left Spacer */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }} />

          {/* Centered Annotation Tools */}
          <div style={{ display: 'flex', alignItems: 'center', alignContent: 'center', gap: '6px', flexWrap: 'wrap', position: 'relative' }}>
            {/* Top Level Tools: Pan & Select */}
            {[
              { id: 'pan', label: 'Pan', iconName: 'pan' },
              { id: 'select', label: 'Select', iconName: 'cursor' }
            ].map(t => (
              <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    setActiveTool(t.id);
                    setActiveCategoryDropdown(null);
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltip({ visible: true, text: t.label, x: rect.left + rect.width / 2, y: rect.top - 10 });
                  }}
                  onMouseLeave={() => setTooltip({ visible: false, text: '', x: 0, y: 0 })}
                  className={`btn btn-icon ${activeTool === t.id ? 'btn-active' : ''}`}
                >
                  <Icon name={t.iconName} size={16} />
                </button>
              </div>
            ))}

            <div style={{ width: '1px', height: '24px', background: 'rgb(85, 85, 85)', margin: '0 2px' }} />

            {/* Draw Category */}
            {/* Draw Category Button */}
            {/* Draw Category Button */}
            <button
              onClick={() => {
                const isActive = activeCategoryDropdown === 'draw';
                setActiveCategoryDropdown(isActive ? null : 'draw');
                if (!isActive) {
                  if (!['pen', 'highlighter', 'eraser'].includes(activeTool)) {
                    setActiveTool(lastDrawTool);
                  }
                }
              }}
              className={`btn btn-md ${activeCategoryDropdown === 'draw' || ['pen', 'highlighter', 'eraser'].includes(activeTool) ? 'btn-active' : 'btn-default'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
              title="Draw"
            >
              <Icon name="pen" size={22} />
            </button>

            {/* Shape Category */}
            {/* Shape Category Button */}
            {/* Shape Category Button */}
            <button
              onClick={() => {
                const isActive = activeCategoryDropdown === 'shape';
                setActiveCategoryDropdown(isActive ? null : 'shape');
                if (!isActive) {
                  if (!['rect', 'ellipse', 'line', 'arrow'].includes(activeTool)) {
                    setActiveTool(lastShapeTool);
                  }
                }
              }}
              className={`btn btn-md ${activeCategoryDropdown === 'shape' || ['rect', 'ellipse', 'line', 'arrow'].includes(activeTool) ? 'btn-active' : 'btn-default'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
              title="Shape"
            >
              <Icon name="rect" size={16} />
            </button>

            {/* Review Category */}
            {/* Review Category Button */}
            {/* Review Category Button */}
            <button
              onClick={() => {
                const isActive = activeCategoryDropdown === 'review';
                setActiveCategoryDropdown(isActive ? null : 'review');
                if (!isActive) {
                  if (!['text', 'note', 'underline', 'strikeout', 'squiggly'].includes(activeTool)) {
                    setActiveTool(lastReviewTool);
                  }
                }
              }}
              className={`btn btn-md ${activeCategoryDropdown === 'review' || ['text', 'note', 'underline', 'strikeout', 'squiggly'].includes(activeTool) ? 'btn-active' : 'btn-default'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
              title="Review"
            >
              <Icon name="text" size={16} />
            </button>

            {/* Survey Category Button (Conditional) */}
            {showSurveyPanel && (
              <button
                onClick={() => {
                  const isActive = activeCategoryDropdown === 'survey';
                  setActiveCategoryDropdown(isActive ? null : 'survey');
                  if (!isActive) {
                    setActiveTool('highlight');
                  }
                }}
                className={`btn btn-md ${activeCategoryDropdown === 'survey' || activeTool === 'highlight' ? 'btn-active' : 'btn-default'}`}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
                title="Survey"
              >
                <Icon name="highlighter" size={16} />
              </button>
            )}



            <div style={{ width: '1px', height: '24px', background: '#555' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              <button
                onClick={() => setShowAnnotationColorPicker(!showAnnotationColorPicker)}
                className="btn btn-default"
                style={{
                  width: '32px',
                  height: '28px',
                  padding: 0,
                  borderRadius: '4px',
                  border: '1px solid transparent',
                  background: strokeColor,
                  opacity: strokeOpacity / 100,
                  position: 'relative',
                  overflow: 'hidden'
                }}
                title="Color"
              />

              {showAnnotationColorPicker && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  marginBottom: '10px',
                  transform: 'translate(-50%, 0)',
                  zIndex: 2000
                }}>
                  <CompactColorPicker
                    color={strokeColor}
                    opacity={strokeOpacity / 100}
                    onChange={(hex, alpha) => {
                      handleStrokeColorChange(hex);
                      handleStrokeOpacityChange(Math.round(alpha * 100));
                    }}
                    onClose={() => setShowAnnotationColorPicker(false)}
                  />
                </div>
              )}

              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="no-spin-buttons"
                value={activeTool === 'eraser' ? eraserSizeInputValue : strokeWidthInputValue}
                onChange={activeTool === 'eraser' ? handleEraserSizeInputChange : handleStrokeWidthInputChange}
                onFocus={() => activeTool === 'eraser' ? setIsEraserSizeFocused(true) : setIsStrokeWidthFocused(true)}
                onBlur={activeTool === 'eraser' ? handleEraserSizeInputBlur : handleStrokeWidthInputBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.target.blur();
                  }
                }}
                style={{
                  width: "40px",
                  padding: "6px 4px",
                  background: "#444",
                  color: "#ddd",
                  border: "1px solid transparent",
                  borderRadius: "5px",
                  fontSize: "13px",
                  fontFamily: FONT_FAMILY,
                  textAlign: "center"
                }}
                title="Width"
              />
            </div>
          </div>

          {/* Right Section: Zoom Controls */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={zoomOut}
              className="btn btn-default btn-icon"
            >
              <Icon name="minus" size={18} />
            </button>

            <div
              onClick={() => zoomInputRef.current?.focus()}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '29px',
                background: '#444',
                border: '1px solid #555',
                borderRadius: '5px',
                padding: '0 4px',
                boxSizing: 'border-box',
                cursor: 'text'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'inline-grid', alignItems: 'center' }}>
                  <span style={{
                    gridArea: '1/1',
                    visibility: 'hidden',
                    fontSize: '13px',
                    fontFamily: FONT_FAMILY,
                    fontWeight: '500',
                    letterSpacing: '-0.2px',
                    whiteSpace: 'pre',
                    padding: '0 1px'
                  }}>
                    {zoomInputValue || ' '}
                  </span>
                  <input
                    ref={zoomInputRef}
                    type="text"
                    data-page-number-input
                    value={zoomInputValue}
                    onChange={handleZoomInputChange}
                    onKeyDown={handleZoomInputKeyDown}
                    onBlur={handleZoomInputBlur}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Zoom percentage"
                    style={{
                      gridArea: '1/1',
                      width: '100%',
                      background: 'transparent',
                      color: '#ddd',
                      border: 'none',
                      padding: 0,
                      margin: 0,
                      fontSize: '13px',
                      fontFamily: FONT_FAMILY,
                      fontWeight: '500',
                      letterSpacing: '-0.2px',
                      textAlign: 'center',
                      outline: 'none',
                      minWidth: '1ch'
                    }}
                  />
                </div>
                <span style={{
                  color: '#999',
                  fontSize: '12px',
                  fontFamily: FONT_FAMILY,
                  fontWeight: '400',
                  marginLeft: '1px',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  height: '100%'
                }}>
                  %
                </span>
              </div>
            </div>

            <button
              onClick={zoomIn}
              className="btn btn-default btn-icon"
            >
              <Icon name="plus" size={18} />
            </button>

            <button
              onClick={resetZoom}
              className="btn btn-default btn-sm"
              style={{ fontSize: '13px', padding: '6px 10px' }}
            >
              Reset
            </button>

            <div
              ref={zoomMenuRef}
              style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
            >
              <button
                onClick={toggleZoomMenu}
                className="btn btn-default btn-sm"
                aria-haspopup="listbox"
                aria-expanded={isZoomMenuOpen}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  whiteSpace: 'nowrap',
                  fontSize: '13px',
                  padding: '6px 10px'
                }}
              >
                <span>{zoomDropdownLabel}</span>
                <Icon name={isZoomMenuOpen ? 'chevronUp' : 'chevronDown'} size={14} />
              </button>

              {isZoomMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    right: 0,
                    marginBottom: '6px',
                    background: '#2b2b2b',
                    border: '1px solid transparent',
                    borderRadius: '10px',
                    boxShadow: '0 18px 36px rgba(0,0,0,0.45)',
                    minWidth: '220px',
                    zIndex: 2000,
                    padding: '6px 0'
                  }}
                >
                  {ZOOM_MODE_OPTIONS.map((option) => {
                    const isActive = option.id === zoomMode;
                    return (
                      <button
                        key={option.id}
                        onClick={() => handleZoomModeSelect(option.id)}
                        className="btn btn-ghost"
                        style={{
                          width: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          padding: '10px 14px',
                          background: isActive ? '#3a3a3a' : 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          gap: '2px'
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#e0e0e0' }}>
                          {option.label}
                          {option.id === ZOOM_MODES.MANUAL && (
                            <span style={{ marginLeft: '6px', fontWeight: 400, color: '#9a9a9a' }}>
                              {Math.round((manualZoomScale || 1) * 100)}%
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: '12px', color: '#9a9a9a' }}>
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* View Mode Toggle */}
            <button
              onClick={toggleScrollMode}
              className="btn btn-default btn-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                justifyContent: 'center',
                paddingLeft: '10px',
                paddingRight: '10px',
                position: 'absolute',
                left: '8px'
              }}
            >
              <Icon name={scrollMode === 'continuous' ? 'pages' : 'pageSingle'} size={16} />
              {scrollMode === 'continuous' ? 'Continuous' : 'Single Page'}
            </button>

            {/* Page Navigation */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              position: 'absolute',
              left: '114px'
            }}>
              <button
                onClick={goToPreviousPage}
                disabled={pageNum <= 1}
                className="btn btn-default btn-icon-sm"
              >
                <Icon name="chevronLeft" size={16} />
              </button>

              <input
                ref={pageInputRef}
                type="text"
                data-page-number-input
                value={pageInputValue}
                onChange={handlePageInputChange}
                onKeyDown={handlePageInputKeyDown}
                onBlur={handlePageInputBlur}
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Current page"
                style={{
                  width: '48px',
                  padding: '3px 8px',
                  background: '#444',
                  color: '#ddd',
                  border: '1px solid #555',
                  borderRadius: '5px',
                  fontSize: '13px',
                  fontFamily: FONT_FAMILY,
                  fontWeight: '500',
                  letterSpacing: '-0.2px',
                  textAlign: 'center'
                }}
              />

              <span style={{
                color: '#999',
                fontSize: '13px',
                fontFamily: FONT_FAMILY,
                fontWeight: '400'
              }}>
                / {numPages}
              </span>

              <button
                onClick={goToNextPage}
                disabled={pageNum >= numPages}
                className="btn btn-default btn-icon-sm"
              >
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Status Bar with improved typography */}
        <div
          ref={statusBarRef}
          style={{
            padding: '8px 20px',
            background: '#333',
            borderTop: '1px solid #444',
            fontSize: '12px',
            color: '#999',
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            fontFamily: FONT_FAMILY,
            fontWeight: '400',
            letterSpacing: '-0.1px'
          }}>
          <span>
            {scrollMode === 'continuous'
              ? 'Scroll to navigate • Ctrl+Scroll to zoom • Drag to pan'
              : 'Use arrow keys • Ctrl+Scroll to zoom • Drag to pan'}
          </span>
          {scrollMode === 'continuous' && (
            <>
              <span style={{
                marginLeft: 'auto',
                color: '#aaa',
                fontFamily: FONT_FAMILY,
                fontWeight: '500'
              }}>
                {renderedPages.size} of {numPages} pages rendered
              </span>
            </>
          )}
        </div>

        {/* Space Selection Modal */}
        {showSpaceSelection && (
          <>
            <div
              onClick={() => setShowSpaceSelection(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                zIndex: 10000,
                animation: 'fadeIn 0.2s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#2b2b2b',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  padding: '24px',
                  width: '500px',
                  maxWidth: '90vw',
                  maxHeight: '80vh',
                  overflow: 'auto',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                  animation: 'fadeIn 0.2s ease-out'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '20px'
                }}>
                  <h2 style={{
                    margin: 0,
                    fontSize: '18px',
                    fontWeight: '600',
                    color: '#fff',
                    fontFamily: FONT_FAMILY
                  }}>
                    Select Space
                  </h2>
                  <button
                    onClick={() => setShowSpaceSelection(false)}
                    className="btn btn-icon btn-icon-sm"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#999'
                    }}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                {appTemplates.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                    <p>No templates available. Please create a template first.</p>
                  </div>
                ) : (() => {
                  // Aggregate all spaces from all templates
                  const allSpaces = [];
                  appTemplates.forEach(template => {
                    (template.spaces || []).forEach(space => {
                      allSpaces.push({ ...space, templateId: template.id, templateName: template.name });
                    });
                  });

                  if (allSpaces.length === 0) {
                    return (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                        <p>No spaces available in any template.</p>
                      </div>
                    );
                  }

                  // Determine source module ID if we're copying items
                  const selectedHighlightIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                  let sourceModuleId = null;
                  if (selectedHighlightIds.length > 0) {
                    const firstHighlight = highlightAnnotations[selectedHighlightIds[0]];
                    const highlightModuleId = firstHighlight?.moduleId || firstHighlight?.spaceId; // Support legacy spaceId
                    sourceModuleId = highlightModuleId || selectedModuleId;
                  } else {
                    sourceModuleId = selectedModuleId;
                  }

                  // Filter out the source module from available modules (only if we have a source module)
                  const availableModules = sourceModuleId
                    ? allSpaces.filter(module => module.id !== sourceModuleId)
                    : allSpaces;

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {availableModules.map(module => (
                        <button
                          key={`${module.templateId}-${module.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();

                            // Find the template that contains this module
                            const template = appTemplates.find(t => t.id === module.templateId);

                            if (!template) {
                              console.error('Template not found for module:', module);
                              alert('Template not found. Please try again.');
                              return;
                            }

                            // Check if we're copying categories (when categorySelectModeActive is true)
                            if (categorySelectModeActive) {
                              const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                              if (selectedCatIds.length === 0) {
                                alert('Please select at least one category to copy.');
                                return;
                              }

                              // Get all highlights in the selected categories
                              const highlightsToCopy = [];
                              selectedCatIds.forEach(catId => {
                                const highlightsInCategory = Object.entries(highlightAnnotations).filter(([_, h]) => {
                                  const hModuleId = h.moduleId || h.spaceId; // Support legacy spaceId
                                  return hModuleId === selectedModuleId && h.categoryId === catId;
                                }
                                );
                                highlightsInCategory.forEach(([highlightId, highlight]) => {
                                  highlightsToCopy.push(highlightId);
                                });
                              });

                              if (highlightsToCopy.length === 0) {
                                alert('Selected categories have no items to copy.');
                                return;
                              }

                              // Use the same logic as item copying, but for all items in selected categories
                              const itemIdsToCopy = [];
                              const sourceTemplate = selectedTemplate || appTemplates.find(t => {
                                const allModules = (t.modules || t.spaces) || [];
                                return allModules.some(m => m.id === selectedModuleId);
                              });

                              if (!sourceTemplate) {
                                alert('Unable to find source template. Please try again.');
                                return;
                              }

                              highlightsToCopy.forEach(highlightId => {
                                const highlight = highlightAnnotations[highlightId];
                                if (!highlight || !highlight.categoryId) return;

                                const categoryName = getCategoryName(sourceTemplate, highlight.spaceId, highlight.categoryId);
                                const matchingItem = Object.values(items).find(item =>
                                  item.name === highlight.name &&
                                  item.itemType === categoryName
                                );

                                if (matchingItem && matchingItem.itemId && !itemIdsToCopy.includes(matchingItem.itemId)) {
                                  itemIdsToCopy.push(matchingItem.itemId);
                                }
                              });

                              if (itemIdsToCopy.length > 0) {
                                // Check if categories need to be created
                                const itemsToCheck = itemIdsToCopy.map(itemId => items[itemId]).filter(Boolean);
                                const itemTypes = [...new Set(itemsToCheck.map(item => item.itemType))];

                                const missingCategories = itemTypes.filter(itemType =>
                                  !categoryExists(template, module.id, itemType)
                                );

                                if (missingCategories.length > 0) {
                                  alert(`Some categories don't exist in the destination module. Please create them first: ${missingCategories.join(', ')}`);
                                  return;
                                }

                                // Copy items to destination module
                                const result = transferItems(
                                  itemIdsToCopy,
                                  selectedModuleId,
                                  module.id,
                                  template,
                                  items,
                                  annotations
                                );

                                setItems(result.newItems);
                                setAnnotations(result.updatedAnnotations);

                                // Create highlight entries for visual display
                                const newHighlights = {};
                                itemIdsToCopy.forEach(itemId => {
                                  const item = result.newItems[itemId];
                                  if (!item) return;

                                  const destAnnotation = Object.values(result.updatedAnnotations).find(ann => {
                                    const annModuleId = ann.moduleId || ann.spaceId; // Support legacy spaceId
                                    return ann.itemId === itemId && annModuleId === module.id;
                                  });

                                  const sourceHighlightId = highlightsToCopy.find(id => {
                                    const h = highlightAnnotations[id];
                                    return h && h.name === item.name;
                                  });
                                  const sourceHighlight = sourceHighlightId ? highlightAnnotations[sourceHighlightId] : null;

                                  const sourceAnnotation = Object.values(annotations).find(a => {
                                    const aModuleId = a.moduleId || a.spaceId; // Support legacy spaceId
                                    return a.itemId === itemId && aModuleId === selectedModuleId;
                                  });

                                  const destModule = ((template.modules || template.spaces) || []).find(m => m.id === module.id);
                                  const destCategory = destModule?.categories?.find(c => c.name === item.itemType);

                                  let bounds = null;
                                  if (destAnnotation?.pdfCoordinates) {
                                    bounds = destAnnotation.pdfCoordinates;
                                  } else if (sourceAnnotation?.pdfCoordinates) {
                                    bounds = sourceAnnotation.pdfCoordinates;
                                  } else if (sourceHighlight?.bounds) {
                                    bounds = sourceHighlight.bounds;
                                  }

                                  if (bounds) {
                                    const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                    const pageNum = sourceHighlight?.pageNumber || destAnnotation?.pageNumber || 1;

                                    newHighlights[highlightId] = {
                                      id: highlightId,
                                      pageNumber: pageNum,
                                      bounds: bounds,
                                      moduleId: module.id,
                                      categoryId: destCategory?.id || null,
                                      name: item.name || sourceHighlight?.name || 'Untitled Item',
                                      checklistResponses: {}
                                    };

                                    setNewHighlightsByPage(prev => ({
                                      ...prev,
                                      [pageNum]: [
                                        ...(prev[pageNum] || []),
                                        {
                                          ...bounds,
                                          needsBIC: true,
                                          highlightId: highlightId
                                        }
                                      ]
                                    }));
                                  }
                                });

                                if (Object.keys(newHighlights).length > 0) {
                                  setHighlightAnnotations(prev => ({
                                    ...prev,
                                    ...newHighlights
                                  }));
                                }

                                // Clear selection and close modals
                                setSelectedCategories({});
                                setCategorySelectModeActive(false);
                                setCategorySelectModeForCategory(null);
                                setShowSpaceSelection(false);

                                // Switch to the destination module
                                setSelectedTemplate(template);
                                setSelectedModuleId(module.id);
                                setShowSurveyPanel(true);

                                return;
                              } else {
                                // Fall back to legacy highlight copying
                                const legacyHighlights = highlightsToCopy
                                  .map(id => highlightAnnotations[id])
                                  .filter(Boolean);

                                if (legacyHighlights.length === 0) {
                                  alert('No valid items found to copy.');
                                  return;
                                }

                                const destModule = ((template.modules || template.spaces) || []).find(m => m.id === module.id);
                                const missingCategories = [];
                                legacyHighlights.forEach(h => {
                                  const hModuleId = h.moduleId || h.spaceId; // Support legacy spaceId
                                  const sourceCategoryName = getCategoryName(sourceTemplate, hModuleId, h.categoryId);
                                  const destCategory = destModule?.categories?.find(c => c.name === sourceCategoryName);
                                  if (!destCategory && sourceCategoryName && !missingCategories.includes(sourceCategoryName)) {
                                    missingCategories.push(sourceCategoryName);
                                  }
                                });

                                if (missingCategories.length > 0) {
                                  alert(`Cannot copy categories. The following categories don't exist in the destination module:\n\n${missingCategories.join(', ')}\n\nPlease create these categories in the destination module first.`);
                                  return;
                                }

                                const newHighlights = {};
                                legacyHighlights.forEach(h => {
                                  const hModuleId = h.moduleId || h.spaceId; // Support legacy spaceId
                                  const sourceCategoryName = getCategoryName(sourceTemplate, hModuleId, h.categoryId);
                                  const destCategory = destModule?.categories?.find(c => c.name === sourceCategoryName);

                                  const newId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                  newHighlights[newId] = {
                                    ...h,
                                    id: newId,
                                    moduleId: module.id,
                                    categoryId: destCategory?.id || null
                                  };
                                });

                                setHighlightAnnotations(prev => ({
                                  ...prev,
                                  ...newHighlights
                                }));

                                setSelectedCategories({});
                                setCategorySelectModeActive(false);
                                setCategorySelectModeForCategory(null);
                                setShowSpaceSelection(false);

                                setSelectedTemplate(template);
                                setSelectedModuleId(module.id);
                                setShowSurveyPanel(true);

                                return;
                              }
                            }

                            // Check if we're copying items (when copiedItemSelection has items)
                            console.log('Copy to Spaces - Selected highlight IDs:', selectedHighlightIds);
                            console.log('Copy to Spaces - Highlight annotations:', highlightAnnotations);

                            if (selectedHighlightIds.length > 0) {
                              // We're copying items - get the itemIds from the selected highlights
                              const itemIdsToCopy = [];

                              if (!sourceSpaceId) {
                                console.error('No source space ID found');
                                alert('Unable to determine source space. Please try again.');
                                return;
                              }

                              // Find the source template (the one containing the source space)
                              const sourceTemplate = selectedTemplate || appTemplates.find(t =>
                                t.spaces?.some(s => s.id === sourceSpaceId)
                              );

                              if (!sourceTemplate) {
                                console.error('Source template not found for space:', sourceSpaceId);
                                alert('Unable to find source template. Please try again.');
                                return;
                              }

                              console.log('Source space ID:', sourceSpaceId);
                              console.log('Source template:', sourceTemplate);
                              console.log('Destination space ID:', space.id);
                              console.log('Destination template:', template);
                              console.log('All items:', items);
                              console.log('All annotations:', annotations);

                              selectedHighlightIds.forEach(highlightId => {
                                const highlight = highlightAnnotations[highlightId];
                                console.log(`Processing highlight ${highlightId}:`, highlight);

                                if (!highlight) {
                                  console.warn(`Highlight ${highlightId} not found`);
                                  return;
                                }

                                if (!highlight.categoryId) {
                                  console.warn(`Highlight ${highlightId} has no categoryId`);
                                  return;
                                }

                                // Find corresponding item by matching name and category (same logic as transfer)
                                const categoryName = getCategoryName(sourceTemplate, highlight.spaceId, highlight.categoryId);
                                console.log(`Category name for highlight ${highlightId}:`, categoryName);
                                console.log(`Highlight name:`, highlight.name);

                                // Find items that match name and category
                                const matchingItem = Object.values(items).find(item =>
                                  item.name === highlight.name &&
                                  item.itemType === categoryName
                                );

                                console.log(`Matching item for highlight ${highlightId}:`, matchingItem);

                                // Verify the item has an annotation in the same space
                                if (matchingItem) {
                                  // Try to find annotation - don't require displayType to be 'highlight'
                                  const matchingAnnotation = Object.values(annotations).find(ann =>
                                    ann.itemId === matchingItem.itemId &&
                                    ann.spaceId === highlight.spaceId
                                  );

                                  console.log(`Matching annotation for item ${matchingItem.itemId}:`, matchingAnnotation);

                                  if (matchingAnnotation && matchingItem.itemId) {
                                    // Found corresponding item in new system
                                    // Avoid duplicates
                                    if (!itemIdsToCopy.includes(matchingItem.itemId)) {
                                      console.log(`Adding item ${matchingItem.itemId} to copy list`);
                                      itemIdsToCopy.push(matchingItem.itemId);
                                    }
                                  } else {
                                    // No annotation found, but item exists - still copy it
                                    // The item might not have an annotation yet, but we can still copy it
                                    if (!itemIdsToCopy.includes(matchingItem.itemId)) {
                                      console.log(`Adding item ${matchingItem.itemId} to copy list (no annotation)`);
                                      itemIdsToCopy.push(matchingItem.itemId);
                                    }
                                  }
                                } else {
                                  console.warn(`No matching item found for highlight ${highlightId} with name "${highlight.name}" and category "${categoryName}"`);
                                }
                              });

                              console.log('Items to copy:', itemIdsToCopy);

                              if (itemIdsToCopy.length > 0) {
                                // Check if categories need to be created
                                const itemsToCheck = itemIdsToCopy.map(itemId => items[itemId]).filter(Boolean);
                                const itemTypes = [...new Set(itemsToCheck.map(item => item.itemType))];

                                console.log('Item types to copy:', itemTypes);

                                const missingCategories = itemTypes.filter(itemType =>
                                  !categoryExists(template, space.id, itemType)
                                );

                                if (missingCategories.length > 0) {
                                  // Need to create categories - show a message for now
                                  alert(`Some categories don't exist in the destination space. Please create them first: ${missingCategories.join(', ')}`);
                                  return;
                                } else {
                                  // Direct transfer - copy items to the destination space
                                  console.log('Calling transferItems with:', {
                                    itemIdsToCopy,
                                    sourceSpaceId,
                                    destSpaceId: space.id,
                                    template
                                  });

                                  const result = transferItems(
                                    itemIdsToCopy,
                                    sourceSpaceId,
                                    space.id,
                                    template,
                                    items,
                                    annotations
                                  );

                                  console.log('Transfer result:', result);

                                  // Update items and annotations
                                  setItems(result.newItems);
                                  setAnnotations(result.updatedAnnotations);

                                  // Create highlight entries for visual display
                                  console.log('Creating highlight entries for', itemIdsToCopy.length, 'items');
                                  const newHighlights = {};
                                  itemIdsToCopy.forEach(itemId => {
                                    const item = result.newItems[itemId];
                                    console.log('Processing item for highlight creation:', itemId, item);
                                    if (!item) {
                                      console.log('Item not found in result.newItems');
                                      return;
                                    }

                                    // Find the annotation we just created for this item in destination space
                                    const destAnnotation = Object.values(result.updatedAnnotations).find(ann =>
                                      ann.itemId === itemId && ann.spaceId === space.id
                                    );

                                    console.log('Destination annotation:', destAnnotation);

                                    // Find source annotation to get coordinates
                                    const sourceAnnotation = Object.values(annotations).find(a =>
                                      a.itemId === itemId && a.spaceId === sourceSpaceId
                                    );
                                    console.log('Source annotation:', sourceAnnotation);

                                    // Find source highlight by matching the selected ID
                                    const sourceHighlightId = selectedHighlightIds.find(id => {
                                      const h = highlightAnnotations[id];
                                      return h && h.name === item.name;
                                    });
                                    const sourceHighlight = sourceHighlightId ? highlightAnnotations[sourceHighlightId] : null;

                                    console.log('Source highlight:', sourceHighlight);

                                    // Find destination category ID
                                    const destSpace = template.spaces.find(s => s.id === space.id);
                                    const destCategory = destSpace?.categories?.find(c => c.name === item.itemType);
                                    console.log('Destination category:', destCategory);

                                    // Use destination annotation coordinates, or source annotation coordinates, or source highlight bounds
                                    let bounds = null;
                                    if (destAnnotation?.pdfCoordinates) {
                                      bounds = destAnnotation.pdfCoordinates;
                                    } else if (sourceAnnotation?.pdfCoordinates) {
                                      bounds = sourceAnnotation.pdfCoordinates;
                                    } else if (sourceHighlight?.bounds) {
                                      bounds = sourceHighlight.bounds;
                                    }

                                    console.log('Bounds for highlight:', bounds);

                                    if (bounds) {
                                      const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                      const pageNum = sourceHighlight?.pageNumber || destAnnotation?.pageNumber || 1;

                                      // Create highlight WITHOUT BIC (starts blank in new space)
                                      newHighlights[highlightId] = {
                                        id: highlightId,
                                        pageNumber: pageNum,
                                        bounds: bounds,
                                        spaceId: space.id,
                                        categoryId: destCategory?.id || null,
                                        name: item.name || sourceHighlight?.name || 'Untitled Item',
                                        // Do NOT copy BIC properties - item starts blank in new space
                                        checklistResponses: {}
                                      };
                                      console.log('Created highlight (no BIC):', newHighlights[highlightId]);

                                      // Add to newHighlightsByPage as transparent with dashed outline (needs BIC)
                                      setNewHighlightsByPage(prev => ({
                                        ...prev,
                                        [pageNum]: [
                                          ...(prev[pageNum] || []),
                                          {
                                            ...bounds,
                                            needsBIC: true, // Flag to indicate it needs BIC assignment
                                            highlightId: highlightId // Store ID for later reference
                                          }
                                        ]
                                      }));
                                    } else {
                                      console.log('No bounds available, skipping highlight creation');
                                    }
                                  });

                                  // Add new highlights to highlightAnnotations
                                  if (Object.keys(newHighlights).length > 0) {
                                    console.log('Adding', Object.keys(newHighlights).length, 'new highlights to highlightAnnotations');
                                    setHighlightAnnotations(prev => ({
                                      ...prev,
                                      ...newHighlights
                                    }));
                                  }

                                  // Clear selection and close modals
                                  setCopiedItemSelection({});
                                  setCopyModeActive(false);
                                  setShowSpaceSelection(false);

                                  // Switch to the destination space to show the copied items
                                  setSelectedTemplate(template);
                                  setSelectedSpaceId(space.id);
                                  setShowSurveyPanel(true);

                                  console.log('Copy completed successfully');
                                  // Explicitly return to prevent any further code execution
                                  return;
                                }
                              } else {
                                // No items found - handle as legacy highlights
                                console.log('No items found, treating highlights as legacy highlights');
                                const legacyHighlights = selectedHighlightIds
                                  .map(id => highlightAnnotations[id])
                                  .filter(Boolean);

                                if (legacyHighlights.length === 0) {
                                  console.error('No valid highlights found to process');
                                  alert('No valid highlights selected. Please select highlights and try again.');
                                  return;
                                }

                                console.log('Copying legacy highlights:', legacyHighlights);

                                // Check if all required categories exist in destination space
                                const destSpace = template.spaces.find(s => s.id === space.id);
                                const missingCategories = [];
                                legacyHighlights.forEach(h => {
                                  const sourceCategoryName = getCategoryName(sourceTemplate, h.spaceId, h.categoryId);
                                  const destCategory = destSpace?.categories?.find(c => c.name === sourceCategoryName);
                                  if (!destCategory && sourceCategoryName && !missingCategories.includes(sourceCategoryName)) {
                                    missingCategories.push(sourceCategoryName);
                                  }
                                });

                                if (missingCategories.length > 0) {
                                  alert(`Cannot copy highlights. The following categories don't exist in the destination space:\n\n${missingCategories.join(', ')}\n\nPlease create these categories in the destination space first.`);
                                  return;
                                }

                                // Create new highlights in destination space
                                const newHighlights = {};
                                legacyHighlights.forEach(h => {
                                  // Find matching category in destination space by name
                                  const sourceCategoryName = getCategoryName(sourceTemplate, h.spaceId, h.categoryId);
                                  const destCategory = destSpace?.categories?.find(c => c.name === sourceCategoryName);

                                  const newId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                  newHighlights[newId] = {
                                    ...h,
                                    id: newId,
                                    spaceId: space.id,
                                    categoryId: destCategory?.id || null
                                  };

                                  console.log(`Created legacy highlight copy: ${newId}`, newHighlights[newId]);
                                });

                                // Update highlightAnnotations
                                setHighlightAnnotations(prev => ({
                                  ...prev,
                                  ...newHighlights
                                }));

                                // Clear selection and close modals
                                setCopiedItemSelection({});
                                setCopyModeActive(false);
                                setShowSpaceSelection(false);

                                // Switch to destination space
                                setSelectedTemplate(template);
                                setSelectedSpaceId(space.id);
                                setShowSurveyPanel(true);

                                console.log('Legacy highlights copied successfully');
                                return;
                              }
                            } else {
                              // No items selected - this shouldn't happen if validation is working correctly
                              console.warn('No items selected for copy. Closing modal.');
                              setShowSpaceSelection(false);
                            }
                          }}
                          className="btn btn-default btn-md"
                          style={{
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                            padding: '12px 16px',
                            background: '#333',
                            border: '1px solid #444'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Icon name="template" size={20} />
                            <div>
                              <div style={{ fontWeight: '500', color: '#fff' }}>
                                {space.name || 'Untitled Space'}
                              </div>
                              <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                                {space.templateName || 'Untitled Template'}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>
        )}

        {/* Template Selection Modal */}
        {showTemplateSelection && (
          <>
            <div
              onClick={() => setShowTemplateSelection(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                zIndex: 10000,
                animation: 'fadeIn 0.2s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#2b2b2b',
                  border: '1px solid #444',
                  borderRadius: '8px',
                  padding: '24px',
                  width: '500px',
                  maxWidth: '90vw',
                  maxHeight: '80vh',
                  overflow: 'auto',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                  animation: 'fadeIn 0.2s ease-out'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '20px'
                }}>
                  <h2 style={{
                    margin: 0,
                    fontSize: '18px',
                    fontWeight: '600',
                    color: '#fff',
                    fontFamily: FONT_FAMILY
                  }}>
                    Select Template
                  </h2>
                  <button
                    onClick={() => setShowTemplateSelection(false)}
                    className="btn btn-icon btn-icon-sm"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#999'
                    }}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                {appTemplates.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '40px',
                      color: '#999',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '16px'
                    }}
                  >
                    <p style={{ margin: 0 }}>No templates available.</p>
                    <p style={{ margin: 0 }}>Please create a template first.</p>
                    <button
                      onClick={() => {
                        setShowTemplateSelection(false);
                        setShowSurveyPanel(false);
                        setSelectedTemplate(null);
                        setSelectedModuleId(null);
                        onRequestCreateTemplate?.();
                      }}
                      className="btn btn-primary btn-md"
                      style={{ minWidth: '160px' }}
                    >
                      Create Template
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {appTemplates.map(template => (
                        <button
                          key={template.id}
                          onClick={() => {
                            const firstModuleId = (template.modules || template.spaces || [])?.[0]?.id || null;
                            setSelectedTemplate(template);
                            setSelectedModuleId(firstModuleId);
                            setShowTemplateSelection(false);
                            setShowSurveyPanel(true);
                          }}
                          className="btn btn-default btn-md"
                          style={{
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                            padding: '12px 16px',
                            background: '#333',
                            border: '1px solid #444'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Icon name="template" size={20} />
                            <div>
                              <div style={{ fontWeight: '500', color: '#fff' }}>
                                {template.name || 'Untitled Template'}
                              </div>
                              <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                                {((template.modules || template.spaces) || []).length} module{((template.modules || template.spaces) || []).length !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setShowTemplateSelection(false);
                        setShowSurveyPanel(false);
                        setSelectedTemplate(null);
                        setSelectedModuleId(null);
                        onRequestCreateTemplate?.();
                      }}
                      className="btn btn-primary btn-md"
                      style={{ alignSelf: 'center', minWidth: '160px' }}
                    >
                      Create Template
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Survey Panel */}
        {showSurveyPanel && selectedTemplate && (
          <>
            {/* Panel */}
            <div
              style={{
                position: 'fixed',
                top: `${middleAreaBounds.top}px`,
                right: 0,
                height: `${middleAreaBounds.height}px`,
                width: isSurveyPanelCollapsed ? '48px' : '320px',
                background: '#2b2b2b',
                borderLeft: '1px solid #444',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.5)',
                animation: 'slideInRight 0.3s ease-out',
                transition: 'width 0.2s ease, top 0.2s ease, height 0.2s ease'
              }}
            >
              {/* Collapse/Expand Button */}
              <div
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #3a3a3a',
                  display: 'flex',
                  justifyContent: 'flex-start',
                  background: '#252525'
                }}
              >
                {isSurveyPanelCollapsed && (
                  <button
                    onClick={() => {
                      setIsSurveyPanelCollapsed(prev => !prev);
                      requestAnimationFrame(() => {
                        zoomControllerRef.current?.applyZoom({ persist: false, force: true });
                      });
                    }}
                    style={{
                      background: 'rgb(51, 51, 51)',
                      border: 'none',
                      color: 'rgb(153, 153, 153)',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgb(51, 51, 51)'}
                  >
                    <Icon name="chevronLeft" size={16} color="#999" />
                  </button>
                )}
              </div>

              {!isSurveyPanelCollapsed && (
                <>
                  {/* Panel Header */}
                  <div
                    style={{
                      padding: categorySelectModeActive ? '10px 8px' : '12px 8px',
                      borderBottom: '1px solid #444',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: '#333'
                    }}
                  >
                    <button
                      onClick={() => {
                        setIsSurveyPanelCollapsed(prev => !prev);
                        requestAnimationFrame(() => {
                          zoomControllerRef.current?.applyZoom({ persist: false, force: true });
                        });
                      }}
                      style={{
                        background: 'rgb(51, 51, 51)',
                        border: 'none',
                        color: 'rgb(153, 153, 153)',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.15s'
                      }}
                    >
                      <Icon name={isSurveyPanelCollapsed ? 'chevronLeft' : 'chevronRight'} size={16} color="#999" />
                    </button>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}
                    >
                      <h2
                        style={{
                          margin: 0,
                          fontSize: categorySelectModeActive ? '20px' : '18px',
                          fontWeight: '600',
                          color: '#fff',
                          fontFamily: FONT_FAMILY,
                          letterSpacing: '-0.2px',
                          flex: categorySelectModeActive ? 0 : 1
                        }}
                      >
                        {categorySelectModeActive && selectedModuleId
                          ? ((selectedTemplate.modules || selectedTemplate.spaces || []).find(m => m.id === selectedModuleId)?.name || 'Survey')
                          : (selectedTemplate.name || 'Survey')}
                      </h2>
                      {!categorySelectModeActive && (
                        <>
                          {selectedTemplate.linkedExcelPath && (
                            <>

                              {lastSyncMessage && (
                                <div style={{
                                  fontSize: '11px',
                                  color: lastSyncMessage.includes('failed') ? '#e74c3c' : '#3498db',
                                  padding: '4px 8px',
                                  background: lastSyncMessage.includes('failed') ? 'rgba(231, 76, 60, 0.1)' : 'rgba(52, 152, 219, 0.1)',
                                  borderRadius: '4px',
                                  border: lastSyncMessage.includes('failed') ? '1px solid rgba(231, 76, 60, 0.3)' : '1px solid rgba(52, 152, 219, 0.3)'
                                }}>
                                  {lastSyncMessage}
                                </div>
                              )}
                              <button
                                onClick={() => setAutoPushToExcel(!autoPushToExcel)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '11px',
                                  color: autoPushToExcel ? '#2ecc71' : '#888',
                                  padding: '4px 8px',
                                  background: autoPushToExcel ? 'rgba(46, 204, 113, 0.1)' : 'rgba(136, 136, 136, 0.1)',
                                  borderRadius: '4px',
                                  border: autoPushToExcel ? '1px solid rgba(46, 204, 113, 0.3)' : '1px solid rgba(136, 136, 136, 0.3)',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                title={autoPushToExcel ? 'Auto-push to Excel is ON' : 'Auto-push to Excel is OFF'}
                              >
                                <span style={{ fontSize: '14px' }}>{autoPushToExcel ? '●' : '○'}</span>
                                <span>Auto-push</span>
                              </button>
                              {lastPushMessage && (
                                <div style={{
                                  fontSize: '11px',
                                  color: lastPushMessage.includes('failed') ? '#e74c3c' : '#9b59b6',
                                  padding: '4px 8px',
                                  background: lastPushMessage.includes('failed') ? 'rgba(231, 76, 60, 0.1)' : 'rgba(155, 89, 182, 0.1)',
                                  borderRadius: '4px',
                                  border: lastPushMessage.includes('failed') ? '1px solid rgba(231, 76, 60, 0.3)' : '1px solid rgba(155, 89, 182, 0.3)'
                                }}>
                                  {lastPushMessage}
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        if (categorySelectModeActive) {
                          setCategorySelectModeActive(false);
                          setCategorySelectModeForCategory(null);
                          setSelectedCategories({});
                        } else {
                          setShowSurveyPanel(false);
                          setSelectedTemplate(null);
                          setSelectedSpaceId(null);
                          setSelectedCategoryId(null);
                        }
                      }}
                      className="btn btn-icon btn-icon-sm"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#fff',
                        padding: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  {/* Modules Tabs */}
                  {((selectedTemplate.modules || selectedTemplate.spaces) || []).length > 0 && (
                    <div style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #444',
                      background: '#333',
                      display: 'flex',
                      gap: '6px',
                      overflowX: 'auto'
                    }}>
                      {(selectedTemplate.modules || selectedTemplate.spaces || []).map(module => (
                        <button
                          key={module.id}
                          onClick={() => {
                            setSelectedModuleId(module.id);
                            setSelectedCategoryId(null); // Reset category when switching modules
                            // Exit select mode when switching modules
                            setCopyModeActive(false);
                            setCopiedItemSelection({});
                            if (categorySelectModeActive) {
                              setSelectedCategories({});
                            }
                          }}
                          className="btn btn-sm"
                          style={{
                            background: selectedModuleId === module.id ? '#4A90E2' : '#3A3A3A',
                            color: selectedModuleId === module.id ? '#fff' : '#DDD',
                            border: selectedModuleId === module.id ? '1px solid #4A90E2' : '1px solid #444',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            borderRadius: '6px'
                          }}
                        >
                          {module.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Panel Content */}
                  <div style={{
                    flex: categorySelectModeActive ? '1 1 auto' : 1,
                    overflowY: 'auto',
                    padding: '12px 8px',
                    fontFamily: FONT_FAMILY,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0
                  }}>
                    {selectedModuleId ? (() => {
                      const module = (selectedTemplate.modules || selectedTemplate.spaces || [])?.find(m => m.id === selectedModuleId);
                      if (!module) return null;

                      // Get highlights for this module, grouped by category
                      const highlightsByCategory = {};
                      Object.entries(highlightAnnotations).forEach(([highlightId, highlight]) => {
                        const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId
                        if (highlightModuleId === selectedModuleId && highlight.categoryId) {
                          if (!highlightsByCategory[highlight.categoryId]) {
                            highlightsByCategory[highlight.categoryId] = [];
                          }
                          // IMPORTANT: Always use the key from highlightAnnotations as the authoritative ID
                          // This ensures consistency when selecting/looking up highlights
                          highlightsByCategory[highlight.categoryId].push({
                            ...highlight,
                            id: highlightId  // Use the key, not highlight.id
                          });
                        }
                      });

                      // Show categories list first (before highlights)
                      const hasHighlights = Object.keys(highlightsByCategory).length > 0;

                      return (
                        <div>
                          {/* Select toggle button + Create Category */}
                          {!copyModeActive && !categorySelectModeActive ? (
                            <div
                              style={{
                                marginBottom: '12px',
                                display: 'flex',
                                gap: '8px',
                                flexWrap: 'wrap',
                                alignItems: 'center'
                              }}
                            >
                              <button
                                onClick={() => setCategorySelectModeActive(true)}
                                className="btn btn-sm"
                                style={{
                                  background: '#3a3a3a',
                                  color: '#ddd',
                                  border: '1px solid #444',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  padding: '6px 12px',
                                  borderRadius: '6px'
                                }}
                              >
                                Select Catagory
                              </button>
                              <button
                                onClick={() => {
                                  if (!selectedTemplate?.id || !selectedModuleId) {
                                    alert('Please select a template and module before creating a category.');
                                    return;
                                  }
                                  onRequestCreateTemplate?.({
                                    mode: 'edit',
                                    templateId: selectedTemplate.id,
                                    moduleId: selectedModuleId,
                                    startAddingCategory: true
                                  });
                                }}
                                className="btn btn-sm"
                                style={{
                                  background: '#4A90E2',
                                  color: '#fff',
                                  border: '1px solid #4A90E2',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                  padding: '6px 14px',
                                  borderRadius: '6px'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = '#5AA0F2';
                                  e.currentTarget.style.borderColor = '#5AA0F2';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = '#4A90E2';
                                  e.currentTarget.style.borderColor = '#4A90E2';
                                }}
                              >
                                Create Category
                              </button>
                            </div>
                          ) : copyModeActive ? (
                            <div style={{
                              marginBottom: '12px',
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              paddingBottom: '8px',
                              borderBottom: '1px solid #333'
                            }}>
                              {/* Select All checkbox */}
                              {(() => {
                                // IMPORTANT: Use the key from highlightAnnotations as the authoritative ID
                                const allHighlightIds = Object.entries(highlightAnnotations)
                                  .filter(([highlightId, h]) => {
                                    const hModuleId = h.moduleId || h.spaceId; // Support legacy spaceId
                                    return hModuleId === selectedModuleId;
                                  })
                                  .map(([highlightId, h]) => highlightId);  // Use the key, not h.id
                                const moduleSelectedCount = allHighlightIds.filter(id => copiedItemSelection[id] === true).length;
                                const moduleAllSelected = moduleSelectedCount === allHighlightIds.length && allHighlightIds.length > 0;

                                return (
                                  <label style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    cursor: 'pointer',
                                    userSelect: 'none'
                                  }}>
                                    <input
                                      type="checkbox"
                                      checked={moduleAllSelected}
                                      onChange={(e) => {
                                        const newSelection = { ...copiedItemSelection };
                                        allHighlightIds.forEach(id => {
                                          if (!moduleAllSelected) {
                                            newSelection[id] = true;
                                          } else {
                                            delete newSelection[id];
                                          }
                                        });
                                        setCopiedItemSelection(newSelection);
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    />
                                    <span style={{ color: '#ddd', fontSize: '13px', fontWeight: '400' }}>
                                      Select All
                                    </span>
                                  </label>
                                );
                              })()}

                              <div style={{ width: '1px', height: '16px', background: '#444' }} />

                              {/* Copy to Spaces button */}
                              <button
                                onClick={() => {
                                  const selectedIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                                  console.log('=== Copy to Spaces Button Clicked ===');
                                  console.log('copiedItemSelection:', copiedItemSelection);
                                  console.log('selectedIds:', selectedIds);
                                  console.log('highlightAnnotations keys:', Object.keys(highlightAnnotations));
                                  console.log('Checking if selected IDs exist in highlightAnnotations:');
                                  selectedIds.forEach(id => {
                                    console.log(`  ${id}: ${highlightAnnotations[id] ? 'EXISTS' : 'NOT FOUND'}`);
                                  });
                                  if (selectedIds.length === 0) return;
                                  setShowSpaceSelection(true);
                                }}
                                disabled={!Object.values(copiedItemSelection).some(Boolean)}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: Object.values(copiedItemSelection).some(Boolean) ? '#999' : '#555',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#ddd';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#999';
                                  }
                                }}
                              >
                                Copy to Spaces
                              </button>

                              {/* Delete button */}
                              <button
                                onClick={() => {
                                  const selectedIds = Object.keys(copiedItemSelection).filter(id => copiedItemSelection[id]);
                                  if (selectedIds.length === 0) return;

                                  // Confirm deletion
                                  if (!confirm(`Are you sure you want to delete ${selectedIds.length} item${selectedIds.length !== 1 ? 's' : ''}?`)) {
                                    return;
                                  }

                                  // Capture highlights before deletion (state is async)
                                  const highlightsToDelete = selectedIds.map(id => highlightAnnotations[id]).filter(Boolean);

                                  // Delete highlights from highlightAnnotations
                                  setHighlightAnnotations(prev => {
                                    const updated = { ...prev };
                                    selectedIds.forEach(id => {
                                      delete updated[id];
                                    });

                                    // Check if all items in the current space have been deleted
                                    // If so, exit copy mode automatically
                                    if (selectedSpaceId) {
                                      const remainingHighlights = Object.entries(updated)
                                        .filter(([_, h]) => h.spaceId === selectedSpaceId);
                                      if (remainingHighlights.length === 0) {
                                        // Use setTimeout to ensure state updates are processed
                                        setTimeout(() => {
                                          setCopyModeActive(false);
                                          setCopiedItemSelection({});
                                        }, 0);
                                      }
                                    }

                                    return updated;
                                  });

                                  // Trigger removal from canvas via highlightsToRemoveByPage (same as working ✕ button)
                                  highlightsToDelete.forEach(highlight => {
                                    const pageNum = highlight.pageNumber;
                                    const bounds = highlight.bounds;

                                    if (pageNum && bounds) {
                                      setHighlightsToRemoveByPage(prev => ({
                                        ...prev,
                                        [pageNum]: [...(prev[pageNum] || []), bounds]
                                      }));
                                    }
                                  });

                                  // Clear the removal queue after a short delay to allow processing
                                  setTimeout(() => {
                                    highlightsToDelete.forEach(highlight => {
                                      const pageNum = highlight.pageNumber;
                                      if (pageNum) {
                                        setHighlightsToRemoveByPage(prev => {
                                          const updated = { ...prev };
                                          delete updated[pageNum];
                                          return updated;
                                        });
                                      }
                                    });
                                  }, 100);

                                  // Delete highlight rectangles from PDF canvas (annotationsByPage) - keep for backward compatibility
                                  highlightsToDelete.forEach(highlight => {
                                    const pageNum = highlight.pageNumber;
                                    if (pageNum && annotationsByPage[pageNum]) {
                                      setAnnotationsByPage(prev => {
                                        const pageAnnotations = prev[pageNum];
                                        if (!pageAnnotations || !pageAnnotations.objects) return prev;

                                        // Get the current scale for coordinate conversion
                                        const currentScale = scale;

                                        // Filter out highlight rectangles that match this highlight's bounds
                                        const filteredObjects = pageAnnotations.objects.filter(obj => {
                                          // Check if this is a highlight rectangle (with any opacity)
                                          if (obj.type !== 'rect') return true;
                                          if (!obj.fill || typeof obj.fill !== 'string') return true;
                                          if (!obj.fill.includes('rgba')) return true;

                                          // Canvas coordinates are at canvas scale, need to normalize for comparison
                                          const objX = (obj.left || 0) / currentScale;
                                          const objY = (obj.top || 0) / currentScale;
                                          const objWidth = (obj.width || 0) / currentScale;
                                          const objHeight = (obj.height || 0) / currentScale;

                                          const bounds = highlight.bounds || {};
                                          const highlightX = bounds.x || bounds.left || 0;
                                          const highlightY = bounds.y || bounds.top || 0;
                                          const highlightWidth = bounds.width || (bounds.right ? bounds.right - bounds.left : 0) || 0;
                                          const highlightHeight = bounds.height || (bounds.bottom ? bounds.bottom - bounds.top : 0) || 0;

                                          // Check if bounds match (with tolerance in normalized coordinates)
                                          const tolerance = 5 / currentScale; // Convert tolerance to normalized coordinates
                                          if (Math.abs(objX - highlightX) < tolerance &&
                                            Math.abs(objY - highlightY) < tolerance &&
                                            Math.abs(objWidth - highlightWidth) < tolerance &&
                                            Math.abs(objHeight - highlightHeight) < tolerance) {
                                            return false; // Remove this object
                                          }
                                          return true; // Keep this object
                                        });

                                        return {
                                          ...prev,
                                          [pageNum]: {
                                            ...pageAnnotations,
                                            objects: filteredObjects
                                          }
                                        };
                                      });
                                    }
                                  });

                                  // Delete associated items and annotations
                                  highlightsToDelete.forEach(highlight => {

                                    // Find associated item by matching name and category
                                    const categoryName = getCategoryName(selectedTemplate, highlight.spaceId, highlight.categoryId);
                                    const matchingItem = Object.values(items).find(item =>
                                      item.name === highlight.name &&
                                      item.itemType === categoryName
                                    );

                                    if (matchingItem) {
                                      // Find and delete annotations for this item in this space
                                      setAnnotations(prev => {
                                        const updated = { ...prev };
                                        Object.values(updated).forEach(ann => {
                                          if (ann.itemId === matchingItem.itemId && ann.spaceId === highlight.spaceId) {
                                            delete updated[ann.annotationId];
                                          }
                                        });
                                        return updated;
                                      });

                                      // Check if item has data in other modules - if not, delete the item
                                      const highlightModuleId = highlight.moduleId || highlight.spaceId; // Support legacy spaceId
                                      const moduleName = getModuleName(selectedTemplate, highlightModuleId);
                                      const dataKey = getModuleDataKey(moduleName);
                                      const item = items[matchingItem.itemId];

                                      if (item) {
                                        // Remove the module-specific data
                                        const updatedItem = { ...item };
                                        delete updatedItem[dataKey];

                                        // Check if item has any module data left
                                        const allModules = selectedTemplate?.modules || selectedTemplate?.spaces || [];
                                        const hasOtherModuleData = allModules.some(module => {
                                          const moduleId = module.id;
                                          if (moduleId === highlightModuleId) return false;
                                          const otherModuleName = getModuleName(selectedTemplate, moduleId);
                                          const otherDataKey = getModuleDataKey(otherModuleName);
                                          return updatedItem[otherDataKey] && Object.keys(updatedItem[otherDataKey]).length > 0;
                                        });

                                        if (hasOtherModuleData) {
                                          // Item exists in other modules, just remove this module's data
                                          setItems(prev => ({
                                            ...prev,
                                            [matchingItem.itemId]: updatedItem
                                          }));
                                        } else {
                                          // Item doesn't exist in other spaces, delete it entirely
                                          setItems(prev => {
                                            const updated = { ...prev };
                                            delete updated[matchingItem.itemId];
                                            return updated;
                                          });
                                        }
                                      }
                                    }
                                  });

                                  // Clear selection (copy mode will be automatically exited if all items in space are deleted)
                                  setCopiedItemSelection({});
                                }}
                                disabled={!Object.values(copiedItemSelection).some(Boolean)}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: Object.values(copiedItemSelection).some(Boolean) ? '#cc4444' : '#555',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: Object.values(copiedItemSelection).some(Boolean) ? 'pointer' : 'not-allowed'
                                }}
                                onMouseEnter={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#ff6666';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (Object.values(copiedItemSelection).some(Boolean)) {
                                    e.currentTarget.style.color = '#cc4444';
                                  }
                                }}
                              >
                                Delete
                              </button>

                              <div style={{ marginLeft: 'auto' }} />

                              {/* Cancel button */}
                              <button
                                onClick={() => {
                                  setCopyModeActive(false);
                                  setCopiedItemSelection({});
                                }}
                                style={{
                                  padding: 0,
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#999',
                                  fontSize: '13px',
                                  fontWeight: '400',
                                  cursor: 'pointer'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.color = '#ddd'}
                                onMouseLeave={(e) => e.currentTarget.style.color = '#999'}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : null}

                          {/* Categories List */}
                          <div style={{ marginBottom: '20px' }}>
                            <h3 style={{
                              fontSize: '14px',
                              fontWeight: '600',
                              color: '#fff',
                              marginBottom: '10px',
                              fontFamily: FONT_FAMILY
                            }}>
                              Select Category to Highlight
                            </h3>

                            {/* Category Select Mode Actions - show when category select mode is active */}
                            {categorySelectModeActive && module.categories && module.categories.length > 0 && (() => {
                              const selectedCategoryCount = Object.keys(selectedCategories).filter(id => selectedCategories[id]).length;
                              const hasSelectedCategories = selectedCategoryCount > 0;

                              return (
                                <div style={{
                                  marginBottom: '10px'
                                }}>
                                  <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                    flexWrap: 'nowrap',
                                    width: '100%'
                                  }}>
                                    <button
                                      onClick={() => {
                                        // Select all categories in this module
                                        const allCategoryIds = module.categories.map(c => c.id);
                                        const newSelection = {};
                                        allCategoryIds.forEach(catId => {
                                          newSelection[catId] = true;
                                        });
                                        setSelectedCategories(newSelection);
                                      }}
                                      style={{
                                        flex: '1 1 0',
                                        padding: '4px 5px',
                                        background: '#3A3A3A',
                                        color: '#DDD',
                                        border: '1px solid #4A90E2',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: '400',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                        minWidth: 0
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = '#444';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = '#3A3A3A';
                                      }}
                                    >
                                      Select All
                                    </button>

                                    <button
                                      onClick={() => {
                                        const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                                        if (selectedCatIds.length === 0) {
                                          alert('Please select at least one category to copy.');
                                          return;
                                        }

                                        // Copy logic would go here - for now just alert
                                        alert(`Copy functionality for ${selectedCatIds.length} categories to be implemented.`);
                                      }}
                                      disabled={!hasSelectedCategories}
                                      style={{
                                        flex: '1 1 0',
                                        padding: '4px 5px',
                                        background: '#3A3A3A',
                                        color: hasSelectedCategories ? '#DDD' : '#666',
                                        border: '1px solid #4A90E2',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: '400',
                                        cursor: hasSelectedCategories ? 'pointer' : 'not-allowed',
                                        whiteSpace: 'nowrap',
                                        minWidth: 0
                                      }}
                                      onMouseEnter={(e) => {
                                        if (hasSelectedCategories) {
                                          e.currentTarget.style.background = '#444';
                                        }
                                      }}
                                      onMouseLeave={(e) => {
                                        if (hasSelectedCategories) {
                                          e.currentTarget.style.background = '#3A3A3A';
                                        }
                                      }}
                                    >
                                      Copy
                                    </button>

                                    <button
                                      onClick={() => {
                                        const selectedCatIds = Object.keys(selectedCategories).filter(id => selectedCategories[id]);
                                        if (selectedCatIds.length === 0) {
                                          alert('Please select at least one category to delete.');
                                          return;
                                        }
                                        if (!confirm(`Are you sure you want to delete ${selectedCatIds.length} categor${selectedCatIds.length !== 1 ? 'ies' : 'y'} and all items within?`)) {
                                          return;
                                        }

                                        // Delete categories and their items
                                        selectedCatIds.forEach(catId => {
                                          // Delete all highlights in this category
                                          const highlightsInCategory = Object.entries(highlightAnnotations).filter(([_, h]) => {
                                            const hModuleId = h.moduleId || h.spaceId; // Support legacy spaceId
                                            return hModuleId === selectedModuleId && h.categoryId === catId;
                                          });

                                          highlightsInCategory.forEach(([highlightId, highlight]) => {
                                            // Remove from canvas
                                            if (highlight.pageNumber && highlight.bounds) {
                                              setHighlightsToRemoveByPage(prev => ({
                                                ...prev,
                                                [highlight.pageNumber]: [...(prev[highlight.pageNumber] || []), highlight.bounds]
                                              }));
                                            }
                                          });

                                          // Delete from highlightAnnotations
                                          setHighlightAnnotations(prev => {
                                            const updated = { ...prev };
                                            highlightsInCategory.forEach(([highlightId]) => {
                                              delete updated[highlightId];
                                            });
                                            return updated;
                                          });

                                          // Delete category from module
                                          deleteCategory(selectedModuleId, catId);
                                        });

                                        // Exit category select mode
                                        setCategorySelectModeActive(false);
                                        setCategorySelectModeForCategory(null);
                                        setSelectedCategories({});
                                      }}
                                      disabled={!hasSelectedCategories}
                                      style={{
                                        flex: '1 1 0',
                                        padding: '4px 5px',
                                        background: '#3A3A3A',
                                        color: hasSelectedCategories ? '#cc4444' : '#666',
                                        border: '1px solid #cc4444',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: '400',
                                        cursor: hasSelectedCategories ? 'pointer' : 'not-allowed',
                                        whiteSpace: 'nowrap',
                                        minWidth: 0
                                      }}
                                      onMouseEnter={(e) => {
                                        if (hasSelectedCategories) {
                                          e.currentTarget.style.background = '#444';
                                          e.currentTarget.style.color = '#ff6666';
                                        }
                                      }}
                                      onMouseLeave={(e) => {
                                        if (hasSelectedCategories) {
                                          e.currentTarget.style.background = '#3A3A3A';
                                          e.currentTarget.style.color = '#cc4444';
                                        }
                                      }}
                                    >
                                      Delete
                                    </button>

                                    <button
                                      onClick={() => {
                                        setCategorySelectModeActive(false);
                                        setCategorySelectModeForCategory(null);
                                        setSelectedCategories({});
                                      }}
                                      style={{
                                        flex: '1 1 0',
                                        padding: '4px 5px',
                                        background: '#3A3A3A',
                                        color: '#DDD',
                                        border: '1px solid #4A90E2',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                        fontWeight: '400',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                        minWidth: 0
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = '#444';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = '#3A3A3A';
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}

                            {module.categories && module.categories.length > 0 ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: categorySelectModeActive ? '8px' : '4px' }}>
                                {module.categories.map(category => {
                                  const categoryHighlights = highlightsByCategory[category.id] || [];
                                  const highlightCount = categoryHighlights.length;
                                  const isExpanded = expandedCategories[category.id];
                                  const isArrowActive = isExpanded || selectedCategoryId === category.id;

                                  // Calculate category checkbox state for copy mode
                                  const categorySelectedCount = categoryHighlights.filter(h => copiedItemSelection[h.id] === true).length;
                                  const categoryAllSelected = categorySelectedCount === categoryHighlights.length && categoryHighlights.length > 0;

                                  // Category-level selection state
                                  const isCategorySelected = selectedCategories[category.id] === true;
                                  const isCategorySelectModeActive = categorySelectModeActive;
                                  const isCategoryActive = (isCategorySelectModeActive && isCategorySelected) || selectedCategoryId === category.id;
                                  const buttonBackground = 'transparent';
                                  const borderColor = isCategoryActive ? '#4A90E2' : 'transparent';
                                  const baseBorder = `1px solid ${borderColor}`;
                                  const buttonTextColor = isCategoryActive ? '#4A90E2' : '#ddd';
                                  const buttonSubTextColor = isCategoryActive ? '#4A90E2' : '#999';
                                  const buttonLeftBorder = (copyModeActive || isCategorySelectModeActive) ? 'none' : baseBorder;
                                  const buttonRightBorder = highlightCount > 0 ? 'none' : baseBorder;

                                  // Item-level selection state
                                  const isItemSelectModeActiveForCategory = itemSelectModeActive[category.id] === true;
                                  const selectedItemsForCategory = selectedItemsInCategory[category.id] || {};
                                  const itemSelectedCount = Object.values(selectedItemsForCategory).filter(Boolean).length;
                                  const allItemsSelected = itemSelectedCount === highlightCount && highlightCount > 0;

                                  return (
                                    <div key={category.id} style={{
                                      marginBottom: categorySelectModeActive ? '0' : '4px',
                                      border: '1px solid #444',
                                      borderRadius: '4px',
                                      padding: '2px'
                                    }}>
                                      <div style={{ display: 'flex', gap: isCategorySelectModeActive ? '12px' : '8px', alignItems: 'center' }}>
                                        {/* Checkbox for category selection - only show in copy mode */}
                                        {copyModeActive && (
                                          <label style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '0 6px',
                                            cursor: 'pointer',
                                            border: '1px solid transparent',
                                            borderRadius: '4px 0 0 4px',
                                            background: '#333',
                                            userSelect: 'none'
                                          }}>
                                            <input
                                              type="checkbox"
                                              checked={categoryAllSelected}
                                              onChange={(e) => {
                                                const newSelection = { ...copiedItemSelection };
                                                categoryHighlights.forEach(h => {
                                                  if (!categoryAllSelected) {
                                                    newSelection[h.id] = true;
                                                  } else {
                                                    delete newSelection[h.id];
                                                  }
                                                });
                                                setCopiedItemSelection(newSelection);
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              style={{ cursor: 'pointer', flexShrink: 0 }}
                                            />
                                          </label>
                                        )}

                                        {isCategorySelectModeActive ? (
                                          <div
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedCategories(prev => ({
                                                ...prev,
                                                [category.id]: !prev[category.id]
                                              }));
                                            }}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: '12px',
                                              padding: '12px 16px',
                                              background: 'transparent',
                                              borderRadius: '6px',
                                              cursor: 'pointer',
                                              flex: 1,
                                              marginBottom: '8px',
                                              color: isCategorySelected ? '#4A90E2' : '#DDD',
                                              border: `1px solid ${isCategorySelected ? '#4A90E2' : 'transparent'}`
                                            }}
                                            onMouseEnter={(e) => {
                                              if (!isCategorySelected) {
                                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                              }
                                            }}
                                            onMouseLeave={(e) => {
                                              if (!isCategorySelected) {
                                                e.currentTarget.style.background = 'transparent';
                                              }
                                            }}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={isCategorySelected}
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                setSelectedCategories(prev => ({
                                                  ...prev,
                                                  [category.id]: e.target.checked
                                                }));
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              style={{
                                                cursor: 'pointer',
                                                flexShrink: 0,
                                                width: '18px',
                                                height: '18px',
                                                accentColor: '#4A90E2',
                                                margin: 0
                                              }}
                                            />
                                            <div style={{
                                              fontWeight: '500',
                                              fontSize: '14px',
                                              color: isCategorySelected ? '#fff' : '#DDD',
                                              flex: 1
                                            }}>
                                              {category.name || 'Untitled Category'}
                                            </div>
                                          </div>
                                        ) : (
                                          <div style={{ display: 'flex', flex: 1, alignItems: 'stretch' }}>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (copyModeActive) {
                                                  // In copy mode, don't change category selection or hide panel
                                                  return;
                                                }

                                                // Set selected category
                                                setSelectedCategoryId(category.id);
                                                // Hide survey panel
                                                setShowSurveyPanel(false);
                                                // Switch to highlight tool
                                                setActiveTool('highlight');
                                              }}
                                              className="btn btn-default btn-md"
                                              style={{
                                                textAlign: 'left',
                                                justifyContent: 'flex-start',
                                                padding: '6px 12px',
                                                background: buttonBackground,
                                                borderTop: baseBorder,
                                                borderBottom: baseBorder,
                                                borderLeft: buttonLeftBorder,
                                                borderRight: highlightCount > 0 ? 'none' : baseBorder,
                                                color: buttonTextColor,
                                                flex: 1,
                                                borderRadius: highlightCount > 0 ? '4px 0 0 4px' : '4px',
                                              }}
                                            >
                                              <div style={{ fontWeight: '500' }}>
                                                {category.name || 'Untitled Category'}
                                              </div>
                                              <div style={{ fontSize: '11px', color: buttonSubTextColor, marginTop: '2px' }}>
                                                {highlightCount}
                                              </div>
                                            </button>
                                            {highlightCount > 0 && (
                                              <button
                                                className="dropdown-arrow"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setExpandedCategories(prev => ({
                                                    ...prev,
                                                    [category.id]: !prev[category.id]
                                                  }));
                                                }}
                                                style={{
                                                  padding: '2px 8px',
                                                  background: 'transparent',
                                                  borderTop: baseBorder,
                                                  borderRight: baseBorder,
                                                  borderBottom: baseBorder,
                                                  borderLeft: 'none',
                                                  borderRadius: '0 4px 4px 0',
                                                  cursor: 'pointer',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  transition: 'background 0.2s ease, border-color 0.2s ease'
                                                }}
                                              >
                                                <svg
                                                  width="16"
                                                  height="16"
                                                  viewBox="0 0 24 24"
                                                  fill="none"
                                                  xmlns="http://www.w3.org/2000/svg"
                                                  style={{
                                                    width: '14px',
                                                    height: '14px',
                                                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.2s ease'
                                                  }}
                                                >
                                                  <path
                                                    d="M6 9L12 15L18 9"
                                                    stroke={isArrowActive ? "#4A90E2" : "#fff"}
                                                    strokeWidth="2.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  />
                                                </svg>
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {/* Expanded highlights list */}
                                      {isExpanded && highlightCount > 0 && (
                                        <div style={{
                                          marginTop: '4px',
                                          padding: '4px',
                                          background: 'transparent',
                                          border: '1px solid transparent',
                                          borderRadius: '4px'
                                        }}>
                                          {/* Select button for item-level selection - only show when NOT in item select mode */}
                                          {!isItemSelectModeActiveForCategory && !categorySelectModeActive && !copyModeActive && (
                                            <button
                                              onClick={() => {
                                                setItemSelectModeActive(prev => ({
                                                  ...prev,
                                                  [category.id]: true
                                                }));
                                                setSelectedItemsInCategory(prev => ({
                                                  ...prev,
                                                  [category.id]: {}
                                                }));
                                              }}
                                              className="btn btn-sm"
                                              style={{
                                                marginBottom: '8px',
                                                background: '#3a3a3a',
                                                color: '#ddd',
                                                border: '1px solid transparent',
                                                whiteSpace: 'nowrap'
                                              }}
                                            >
                                              Select Item
                                            </button>
                                          )}

                                          {/* Item Select Mode Actions */}
                                          {isItemSelectModeActiveForCategory && (
                                            <div style={{
                                              marginBottom: '8px',
                                              display: 'flex',
                                              gap: '4px',
                                              alignItems: 'center',
                                              justifyContent: 'center',
                                              flexWrap: 'nowrap',
                                              width: '100%'
                                            }}>
                                              <button
                                                onClick={() => {
                                                  const newSelection = {};
                                                  categoryHighlights.forEach(h => {
                                                    newSelection[h.id] = true;
                                                  });
                                                  setSelectedItemsInCategory(prev => ({
                                                    ...prev,
                                                    [category.id]: newSelection
                                                  }));
                                                }}
                                                style={{
                                                  flex: '1 1 0',
                                                  padding: '4px 5px',
                                                  background: 'rgb(68, 68, 68)',
                                                  color: 'rgb(221, 221, 221)',
                                                  border: '1px solid rgb(74, 144, 226)',
                                                  borderRadius: '4px',
                                                  fontSize: '11px',
                                                  fontWeight: '400',
                                                  cursor: 'pointer',
                                                  whiteSpace: 'nowrap',
                                                  minWidth: 0
                                                }}
                                              >
                                                Select All
                                              </button>

                                              <button
                                                onClick={() => {
                                                  const selectedItemIds = Object.keys(selectedItemsForCategory).filter(id => selectedItemsForCategory[id]);
                                                  if (selectedItemIds.length === 0) {
                                                    alert('Please select at least one item to copy.');
                                                    return;
                                                  }
                                                  // Store selected items for copy operation
                                                  setCopiedItemSelection(prev => {
                                                    const newSelection = { ...prev };
                                                    selectedItemIds.forEach(id => {
                                                      newSelection[id] = true;
                                                    });
                                                    return newSelection;
                                                  });
                                                  setShowSpaceSelection(true);
                                                }}
                                                disabled={itemSelectedCount === 0}
                                                style={{
                                                  flex: '1 1 0',
                                                  padding: '4px 5px',
                                                  background: 'rgb(68, 68, 68)',
                                                  color: 'rgb(221, 221, 221)',
                                                  border: '1px solid rgb(74, 144, 226)',
                                                  borderRadius: '4px',
                                                  fontSize: '11px',
                                                  fontWeight: '400',
                                                  cursor: itemSelectedCount > 0 ? 'pointer' : 'not-allowed',
                                                  opacity: itemSelectedCount > 0 ? 1 : 0.5,
                                                  whiteSpace: 'nowrap',
                                                  minWidth: 0
                                                }}
                                              >
                                                Copy
                                              </button>

                                              <button
                                                onClick={() => {
                                                  const selectedItemIds = Object.keys(selectedItemsForCategory).filter(id => selectedItemsForCategory[id]);
                                                  if (selectedItemIds.length === 0) {
                                                    alert('Please select at least one item to delete.');
                                                    return;
                                                  }
                                                  if (!confirm(`Are you sure you want to delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? 's' : ''}?`)) {
                                                    return;
                                                  }

                                                  // Delete selected items
                                                  selectedItemIds.forEach(highlightId => {
                                                    handleDeleteHighlightItem(highlightId);
                                                  });

                                                  // Clear selection and exit item select mode if no items left
                                                  const remainingItems = categoryHighlights.filter(h => !selectedItemIds.includes(h.id));
                                                  if (remainingItems.length === 0) {
                                                    setItemSelectModeActive(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[category.id];
                                                      return updated;
                                                    });
                                                    setSelectedItemsInCategory(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[category.id];
                                                      return updated;
                                                    });
                                                  } else {
                                                    setSelectedItemsInCategory(prev => {
                                                      const updated = { ...prev };
                                                      updated[category.id] = {};
                                                      return updated;
                                                    });
                                                  }
                                                }}
                                                disabled={itemSelectedCount === 0}
                                                style={{
                                                  flex: '1 1 0',
                                                  padding: '4px 5px',
                                                  background: 'rgb(68, 68, 68)',
                                                  color: 'rgb(255, 102, 102)',
                                                  border: '1px solid rgb(204, 68, 68)',
                                                  borderRadius: '4px',
                                                  fontSize: '11px',
                                                  fontWeight: '400',
                                                  cursor: itemSelectedCount > 0 ? 'pointer' : 'not-allowed',
                                                  opacity: itemSelectedCount > 0 ? 1 : 0.5,
                                                  whiteSpace: 'nowrap',
                                                  minWidth: 0
                                                }}
                                              >
                                                Delete
                                              </button>

                                              <button
                                                onClick={() => {
                                                  setItemSelectModeActive(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[category.id];
                                                    return updated;
                                                  });
                                                  setSelectedItemsInCategory(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[category.id];
                                                    return updated;
                                                  });
                                                }}
                                                style={{
                                                  flex: '1 1 0',
                                                  padding: '4px 5px',
                                                  background: 'rgb(68, 68, 68)',
                                                  color: 'rgb(221, 221, 221)',
                                                  border: '1px solid rgb(74, 144, 226)',
                                                  borderRadius: '4px',
                                                  fontSize: '11px',
                                                  fontWeight: '400',
                                                  cursor: 'pointer',
                                                  whiteSpace: 'nowrap',
                                                  minWidth: 0
                                                }}
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          )}

                                          {categoryHighlights.map((highlight, highlightIndex) => {
                                            const highlightId = highlight.id;
                                            const isHighlightExpanded = expandedHighlights[highlightId];
                                            const baseCategoryName = category?.name?.trim() || 'Untitled Category';
                                            const fallbackName = `${baseCategoryName} ${highlightIndex + 1}`;
                                            const highlightName = highlightAnnotations[highlightId]?.name || highlight.name || fallbackName;

                                            return (
                                              <div key={highlight.id} id={`highlight-item-${highlight.id}`} style={{
                                                marginBottom: '4px',
                                                background: 'transparent',
                                                border: '1px solid #444',
                                                borderRadius: '4px',
                                                overflow: 'hidden'
                                              }}>
                                                {/* Highlight header - clickable to expand */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                  {/* Checkbox for selection - show in copy mode or item select mode */}
                                                  {(copyModeActive || isItemSelectModeActiveForCategory) && (
                                                    <input
                                                      type="checkbox"
                                                      checked={
                                                        isItemSelectModeActiveForCategory
                                                          ? selectedItemsForCategory[highlightId] === true
                                                          : copiedItemSelection[highlightId] === true
                                                      }
                                                      onChange={(e) => {
                                                        if (isItemSelectModeActiveForCategory) {
                                                          setSelectedItemsInCategory(prev => ({
                                                            ...prev,
                                                            [category.id]: {
                                                              ...(prev[category.id] || {}),
                                                              [highlightId]: e.target.checked
                                                            }
                                                          }));
                                                        } else {
                                                          console.log('Checkbox changed:', {
                                                            highlightId,
                                                            checked: e.target.checked,
                                                            highlight,
                                                            'highlight.id': highlight.id
                                                          });
                                                          setCopiedItemSelection(prev => {
                                                            const newSelection = { ...prev };
                                                            if (e.target.checked) {
                                                              newSelection[highlightId] = true;
                                                            } else {
                                                              delete newSelection[highlightId];
                                                            }
                                                            console.log('Updated selection:', newSelection);
                                                            return newSelection;
                                                          });
                                                        }
                                                      }}
                                                      onClick={(e) => e.stopPropagation()}
                                                      style={{ cursor: 'pointer', flexShrink: 0 }}
                                                    />
                                                  )}

                                                  {/* Expandable button */}
                                                  <button
                                                    onClick={() => {
                                                      setExpandedHighlights(prev => ({
                                                        ...prev,
                                                        [highlightId]: !prev[highlightId]
                                                      }));
                                                    }}
                                                    style={{
                                                      flex: 1,
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'space-between',
                                                      padding: '6px 8px',
                                                      background: 'transparent',
                                                      border: 'none',
                                                      cursor: 'pointer',
                                                      textAlign: 'left',
                                                      minWidth: 0
                                                    }}
                                                  >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>

                                                      {(() => {
                                                        // Get ball-in-court entity for indicator - data-driven from category item's ballInCourt field
                                                        let indicatorColor = null;
                                                        let indicatorTooltip = null;
                                                        if (selectedTemplate && selectedModuleId) {
                                                          const highlightData = highlightAnnotations[highlightId];
                                                          const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                          const highlightName = highlightData?.name || highlight.name || '';
                                                          const matchingItem = Object.values(items).find(item =>
                                                            item.name === highlightName &&
                                                            item.itemType === categoryName
                                                          );

                                                          // Try to get ballInCourtEntityId from item's module data first, then from highlightData
                                                          let ballInCourtEntityId = null;
                                                          if (matchingItem) {
                                                            const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                            const dataKey = getModuleDataKey(moduleName);
                                                            const moduleData = matchingItem[dataKey] || {};
                                                            ballInCourtEntityId = moduleData.ballInCourtEntityId;
                                                          }
                                                          // Fallback to highlightData if not found in item
                                                          if (!ballInCourtEntityId && highlightData?.ballInCourtEntityId) {
                                                            ballInCourtEntityId = highlightData.ballInCourtEntityId;
                                                          }

                                                          if (ballInCourtEntityId) {
                                                            const ballInCourtEntities = selectedTemplate?.ballInCourtEntities || [];
                                                            const entity = ballInCourtEntities.find(e => e.id === ballInCourtEntityId);
                                                            if (entity) {
                                                              // Use the exact color from ballInCourt.color without transformation
                                                              indicatorColor = entity.color;
                                                              indicatorTooltip = entity.name;
                                                            }
                                                          }
                                                        }

                                                        return (
                                                          <BallInCourtIndicator
                                                            color={indicatorColor}
                                                            size={16}
                                                            tooltipText={indicatorTooltip}
                                                          />
                                                        );
                                                      })()}
                                                      {highlightAnnotations[highlightId]?.editingName ? (
                                                        <input
                                                          type="text"
                                                          value={highlightAnnotations[highlightId]?.name || ''}
                                                          onChange={(e) => {
                                                            setHighlightAnnotations(prev => ({
                                                              ...prev,
                                                              [highlight.id]: {
                                                                ...prev[highlight.id],
                                                                name: e.target.value
                                                              }
                                                            }));
                                                          }}
                                                          onBlur={() => {
                                                            setHighlightAnnotations(prev => ({
                                                              ...prev,
                                                              [highlight.id]: {
                                                                ...prev[highlight.id],
                                                                editingName: false
                                                              }
                                                            }));
                                                          }}
                                                          onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                              e.target.blur();
                                                            } else if (e.key === 'Escape') {
                                                              setHighlightAnnotations(prev => ({
                                                                ...prev,
                                                                [highlight.id]: {
                                                                  ...prev[highlight.id],
                                                                  editingName: false,
                                                                  name: prev[highlight.id]?.name || fallbackName
                                                                }
                                                              }));
                                                              e.target.blur();
                                                            }
                                                          }}
                                                          onClick={(e) => e.stopPropagation()}
                                                          autoFocus
                                                          style={{
                                                            flex: 1,
                                                            minWidth: 0,
                                                            padding: '3px 6px',
                                                            background: '#333',
                                                            color: '#fff',
                                                            border: '1px solid #4A90E2',
                                                            borderRadius: '4px',
                                                            fontSize: '12px',
                                                            fontFamily: FONT_FAMILY,
                                                            outline: 'none'
                                                          }}
                                                        />
                                                      ) : (
                                                        <span style={{
                                                          fontSize: '12px',
                                                          color: '#999',
                                                          fontWeight: highlightAnnotations[highlightId]?.name ? '500' : '400'
                                                        }}>
                                                          {highlightName}
                                                        </span>
                                                      )}
                                                    </div>
                                                    <span
                                                      style={{
                                                        marginLeft: '4px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        transition: 'transform 0.2s ease',
                                                        transform: isHighlightExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                        flexShrink: 0
                                                      }}
                                                    >
                                                      <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        style={{ width: '14px', height: '14px' }}
                                                      >
                                                        <path
                                                          d="M6 9L12 15L18 9"
                                                          stroke="#fff"
                                                          strokeWidth="2.5"
                                                          strokeLinecap="round"
                                                          strokeLinejoin="round"
                                                        />
                                                      </svg>
                                                    </span>
                                                  </button>

                                                  {/* Rename button - now a sibling, not nested */}
                                                  {!highlightAnnotations[highlightId]?.editingName && (
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setHighlightAnnotations(prev => ({
                                                          ...prev,
                                                          [highlight.id]: {
                                                            ...prev[highlight.id],
                                                            editingName: true
                                                          }
                                                        }));
                                                      }}
                                                      style={{
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: '#999',
                                                        cursor: 'pointer',
                                                        padding: '4px',
                                                        fontSize: '12px',
                                                        opacity: 0.7,
                                                        flexShrink: 0
                                                      }}
                                                      onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                                      onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                                                      title="Rename highlight"
                                                    >
                                                      ✎
                                                    </button>
                                                  )}

                                                  {/* Item-level Notes button */}
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const highlightData = highlightAnnotations[highlightId];
                                                      const existingNote = highlightData?.note;
                                                      console.log('Opening item-level note dialog:', { highlightId, existingNote });

                                                      if (existingNote) {
                                                        setNoteDialogContent({
                                                          text: existingNote.text || '',
                                                          photos: existingNote.photos || [],
                                                          videos: existingNote.videos || []
                                                        });
                                                      } else {
                                                        setNoteDialogContent({ text: '', photos: [], videos: [] });
                                                      }

                                                      // For item-level notes, we only need the highlightId
                                                      setNoteDialogOpen(highlightId);
                                                    }}
                                                    style={{
                                                      background: 'transparent',
                                                      border: 'none',
                                                      color: highlightAnnotations[highlightId]?.note?.text ? '#4A90E2' : '#999',
                                                      cursor: 'pointer',
                                                      padding: '4px',
                                                      fontSize: '12px',
                                                      opacity: 0.7,
                                                      flexShrink: 0
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                                                    title={highlightAnnotations[highlightId]?.note?.text ? "Edit item notes" : "Add item notes"}
                                                  >
                                                    Notes {highlightAnnotations[highlightId]?.note?.text ? '✓' : ''}
                                                  </button>

                                                  {/* Locate Button (Magnifying Glass) */}
                                                  <div
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      // Check if item has location (bounds and pageNumber)
                                                      const hasLocation = highlight.bounds && highlight.pageNumber;

                                                      if (hasLocation) {
                                                        handleLocateItemOnPDF(highlight);
                                                      } else {
                                                        // Prompt to highlight
                                                        setPendingLocationItem(highlight);
                                                      }
                                                    }}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      padding: '4px',
                                                      borderRadius: '4px',
                                                      cursor: 'pointer',
                                                      color: (highlight.bounds && highlight.pageNumber) ? '#4A90E2' : '#F5A623', // Blue if located, Orange if not
                                                      transition: 'background 0.2s, color 0.2s',
                                                      marginLeft: '0'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.background = '#444';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    title={highlight.bounds && highlight.pageNumber ? "Locate on PDF" : "Click to set location on PDF"}
                                                  >
                                                    <Icon name="search" size={14} />
                                                  </div>

                                                  {/* Delete Button */}
                                                  <div
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (confirm('Are you sure you want to delete this item?')) {
                                                        handleDeleteHighlightItem(highlightId);
                                                      }
                                                    }}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      padding: '4px',
                                                      borderRadius: '4px',
                                                      cursor: 'pointer',
                                                      color: '#FF6666',
                                                      transition: 'background 0.2s, color 0.2s',
                                                      marginLeft: '0'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.background = '#444';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.background = 'transparent';
                                                    }}
                                                    title="Delete item"
                                                  >
                                                    <svg
                                                      width="14"
                                                      height="14"
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      strokeWidth="2"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                    >
                                                      <polyline points="3 6 5 6 21 6"></polyline>
                                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                    </svg>
                                                  </div>
                                                </div>

                                                {/* Ball in Court selector */}
                                                {
                                                  isHighlightExpanded && selectedTemplate && selectedModuleId && (() => {
                                                    // Find the item associated with this highlight
                                                    const highlightData = highlightAnnotations[highlightId];
                                                    const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                    const highlightName = highlightData?.name || highlight.name || '';
                                                    const matchingItem = Object.values(items).find(item =>
                                                      item.name === highlightName &&
                                                      item.itemType === categoryName
                                                    );

                                                    // Get module-specific data
                                                    const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                    const dataKey = getModuleDataKey(moduleName);
                                                    const moduleData = matchingItem?.[dataKey] || {};

                                                    // Get current BIC status from item's module-specific data (preferred) or from highlight annotation (legacy)
                                                    const currentBICEntityId = moduleData.ballInCourtEntityId || highlightData?.ballInCourtEntityId;
                                                    const ballInCourtEntities = selectedTemplate?.ballInCourtEntities || [];

                                                    return (
                                                      <div style={{
                                                        padding: '6px 8px',
                                                        background: '#333',
                                                        borderTop: '1px solid #444',
                                                        marginTop: '0'
                                                      }}>
                                                        <div style={{
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          gap: '8px',
                                                          marginBottom: '4px',
                                                          flexWrap: 'wrap'
                                                        }}>
                                                          <span style={{
                                                            color: '#DDD',
                                                            fontSize: '12px',
                                                            flex: '1',
                                                            minWidth: '150px'
                                                          }}>
                                                            Ball in Court:
                                                          </span>
                                                          <select
                                                            value={currentBICEntityId || ''}
                                                            onChange={(e) => {
                                                              e.stopPropagation();
                                                              const entityId = e.target.value;
                                                              const entity = entityId ? ballInCourtEntities.find(e => e.id === entityId) : null;

                                                              console.log('Ball in Court dropdown changed:', { entityId, entity, matchingItem, highlightId, highlightData });

                                                              // Update highlight annotation - the useEffect will automatically rebuild newHighlightsByPage
                                                              setHighlightAnnotations(prev => {
                                                                const updated = {
                                                                  ...prev,
                                                                  [highlightId]: {
                                                                    ...prev[highlightId],
                                                                    ballInCourtEntityId: entity?.id,
                                                                    ballInCourtEntityName: entity?.name,
                                                                    ballInCourtColor: entity?.color
                                                                  }
                                                                };
                                                                console.log('Updated highlight annotation:', updated[highlightId]);
                                                                return updated;
                                                              });

                                                              // Update item's module-specific data if matchingItem exists
                                                              if (matchingItem) {
                                                                if (entity) {
                                                                  // Update item with BIC status
                                                                  const updatedItem = {
                                                                    ...matchingItem,
                                                                    [dataKey]: {
                                                                      ...moduleData,
                                                                      ballInCourtEntityId: entity.id,
                                                                      ballInCourtEntityName: entity.name,
                                                                      ballInCourtColor: entity.color
                                                                    }
                                                                  };

                                                                  setItems(prev => ({
                                                                    ...prev,
                                                                    [matchingItem.itemId]: updatedItem
                                                                  }));

                                                                  // Update all annotations for this item in this space with the new color
                                                                  setAnnotations(prev => {
                                                                    const updated = { ...prev };
                                                                    Object.values(updated).forEach(ann => {
                                                                      if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                                                                        updated[ann.annotationId] = {
                                                                          ...ann,
                                                                          ballInCourtEntityId: entity.id,
                                                                          ballInCourtEntityName: entity.name,
                                                                          ballInCourtColor: entity.color
                                                                        };
                                                                      }
                                                                    });
                                                                    return updated;
                                                                  });
                                                                } else {
                                                                  // Remove BIC status from item
                                                                  const updatedItem = {
                                                                    ...matchingItem,
                                                                    [dataKey]: {
                                                                      ...moduleData,
                                                                      ballInCourtEntityId: undefined,
                                                                      ballInCourtEntityName: undefined,
                                                                      ballInCourtColor: undefined
                                                                    }
                                                                  };

                                                                  setItems(prev => ({
                                                                    ...prev,
                                                                    [matchingItem.itemId]: updatedItem
                                                                  }));

                                                                  // Update all annotations for this item in this space
                                                                  setAnnotations(prev => {
                                                                    const updated = { ...prev };
                                                                    Object.values(updated).forEach(ann => {
                                                                      if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                                                                        updated[ann.annotationId] = {
                                                                          ...ann,
                                                                          ballInCourtEntityId: undefined,
                                                                          ballInCourtEntityName: undefined,
                                                                          ballInCourtColor: undefined
                                                                        };
                                                                      }
                                                                    });
                                                                    return updated;
                                                                  });
                                                                }
                                                              }
                                                            }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            style={{
                                                              padding: '4px 8px',
                                                              fontSize: '11px',
                                                              background: '#141414',
                                                              color: '#ddd',
                                                              border: '1px solid #2f2f2f',
                                                              borderRadius: '4px',
                                                              outline: 'none',
                                                              cursor: 'pointer',
                                                              minWidth: '120px'
                                                            }}
                                                          >
                                                            <option value="">None</option>
                                                            {ballInCourtEntities.map(entity => (
                                                              <option key={entity.id} value={entity.id}>
                                                                {entity.name}
                                                              </option>
                                                            ))}
                                                          </select>
                                                        </div>
                                                      </div>
                                                    );
                                                  })()
                                                }

                                                {/* Expanded checklist items */}
                                                {
                                                  isHighlightExpanded && category.checklist && category.checklist.map(item => {
                                                    const response = highlightAnnotations[highlightId]?.checklistResponses?.[item.id] || {};
                                                    const isSelected = response.selection;
                                                    return (
                                                      <div key={item.id} style={{
                                                        padding: '6px 8px',
                                                        background: '#333',
                                                        borderTop: '1px solid #444',
                                                        marginTop: '0'
                                                      }}>
                                                        <div style={{
                                                          display: 'flex',
                                                          alignItems: 'center',
                                                          gap: '8px',
                                                          marginBottom: '4px',
                                                          flexWrap: 'wrap'
                                                        }}>
                                                          <span style={{
                                                            color: '#DDD',
                                                            fontSize: '12px',
                                                            flex: '1',
                                                            minWidth: '150px'
                                                          }}>
                                                            {item.text}
                                                          </span>
                                                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                                            {['Y', 'N', 'N/A'].map(option => (
                                                              <button
                                                                key={option}
                                                                type="button"
                                                                onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  setHighlightAnnotations(prev => {
                                                                    const updated = {
                                                                      ...prev,
                                                                      [highlightId]: {
                                                                        ...prev[highlightId],
                                                                        checklistResponses: {
                                                                          ...prev[highlightId]?.checklistResponses,
                                                                          [item.id]: {
                                                                            ...prev[highlightId]?.checklistResponses?.[item.id],
                                                                            selection: option
                                                                          }
                                                                        }
                                                                      }
                                                                    };

                                                                    // Check if all checklist items are Y or N/A
                                                                    const updatedHighlight = updated[highlightId];
                                                                    if (updatedHighlight && category.checklist && category.checklist.length > 0 && selectedTemplate && selectedSpaceId) {
                                                                      const allItemsComplete = category.checklist.every(checklistItem => {
                                                                        const response = updatedHighlight.checklistResponses?.[checklistItem.id];
                                                                        const selection = response?.selection;
                                                                        return selection === 'Y' || selection === 'N/A';
                                                                      });

                                                                      // Find the item associated with this highlight
                                                                      const highlightData = updated[highlightId];
                                                                      const categoryName = getCategoryName(selectedTemplate, selectedModuleId, category.id);
                                                                      const highlightName = highlightData?.name || highlight.name || '';
                                                                      const matchingItem = Object.values(items).find(item =>
                                                                        item.name === highlightName &&
                                                                        item.itemType === categoryName
                                                                      );

                                                                      // Get module-specific data
                                                                      const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                                                                      const dataKey = getModuleDataKey(moduleName);
                                                                      const moduleData = matchingItem?.[dataKey] || {};

                                                                      // If all items are Y or N/A, automatically set ball in court to "Complete"
                                                                      if (allItemsComplete) {
                                                                        // Find the "Complete" entity
                                                                        const ballInCourtEntities = selectedTemplate.ballInCourtEntities || [];
                                                                        const completeEntity = ballInCourtEntities.find(e =>
                                                                          e.name.toLowerCase().includes('complete')
                                                                        );

                                                                        if (completeEntity) {
                                                                          const entityColor = normalizeHighlightColor(completeEntity.color) || completeEntity.color || hexToRgba('#E3D1FB', DEFAULT_SURVEY_HIGHLIGHT_OPACITY);
                                                                          // Update item's module-specific data with Complete BIC status
                                                                          if (matchingItem) {
                                                                            const updatedItem = {
                                                                              ...matchingItem,
                                                                              [dataKey]: {
                                                                                ...moduleData,
                                                                                ballInCourtEntityId: completeEntity.id,
                                                                                ballInCourtEntityName: completeEntity.name,
                                                                                ballInCourtColor: entityColor
                                                                              }
                                                                            };

                                                                            setItems(prev => ({
                                                                              ...prev,
                                                                              [matchingItem.itemId]: updatedItem
                                                                            }));

                                                                            // Update all annotations for this item in this module with the new color
                                                                            setAnnotations(prev => {
                                                                              const updatedAnns = { ...prev };
                                                                              Object.values(updatedAnns).forEach(ann => {
                                                                                const annModuleId = ann.moduleId || ann.spaceId; // Support legacy spaceId
                                                                                if (ann.itemId === matchingItem.itemId && annModuleId === selectedModuleId) {
                                                                                  updatedAnns[ann.annotationId] = {
                                                                                    ...ann,
                                                                                    ballInCourtEntityId: completeEntity.id,
                                                                                    ballInCourtEntityName: completeEntity.name,
                                                                                    ballInCourtColor: entityColor
                                                                                  };
                                                                                }
                                                                              });
                                                                              return updatedAnns;
                                                                            });

                                                                            // Update highlight color on PDF
                                                                            if (highlightData?.pageNumber && highlightData?.bounds) {
                                                                              setNewHighlightsByPage(prev => {
                                                                                const pageHighlights = prev[highlightData.pageNumber] || [];
                                                                                // Remove any existing highlight with this highlightId or same bounds (regardless of needsBIC or color)
                                                                                const filtered = pageHighlights.filter(h => {
                                                                                  // Keep highlights that don't match by ID or bounds
                                                                                  const hasMatchingId = h.highlightId === highlightId;
                                                                                  const hasMatchingBounds = h.x === highlightData.bounds.x &&
                                                                                    h.y === highlightData.bounds.y &&
                                                                                    h.width === highlightData.bounds.width &&
                                                                                    h.height === highlightData.bounds.height;
                                                                                  // Remove if it matches by ID or bounds
                                                                                  return !hasMatchingId && !hasMatchingBounds;
                                                                                });
                                                                                return {
                                                                                  ...prev,
                                                                                  [highlightData.pageNumber]: [
                                                                                    ...filtered,
                                                                                    {
                                                                                      ...highlightData.bounds,
                                                                                      color: entityColor,
                                                                                      highlightId: highlightId
                                                                                    }
                                                                                  ]
                                                                                };
                                                                              });
                                                                            }
                                                                          }

                                                                          // Update highlight annotation with Complete BIC status
                                                                          updated[highlightId] = {
                                                                            ...updated[highlightId],
                                                                            ballInCourtEntityId: completeEntity.id,
                                                                            ballInCourtEntityName: completeEntity.name,
                                                                            ballInCourtColor: entityColor
                                                                          };
                                                                        }
                                                                      } else {
                                                                        // Not all items are Y or N/A - remove ball in court status (set to None)
                                                                        if (matchingItem) {
                                                                          const updatedItem = {
                                                                            ...matchingItem,
                                                                            [dataKey]: {
                                                                              ...moduleData,
                                                                              ballInCourtEntityId: undefined,
                                                                              ballInCourtEntityName: undefined,
                                                                              ballInCourtColor: undefined
                                                                            }
                                                                          };

                                                                          setItems(prev => ({
                                                                            ...prev,
                                                                            [matchingItem.itemId]: updatedItem
                                                                          }));

                                                                          // Update all annotations for this item in this space
                                                                          setAnnotations(prev => {
                                                                            const updatedAnns = { ...prev };
                                                                            Object.values(updatedAnns).forEach(ann => {
                                                                              if (ann.itemId === matchingItem.itemId && ann.spaceId === selectedSpaceId) {
                                                                                updatedAnns[ann.annotationId] = {
                                                                                  ...ann,
                                                                                  ballInCourtEntityId: undefined,
                                                                                  ballInCourtEntityName: undefined,
                                                                                  ballInCourtColor: undefined
                                                                                };
                                                                              }
                                                                            });
                                                                            return updatedAnns;
                                                                          });

                                                                          // Update highlight on PDF - revert to "needs BIC" state (transparent with dashed outline)
                                                                          if (highlightData?.pageNumber && highlightData?.bounds) {
                                                                            setNewHighlightsByPage(prev => {
                                                                              const pageHighlights = prev[highlightData.pageNumber] || [];
                                                                              // Remove any existing highlight with this highlightId or same bounds (regardless of needsBIC or color)
                                                                              const filtered = pageHighlights.filter(h => {
                                                                                // Keep highlights that don't match by ID or bounds
                                                                                const hasMatchingId = h.highlightId === highlightId;
                                                                                const hasMatchingBounds = h.x === highlightData.bounds.x &&
                                                                                  h.y === highlightData.bounds.y &&
                                                                                  h.width === highlightData.bounds.width &&
                                                                                  h.height === highlightData.bounds.height;
                                                                                // Remove if it matches by ID or bounds
                                                                                return !hasMatchingId && !hasMatchingBounds;
                                                                              });
                                                                              // Add "needs BIC" highlight (transparent with dashed outline)
                                                                              return {
                                                                                ...prev,
                                                                                [highlightData.pageNumber]: [
                                                                                  ...filtered,
                                                                                  {
                                                                                    ...highlightData.bounds,
                                                                                    needsBIC: true,
                                                                                    highlightId: highlightId
                                                                                  }
                                                                                ]
                                                                              };
                                                                            });
                                                                          }
                                                                        }

                                                                        // Update highlight annotation to remove BIC status
                                                                        updated[highlightId] = {
                                                                          ...updated[highlightId],
                                                                          ballInCourtEntityId: undefined,
                                                                          ballInCourtEntityName: undefined,
                                                                          ballInCourtColor: undefined
                                                                        };
                                                                      }
                                                                    }

                                                                    return updated;
                                                                  });
                                                                }}
                                                                style={{
                                                                  minWidth: '28px',
                                                                  padding: '4px 6px',
                                                                  fontSize: '11px',
                                                                  fontWeight: '400',
                                                                  border: 'none',
                                                                  borderRadius: '3px',
                                                                  cursor: 'pointer',
                                                                  background: isSelected === option
                                                                    ? option === 'Y'
                                                                      ? '#B8E6D4'
                                                                      : option === 'N'
                                                                        ? '#FFB3BA'
                                                                        : '#777'
                                                                    : '#D3D3D3',
                                                                  color: isSelected === option ? '#FFFFFF' : '#333333',
                                                                  transition: 'all 0.2s ease'
                                                                }}
                                                              >
                                                                {option}
                                                              </button>
                                                            ))}
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })
                                                }
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )
                                      }
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div style={{ color: '#999', fontSize: '14px', padding: '20px', textAlign: 'center' }}>
                                <div>No categories available for this space.</div>
                                {selectedTemplate && selectedModuleId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!selectedTemplate?.id || !selectedModuleId) {
                                        alert('Please select a template and module before creating a category.');
                                        return;
                                      }
                                      onRequestCreateTemplate?.({
                                        mode: 'edit',
                                        templateId: selectedTemplate.id,
                                        moduleId: selectedModuleId,
                                        startAddingCategory: true
                                      });
                                    }}
                                    style={{
                                      marginTop: '12px',
                                      padding: '10px 18px',
                                      borderRadius: '20px',
                                      border: '1px solid #4A90E2',
                                      background: '#2a2a2a',
                                      color: '#FFFFFF',
                                      fontSize: '13px',
                                      fontWeight: 500,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: '6px',
                                      transition: 'background 0.2s ease, border-color 0.2s ease'
                                    }}
                                    onMouseEnter={(event) => {
                                      event.currentTarget.style.background = '#3a3a3a';
                                      event.currentTarget.style.borderColor = '#5AA0F2';
                                    }}
                                    onMouseLeave={(event) => {
                                      event.currentTarget.style.background = '#2a2a2a';
                                      event.currentTarget.style.borderColor = '#4A90E2';
                                    }}
                                  >
                                    Create Category
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })() : (
                      <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                        <p>Select a space to view categories</p>
                      </div>
                    )}
                  </div>


                </>
              )}

              {/* Export / Sync Button at Bottom */}
              {!isSurveyPanelCollapsed && selectedTemplate && (
                <div style={{
                  padding: '12px',
                  borderTop: '1px solid #3a3a3a',
                  background: '#252525',
                  position: 'relative' // For dropdown positioning
                }}>
                  {!selectedTemplate.linkedExcelPath ? (
                    <button
                      type="button"
                      onClick={handleExportSurveyToExcel}
                      style={{
                        width: '100%',
                        background: '#4A90E2',
                        border: '1px solid #3277c7',
                        color: '#fff',
                        fontSize: '14px',
                        fontWeight: 600,
                        padding: '10px 16px',
                        borderRadius: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#357abd';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#4A90E2';
                      }}
                    >
                      EXPORT
                    </button>
                  ) : (
                    <div ref={exportMenuRef} style={{ display: 'flex', width: '100%' }}>
                      <button
                        type="button"
                        onClick={() => handleExportSurveyToExcel()} // Default action: Export new
                        style={{
                          flex: 1,
                          background: '#4A90E2',
                          border: '1px solid #3277c7',
                          borderRight: 'none',
                          borderTopLeftRadius: '6px',
                          borderBottomLeftRadius: '6px',
                          color: '#fff',
                          fontSize: '14px',
                          fontWeight: 600,
                          padding: '10px 16px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#357abd';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#4A90E2';
                        }}
                      >
                        EXPORT
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        style={{
                          width: '40px',
                          background: '#4A90E2',
                          border: '1px solid #3277c7',
                          borderLeft: '1px solid rgba(0,0,0,0.1)',
                          borderTopRightRadius: '6px',
                          borderBottomRightRadius: '6px',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#357abd';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#4A90E2';
                        }}
                      >
                        <Icon name={showExportMenu ? "chevronUp" : "chevronDown"} size={16} />
                      </button>

                      {showExportMenu && (
                        <div style={{
                          position: 'absolute',
                          bottom: '100%',
                          left: '12px',
                          right: '12px',
                          marginBottom: '8px',
                          background: '#333',
                          border: '1px solid #444',
                          borderRadius: '6px',
                          boxShadow: '0 -4px 12px rgba(0,0,0,0.3)',
                          zIndex: 100,
                          overflow: 'hidden'
                        }}>
                          <div
                            onClick={async () => {
                              const excelPath = selectedTemplate.linkedExcelPath;
                              const isOneDrive = selectedTemplate.isOneDrive;

                              console.log('Attempting to open Excel file:', { excelPath, isOneDrive });

                              if (!excelPath) {
                                alert('No Excel file is linked to this survey.');
                                setShowExportMenu(false);
                                return;
                              }

                              // Handle OneDrive files - open in browser
                              if (isOneDrive) {
                                try {
                                  // Get the file's web URL from OneDrive
                                  if (graphClient) {
                                    const driveItem = await graphClient.api(`/me/drive/root:${excelPath}`).get();
                                    if (driveItem && driveItem.webUrl) {
                                      window.open(driveItem.webUrl, '_blank');
                                    } else {
                                      alert('Could not get the OneDrive file URL. Please open the file manually from OneDrive.');
                                    }
                                  } else {
                                    alert('Please sign in to Microsoft to open OneDrive files.');
                                  }
                                } catch (err) {
                                  console.error('Error opening OneDrive file:', err);
                                  alert(`Error opening OneDrive file:\n${err.message}`);
                                }
                                setShowExportMenu(false);
                                return;
                              }

                              // Handle local files
                              if (window.electronAPI) {
                                try {
                                  // Check if file exists first
                                  const exists = await window.electronAPI.fileExists(excelPath);
                                  console.log('File exists:', exists);

                                  if (!exists) {
                                    alert(`Excel file not found at:\n${excelPath}\n\nThe file may have been moved or deleted.`);
                                    setShowExportMenu(false);
                                    return;
                                  }

                                  const result = await window.electronAPI.openPath(excelPath);
                                  if (result) {
                                    // shell.openPath returns an error string if it fails, empty string on success
                                    console.error('Failed to open Excel file:', result);
                                    alert(`Failed to open Excel file:\n${result}\n\nPath: ${excelPath}`);
                                  }
                                } catch (err) {
                                  console.error('Error opening Excel file:', err);
                                  alert(`Error opening Excel file:\n${err.message}\n\nPath: ${excelPath}`);
                                }
                              } else {
                                alert('This feature is only available in the desktop app.');
                              }
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#fff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="document" size={16} />
                            Open Excel
                          </div>
                          <div
                            onClick={() => {
                              handleExportSurveyToExcel(selectedTemplate.linkedExcelPath);
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#fff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              borderBottom: '1px solid #444',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="upload" size={16} />
                            Push to Excel
                          </div>
                          <div
                            onClick={() => {
                              handleSyncFromExcel();
                              setShowExportMenu(false);
                            }}
                            style={{
                              padding: '12px 16px',
                              color: '#fff',
                              fontSize: '14px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#444'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <Icon name="download" size={16} />
                            Pull from Excel
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )
        }

        {/* Category Selection Modal (after highlighting) */}
        {
          pendingHighlight && selectedTemplate && selectedModuleId && (
            <>
              <div
                onClick={() => setPendingHighlight(null)}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 10001,
                  animation: 'fadeIn 0.2s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: '#2b2b2b',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    padding: '24px',
                    width: '500px',
                    maxWidth: '90vw',
                    maxHeight: '80vh',
                    overflow: 'auto',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    animation: 'fadeIn 0.2s ease-out'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '20px'
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '18px',
                      fontWeight: '600',
                      color: '#fff',
                      fontFamily: FONT_FAMILY
                    }}>
                      Categorize Highlight
                    </h3>
                    <button
                      onClick={() => setPendingHighlight(null)}
                      className="btn btn-icon btn-icon-sm"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#999'
                      }}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  <p style={{ color: '#999', fontSize: '14px', marginBottom: '20px' }}>
                    Select a category for this highlighted item:
                  </p>

                  {(() => {
                    const module = ((selectedTemplate.modules || selectedTemplate.spaces) || [])?.find(m => m.id === selectedModuleId);
                    if (!module || !module.categories || module.categories.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                          <p>No categories available for this module.</p>
                        </div>
                      );
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {module.categories.map(category => (
                          <button
                            key={category.id}
                            onClick={() => {
                              // Check if template has Ball in Court entities
                              const ballInCourtEntities = selectedTemplate?.ballInCourtEntities || [];
                              if (ballInCourtEntities.length > 0) {
                                // Show Ball in Court selection dialog first
                                setPendingBallInCourtSelection({
                                  highlight: pendingHighlight,
                                  categoryId: category.id
                                });
                              } else {
                                // No Ball in Court entities, go directly to name prompt
                                setPendingHighlightName({
                                  highlight: pendingHighlight,
                                  categoryId: category.id
                                });
                                setHighlightNameInput(''); // Reset input
                              }
                              // Clear pending highlight modal
                              setPendingHighlight(null);
                            }}
                            className="btn btn-default btn-md"
                            style={{
                              textAlign: 'left',
                              justifyContent: 'flex-start',
                              padding: '12px 16px',
                              background: 'transparent',
                              border: '1px solid transparent'
                            }}
                          >
                            <div style={{ fontWeight: '500', color: '#fff' }}>
                              {category.name || 'Untitled Category'}
                            </div>
                            {category.checklist && category.checklist.length > 0 && (
                              <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                                {category.checklist.length} checklist item{category.checklist.length !== 1 ? 's' : ''}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )
        }

        {/* Ball in Court Selection Dialog */}
        {
          pendingBallInCourtSelection && selectedTemplate && selectedModuleId && (() => {
            const ballInCourtEntities = selectedTemplate.ballInCourtEntities || [];

            return (
              <>
                <div
                  onClick={() => {
                    // Cancel - proceed without entity selection
                    setPendingHighlightName({
                      highlight: pendingBallInCourtSelection.highlight,
                      categoryId: pendingBallInCourtSelection.categoryId
                    });
                    setPendingBallInCourtSelection(null);
                    setHighlightNameInput('');
                  }}
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 10003,
                    animation: 'fadeIn 0.2s ease-out',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: '#2b2b2b',
                      border: '1px solid #444',
                      borderRadius: '8px',
                      padding: '24px',
                      width: '500px',
                      maxWidth: '90vw',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                      animation: 'fadeIn 0.2s ease-out'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '20px'
                    }}>
                      <h3 style={{
                        margin: 0,
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#fff',
                        fontFamily: FONT_FAMILY
                      }}>
                        Ball in Court
                      </h3>
                      <button
                        onClick={() => {
                          // Cancel - proceed without entity selection
                          setPendingHighlightName({
                            highlight: pendingBallInCourtSelection.highlight,
                            categoryId: pendingBallInCourtSelection.categoryId
                          });
                          setPendingBallInCourtSelection(null);
                          setHighlightNameInput('');
                        }}
                        className="btn btn-icon btn-icon-sm"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#999'
                        }}
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </div>

                    <div style={{
                      fontSize: '14px',
                      color: '#999',
                      marginBottom: '16px'
                    }}>
                      Select the entity responsible for this highlight:
                    </div>

                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      maxHeight: '400px',
                      overflowY: 'auto'
                    }}>
                      {ballInCourtEntities.map(entity => (
                        <button
                          key={entity.id}
                          onClick={() => {
                            // Apply entity color and proceed to name prompt
                            // Use the entity's saved opacity for highlights
                            const entityColor = normalizeHighlightColor(entity.color) || entity.color || hexToRgba('#E3D1FB', DEFAULT_SURVEY_HIGHLIGHT_OPACITY);

                            // Store highlight with entity info
                            setHighlightAnnotations(prev => ({
                              ...prev,
                              [pendingBallInCourtSelection.highlight.id]: {
                                ...pendingBallInCourtSelection.highlight,
                                categoryId: pendingBallInCourtSelection.categoryId,
                                ballInCourtEntityId: entity.id,
                                ballInCourtEntityName: entity.name,
                                ballInCourtColor: entityColor,
                                checklistResponses: {}
                              }
                            }));

                            // Update existing highlight on page with entity color (rgba with 100% opacity)
                            // Replace the existing highlight (with needsBIC) with the new one that has the color
                            setNewHighlightsByPage(prev => {
                              const pageHighlights = prev[pendingBallInCourtSelection.highlight.pageNumber] || [];
                              // Remove existing highlight with this highlightId (if it exists)
                              const filtered = pageHighlights.filter(h => h.highlightId !== pendingBallInCourtSelection.highlight.id);
                              // Add the new highlight with color
                              return {
                                ...prev,
                                [pendingBallInCourtSelection.highlight.pageNumber]: [
                                  ...filtered,
                                  {
                                    ...pendingBallInCourtSelection.highlight.bounds,
                                    color: entityColor,
                                    highlightId: pendingBallInCourtSelection.highlight.id,
                                    moduleId: pendingBallInCourtSelection.highlight.moduleId || selectedModuleId
                                  }
                                ]
                              };
                            });

                            // Proceed to name prompt
                            setPendingHighlightName({
                              highlight: {
                                ...pendingBallInCourtSelection.highlight,
                                ballInCourtEntityId: entity.id,
                                ballInCourtEntityName: entity.name,
                                ballInCourtColor: entityColor
                              },
                              categoryId: pendingBallInCourtSelection.categoryId
                            });
                            setPendingBallInCourtSelection(null);
                            setHighlightNameInput('');
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            background: '#333',
                            border: '1px solid #444',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            textAlign: 'left'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#3a3a3a';
                            e.currentTarget.style.borderColor = '#555';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#333';
                            e.currentTarget.style.borderColor = '#444';
                          }}
                        >
                          <div
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '4px',
                              background: entity.color,
                              border: '1px solid rgba(255, 255, 255, 0.2)',
                              flexShrink: 0
                            }}
                          />
                          <span style={{
                            color: '#fff',
                            fontSize: '14px',
                            fontWeight: '500',
                            fontFamily: FONT_FAMILY
                          }}>
                            {entity.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            );
          })()
        }

        {/* Name Prompt Modal (after categorizing highlight) */}
        {
          pendingHighlightName && selectedTemplate && selectedModuleId && (() => {
            const module = ((selectedTemplate.modules || selectedTemplate.spaces) || [])?.find(m => m.id === selectedModuleId);
            const category = module?.categories?.find(c => c.id === pendingHighlightName.categoryId);
            const categoryName = category?.name?.trim() || 'Untitled Category';
            const existingHighlights = Object.values(highlightAnnotations).filter(h => h.categoryId === pendingHighlightName.categoryId);
            const defaultName = generateDefaultHighlightName(categoryName, existingHighlights);

            return (
              <>
                <div
                  onClick={() => {
                    // Cancel - save with default name
                    const highlightData = {
                      ...pendingHighlightName.highlight,
                      categoryId: pendingHighlightName.categoryId,
                      name: defaultName,
                      checklistResponses: {}
                    };
                    setHighlightAnnotations(prev => ({
                      ...prev,
                      [pendingHighlightName.highlight.id]: highlightData
                    }));

                    // Update existing highlight with color if Ball in Court was selected (ensure 100% opacity)
                    // Replace the existing highlight (with needsBIC) with the new one that has the color
                    const highlightColor = highlightData.ballInCourtColor
                      ? (normalizeHighlightColor(highlightData.ballInCourtColor) || highlightData.ballInCourtColor)
                      : 'rgba(255, 193, 7, 1.0)';
                    setNewHighlightsByPage(prev => {
                      const pageHighlights = prev[pendingHighlightName.highlight.pageNumber] || [];
                      // Remove existing highlight with this highlightId (if it exists)
                      const filtered = pageHighlights.filter(h => h.highlightId !== pendingHighlightName.highlight.id);
                      // Add the new highlight with color
                      return {
                        ...prev,
                        [pendingHighlightName.highlight.pageNumber]: [
                          ...filtered,
                          {
                            ...pendingHighlightName.highlight.bounds,
                            color: highlightColor,
                            highlightId: pendingHighlightName.highlight.id,
                            moduleId: pendingHighlightName.highlight.moduleId || selectedModuleId
                          }
                        ]
                      };
                    });

                    setPendingHighlightName(null);
                    setHighlightNameInput('');
                    setShowSurveyPanel(true);
                  }}
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 10002,
                    animation: 'fadeIn 0.2s ease-out',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: '#2b2b2b',
                      border: '1px solid #444',
                      borderRadius: '8px',
                      padding: '24px',
                      width: '500px',
                      maxWidth: '90vw',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                      animation: 'fadeIn 0.2s ease-out'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '20px'
                    }}>
                      <h3 style={{
                        margin: 0,
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#fff',
                        fontFamily: FONT_FAMILY
                      }}>
                        Name Highlight
                      </h3>
                      <button
                        onClick={() => {
                          // Cancel - save with default name
                          const highlightData = {
                            ...pendingHighlightName.highlight,
                            categoryId: pendingHighlightName.categoryId,
                            name: defaultName,
                            checklistResponses: {}
                          };
                          setHighlightAnnotations(prev => ({
                            ...prev,
                            [pendingHighlightName.highlight.id]: highlightData
                          }));

                          // If BIC was selected, also store it in the item's module-specific data
                          if (highlightData.ballInCourtEntityId && selectedTemplate && selectedModuleId) {
                            // Find or create item for this highlight
                            const categoryName = getCategoryName(selectedTemplate, selectedModuleId, pendingHighlightName.categoryId);
                            const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                            const dataKey = getModuleDataKey(moduleName);

                            // Find existing item by name and category
                            const existingItem = Object.values(items).find(item =>
                              item.name === defaultName &&
                              item.itemType === categoryName
                            );

                            if (existingItem) {
                              // Update existing item's module-specific data with BIC
                              const moduleData = existingItem[dataKey] || {};
                              const ballInCourtEntity = selectedTemplate.ballInCourtEntities?.find(e => e.id === highlightData.ballInCourtEntityId);

                              if (ballInCourtEntity) {
                                setItems(prev => ({
                                  ...prev,
                                  [existingItem.itemId]: {
                                    ...existingItem,
                                    [dataKey]: {
                                      ...moduleData,
                                      ballInCourtEntityId: ballInCourtEntity.id,
                                      ballInCourtEntityName: ballInCourtEntity.name,
                                      ballInCourtColor: ballInCourtEntity.color
                                    }
                                  }
                                }));
                              }
                            } else {
                              // Create new item with BIC in module-specific data
                              const newItem = createItem(
                                selectedTemplate,
                                selectedModuleId,
                                pendingHighlightName.categoryId,
                                defaultName,
                                1
                              );

                              const ballInCourtEntity = selectedTemplate.ballInCourtEntities?.find(e => e.id === highlightData.ballInCourtEntityId);
                              if (ballInCourtEntity) {
                                newItem[dataKey] = {
                                  ballInCourtEntityId: ballInCourtEntity.id,
                                  ballInCourtEntityName: ballInCourtEntity.name,
                                  ballInCourtColor: ballInCourtEntity.color
                                };
                              }

                              setItems(prev => ({
                                ...prev,
                                [newItem.itemId]: newItem
                              }));

                              // Also create annotation for this item
                              const annotation = createAnnotation(
                                pendingHighlightName.highlight.bounds,
                                'highlight',
                                selectedTemplate,
                                selectedSpaceId,
                                newItem.itemId,
                                categoryName
                              );

                              // Set BIC on annotation
                              if (ballInCourtEntity) {
                                annotation.ballInCourtEntityId = ballInCourtEntity.id;
                                annotation.ballInCourtEntityName = ballInCourtEntity.name;
                                annotation.ballInCourtColor = ballInCourtEntity.color;
                              }

                              setAnnotations(prev => ({
                                ...prev,
                                [annotation.annotationId]: annotation
                              }));
                            }
                          }

                          // Update existing highlight with color if Ball in Court was selected (ensure 100% opacity)
                          // Replace the existing highlight (with needsBIC) with the new one that has the color
                          const highlightColor = highlightData.ballInCourtColor
                            ? (normalizeHighlightColor(highlightData.ballInCourtColor) || highlightData.ballInCourtColor)
                            : 'rgba(255, 193, 7, 1.0)';
                          setNewHighlightsByPage(prev => {
                            const pageHighlights = prev[pendingHighlightName.highlight.pageNumber] || [];
                            // Remove existing highlight with this highlightId (if it exists)
                            const filtered = pageHighlights.filter(h => h.highlightId !== pendingHighlightName.highlight.id);
                            // Add the new highlight with color
                            return {
                              ...prev,
                              [pendingHighlightName.highlight.pageNumber]: [
                                ...filtered,
                                {
                                  ...pendingHighlightName.highlight.bounds,
                                  color: highlightColor,
                                  highlightId: pendingHighlightName.highlight.id,
                                  moduleId: pendingHighlightName.highlight.moduleId || selectedModuleId
                                }
                              ]
                            };
                          });

                          setPendingHighlightName(null);
                          setHighlightNameInput('');
                          setShowSurveyPanel(true);
                        }}
                        className="btn btn-icon btn-icon-sm"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#999'
                        }}
                      >
                        <Icon name="close" size={18} />
                      </button>
                    </div>

                    <p style={{ color: '#999', fontSize: '14px', marginBottom: '16px' }}>
                      Category: <strong style={{ color: '#fff' }}>{category?.name || 'Untitled Category'}</strong>
                    </p>

                    <input
                      type="text"
                      autoFocus
                      value={highlightNameInput || defaultName}
                      onChange={(e) => setHighlightNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const name = (highlightNameInput || defaultName).trim() || defaultName;
                          const highlightData = {
                            ...pendingHighlightName.highlight,
                            categoryId: pendingHighlightName.categoryId,
                            name: name,
                            checklistResponses: {}
                          };
                          setHighlightAnnotations(prev => ({
                            ...prev,
                            [pendingHighlightName.highlight.id]: highlightData
                          }));

                          // Update existing highlight with color if Ball in Court was selected (ensure 100% opacity)
                          // Replace the existing highlight (with needsBIC) with the new one that has the color
                          const highlightColor = highlightData.ballInCourtColor
                            ? (normalizeHighlightColor(highlightData.ballInCourtColor) || highlightData.ballInCourtColor)
                            : 'rgba(255, 193, 7, 1.0)';
                          setNewHighlightsByPage(prev => {
                            const pageHighlights = prev[pendingHighlightName.highlight.pageNumber] || [];
                            // Remove existing highlight with this highlightId (if it exists)
                            const filtered = pageHighlights.filter(h => h.highlightId !== pendingHighlightName.highlight.id);
                            // Add the new highlight with color
                            return {
                              ...prev,
                              [pendingHighlightName.highlight.pageNumber]: [
                                ...filtered,
                                {
                                  ...pendingHighlightName.highlight.bounds,
                                  color: highlightColor,
                                  highlightId: pendingHighlightName.highlight.id,
                                  moduleId: pendingHighlightName.highlight.moduleId || selectedModuleId
                                }
                              ]
                            };
                          });

                          setPendingHighlightName(null);
                          setHighlightNameInput('');
                          setShowSurveyPanel(true);
                        } else if (e.key === 'Escape') {
                          // Cancel - save with default name
                          const highlightData = {
                            ...pendingHighlightName.highlight,
                            categoryId: pendingHighlightName.categoryId,
                            name: defaultName,
                            checklistResponses: {}
                          };
                          setHighlightAnnotations(prev => ({
                            ...prev,
                            [pendingHighlightName.highlight.id]: highlightData
                          }));

                          // Update existing highlight with color if Ball in Court was selected (ensure 100% opacity)
                          // Replace the existing highlight (with needsBIC) with the new one that has the color
                          const highlightColor = highlightData.ballInCourtColor
                            ? (normalizeHighlightColor(highlightData.ballInCourtColor) || highlightData.ballInCourtColor)
                            : 'rgba(255, 193, 7, 1.0)';
                          setNewHighlightsByPage(prev => {
                            const pageHighlights = prev[pendingHighlightName.highlight.pageNumber] || [];
                            // Remove existing highlight with this highlightId (if it exists)
                            const filtered = pageHighlights.filter(h => h.highlightId !== pendingHighlightName.highlight.id);
                            // Add the new highlight with color
                            return {
                              ...prev,
                              [pendingHighlightName.highlight.pageNumber]: [
                                ...filtered,
                                {
                                  ...pendingHighlightName.highlight.bounds,
                                  color: highlightColor,
                                  highlightId: pendingHighlightName.highlight.id,
                                  moduleId: pendingHighlightName.highlight.moduleId || selectedModuleId
                                }
                              ]
                            };
                          });

                          setPendingHighlightName(null);
                          setHighlightNameInput('');
                          setShowSurveyPanel(true);
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        background: '#1b1b1b',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        color: '#fff',
                        fontSize: '14px',
                        fontFamily: FONT_FAMILY,
                        outline: 'none',
                        marginBottom: '16px'
                      }}
                      placeholder="Enter highlight name"
                    />

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => {
                          // Cancel - save with default name
                          const highlightData = {
                            ...pendingHighlightName.highlight,
                            categoryId: pendingHighlightName.categoryId,
                            name: defaultName,
                            checklistResponses: {}
                          };
                          setHighlightAnnotations(prev => ({
                            ...prev,
                            [pendingHighlightName.highlight.id]: highlightData
                          }));

                          // If BIC was selected, also store it in the item's module-specific data
                          if (highlightData.ballInCourtEntityId && selectedTemplate && selectedModuleId) {
                            // Find or create item for this highlight
                            const categoryName = getCategoryName(selectedTemplate, selectedModuleId, pendingHighlightName.categoryId);
                            const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                            const dataKey = getModuleDataKey(moduleName);

                            // Find existing item by name and category
                            const existingItem = Object.values(items).find(item =>
                              item.name === defaultName &&
                              item.itemType === categoryName
                            );

                            if (existingItem) {
                              // Update existing item's module-specific data with BIC
                              const moduleData = existingItem[dataKey] || {};
                              const ballInCourtEntity = selectedTemplate.ballInCourtEntities?.find(e => e.id === highlightData.ballInCourtEntityId);

                              if (ballInCourtEntity) {
                                setItems(prev => ({
                                  ...prev,
                                  [existingItem.itemId]: {
                                    ...existingItem,
                                    [dataKey]: {
                                      ...moduleData,
                                      ballInCourtEntityId: ballInCourtEntity.id,
                                      ballInCourtEntityName: ballInCourtEntity.name,
                                      ballInCourtColor: ballInCourtEntity.color
                                    }
                                  }
                                }));
                              }
                            } else {
                              // Create new item with BIC in module-specific data
                              const newItem = createItem(
                                selectedTemplate,
                                selectedModuleId,
                                pendingHighlightName.categoryId,
                                defaultName,
                                1
                              );

                              const ballInCourtEntity = selectedTemplate.ballInCourtEntities?.find(e => e.id === highlightData.ballInCourtEntityId);
                              if (ballInCourtEntity) {
                                newItem[dataKey] = {
                                  ballInCourtEntityId: ballInCourtEntity.id,
                                  ballInCourtEntityName: ballInCourtEntity.name,
                                  ballInCourtColor: ballInCourtEntity.color
                                };
                              }

                              setItems(prev => ({
                                ...prev,
                                [newItem.itemId]: newItem
                              }));

                              // Also create annotation for this item
                              const annotation = createAnnotation(
                                pendingHighlightName.highlight.bounds,
                                'highlight',
                                selectedTemplate,
                                selectedSpaceId,
                                newItem.itemId,
                                categoryName
                              );

                              // Set BIC on annotation
                              if (ballInCourtEntity) {
                                annotation.ballInCourtEntityId = ballInCourtEntity.id;
                                annotation.ballInCourtEntityName = ballInCourtEntity.name;
                                annotation.ballInCourtColor = ballInCourtEntity.color;
                              }

                              setAnnotations(prev => ({
                                ...prev,
                                [annotation.annotationId]: annotation
                              }));
                            }
                          }

                          // Update existing highlight with color if Ball in Court was selected (ensure 100% opacity)
                          // Replace the existing highlight (with needsBIC) with the new one that has the color
                          const highlightColor = highlightData.ballInCourtColor
                            ? (normalizeHighlightColor(highlightData.ballInCourtColor) || highlightData.ballInCourtColor)
                            : 'rgba(255, 193, 7, 1.0)';
                          setNewHighlightsByPage(prev => {
                            const pageHighlights = prev[pendingHighlightName.highlight.pageNumber] || [];
                            // Remove existing highlight with this highlightId (if it exists)
                            const filtered = pageHighlights.filter(h => h.highlightId !== pendingHighlightName.highlight.id);
                            // Add the new highlight with color
                            return {
                              ...prev,
                              [pendingHighlightName.highlight.pageNumber]: [
                                ...filtered,
                                {
                                  ...pendingHighlightName.highlight.bounds,
                                  color: highlightColor,
                                  highlightId: pendingHighlightName.highlight.id,
                                  moduleId: pendingHighlightName.highlight.moduleId || selectedModuleId
                                }
                              ]
                            };
                          });

                          setPendingHighlightName(null);
                          setHighlightNameInput('');
                          setShowSurveyPanel(true);
                        }}
                        className="btn btn-default btn-md"
                        style={{
                          padding: '10px 20px'
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          const name = (highlightNameInput || defaultName).trim() || defaultName;
                          const highlightData = {
                            ...pendingHighlightName.highlight,
                            categoryId: pendingHighlightName.categoryId,
                            name: name,
                            checklistResponses: {}
                          };
                          setHighlightAnnotations(prev => ({
                            ...prev,
                            [pendingHighlightName.highlight.id]: highlightData
                          }));

                          // If BIC was selected, also store it in the item's module-specific data
                          if (highlightData.ballInCourtEntityId && selectedTemplate && selectedModuleId) {
                            // Find or create item for this highlight
                            const categoryName = getCategoryName(selectedTemplate, selectedModuleId, pendingHighlightName.categoryId);
                            const moduleName = getModuleName(selectedTemplate, selectedModuleId);
                            const dataKey = getModuleDataKey(moduleName);

                            // Find existing item by name and category
                            const existingItem = Object.values(items).find(item =>
                              item.name === name &&
                              item.itemType === categoryName
                            );

                            if (existingItem) {
                              // Update existing item's module-specific data with BIC
                              const moduleData = existingItem[dataKey] || {};
                              const ballInCourtEntity = selectedTemplate.ballInCourtEntities?.find(e => e.id === highlightData.ballInCourtEntityId);

                              if (ballInCourtEntity) {
                                setItems(prev => ({
                                  ...prev,
                                  [existingItem.itemId]: {
                                    ...existingItem,
                                    [dataKey]: {
                                      ...moduleData,
                                      ballInCourtEntityId: ballInCourtEntity.id,
                                      ballInCourtEntityName: ballInCourtEntity.name,
                                      ballInCourtColor: ballInCourtEntity.color
                                    }
                                  }
                                }));
                              }
                            } else {
                              // Create new item with BIC in space-specific data
                              const newItem = createItem(
                                selectedTemplate,
                                selectedSpaceId,
                                pendingHighlightName.categoryId,
                                name,
                                1
                              );

                              const ballInCourtEntity = selectedTemplate.ballInCourtEntities?.find(e => e.id === highlightData.ballInCourtEntityId);
                              if (ballInCourtEntity) {
                                newItem[dataKey] = {
                                  ballInCourtEntityId: ballInCourtEntity.id,
                                  ballInCourtEntityName: ballInCourtEntity.name,
                                  ballInCourtColor: ballInCourtEntity.color
                                };
                              }

                              setItems(prev => ({
                                ...prev,
                                [newItem.itemId]: newItem
                              }));

                              // Also create annotation for this item
                              const annotation = createAnnotation(
                                pendingHighlightName.highlight.bounds,
                                'highlight',
                                selectedTemplate,
                                selectedSpaceId,
                                newItem.itemId,
                                categoryName
                              );

                              // Set BIC on annotation
                              if (ballInCourtEntity) {
                                annotation.ballInCourtEntityId = ballInCourtEntity.id;
                                annotation.ballInCourtEntityName = ballInCourtEntity.name;
                                annotation.ballInCourtColor = ballInCourtEntity.color;
                              }

                              setAnnotations(prev => ({
                                ...prev,
                                [annotation.annotationId]: annotation
                              }));
                            }
                          }

                          // Update existing highlight with color if Ball in Court was selected (ensure 100% opacity)
                          // Replace the existing highlight (with needsBIC) with the new one that has the color
                          const highlightColor = highlightData.ballInCourtColor
                            ? (normalizeHighlightColor(highlightData.ballInCourtColor) || highlightData.ballInCourtColor)
                            : 'rgba(255, 193, 7, 1.0)';
                          setNewHighlightsByPage(prev => {
                            const pageHighlights = prev[pendingHighlightName.highlight.pageNumber] || [];
                            // Remove existing highlight with this highlightId (if it exists)
                            const filtered = pageHighlights.filter(h => h.highlightId !== pendingHighlightName.highlight.id);
                            // Add the new highlight with color
                            return {
                              ...prev,
                              [pendingHighlightName.highlight.pageNumber]: [
                                ...filtered,
                                {
                                  ...pendingHighlightName.highlight.bounds,
                                  color: highlightColor,
                                  highlightId: pendingHighlightName.highlight.id,
                                  moduleId: pendingHighlightName.highlight.moduleId || selectedModuleId
                                }
                              ]
                            };
                          });

                          setPendingHighlightName(null);
                          setHighlightNameInput('');
                          setShowSurveyPanel(true);
                        }}
                        className="btn btn-primary btn-md"
                        style={{
                          padding: '10px 20px'
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              </>
            );
          })()
        }

        {/* Note Dialog */}
        {
          noteDialogOpen && (
            <>
              <div
                onClick={() => setNoteDialogOpen(null)}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 10001,
                  animation: 'fadeIn 0.2s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: '#2b2b2b',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    padding: '24px',
                    width: '600px',
                    maxWidth: '90vw',
                    maxHeight: '80vh',
                    overflow: 'auto',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    animation: 'fadeIn 0.2s ease-out'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '20px'
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '18px',
                      fontWeight: '600',
                      color: '#fff',
                      fontFamily: FONT_FAMILY
                    }}>
                      Note
                    </h3>
                    <button
                      onClick={() => setNoteDialogOpen(null)}
                      className="btn btn-icon btn-icon-sm"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#999'
                      }}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: '#ddd'
                    }}>
                      Notes
                    </label>
                    <textarea
                      value={noteDialogContent.text}
                      onChange={(e) => setNoteDialogContent(prev => ({ ...prev, text: e.target.value }))}
                      rows={6}
                      style={{
                        width: '100%',
                        padding: '10px',
                        background: '#333',
                        color: '#ddd',
                        border: '1px solid #555',
                        borderRadius: '5px',
                        fontSize: '14px',
                        fontFamily: FONT_FAMILY,
                        resize: 'vertical'
                      }}
                      placeholder="Enter your notes..."
                    />
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: '#ddd'
                    }}>
                      Photos
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const photoPromises = files.map(file => {
                          return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              resolve({ name: file.name, dataUrl: event.target.result });
                            };
                            reader.readAsDataURL(file);
                          });
                        });
                        Promise.all(photoPromises).then(photos => {
                          setNoteDialogContent(prev => ({
                            ...prev,
                            photos: [...prev.photos, ...photos]
                          }));
                        });
                      }}
                      style={{ display: 'none' }}
                      id={`photo-upload-${noteDialogOpen}`}
                    />
                    <label
                      htmlFor={`photo-upload-${noteDialogOpen}`}
                      className="btn btn-secondary btn-md"
                      style={{ cursor: 'pointer', display: 'inline-block' }}
                    >
                      Upload Photos
                    </label>
                    {noteDialogContent.photos.length > 0 && (
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {noteDialogContent.photos.map((photo, idx) => (
                          <div key={idx} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px',
                            background: '#333',
                            borderRadius: '4px'
                          }}>
                            <img src={photo.dataUrl} alt={photo.name} style={{
                              width: '60px',
                              height: '60px',
                              objectFit: 'cover',
                              borderRadius: '4px'
                            }} />
                            <span style={{ flex: 1, color: '#ddd', fontSize: '13px' }}>{photo.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteDialogContent(prev => ({
                                  ...prev,
                                  photos: prev.photos.filter((_, i) => i !== idx)
                                }));
                              }}
                              className="btn btn-icon btn-icon-sm"
                              style={{ background: '#444' }}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: '20px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      fontSize: '14px',
                      fontWeight: '500',
                      color: '#ddd'
                    }}>
                      Videos
                    </label>
                    <input
                      type="file"
                      accept="video/*"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const videoPromises = files.map(file => {
                          return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              resolve({ name: file.name, dataUrl: event.target.result });
                            };
                            reader.readAsDataURL(file);
                          });
                        });
                        Promise.all(videoPromises).then(videos => {
                          setNoteDialogContent(prev => ({
                            ...prev,
                            videos: [...prev.videos, ...videos]
                          }));
                        });
                      }}
                      style={{ display: 'none' }}
                      id={`video-upload-${noteDialogOpen}`}
                    />
                    <label
                      htmlFor={`video-upload-${noteDialogOpen}`}
                      className="btn btn-secondary btn-md"
                      style={{ cursor: 'pointer', display: 'inline-block' }}
                    >
                      Upload Videos
                    </label>
                    {noteDialogContent.videos.length > 0 && (
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {noteDialogContent.videos.map((video, idx) => (
                          <div key={idx} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px',
                            background: '#333',
                            borderRadius: '4px'
                          }}>
                            <video src={video.dataUrl} style={{
                              width: '60px',
                              height: '60px',
                              objectFit: 'cover',
                              borderRadius: '4px'
                            }} />
                            <span style={{ flex: 1, color: '#ddd', fontSize: '13px' }}>{video.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteDialogContent(prev => ({
                                  ...prev,
                                  videos: prev.videos.filter((_, i) => i !== idx)
                                }));
                              }}
                              className="btn btn-icon btn-icon-sm"
                              style={{ background: '#444' }}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setNoteDialogOpen(null)}
                      className="btn btn-default btn-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        console.log('=== NOTE SAVE CLICKED ===');
                        console.log('noteDialogOpen:', noteDialogOpen);
                        console.log('noteDialogContent:', noteDialogContent);

                        // For item-level notes, noteDialogOpen is just the highlightId
                        const highlightId = noteDialogOpen;

                        console.log('Saving item-level note for highlightId:', highlightId);
                        console.log('Note text:', noteDialogContent.text);
                        console.log('Photos:', noteDialogContent.photos.length);
                        console.log('Videos:', noteDialogContent.videos.length);

                        // Update highlight annotation with item-level note
                        setHighlightAnnotations(prev => {
                          console.log('Current highlight data:', prev[highlightId]);

                          const existingHighlight = prev[highlightId] || {};

                          const newNote = {
                            text: noteDialogContent.text,
                            photos: noteDialogContent.photos,
                            videos: noteDialogContent.videos
                          };
                          console.log('Saving note:', newNote);

                          const updated = {
                            ...prev,
                            [highlightId]: {
                              ...existingHighlight, // Preserve all existing data
                              note: newNote  // Save note at highlight level
                            }
                          };

                          console.log('Updated highlight with note:', JSON.stringify(updated[highlightId], null, 2));

                          // Save to localStorage immediately
                          if (pdfId) {
                            saveHighlightAnnotations(pdfId, updated);
                            console.log('Saved to localStorage, pdfId:', pdfId);
                          } else {
                            console.warn('Cannot save to localStorage: pdfId is null');
                          }

                          return updated;
                        });

                        console.log('Closing dialog');
                        setNoteDialogOpen(null);
                        setNoteDialogContent({ text: '', photos: [], videos: [] }); // Clear dialog content
                        console.log('=== NOTE SAVE COMPLETE ===');
                      }}
                      className="btn btn-primary btn-md"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </>
          )
        }

        {/* Item Transfer - Destination Selection Modal */}
        {
          transferState && transferState.mode === 'select' && selectedTemplate && (
            <>
              <div
                onClick={() => setTransferState(null)}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 10003,
                  animation: 'fadeIn 0.2s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: '#2b2b2b',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    padding: '24px',
                    width: '500px',
                    maxWidth: '90vw',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    animation: 'fadeIn 0.2s ease-out'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '20px'
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '18px',
                      fontWeight: '600',
                      color: '#fff',
                      fontFamily: FONT_FAMILY
                    }}>
                      Copy Items to Which Space?
                    </h3>
                    <button
                      onClick={() => setTransferState(null)}
                      className="btn btn-icon btn-icon-sm"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#999'
                      }}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  <p style={{ color: '#999', fontSize: '14px', marginBottom: '20px' }}>
                    Copy {transferState.items.length} item{transferState.items.length !== 1 ? 's' : ''} to:
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {((selectedTemplate.modules || selectedTemplate.spaces) || [])
                      .filter(module => module.id !== transferState.sourceModuleId)
                      .map(module => (
                        <button
                          key={module.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();

                            // Find corresponding items for each selected highlight
                            // First check if highlights exist and find their corresponding items via annotations
                            const itemIdsToCopy = [];
                            const legacyHighlightsToCopy = [];

                            console.log('Copying items:', transferState.items);
                            console.log('Source module:', transferState.sourceModuleId);
                            console.log('Destination module:', module.id);

                            transferState.items.forEach(highlightId => {
                              const highlight = highlightAnnotations[highlightId];
                              console.log('Processing highlight:', highlightId, highlight);

                              if (!highlight) {
                                // Not a highlight, might be an itemId directly
                                if (items[highlightId]) {
                                  console.log('Found direct itemId:', highlightId);
                                  itemIdsToCopy.push(highlightId);
                                }
                                return;
                              }

                              // Try to find corresponding item by matching name and category (same logic as migration)
                              const categoryName = getCategoryName(selectedTemplate, highlight.spaceId, highlight.categoryId);
                              console.log('Category name:', categoryName, 'Highlight name:', highlight.name);

                              // Find items that match name and category
                              const matchingItem = Object.values(items).find(item =>
                                item.name === highlight.name &&
                                item.itemType === categoryName
                              );

                              console.log('Matching item:', matchingItem);

                              // Verify the item has an annotation in the same space
                              if (matchingItem) {
                                // Try to find annotation - don't require displayType to be 'highlight'
                                const matchingAnnotation = Object.values(annotations).find(ann =>
                                  ann.itemId === matchingItem.itemId &&
                                  ann.spaceId === highlight.spaceId
                                );

                                console.log('Matching annotation:', matchingAnnotation);
                                console.log('All annotations for item:', Object.values(annotations).filter(a => a.itemId === matchingItem.itemId));

                                if (matchingAnnotation && matchingItem.itemId) {
                                  // Found corresponding item in new system
                                  // Avoid duplicates
                                  if (!itemIdsToCopy.includes(matchingItem.itemId)) {
                                    console.log('Adding itemId to copy:', matchingItem.itemId);
                                    itemIdsToCopy.push(matchingItem.itemId);
                                  }
                                } else {
                                  // No annotation found, but item exists - still copy it
                                  // The item might not have an annotation yet, but we can still copy it
                                  console.log('No matching annotation, but item exists - copying anyway');
                                  if (!itemIdsToCopy.includes(matchingItem.itemId)) {
                                    itemIdsToCopy.push(matchingItem.itemId);
                                  }
                                }
                              } else {
                                // Legacy highlight, no corresponding item found
                                console.log('No matching item, treating as legacy highlight');
                                legacyHighlightsToCopy.push(highlight);
                              }
                            });

                            console.log('Items to copy:', itemIdsToCopy);
                            console.log('Legacy highlights to copy:', legacyHighlightsToCopy);

                            // Handle new system items
                            if (itemIdsToCopy.length > 0) {
                              const itemsToCheck = itemIdsToCopy.map(itemId => items[itemId]).filter(Boolean);
                              const itemTypes = [...new Set(itemsToCheck.map(item => item.itemType))];

                              const missingCategories = itemTypes.filter(itemType =>
                                !categoryExists(selectedTemplate, module.id, itemType)
                              );

                              if (missingCategories.length > 0) {
                                // Need to create categories - go to checklist prompt
                                setTransferState({
                                  ...transferState,
                                  mode: 'checklist',
                                  destModuleId: module.id,
                                  items: itemIdsToCopy
                                });
                              } else {
                                // Direct transfer
                                const result = transferItems(
                                  itemIdsToCopy,
                                  transferState.sourceModuleId,
                                  module.id,
                                  selectedTemplate,
                                  items,
                                  annotations
                                );

                                setItems(result.newItems);
                                setAnnotations(result.updatedAnnotations);

                                // Create highlight entries for UI display
                                console.log('Creating highlight entries for', itemIdsToCopy.length, 'items');
                                const newHighlights = {};
                                itemIdsToCopy.forEach(itemId => {
                                  const item = result.newItems[itemId];
                                  console.log('Processing item for highlight creation:', itemId, item);
                                  if (!item) {
                                    console.log('Item not found in result.newItems');
                                    return;
                                  }

                                  // Find the annotation we just created for this item in destination module
                                  const destAnnotation = Object.values(result.updatedAnnotations).find(ann => {
                                    const annModuleId = ann.moduleId || ann.spaceId; // Support legacy spaceId
                                    return ann.itemId === itemId && annModuleId === module.id;
                                  });

                                  console.log('Destination annotation:', destAnnotation);

                                  // Find source annotation to get coordinates
                                  const sourceAnnotation = Object.values(annotations).find(a => {
                                    const aModuleId = a.moduleId || a.spaceId; // Support legacy spaceId
                                    return a.itemId === itemId && aModuleId === transferState.sourceModuleId;
                                  });
                                  console.log('Source annotation:', sourceAnnotation);

                                  // Find source highlight by matching coordinates or by finding the highlight we selected
                                  let sourceHighlight = null;
                                  if (sourceAnnotation && sourceAnnotation.pdfCoordinates) {
                                    sourceHighlight = Object.values(highlightAnnotations).find(h => {
                                      const hModuleId = h.moduleId || h.spaceId; // Support legacy spaceId
                                      return hModuleId === transferState.sourceModuleId &&
                                        h.bounds &&
                                        Math.abs((h.bounds.x || 0) - (sourceAnnotation.pdfCoordinates.x || 0)) < 1 &&
                                        Math.abs((h.bounds.y || 0) - (sourceAnnotation.pdfCoordinates.y || 0)) < 1;
                                    });
                                  }

                                  // Also try to find by matching the highlight ID from transferState.items
                                  if (!sourceHighlight && transferState.items.length > 0) {
                                    const highlightId = transferState.items.find(id => {
                                      const h = highlightAnnotations[id];
                                      const hModuleId = h?.moduleId || h?.spaceId; // Support legacy spaceId
                                      return h && hModuleId === transferState.sourceModuleId;
                                    });
                                    if (highlightId) {
                                      sourceHighlight = highlightAnnotations[highlightId];
                                    }
                                  }

                                  console.log('Source highlight:', sourceHighlight);

                                  // Find destination category ID
                                  const destModule = ((selectedTemplate.modules || selectedTemplate.spaces) || []).find(m => m.id === module.id);
                                  const destCategory = destModule?.categories?.find(c => c.name === item.itemType);
                                  console.log('Destination category:', destCategory);

                                  // Use destination annotation coordinates, or source annotation coordinates, or source highlight bounds
                                  // Convert pdfCoordinates format to bounds format (they should be the same structure)
                                  let bounds = null;
                                  if (destAnnotation?.pdfCoordinates) {
                                    bounds = destAnnotation.pdfCoordinates;
                                  } else if (sourceAnnotation?.pdfCoordinates) {
                                    bounds = sourceAnnotation.pdfCoordinates;
                                  } else if (sourceHighlight?.bounds) {
                                    bounds = sourceHighlight.bounds;
                                  }

                                  console.log('Bounds for highlight:', bounds);

                                  if (bounds) {
                                    const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                    newHighlights[highlightId] = {
                                      id: highlightId,
                                      pageNumber: sourceHighlight?.pageNumber || 1,
                                      bounds: bounds,
                                      spaceId: space.id,
                                      categoryId: destCategory?.id || null,
                                      name: item.name || sourceHighlight?.name || 'Untitled Item',
                                      checklistResponses: {}
                                    };
                                    console.log('Created highlight:', newHighlights[highlightId]);
                                  } else {
                                    console.log('No bounds available, skipping highlight creation');
                                  }
                                });

                                // Add new highlights to highlightAnnotations
                                if (Object.keys(newHighlights).length > 0) {
                                  setHighlightAnnotations(prev => ({
                                    ...prev,
                                    ...newHighlights
                                  }));
                                }

                                setTransferState(null);
                              }
                            }

                            // Handle legacy highlights (if any)
                            if (legacyHighlightsToCopy.length > 0) {
                              console.log('Copying legacy highlights:', legacyHighlightsToCopy);
                              console.log('To module:', module.id, module.name);

                              // Find matching category in destination module
                              const allModules = (selectedTemplate.modules || selectedTemplate.spaces) || [];
                              const sourceModule = allModules.find(m => m.id === transferState.sourceModuleId);
                              const sourceCategory = sourceModule?.categories?.find(c => c.id === transferState.categoryId);

                              const destCategory = module.categories?.find(
                                c => c.name === sourceCategory?.name
                              );

                              console.log('Source category:', sourceCategory);
                              console.log('Dest category:', destCategory);

                              // Create new highlights in destination module with same data
                              const newHighlights = {};
                              legacyHighlightsToCopy.forEach(h => {
                                const newId = generateUUID();
                                newHighlights[newId] = {
                                  ...h,
                                  id: newId,
                                  moduleId: module.id,
                                  categoryId: destCategory?.id || null
                                };
                              });

                              console.log('New highlights to add:', newHighlights);

                              // Update highlightAnnotations state
                              setHighlightAnnotations(prev => ({
                                ...prev,
                                ...newHighlights
                              }));

                              // Only close modal if we're done with all items
                              if (itemIdsToCopy.length === 0) {
                                setTransferState(null);
                              }
                            }

                            // If no items found at all, log warning
                            if (itemIdsToCopy.length === 0 && legacyHighlightsToCopy.length === 0) {
                              console.warn('No items found to copy. Selected IDs:', transferState.items);
                              setTransferState(null);
                            }
                          }}
                          className="btn btn-default btn-md"
                          style={{
                            textAlign: 'left',
                            justifyContent: 'flex-start',
                            padding: '12px 16px',
                            background: '#333',
                            border: '1px solid #444'
                          }}
                        >
                          <div style={{ fontWeight: '500', color: '#fff' }}>
                            {module.name || 'Untitled Module'}
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </>
          )
        }

        {/* Item Transfer - Checklist Prompt Modal */}
        {
          transferState && transferState.mode === 'checklist' && selectedTemplate && (
            <>
              <div
                onClick={() => setTransferState(null)}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0, 0, 0, 0.5)',
                  zIndex: 10004,
                  animation: 'fadeIn 0.2s ease-out',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: '#2b2b2b',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    padding: '24px',
                    width: '500px',
                    maxWidth: '90vw',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                    animation: 'fadeIn 0.2s ease-out'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '20px'
                  }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '18px',
                      fontWeight: '600',
                      color: '#fff',
                      fontFamily: FONT_FAMILY
                    }}>
                      Missing Categories Detected
                    </h3>
                    <button
                      onClick={() => setTransferState(null)}
                      className="btn btn-icon btn-icon-sm"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#999'
                      }}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>

                  <p style={{ color: '#999', fontSize: '14px', marginBottom: '20px' }}>
                    The following categories need to be created in the destination space:
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                    {(() => {
                      const itemsToCheck = transferState.items.map(itemId => items[itemId]);
                      const itemTypes = [...new Set(itemsToCheck.map(item => item.itemType))];
                      const missingCategories = itemTypes.filter(itemType =>
                        !categoryExists(selectedTemplate, transferState.destSpaceId, itemType)
                      );

                      return missingCategories.map(itemType => (
                        <div key={itemType} style={{
                          padding: '12px',
                          background: '#333',
                          border: '1px solid #444',
                          borderRadius: '4px',
                          color: '#fff',
                          fontWeight: '500'
                        }}>
                          {itemType}
                        </div>
                      ));
                    })()}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        // Transfer as-is - clone checklists
                        const result = transferItems(
                          transferState.items,
                          transferState.sourceSpaceId,
                          transferState.destSpaceId,
                          selectedTemplate,
                          items,
                          annotations
                        );

                        // TODO: Actually create categories in template with cloned checklists
                        // For now, just complete the transfer
                        setItems(result.newItems);
                        setAnnotations(result.updatedAnnotations);

                        // Create highlight entries for UI display (same logic as direct transfer)
                        const newHighlights = {};
                        transferState.items.forEach(itemId => {
                          const item = result.newItems[itemId];
                          if (!item) return;

                          const destAnnotation = Object.values(result.updatedAnnotations).find(ann =>
                            ann.itemId === itemId && ann.spaceId === transferState.destSpaceId
                          );

                          if (destAnnotation && destAnnotation.pdfCoordinates) {
                            const sourceAnnotation = Object.values(annotations).find(a =>
                              a.itemId === itemId && a.spaceId === transferState.sourceSpaceId
                            );

                            const sourceHighlight = sourceAnnotation ? Object.values(highlightAnnotations).find(h =>
                              h.spaceId === transferState.sourceSpaceId &&
                              h.bounds &&
                              sourceAnnotation.pdfCoordinates &&
                              Math.abs((h.bounds.x || 0) - (sourceAnnotation.pdfCoordinates.x || 0)) < 1 &&
                              Math.abs((h.bounds.y || 0) - (sourceAnnotation.pdfCoordinates.y || 0)) < 1
                            ) : null;

                            const destModule = ((selectedTemplate.modules || selectedTemplate.spaces) || []).find(m => m.id === transferState.destModuleId);
                            const destCategory = destModule?.categories?.find(c => c.name === item.itemType);

                            const highlightId = `highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                            newHighlights[highlightId] = {
                              id: highlightId,
                              pageNumber: sourceHighlight?.pageNumber || 1,
                              bounds: destAnnotation.pdfCoordinates,
                              moduleId: transferState.destModuleId,
                              categoryId: destCategory?.id || null,
                              name: item.name || sourceHighlight?.name || 'Untitled Item',
                              checklistResponses: {}
                            };
                          }
                        });

                        if (Object.keys(newHighlights).length > 0) {
                          setHighlightAnnotations(prev => ({
                            ...prev,
                            ...newHighlights
                          }));
                        }

                        setTransferState(null);
                      }}
                      className="btn btn-primary btn-md"
                      style={{ flex: 1 }}
                    >
                      Copy As-Is
                    </button>
                    <button
                      onClick={() => setTransferState(null)}
                      className="btn btn-default btn-md"
                      style={{ flex: 1 }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </>
          )
        }

        {/* Locate Modal */}
        {showLocateModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)'
            }}
            onClick={() => setShowLocateModal(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#2b2b2b',
                border: '1px solid #444',
                borderRadius: '8px',
                padding: '24px',
                width: '600px',
                maxWidth: '90vw',
                maxHeight: '80vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                animation: 'fadeIn 0.2s ease-out'
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#fff',
                  fontFamily: FONT_FAMILY
                }}>
                  Locate Item
                </h2>
                <button
                  onClick={() => setShowLocateModal(false)}
                  className="btn btn-icon btn-icon-sm"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#999'
                  }}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  value={locateSearchQuery}
                  onChange={(e) => setLocateSearchQuery(e.target.value)}
                  placeholder="Search items by name, category, or notes..."
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: '#1b1b1b',
                    border: '1px solid #444',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '14px',
                    fontFamily: FONT_FAMILY,
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                minHeight: '200px'
              }}>
                {(() => {
                  const query = locateSearchQuery.toLowerCase().trim();
                  if (!query) {
                    return (
                      <div style={{
                        textAlign: 'center',
                        color: '#666',
                        marginTop: '40px'
                      }}>
                        Start typing to search...
                      </div>
                    );
                  }

                  const matches = [];
                  Object.values(highlightAnnotations).forEach(highlight => {
                    const name = highlight.name || '';
                    const note = highlight.note?.text || '';

                    // Resolve category and module names
                    let categoryName = '';
                    let moduleName = '';

                    if (selectedTemplate) {
                      const moduleId = highlight.moduleId || highlight.spaceId;
                      const module = (selectedTemplate.modules || selectedTemplate.spaces || []).find(m => m.id === moduleId);
                      if (module) {
                        moduleName = module.name;
                        const category = module.categories?.find(c => c.id === highlight.categoryId);
                        if (category) {
                          categoryName = category.name;
                        }
                      }
                    }

                    if (
                      name.toLowerCase().includes(query) ||
                      note.toLowerCase().includes(query) ||
                      categoryName.toLowerCase().includes(query)
                    ) {
                      matches.push({
                        ...highlight,
                        categoryName,
                        moduleName
                      });
                    }
                  });

                  if (matches.length === 0) {
                    return (
                      <div style={{
                        textAlign: 'center',
                        color: '#666',
                        marginTop: '40px'
                      }}>
                        No items found.
                      </div>
                    );
                  }

                  return matches.map(highlight => (
                    <button
                      key={highlight.id}
                      onClick={() => {
                        // Navigation Logic
                        const moduleId = highlight.moduleId || highlight.spaceId;

                        // 1. Switch to module
                        setSelectedModuleId(moduleId);

                        // 2. Expand category
                        setExpandedCategories(prev => ({
                          ...prev,
                          [highlight.categoryId]: true
                        }));

                        // 3. Ensure Survey Panel is open
                        setShowSurveyPanel(true);
                        setIsSurveyPanelCollapsed(false);

                        // 4. Close modal
                        setShowLocateModal(false);

                        // 5. Scroll to item
                        setTimeout(() => {
                          const element = document.getElementById(`highlight-item-${highlight.id}`);
                          if (element) {
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Flash effect
                            element.style.transition = 'box-shadow 0.5s';
                            element.style.boxShadow = '0 0 0 2px #4A90E2';
                            setTimeout(() => {
                              element.style.boxShadow = 'none';
                            }, 2000);
                          }
                        }, 300);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        padding: '12px',
                        background: '#333',
                        border: '1px solid #444',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#3a3a3a';
                        e.currentTarget.style.borderColor = '#555';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = '#333';
                        e.currentTarget.style.borderColor = '#444';
                      }}
                    >
                      <div style={{
                        fontWeight: '600',
                        color: '#fff',
                        marginBottom: '4px'
                      }}>
                        {highlight.name || 'Untitled Item'}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: '#999',
                        display: 'flex',
                        gap: '8px'
                      }}>
                        <span>{highlight.moduleName}</span>
                        <span>•</span>
                        <span>{highlight.categoryName}</span>
                      </div>
                      {highlight.note?.text && (
                        <div style={{
                          fontSize: '12px',
                          color: '#777',
                          marginTop: '4px',
                          fontStyle: 'italic',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%'
                        }}>
                          "{highlight.note.text}"
                        </div>
                      )}
                    </button>
                  ));
                })()}
              </div>
            </div>
          </div>
        )
        }
      </div >

      {/* Export Location Choice Modal */}
      {showExportLocationModal && exportPendingData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            background: '#2a2a2a',
            borderRadius: '12px',
            padding: '32px',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <h2 style={{ color: '#fff', marginBottom: '16px', fontSize: '24px' }}>
              Choose Export Location
            </h2>
            <p style={{ color: '#ccc', marginBottom: '32px', lineHeight: '1.6' }}>
              Where would you like to save your Excel file?
            </p>
            <div style={{ display: 'flex', gap: '16px', flexDirection: 'column' }}>
              <button
                onClick={async () => {
                  setShowExportLocationModal(false);
                  // Export to computer (local file)
                  try {
                    const defaultName = `${exportPendingData.fileName}_export.xlsx`;
                    const result = await window.electronAPI.saveFile({
                      title: 'Save Survey Export',
                      defaultPath: defaultName,
                      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
                      data: exportPendingData.buffer
                    });

                    if (result && !result.canceled && result.filePath) {
                      const updatedTemplate = {
                        ...selectedTemplate,
                        linkedExcelPath: result.filePath,
                        lastSyncTime: new Date().toISOString()
                      };
                      setSelectedTemplate(updatedTemplate);
                      alert('Export to computer successful!');
                    }
                  } catch (error) {
                    console.error('Failed to export to computer:', error);
                    alert('Failed to export to computer.');
                  }
                  setExportPendingData(null);
                }}
                style={{
                  padding: '16px 24px',
                  background: '#3498db',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#2980b9'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#3498db'}
              >
                💻 Save to Computer
              </button>
              <button
                onClick={async () => {
                  setShowExportLocationModal(false);
                  // Check if authenticated
                  if (!isMSAuthenticated) {
                    setShowMSLoginModal(true);
                    return;
                  }

                  // Export to OneDrive
                  try {
                    const fileName = `${exportPendingData.fileName}_export.xlsx`;
                    const filePath = `/Documents/${fileName}`;

                    await uploadExcelFile(graphClient, filePath, exportPendingData.buffer);

                    const updatedTemplate = {
                      ...selectedTemplate,
                      linkedExcelPath: filePath,
                      isOneDrive: true,
                      lastSyncTime: new Date().toISOString()
                    };
                    setSelectedTemplate(updatedTemplate);
                    alert('Export to OneDrive successful!');
                  } catch (error) {
                    console.error('Failed to export to OneDrive:', error);
                    alert(`Failed to export to OneDrive: ${error.message}`);
                  }
                  setExportPendingData(null);
                }}
                style={{
                  padding: '16px 24px',
                  background: '#0078d4',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#106ebe'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#0078d4'}
              >
                ☁️ Save to OneDrive
              </button>
              <button
                onClick={() => {
                  setShowExportLocationModal(false);
                  setExportPendingData(null);
                }}
                style={{
                  padding: '12px 24px',
                  background: 'transparent',
                  border: '1px solid #666',
                  borderRadius: '8px',
                  color: '#ccc',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = '#999'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#666'}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Microsoft Login Modal */}
      {showMSLoginModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            background: '#2a2a2a',
            borderRadius: '12px',
            padding: '32px',
            maxWidth: '450px',
            width: '90%',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <h2 style={{ color: '#fff', marginBottom: '16px', fontSize: '24px' }}>
              Microsoft Account Required
            </h2>
            <p style={{ color: '#ccc', marginBottom: '24px', lineHeight: '1.6' }}>
              To sync with Excel files in OneDrive or Microsoft Teams, you need to connect your Microsoft account.
            </p>
            {isMSAuthenticated ? (
              <div>
                <div style={{
                  background: '#1e1e1e',
                  padding: '16px',
                  borderRadius: '8px',
                  marginBottom: '24px'
                }}>
                  <p style={{ color: '#27ae60', marginBottom: '8px', fontSize: '14px' }}>
                    ✓ Connected as
                  </p>
                  <p style={{ color: '#fff', fontWeight: 600 }}>
                    {msAccount?.name || msAccount?.username}
                  </p>
                </div>
                <button
                  onClick={() => setShowMSLoginModal(false)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: '#27ae60',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Continue
                </button>
              </div>
            ) : (
              <div>
                <button
                  onClick={async () => {
                    if (!features?.sso) {
                      alert('OneDrive integration is an Enterprise feature. Please upgrade.');
                      return;
                    }
                    try {
                      await msLogin();
                      // Modal will stay open to show connected status
                    } catch (error) {
                      console.error('Login failed:', error);
                      alert('Failed to sign in with Microsoft.');
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '16px',
                    background: '#0078d4',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginBottom: '12px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#106ebe'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#0078d4'}
                >
                  Connect Microsoft Account
                </button>
                <button
                  onClick={() => setShowMSLoginModal(false)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: 'transparent',
                    border: '1px solid #666',
                    borderRadius: '8px',
                    color: '#ccc',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Main App Component
export default function App() {
  // Microsoft Graph authentication hook
  const { graphClient, isAuthenticated: isMSAuthenticated, login: msLogin, account: msAccount } = useMSGraph();

  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedPDF, setSelectedPDF] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const dashboardRef = useRef(null);

  // Tab management state
  const HOME_TAB_ID = 'home-tab';
  const [tabs, setTabs] = useState([{ id: HOME_TAB_ID, name: 'Home', file: null, isHome: true }]); // Array of { id, name, file, isHome? }
  const [activeTabId, setActiveTabId] = useState(HOME_TAB_ID);

  // Template management state
  const [appTemplates, setAppTemplates] = useState([]);

  const handleTemplatesChange = useCallback((nextTemplates) => {
    const normalized = Array.isArray(nextTemplates) ? nextTemplates : [];
    setAppTemplates(normalized);
  }, []);

  const [ballInCourtEntities, setBallInCourtEntities] = useState([
    { id: `entity-${Date.now()}-1`, name: 'GC', color: '#E3D1FB' },
    { id: `entity-${Date.now()}-2`, name: 'Subcontractor', color: '#FFF5C3' },
    { id: `entity-${Date.now()}-3`, name: 'My Company', color: '#CBDCFF' },
    { id: `entity-${Date.now()}-4`, name: '100% Complete', color: '#B2FFB2' },
    { id: `entity-${Date.now()}-5`, name: 'Removed', color: '#BBBBBB' }
  ].map(entity => ({
    ...entity,
    color: hexToRgba(entity.color, 0.2)
  })));

  // Authentication state
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { showAuthModal, setShowAuthModal, handleDismiss, authPromptDismissed } = useOptionalAuth();

  // Clean up any old localStorage data that might be causing issues
  useEffect(() => {
    // Remove old document data to prevent quota issues
    localStorage.removeItem('pdfDocuments');
  }, []);

  // Clear preferences and settings for non-authenticated users on app load
  // Non-authenticated users should not have their preferences persisted
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      // Clear user preferences and settings
      localStorage.removeItem('dashboardViewMode');
      localStorage.removeItem('projects');
      localStorage.removeItem('templates');
      localStorage.removeItem('pdfViewerZoomPreference');
      // Note: We keep PDF-specific data (pdfData_*, highlightAnnotations_*, pdfSidebar_*) 
      // as they're needed for the current session, but they won't persist across sessions
      // for non-authenticated users since they're tied to specific PDF files
    }
  }, [authLoading, isAuthenticated]);

  // Generate unique tab ID
  const generateTabId = () => `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleDocumentSelect = (file, filePath = null) => {
    // console.log('handleDocumentSelect called with file:', file, 'filePath:', filePath);
    if (!file) {
      console.error('No file provided to handleDocumentSelect');
      return;
    }

    // Check if this file is already open in a tab (excluding home tab)
    const existingTab = tabs.find(tab => {
      // Compare by name and size for uniqueness, and make sure it's not the home tab
      // Also check path if available for more robust matching
      if (tab.isHome || !tab.file) return false;

      const sameName = tab.file.name === file.name;
      const sameSize = tab.file.size === file.size;
      const samePath = tab.filePath && filePath ? tab.filePath === filePath : true;

      return sameName && sameSize && samePath;
    });

    if (existingTab) {
      console.log('Switching to existing tab:', existingTab.id);
      // Switch to existing tab
      setActiveTabId(existingTab.id);
      if (selectedPDF !== existingTab.file) {
        setSelectedPDF(existingTab.file);
      }
      setCurrentView('viewer');
      return;
    }

    // Create new tab
    const newTab = {
      id: generateTabId(),
      name: file.name,
      file: file,
      filePath: filePath, // Store file path in tab
      isHome: false,
      viewState: null // Initialize view state
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setSelectedPDF(file);
    setCurrentView('viewer');
    setIsLoading(true);
    // Reset loading after a short delay
    setTimeout(() => setIsLoading(false), 100);
  };

  const handleTabClick = (tabId) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      // Exit selection mode when switching tabs
      if (dashboardRef.current?.exitSelectionMode) {
        dashboardRef.current.exitSelectionMode();
      }
      
      setActiveTabId(tabId);
      if (tab.isHome) {
        // Home tab - show dashboard
        // setSelectedPDF(null); // Keep selectedPDF to prevent unmounting
        setCurrentView('dashboard');
      } else {
        // PDF tab - show viewer
        setSelectedPDF(tab.file);
        setCurrentView('viewer');
      }
    }
  };

  const handleViewStateChange = useCallback((viewState) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id === activeTabId) {
        return { ...tab, viewState };
      }
      return tab;
    }));
  }, [activeTabId]);

  // Memoized callback to track unsaved annotations - uses selectedPDF to find the correct tab
  const handleUnsavedAnnotationsChange = useCallback((hasUnsaved) => {
    setTabs(prev => {
      const pdfTab = prev.find(t => t.file === selectedPDF && !t.isHome);
      if (!pdfTab) return prev;
      return prev.map(tab =>
        tab.id === pdfTab.id ? { ...tab, hasUnsavedAnnotations: hasUnsaved } : tab
      );
    });
  }, [selectedPDF]);

  // Memoized callback to update PDF file
  const handleUpdatePDFFile = useCallback((newFile) => {
    setTabs(prev => {
      const pdfTab = prev.find(t => t.file === selectedPDF && !t.isHome);
      if (!pdfTab) return prev;
      return prev.map(tab =>
        tab.id === pdfTab.id ? { ...tab, file: newFile } : tab
      );
    });
    setSelectedPDF(newFile);
  }, [selectedPDF]);

  const handleTabClose = (tabId) => {
    // Prevent closing the home tab
    if (tabId === HOME_TAB_ID) return;

    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    // If closing the active tab, switch to another tab or go back to home
    if (tabId === activeTabId) {
      if (newTabs.length > 1) { // More than just home tab
        // Switch to the tab that was at the same position, or the last tab (excluding home)
        const pdfTabs = newTabs.filter(t => !t.isHome);
        if (pdfTabs.length > 0) {
          const newActiveIndex = Math.min(tabIndex - 1, pdfTabs.length - 1);
          const newActiveTab = pdfTabs[newActiveIndex >= 0 ? newActiveIndex : 0];
          setActiveTabId(newActiveTab.id);
          setSelectedPDF(newActiveTab.file);
          setCurrentView('viewer');
        } else {
          // Only home tab left
          setActiveTabId(HOME_TAB_ID);
          setSelectedPDF(null);
          setCurrentView('dashboard');
        }
      } else {
        // Only home tab left
        setActiveTabId(HOME_TAB_ID);
        setSelectedPDF(null);
        setCurrentView('dashboard');
      }
    }
  };

  const handleTabReorder = (reorderedTabs) => {
    // Ensure home tab is always first
    const homeTab = reorderedTabs.find(t => t.isHome);
    const otherTabs = reorderedTabs.filter(t => !t.isHome);
    if (homeTab) {
      setTabs([homeTab, ...otherTabs]);
    } else {
      setTabs(reorderedTabs);
    }
  };

  const handlePageDrop = (sourceTabId, pageNumber, targetTabId) => {
    // This is a placeholder - actual PDF page copying would require PDF manipulation
    // For now, we'll just show a message or implement basic structure
    console.log(`Page ${pageNumber} from tab ${sourceTabId} dropped on tab ${targetTabId}`);

    // TODO: Implement actual page copying using PDF.js or a PDF manipulation library
    // This would involve:
    // 1. Getting the page from source PDF
    // 2. Creating a new PDF or modifying target PDF
    // 3. Adding the page to target PDF
    // 4. Updating the target tab's file

    alert(`Page ${pageNumber} drag-and-drop functionality is being implemented. This feature requires PDF manipulation capabilities.`);
  };

  const handleBack = () => {
    // Switch to home tab instead of closing all tabs
    setActiveTabId(HOME_TAB_ID);
    // setSelectedPDF(null); // Keep selectedPDF to prevent unmounting
    setCurrentView('dashboard');
  };

  const handleCreateTemplateRequest = (options) => {
    if (options?.mode === 'edit' && options.templateId) {
      dashboardRef.current?.openEditTemplateModal?.(options.templateId, {
        moduleId: options.moduleId,
        startAddingCategory: options.startAddingCategory
      });
    } else {
      dashboardRef.current?.openTemplateModal?.();
    }
  };

  if (isLoading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F5F5',
        fontFamily: FONT_FAMILY
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
            <Icon name="document" size={24} />
          </div>
          <div style={{ fontSize: '16px', color: '#666' }}>Loading document...</div>
        </div>
      </div>
    );
  }

  // Determine what to render based on active tab
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isViewerVisible = activeTab && !activeTab.isHome && selectedPDF && currentView === 'viewer';

  // Find the tab associated with the selected PDF to pass the correct tabId
  // This ensures that even if we are on Home tab, the PDFViewer still gets the correct tabId prop
  const pdfTab = tabs.find(t => t.file === selectedPDF && !t.isHome);
  const viewerTabId = pdfTab ? pdfTab.id : activeTabId;
  const viewerViewState = pdfTab ? pdfTab.viewState : null;

  return (
    <>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        {tabs.length > 0 && ( // Show tab bar if there are any tabs (including home)
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            onTabReorder={handleTabReorder}
            onPageDrop={handlePageDrop}
          />
        )}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <Dashboard
            ref={dashboardRef}
            onDocumentSelect={handleDocumentSelect}
            onBack={handleBack}
            documents={documents}
            setDocuments={setDocuments}
            templates={appTemplates}
            onTemplatesChange={handleTemplatesChange}
            onShowAuthModal={() => setShowAuthModal(true)}
            ballInCourtEntities={ballInCourtEntities}
            setBallInCourtEntities={setBallInCourtEntities}
          />
          {selectedPDF && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: '#1f1f1f',
              zIndex: 5000,
              display: isViewerVisible ? 'block' : 'none'
            }}>
              <PDFViewer
                pdfFile={selectedPDF}
                pdfFilePath={pdfTab?.filePath}
                onBack={handleBack}
                tabId={viewerTabId}
                onPageDrop={handlePageDrop}
                onUpdatePDFFile={handleUpdatePDFFile}
                onUnsavedAnnotationsChange={handleUnsavedAnnotationsChange}
                onRequestCreateTemplate={handleCreateTemplateRequest}
                initialViewState={viewerViewState}
                onViewStateChange={handleViewStateChange}
                templates={appTemplates}
                onTemplatesChange={handleTemplatesChange}
                user={user}
                isMSAuthenticated={isMSAuthenticated}
                msLogin={msLogin}
                graphClient={graphClient}
                msAccount={msAccount}
                ballInCourtEntities={ballInCourtEntities}
                setBallInCourtEntities={setBallInCourtEntities}
              />
            </div>
          )}
        </div>
      </div>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onDismiss={!authPromptDismissed ? handleDismiss : null}
      />
    </>
  );
}