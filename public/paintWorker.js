// public/paintWorker.js
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== 'floodFill') return;

  try {
    const { bitmap, x, y, tolerance = 32 } = msg;

    // draw bitmap to offscreen canvas
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;

    const width = canvas.width;
    const height = canvas.height;

    const idx = (px, py) => (py * width + px) * 4;

    const seedIndex = idx(x, y);
    const seedR = data[seedIndex];
    const seedG = data[seedIndex + 1];
    const seedB = data[seedIndex + 2];

    const mask = new Uint8ClampedArray(width * height);
    const q = [];
    q.push([x, y]);
    mask[y * width + x] = 1;

    const colorDist = (px, py) => {
      const i = idx(px, py);
      const dr = data[i] - seedR;
      const dg = data[i + 1] - seedG;
      const db = data[i + 2] - seedB;
      return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    while (q.length > 0) {
      const [cx, cy] = q.shift();
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const pIndex = ny * width + nx;
        if (mask[pIndex]) continue;
        if (colorDist(nx, ny) <= tolerance) {
          mask[pIndex] = 1;
          q.push([nx, ny]);
        }
      }
    }

    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (mask[py * width + px]) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      }
    }
    if (minX > maxX || minY > maxY) {
      self.postMessage({ type: 'result', maskBlob: null });
      return;
    }

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const maskImg = new ImageData(w, h);
    let k = 0;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const v = mask[py * width + px] ? 255 : 0;
        maskImg.data[k++] = 0;
        maskImg.data[k++] = 0;
        maskImg.data[k++] = 0;
        maskImg.data[k++] = v;
      }
    }

    const out = new OffscreenCanvas(w, h);
    const octx = out.getContext('2d');
    octx.putImageData(maskImg, 0, 0);
    const blob = await out.convertToBlob({ type: 'image/png' });

    try { bitmap.close?.(); } catch (e) {}

    self.postMessage({ type: 'result', minX, minY, width: w, height: h, maskBlob: blob }, [blob]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
