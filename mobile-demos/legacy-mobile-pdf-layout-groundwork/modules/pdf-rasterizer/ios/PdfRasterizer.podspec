Pod::Spec.new do |s|
  s.name           = 'PdfRasterizer'
  s.version        = '1.0.0'
  s.summary        = 'Rasterize a PDF page to PNG bytes for Skia (Approach C)'
  s.description    = 'Local Expo module: CGContextDrawPDFPage -> CGBitmapContext -> PNG.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
