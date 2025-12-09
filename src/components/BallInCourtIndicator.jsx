import React, { useState, useRef, useEffect } from 'react';
import { COLORS, TYPOGRAPHY, SHADOWS, Z_INDEX, TRANSITIONS } from '../theme';

/**
 * BallInCourtIndicator - A reusable circular indicator for Ball-in-Court status
 *
 * This component displays a solid circle with the exact color from the ballInCourt.color field.
 * The color is used directly without any transformation or modification.
 *
 * @param {string} color - The exact color value from ballInCourt.color (rgba, hex, or any valid CSS color)
 * @param {number} size - The diameter of the circle in pixels (default: 16)
 * @param {function} onClick - Optional click handler
 * @param {string} tooltipText - The ball-in-court value/name to display on hover (e.g., "GC", "Subcontractor")
 * @param {object} style - Additional inline styles to apply to the container
 */
const BallInCourtIndicator = ({
  color,
  size = 16,
  onClick,
  tooltipText,
  style = {}
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const indicatorRef = useRef(null);
  const tooltipRef = useRef(null);

  // Calculate tooltip position when showing
  useEffect(() => {
    if (showTooltip && indicatorRef.current) {
      const rect = indicatorRef.current.getBoundingClientRect();
      // Position tooltip to the right of the indicator
      setTooltipPosition({
        x: rect.right + 8,
        y: rect.top + rect.height / 2
      });
    }
  }, [showTooltip]);

  // Don't render if no color is provided
  if (!color) {
    return null;
  }

  const handleMouseEnter = () => {
    if (tooltipText) {
      setShowTooltip(true);
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  const handleClick = (e) => {
    if (onClick) {
      e.stopPropagation();
      onClick(e);
    }
  };

  return (
    <>
      {/* Outer container with white background to make transparent colors visible */}
      <div
        ref={indicatorRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          minWidth: `${size}px`,
          minHeight: `${size}px`,
          borderRadius: '50%',
          backgroundColor: '#FFFFFF', // White background so transparent colors are visible
          flexShrink: 0,
          cursor: onClick ? 'pointer' : 'default',
          transition: `transform ${TRANSITIONS.fast}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...style
        }}
        role={onClick ? 'button' : 'presentation'}
        aria-label={tooltipText ? `Ball in Court: ${tooltipText}` : undefined}
      >
        {/* Inner circle with the actual ball-in-court color */}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            backgroundColor: color, // Use the exact color without transformation
            mixBlendMode: 'multiply'
          }}
        />
      </div>

      {/* Tooltip */}
      {showTooltip && tooltipText && (
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: 'translateY(-50%)',
            backgroundColor: COLORS.background.elevated,
            color: COLORS.text.secondary,
            padding: '6px 10px',
            borderRadius: '4px',
            fontSize: TYPOGRAPHY.fontSize.sm,
            fontFamily: TYPOGRAPHY.fontFamily.default,
            fontWeight: TYPOGRAPHY.fontWeight.medium,
            boxShadow: SHADOWS.md,
            zIndex: Z_INDEX.tooltip,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            border: `1px solid ${COLORS.border.default}`,
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {tooltipText}
        </div>
      )}
    </>
  );
};

export default BallInCourtIndicator;
