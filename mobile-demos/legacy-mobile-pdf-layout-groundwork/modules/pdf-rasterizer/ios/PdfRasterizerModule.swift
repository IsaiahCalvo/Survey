import ExpoModulesCore
import PDFKit
import CoreGraphics
import UIKit

/**
 * PdfRasterizer — Approach C native rasterizer (iOS).
 *
 * Renders one PDF page into a CGBitmapContext with the low-level
 * `CGContext.drawPDFPage` (which applies NO page-to-context transform of its own,
 * so our manual flip+scale CTM is correct — do NOT combine with PDFPage.draw,
 * which double-transforms). Returns PNG bytes; ExpoModulesCore maps Swift `Data`
 * to a JS `Uint8Array`. JS hands the bytes to Skia as an SkImage and draws it +
 * vector ink under one <Group transform> — one pipeline, sync is structural.
 *
 * AsyncFunctions run off the JS thread (Expo's background queue) so the main
 * thread never blocks during rasterization. The doc cache is mutated from that
 * queue, so it is guarded by a lock.
 */
public class PdfRasterizerModule: Module {
  private var docs: [String: PDFDocument] = [:]
  private let lock = NSLock()

  private func document(for uri: String) -> PDFDocument? {
    lock.lock()
    defer { lock.unlock() }
    if let cached = docs[uri] { return cached }
    guard let url = URL(string: uri) ?? URL(fileURLWithPath: uri) as URL?,
          let doc = PDFDocument(url: url) else { return nil }
    docs[uri] = doc
    return doc
  }

  public func definition() -> ModuleDefinition {
    Name("PdfRasterizer")

    AsyncFunction("openDocument") { (uri: String) -> Int in
      guard let doc = self.document(for: uri) else {
        throw Exception(name: "LOAD_FAILED", description: "Cannot open PDF at \(uri)")
      }
      return doc.pageCount
    }

    AsyncFunction("getPageSize") { (uri: String, pageIndex: Int) -> [String: Double] in
      guard let doc = self.document(for: uri), let page = doc.page(at: pageIndex) else {
        throw Exception(name: "PAGE_NOT_FOUND", description: "page \(pageIndex) in \(uri)")
      }
      let box = page.bounds(for: .mediaBox)
      return ["width": Double(box.width), "height": Double(box.height)]
    }

    // scale = points -> pixels. devicePixels = pagePoints * scale. Caller clamps.
    // Returns PNG bytes as a Swift `Data`, which ExpoModulesCore bridges to a JS
    // `Uint8Array` (the tested DataUint8ArrayConvertiblesSpec path — a declared
    // `Data` return, not a heterogeneous `[String: Any]`). Pixel dims are not
    // returned: the caller derives them from page points × scale, and the PNG
    // self-describes its size to Skia's decoder.
    AsyncFunction("rasterizePage") { (uri: String, pageIndex: Int, scale: Double) -> Data in
      guard let doc = self.document(for: uri), let page = doc.page(at: pageIndex),
            let cgPage = page.pageRef else {
        throw Exception(name: "PAGE_NOT_FOUND", description: "page \(pageIndex) in \(uri)")
      }
      let box = page.bounds(for: .mediaBox)
      let size = CGSize(width:  max(1, (box.width  * scale).rounded(.up)),
                        height: max(1, (box.height * scale).rounded(.up)))

      // UIGraphicsImageRenderer is the canonical, correctly-oriented PDF->image path. Its
      // context is UIKit y-down/top-left, so translate+flip into the PDF's y-up/bottom-left
      // space, then scale points->pixels. (A raw y-up CGBitmapContext + this SAME flip renders
      // upside down — that was the bug.) Renderer also bakes the white page + PNG encode.
      let fmt = UIGraphicsImageRendererFormat.default()
      fmt.scale = 1        // DPI is baked into `size`; don't multiply by the screen scale again
      fmt.opaque = true    // opaque white page, no alpha channel
      let renderer = UIGraphicsImageRenderer(size: size, format: fmt)
      return renderer.pngData { rctx in
        let cg = rctx.cgContext
        cg.setFillColor(UIColor.white.cgColor)
        cg.fill(CGRect(origin: .zero, size: size))
        cg.translateBy(x: 0, y: size.height)
        cg.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
        cg.drawPDFPage(cgPage)   // CoreGraphics: applies no transform of its own
      }   // Data -> Uint8Array
    }

    // Rasterize ONLY a sub-rectangle of the page (the visible "detail tile"). rx/ry/rw/rh are
    // in DISPLAY points (y-down, top-left, same space the JS coordinate model uses); scale is
    // points->pixels. The CTM mirrors regionDrawAffine() in pdfAnnotation.ts (self-checked
    // offline): translate(-rx*scale, H*scale - ry*scale) then scale(s,-s) puts the region's
    // top-left at the bitmap origin, right-side-up. With rx=ry=0, rw/rh = page size this is
    // identical to rasterizePage. Output pixels are ~viewport-bounded at any zoom -> crisp+cheap.
    AsyncFunction("rasterizeRegion") {
      (uri: String, pageIndex: Int, scale: Double, rx: Double, ry: Double, rw: Double, rh: Double) -> Data in
      guard let doc = self.document(for: uri), let page = doc.page(at: pageIndex),
            let cgPage = page.pageRef else {
        throw Exception(name: "PAGE_NOT_FOUND", description: "page \(pageIndex) in \(uri)")
      }
      let pageHeight = page.bounds(for: .mediaBox).height
      let size = CGSize(width:  max(1, (rw * scale).rounded(.up)),
                        height: max(1, (rh * scale).rounded(.up)))

      let fmt = UIGraphicsImageRendererFormat.default()
      fmt.scale = 1
      fmt.opaque = true
      let renderer = UIGraphicsImageRenderer(size: size, format: fmt)
      return renderer.pngData { rctx in
        let cg = rctx.cgContext
        cg.setFillColor(UIColor.white.cgColor)
        cg.fill(CGRect(origin: .zero, size: size))
        cg.translateBy(x: -CGFloat(rx) * CGFloat(scale),
                       y: pageHeight * CGFloat(scale) - CGFloat(ry) * CGFloat(scale))
        cg.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
        cg.drawPDFPage(cgPage)
      }   // Data -> Uint8Array
    }
  }
}
