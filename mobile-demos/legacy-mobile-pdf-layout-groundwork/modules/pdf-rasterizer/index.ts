import { requireNativeModule } from 'expo-modules-core';

/** PDF page size in points (PDF user-space units, 72/inch). */
export type PageSize = { width: number; height: number };

export type PdfRasterizer = {
  /** Open (and cache) a PDF; returns page count. Accepts a file:// URI or absolute path. */
  openDocument(uri: string): Promise<number>;
  /** MediaBox size of a page, in points. */
  getPageSize(uri: string, pageIndex: number): Promise<PageSize>;
  /**
   * Rasterize a page at `scale` (points -> pixels, i.e. devicePixels = pagePoints * scale;
   * caller clamps) and return PNG-encoded bytes as a Uint8Array. Skia decodes the PNG and
   * reads its own dimensions, so width/height are not returned.
   */
  rasterizePage(uri: string, pageIndex: number, scale: number): Promise<Uint8Array>;
  /**
   * Rasterize only the sub-rectangle [rx,ry,rw,rh] of a page (the visible "detail tile").
   * rx/ry/rw/rh are in DISPLAY points (y-down, top-left); `scale` is points -> pixels. Output
   * is ~viewport-bounded at any zoom, so deep zoom stays crisp without a huge texture. With
   * rx=ry=0 and rw/rh = page size this is identical to rasterizePage.
   */
  rasterizeRegion(
    uri: string, pageIndex: number, scale: number, rx: number, ry: number, rw: number, rh: number,
  ): Promise<Uint8Array>;
};

// Throws synchronously if the native module isn't in the build (e.g. Expo Go) —
// callers wrap the require() in try/catch and fall back to the "needs dev build" notice.
export default requireNativeModule<PdfRasterizer>('PdfRasterizer');
