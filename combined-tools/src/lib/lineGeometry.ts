import { Point } from '@/types/callout';

/**
 * Calculate the geometric midpoint between two points
 */
export function getMidpoint(start: Point, end: Point): Point {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}

/**
 * Calculate the distance from a point to a line segment
 * Returns the perpendicular distance from the point to the line defined by start-end
 */
export function distanceToLineSegment(point: Point, start: Point, end: Point): number {
  const lineLength = Math.sqrt(
    Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2)
  );

  if (lineLength === 0) {
    // start and end are the same point
    return Math.sqrt(Math.pow(point.x - start.x, 2) + Math.pow(point.y - start.y, 2));
  }

  // Calculate the perpendicular distance using the cross product formula
  const numerator = Math.abs(
    (end.y - start.y) * point.x -
    (end.x - start.x) * point.y +
    end.x * start.y -
    end.y * start.x
  );

  return numerator / lineLength;
}

/**
 * Project a point onto the line defined by start-end
 * Returns the closest point on the line segment to the given point
 */
export function projectPointToLine(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    // start and end are the same point
    return { ...start };
  }

  // Calculate parameter t for the projection
  // t=0 means projection is at start, t=1 means at end
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;

  // Clamp t to [0, 1] to stay on the line segment
  t = Math.max(0, Math.min(1, t));

  return {
    x: start.x + t * dx,
    y: start.y + t * dy,
  };
}

/**
 * Check if the midpoint should snap to a linear path (straight line)
 * Returns true if the midpoint is within the threshold distance from the line
 */
export function shouldSnapToLinear(
  midpoint: Point,
  start: Point,
  end: Point,
  threshold: number = 10
): boolean {
  const distance = distanceToLineSegment(midpoint, start, end);
  return distance <= threshold;
}

/**
 * Generate an SVG path string for a quadratic bezier curve
 * The midpoint acts as the control point for the curve
 *
 * For a quadratic bezier: M start Q control end
 * But since we want the curve to pass THROUGH the midpoint (not just be controlled by it),
 * we need to calculate a control point that makes the curve pass through the midpoint
 */
export function getCurvedPath(start: Point, end: Point, midpoint: Point): string {
  // For a quadratic bezier curve to pass through the midpoint at t=0.5,
  // the control point C must satisfy: midpoint = 0.25*start + 0.5*C + 0.25*end
  // Solving for C: C = 2*midpoint - 0.5*start - 0.5*end
  const controlPoint: Point = {
    x: 2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
    y: 2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
  };



  return `M ${start.x},${start.y} Q ${controlPoint.x},${controlPoint.y} ${end.x},${end.y}`;
}

/**
 * Get the tangent angle at the end of a quadratic bezier curve
 * Used for positioning arrowheads correctly on curved arrows
 */
export function getCurveEndAngle(start: Point, end: Point, midpoint: Point): number {
  // Calculate the control point (same as in getCurvedPath)
  const controlPoint: Point = {
    x: 2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
    y: 2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
  };

  // The tangent at t=1 for a quadratic bezier is the direction from control to end
  const angle = Math.atan2(end.y - controlPoint.y, end.x - controlPoint.x);
  return angle * (180 / Math.PI);
}

/**
 * Calculate the position along a quadratic bezier curve at parameter t
 */
export function getPointOnCurve(start: Point, end: Point, midpoint: Point, t: number): Point {
  // Calculate control point
  const controlPoint: Point = {
    x: 2 * midpoint.x - 0.5 * start.x - 0.5 * end.x,
    y: 2 * midpoint.y - 0.5 * start.y - 0.5 * end.y,
  };

  // Quadratic bezier formula: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * controlPoint.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * controlPoint.y + t * t * end.y,
  };
}
