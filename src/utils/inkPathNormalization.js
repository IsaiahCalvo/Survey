/**
 * Read-only operational normalization for legacy/imported Fabric/SVG paths.
 *
 * The authored carrier is never edited. Consumers that need coordinates they
 * can safely erase, transform, or export receive a new absolute M/L/Q/C/Z
 * command list. SVG arcs are represented by their standard cubic Bézier
 * expansion so callers never mistake an arc's endpoint parameters for x/y
 * pairs or replace the arc with its invisible chord.
 */

const finiteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const stableSum = (...values) => {
  if (values.some((value) => Number.isNaN(value))) return NaN;
  if (values.some((value) => !Number.isFinite(value))) {
    return values.reduce((sum, value) => sum + value, 0);
  }
  const direct = values.reduce((sum, value) => sum + value, 0);
  if (Number.isFinite(direct)) return direct;
  const scale = Math.max(0, ...values.map((value) => Math.abs(value)));
  if (scale === 0) return 0;
  return scale * values.reduce((sum, value) => sum + value / scale, 0);
};

const reflectedControl = (x, y, control) => (
  control
    ? {
        x: stableSum(x, x, -control.x),
        y: stableSum(y, y, -control.y),
      }
    : { x, y }
);

const signedVectorAngle = (ux, uy, vx, vy) => {
  const leftScale = Math.max(Math.abs(ux), Math.abs(uy));
  const rightScale = Math.max(Math.abs(vx), Math.abs(vy));
  if (
    !Number.isFinite(leftScale)
    || !Number.isFinite(rightScale)
    || leftScale === 0
    || rightScale === 0
  ) {
    return 0;
  }
  const normalizedUx = ux / leftScale;
  const normalizedUy = uy / leftScale;
  const normalizedVx = vx / rightScale;
  const normalizedVy = vy / rightScale;
  const cross = normalizedUx * normalizedVy - normalizedUy * normalizedVx;
  const dot = normalizedUx * normalizedVx + normalizedUy * normalizedVy;
  if ((!Number.isFinite(cross) || !Number.isFinite(dot)) || (cross === 0 && dot === 0)) {
    return 0;
  }
  return Math.atan2(cross, dot);
};

const signedExp = (logMagnitude, sign) => {
  if (sign === 0) return 0;
  const magnitude = Math.exp(logMagnitude);
  return sign < 0 ? -magnitude : magnitude;
};

const arcToCubics = (start, {
  rx: rawRx,
  ry: rawRy,
  rotation: rawRotation,
  largeArc,
  sweep,
  end,
}) => {
  let rx = Math.abs(finiteNumber(rawRx));
  let ry = Math.abs(finiteNumber(rawRy));
  if (start.x === end.x && start.y === end.y) {
    return [];
  }
  if (rx === 0 || ry === 0) return [['L', end.x, end.y]];

  const phi = (finiteNumber(rawRotation) % 360) * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const halfDx = stableSum(start.x / 2, -end.x / 2);
  const halfDy = stableSum(start.y / 2, -end.y / 2);
  const x1Prime = stableSum(cosPhi * halfDx, sinPhi * halfDy);
  const y1Prime = stableSum(-sinPhi * halfDx, cosPhi * halfDy);

  // Work in a scale-free coordinate system. Squaring authored coordinates
  // directly underflows for microscopic imported paths and overflows for very
  // large ones, even though the arc itself is perfectly representable.
  const geometryScale = Math.max(rx, ry, Math.abs(x1Prime), Math.abs(y1Prime));
  const logRatioX = x1Prime === 0
    ? -Infinity
    : Math.log(Math.abs(x1Prime)) - Math.log(rx);
  const logRatioY = y1Prime === 0
    ? -Infinity
    : Math.log(Math.abs(y1Prime)) - Math.log(ry);
  const maxLogRatio = Math.max(logRatioX, logRatioY);
  const logRadiiScale = Number.isFinite(maxLogRatio)
    ? maxLogRatio + 0.5 * Math.log(
        Math.exp(2 * (logRatioX - maxLogRatio))
        + Math.exp(2 * (logRatioY - maxLogRatio)),
      )
    : -Infinity;
  const radiiCorrected = logRadiiScale > 0;
  if (radiiCorrected) {
    // SVG's radii correction scales both radii by hypot(x'/rx,y'/ry).
    // Computing that quotient directly overflows when a valid authored
    // radius is subnormal (for example 5e-324 against unit endpoints).
    rx = Math.exp(Math.log(rx) + logRadiiScale);
    ry = Math.exp(Math.log(ry) + logRadiiScale);
  }

  const sign = Boolean(largeArc) === Boolean(sweep) ? -1 : 1;
  let cxPrime = 0;
  let cyPrime = 0;
  if (!radiiCorrected) {
    // lambda = (x'/rx)^2 + (y'/ry)^2. Work from its log so extreme
    // aspect-ratio radii never square to zero/Infinity. When SVG radii
    // correction ran, lambda is exactly one and the center-prime terms are
    // exactly zero, so this branch is intentionally skipped.
    const logLambda = 2 * logRadiiScale;
    const lambda = logLambda < Math.log(Number.MIN_VALUE)
      ? 0
      : Math.min(1, Math.exp(logLambda));
    const logCoefficient = 0.5 * (
      (lambda === 0 ? 0 : Math.log1p(-lambda))
      - logLambda
    );
    if (y1Prime !== 0) {
      cxPrime = signedExp(
        logCoefficient + Math.log(rx) + Math.log(Math.abs(y1Prime)) - Math.log(ry),
        sign * Math.sign(y1Prime),
      );
    }
    if (x1Prime !== 0) {
      cyPrime = signedExp(
        logCoefficient + Math.log(ry) + Math.log(Math.abs(x1Prime)) - Math.log(rx),
        -sign * Math.sign(x1Prime),
      );
    }
  }
  const centerX = stableSum(
    cosPhi * cxPrime,
    -sinPhi * cyPrime,
    start.x / 2,
    end.x / 2,
  );
  const centerY = stableSum(
    sinPhi * cxPrime,
    cosPhi * cyPrime,
    start.y / 2,
    end.y / 2,
  );

  const startVectorX = (x1Prime - cxPrime) / rx;
  const startVectorY = (y1Prime - cyPrime) / ry;
  const endVectorX = (-x1Prime - cxPrime) / rx;
  const endVectorY = (-y1Prime - cyPrime) / ry;
  const startAngle = signedVectorAngle(1, 0, startVectorX, startVectorY);
  let sweepAngle = signedVectorAngle(
    startVectorX,
    startVectorY,
    endVectorX,
    endVectorY,
  );
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;

  const segmentCount = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const segmentSweep = sweepAngle / segmentCount;
  const pointAt = (angle) => ({
    x: stableSum(
      centerX,
      rx * cosPhi * Math.cos(angle),
      -ry * sinPhi * Math.sin(angle),
    ),
    y: stableSum(
      centerY,
      rx * sinPhi * Math.cos(angle),
      ry * cosPhi * Math.sin(angle),
    ),
  });
  const derivativeAt = (angle) => ({
    x: stableSum(
      -rx * cosPhi * Math.sin(angle),
      -ry * sinPhi * Math.cos(angle),
    ),
    y: stableSum(
      -rx * sinPhi * Math.sin(angle),
      ry * cosPhi * Math.cos(angle),
    ),
  });

  const result = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const startTheta = startAngle + index * segmentSweep;
    const endTheta = startTheta + segmentSweep;
    const segmentStart = pointAt(startTheta);
    const segmentEnd = pointAt(endTheta);
    const startDerivative = derivativeAt(startTheta);
    const endDerivative = derivativeAt(endTheta);
    const alpha = 4 / 3 * Math.tan(segmentSweep / 4);
    const exactEnd = index === segmentCount - 1 ? end : segmentEnd;
    result.push([
      'C',
      stableSum(segmentStart.x, alpha * startDerivative.x),
      stableSum(segmentStart.y, alpha * startDerivative.y),
      stableSum(segmentEnd.x, -alpha * endDerivative.x),
      stableSum(segmentEnd.y, -alpha * endDerivative.y),
      exactEnd.x,
      exactEnd.y,
    ]);
  }
  return result.every((command) => command.slice(1).every(Number.isFinite))
    ? result
    : [['L', end.x, end.y]];
};

export function normalizeOperationalInkPath(commands) {
  if (!Array.isArray(commands)) return [];

  const normalized = [];
  let currentX = 0;
  let currentY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  let previousCubicControl = null;
  let previousQuadraticControl = null;

  const clearControls = () => {
    previousCubicControl = null;
    previousQuadraticControl = null;
  };
  const coordinate = (command, index, axis, relative) => (
    finiteNumber(command[index])
      + (relative ? (axis === 'x' ? currentX : currentY) : 0)
  );
  const point = (command, index, relative) => ({
    x: coordinate(command, index, 'x', relative),
    y: coordinate(command, index + 1, 'y', relative),
  });

  for (const command of commands) {
    if (!Array.isArray(command) || typeof command[0] !== 'string') continue;
    const sourceOperator = command[0];
    const operator = sourceOperator.toUpperCase();
    const relative = sourceOperator !== operator;

    if (operator === 'Z') {
      normalized.push(['Z']);
      currentX = subpathStartX;
      currentY = subpathStartY;
      clearControls();
      continue;
    }

    if (operator === 'M' || operator === 'L') {
      for (let index = 1; index + 1 < command.length; index += 2) {
        const next = point(command, index, relative);
        const nextOperator = operator === 'M' && index === 1 ? 'M' : 'L';
        normalized.push([nextOperator, next.x, next.y]);
        currentX = next.x;
        currentY = next.y;
        if (nextOperator === 'M') {
          subpathStartX = currentX;
          subpathStartY = currentY;
        }
        clearControls();
      }
      continue;
    }

    if (operator === 'H') {
      for (let index = 1; index < command.length; index += 1) {
        currentX = finiteNumber(command[index]) + (relative ? currentX : 0);
        normalized.push(['L', currentX, currentY]);
        clearControls();
      }
      continue;
    }

    if (operator === 'V') {
      for (let index = 1; index < command.length; index += 1) {
        currentY = finiteNumber(command[index]) + (relative ? currentY : 0);
        normalized.push(['L', currentX, currentY]);
        clearControls();
      }
      continue;
    }

    if (operator === 'Q') {
      for (let index = 1; index + 3 < command.length; index += 4) {
        const control = point(command, index, relative);
        const end = point(command, index + 2, relative);
        normalized.push(['Q', control.x, control.y, end.x, end.y]);
        currentX = end.x;
        currentY = end.y;
        previousQuadraticControl = control;
        previousCubicControl = null;
      }
      continue;
    }

    if (operator === 'T') {
      for (let index = 1; index + 1 < command.length; index += 2) {
        const control = reflectedControl(currentX, currentY, previousQuadraticControl);
        const end = point(command, index, relative);
        normalized.push(['Q', control.x, control.y, end.x, end.y]);
        currentX = end.x;
        currentY = end.y;
        previousQuadraticControl = control;
        previousCubicControl = null;
      }
      continue;
    }

    if (operator === 'C') {
      for (let index = 1; index + 5 < command.length; index += 6) {
        const control1 = point(command, index, relative);
        const control2 = point(command, index + 2, relative);
        const end = point(command, index + 4, relative);
        normalized.push([
          'C',
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          end.x,
          end.y,
        ]);
        currentX = end.x;
        currentY = end.y;
        previousCubicControl = control2;
        previousQuadraticControl = null;
      }
      continue;
    }

    if (operator === 'S') {
      for (let index = 1; index + 3 < command.length; index += 4) {
        const control1 = reflectedControl(currentX, currentY, previousCubicControl);
        const control2 = point(command, index, relative);
        const end = point(command, index + 2, relative);
        normalized.push([
          'C',
          control1.x,
          control1.y,
          control2.x,
          control2.y,
          end.x,
          end.y,
        ]);
        currentX = end.x;
        currentY = end.y;
        previousCubicControl = control2;
        previousQuadraticControl = null;
      }
      continue;
    }

    if (operator === 'A') {
      for (let index = 1; index + 6 < command.length; index += 7) {
        const end = point(command, index + 5, relative);
        normalized.push(...arcToCubics(
          { x: currentX, y: currentY },
          {
            rx: command[index],
            ry: command[index + 1],
            rotation: command[index + 2],
            largeArc: finiteNumber(command[index + 3]) !== 0,
            sweep: finiteNumber(command[index + 4]) !== 0,
            end,
          },
        ));
        currentX = end.x;
        currentY = end.y;
        clearControls();
      }
    }
  }

  return normalized;
}
