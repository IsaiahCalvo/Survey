const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const toIco = require('to-ico');

const svgPath = path.join(__dirname, '../build/Survey Icon.svg');
const buildDir = path.join(__dirname, '../build');
const publicDir = path.join(__dirname, '../public');
const distDir = path.join(__dirname, '../dist');

async function convertIcons() {
  try {
    console.log('Converting SVG icon to required formats...');

    // Read the SVG
    const svgBuffer = fs.readFileSync(svgPath);

    // 1. Create icon.png (1024x1024) for Electron - electron-builder will auto-generate .icns and .ico
    await sharp(svgBuffer)
      .resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(buildDir, 'icon.png'));
    console.log('✓ Created build/icon.png (1024x1024)');

    // 2. Create logo192.png for web manifest
    await sharp(svgBuffer)
      .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(publicDir, 'logo192.png'));
    console.log('✓ Created public/logo192.png');

    // Copy to dist as well
    await sharp(svgBuffer)
      .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(distDir, 'logo192.png'));
    console.log('✓ Created dist/logo192.png');

    // 3. Create logo512.png for web manifest
    await sharp(svgBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(publicDir, 'logo512.png'));
    console.log('✓ Created public/logo512.png');

    // Copy to dist as well
    await sharp(svgBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(distDir, 'logo512.png'));
    console.log('✓ Created dist/logo512.png');

    // 4. Create favicon.ico (multiple sizes: 16, 32, 48, 64)
    const faviconSizes = [16, 32, 48, 64];
    const faviconBuffers = [];
    
    for (const size of faviconSizes) {
      const buffer = await sharp(svgBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();
      faviconBuffers.push(buffer);
    }
    
    // Create favicon.ico with multiple sizes
    const icoBuffer = await toIco(faviconBuffers);
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
    fs.writeFileSync(path.join(distDir, 'favicon.ico'), icoBuffer);
    console.log('✓ Created favicon.ico with multiple sizes');

    // 5. Create .icns file for macOS Electron app
    // Create iconset directory with all required sizes
    const iconsetDir = path.join(buildDir, 'icon.iconset');
    if (!fs.existsSync(iconsetDir)) {
      fs.mkdirSync(iconsetDir, { recursive: true });
    }

    // macOS requires specific icon sizes in the iconset
    const macIconSizes = [
      { size: 16, scale: 1 },
      { size: 16, scale: 2 }, // 32x32 @2x
      { size: 32, scale: 1 },
      { size: 32, scale: 2 }, // 64x64 @2x
      { size: 128, scale: 1 },
      { size: 128, scale: 2 }, // 256x256 @2x
      { size: 256, scale: 1 },
      { size: 256, scale: 2 }, // 512x512 @2x
      { size: 512, scale: 1 },
      { size: 512, scale: 2 }, // 1024x1024 @2x
    ];

    for (const { size, scale } of macIconSizes) {
      const actualSize = size * scale;
      const filename = scale === 1 
        ? `icon_${size}x${size}.png`
        : `icon_${size}x${size}@${scale}x.png`;
      
      await sharp(svgBuffer)
        .resize(actualSize, actualSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toFile(path.join(iconsetDir, filename));
    }

    console.log('✓ Created icon.iconset with all required sizes');

    // Convert iconset to .icns using iconutil
    const { execSync } = require('child_process');
    try {
      execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(buildDir, 'icon.icns')}"`, { stdio: 'inherit' });
      console.log('✓ Created build/icon.icns for macOS');
      
      // Clean up iconset directory
      fs.rmSync(iconsetDir, { recursive: true, force: true });
      console.log('✓ Cleaned up temporary iconset directory');
    } catch (error) {
      console.warn('⚠ Could not create .icns file (iconutil failed). You may need to create it manually.');
      console.warn('  The PNG icon will still work, but .icns is preferred for macOS.');
    }

    console.log('\n✅ All icon conversions complete!');
  } catch (error) {
    console.error('Error converting icons:', error);
    process.exit(1);
  }
}

convertIcons();

