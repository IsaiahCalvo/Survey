import { fabric } from 'fabric';

/**
 * Renders a pill-shaped control (rounded rectangle)
 */
const renderPillControl = (ctx, left, top, styleOverride, fabricObject) => {
    const size = styleOverride.cornerSize || 24;
    const width = size * 1.5; // Wider than tall
    const height = size / 2.5; // Thinner height
    const x = left - width / 2;
    const y = top - height / 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d1d1d1'; // Subtle border/shadow
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent'; // clear shadow for stroke
    ctx.stroke();
    ctx.restore();
};

/**
 * Renders a vertical pill-shaped control (for left/right handles)
 */
const renderVerticalPillControl = (ctx, left, top, styleOverride, fabricObject) => {
    const size = styleOverride.cornerSize || 24;
    const width = size / 2.5; // Thinner width
    const height = size * 1.5; // Taller than wide
    const x = left - width / 2;
    const y = top - height / 2;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, width / 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#d1d1d1';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();
    ctx.restore();
};


/**
 * Renders a circular rotation control with icon
 */
const renderRotationControl = (ctx, left, top, styleOverride, fabricObject) => {
    const size = 24;
    const x = left;
    const y = top;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.stroke();

    // Draw rotation icon (simple circular arrow)
    ctx.beginPath();
    ctx.strokeStyle = '#5c5c5c'; // Dark grey icon
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw arrow arc
    const r = size * 0.25;
    ctx.arc(x, y, r, 0, Math.PI * 1.5);
    ctx.stroke();

    // Draw arrow head
    ctx.beginPath();
    // End point of arc is at (x + r * cos(1.5PI), y + r * sin(1.5PI)) => (x, y-r)
    const arrowX = x;
    const arrowY = y - r;
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX + 3, arrowY - 1);
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(arrowX + 1, arrowY + 3);
    ctx.stroke();

    ctx.restore();
};

export const configureFabricOverrides = () => {
    if (!fabric) return;

    // -- 1. Global Object Styling --
    fabric.Object.prototype.set({
        transparentCorners: false,
        cornerColor: '#ffffff',
        cornerStrokeColor: '#d1d1d1', // Subtle grey border around white corners
        borderColor: '#4a90e2',      // Drawboard blue
        cornerStyle: 'circle',
        borderDashArray: [4, 4],     // Dashed selection
        padding: 6,
        borderScaleFactor: 2,         // Thicker border for better visibility
        cornerSize: 12,               // Slightly larger handles
    });

    // -- 2. Custom Controls --

    // We need to define positioning handlers/functions for the new controls
    // or just reuse standard ones but with custom 'render'

    // Copy existing controls to access standard handlers
    const standardControls = fabric.Object.prototype.controls;

    // Helper to apply common pill styling
    const pillStyle = {
        cornerSize: 24, // Visual size for renderer
        sizeX: 40,      // Hit area
        sizeY: 20,
        touchAction: 'none'
    };

    // Top (mt) and Bottom (mb) - Horizontal Pills
    if (standardControls.mt) {
        standardControls.mt.render = renderPillControl;
        standardControls.mt.cornerSize = 24;
    }
    if (standardControls.mb) {
        standardControls.mb.render = renderPillControl;
        standardControls.mb.cornerSize = 24;
    }

    // Left (ml) and Right (mr) - Vertical Pills
    if (standardControls.ml) {
        standardControls.ml.render = renderVerticalPillControl;
        standardControls.ml.cornerSize = 24;
    }
    if (standardControls.mr) {
        standardControls.mr.render = renderVerticalPillControl;
        standardControls.mr.cornerSize = 24;
    }

    // Corners (tl, tr, bl, br) - Circular with shadow (default renderCircle is close, but we ideally want shadow)
    // We can override render to add shadow if we want perfect "Drawboard" look
    const renderCornerWithShadow = (ctx, left, top, styleOverride, fabricObject) => {
        const size = styleOverride.cornerSize || 12;
        ctx.save();
        ctx.beginPath();
        ctx.arc(left, top, size / 2, 0, 2 * Math.PI, false);
        ctx.fillStyle = styleOverride.cornerColor || '#ffffff';
        ctx.strokeStyle = styleOverride.cornerStrokeColor || '#d1d1d1';
        ctx.lineWidth = 1;
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    };

    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
        if (standardControls[pos]) {
            standardControls[pos].render = renderCornerWithShadow;
            standardControls[pos].cornerSize = 14; // Slightly bigger tap target
        }
    });

    // Rotation (mtr) - Custom icon, positioned at Bottom Center
    if (standardControls.mtr) {
        standardControls.mtr.x = 0;       // Center X
        standardControls.mtr.y = 0.5;     // Bottom Y relative to object center (0.5 = bottom edge)
        standardControls.mtr.offsetY = 30; // 30px below the bottom edge
        standardControls.mtr.render = renderRotationControl;
        standardControls.mtr.cornerSize = 24;
        standardControls.mtr.withConnection = false; // No connection line
        standardControls.mtr.cursorStyle = 'grab'; // Or custom rotation cursor
    }

};
