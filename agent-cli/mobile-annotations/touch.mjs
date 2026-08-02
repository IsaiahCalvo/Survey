const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function interpolate(start, end, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: start.x + ((end.x - start.x) * index) / steps,
    y: start.y + ((end.y - start.y) * index) / steps,
  }));
}

const touchPoint = (point) => ({
  force: 0.7,
  id: 1,
  radiusX: 5,
  radiusY: 5,
  x: point.x,
  y: point.y,
});

export async function createTouchDriver({ browserName, context, page }) {
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page);
    return {
      inputKind: 'trusted-cdp-touch',
      async drag(start, end, { steps = 10, stepDelayMs = 12 } = {}) {
        const points = interpolate(start, end, steps);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [touchPoint(points[0])],
        });
        for (const point of points.slice(1)) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [touchPoint(point)],
          });
          if (stepDelayMs) await delay(stepDelayMs);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      async stroke(points, { stepDelayMs = 12 } = {}) {
        if (points.length < 2) throw new Error('A touch stroke needs at least two points');
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [touchPoint(points[0])],
        });
        for (const point of points.slice(1)) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [touchPoint(point)],
          });
          if (stepDelayMs) await delay(stepDelayMs);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      async longPress(point, { holdMs = 700 } = {}) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [touchPoint(point)],
        });
        await delay(holdMs);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      },
      tap: (point) => page.touchscreen.tap(point.x, point.y),
    };
  }

  // Playwright exposes no trusted multi-point touch API for WebKit. Keep the
  // same touch-enabled mobile context, but label its drag fallback honestly.
  return {
    inputKind: 'webkit-pointer-fallback',
    async drag(start, end, { steps = 10 } = {}) {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps });
      await page.mouse.up();
    },
    async stroke(points) {
      await page.mouse.move(points[0].x, points[0].y);
      await page.mouse.down();
      for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 2 });
      await page.mouse.up();
    },
    async longPress(point, { holdMs = 700 } = {}) {
      await page.touchscreen.tap(point.x, point.y);
      await delay(holdMs);
    },
    tap: (point) => page.touchscreen.tap(point.x, point.y),
  };
}
