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
      let w = max(1, Int((box.width  * scale).rounded(.up)))
      let h = max(1, Int((box.height * scale).rounded(.up)))

      let cs = CGColorSpaceCreateDeviceRGB()
      guard let ctx = CGContext(
        data: nil, width: w, height: h,
        bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                  | CGBitmapInfo.byteOrder32Little.rawValue   // BGRA for the raw-RGBA path
      ) else {
        throw Exception(name: "CTX_FAILED", description: "Cannot create \(w)x\(h) bitmap context")
      }

      // White paper (PDFs are transparent), then flip to PDF's bottom-left origin.
      ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
      ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
      ctx.translateBy(x: 0, y: CGFloat(h))
      ctx.scaleBy(x: CGFloat(scale), y: -CGFloat(scale))
      ctx.drawPDFPage(cgPage)   // CoreGraphics: applies no transform of its own

      guard let cg = ctx.makeImage(), let png = UIImage(cgImage: cg).pngData() else {
        throw Exception(name: "IMG_FAILED", description: "Cannot encode page \(pageIndex)")
      }
      return png   // Data -> Uint8Array
    }
  }
}
