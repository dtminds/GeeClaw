#!/usr/bin/env zx

import 'zx/globals';
import sharp from 'sharp';
import png2icons from 'png2icons';
import { fileURLToPath } from 'url';

// Calculate paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons');
const SVG_SOURCE = path.join(ICONS_DIR, 'icon.svg');
const MASTER_ICON_SIZE = 1024;
const APP_ICON_SIZE = 512;
const TRAY_SOURCE_DENSITY = 1024;
const TRAY_PADDING_RATIO = 1 / 16;
const TRAY_OUTPUTS = [
  {
    filename: 'tray-icon-Template.png',
    size: 16,
    density: 72,
  },
  {
    filename: 'tray-icon-Template@2x.png',
    size: 32,
    density: 144,
  },
];

function transparentBackground(alpha = 0) {
  return {
    r: 0,
    g: 0,
    b: 0,
    alpha,
  };
}

async function buildTrayTemplateBuffer(svgSource) {
  const renderedSource = sharp(svgSource, { density: TRAY_SOURCE_DENSITY }).ensureAlpha();
  const metadata = await renderedSource.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to read tray icon dimensions from SVG source');
  }

  const alphaMask = await renderedSource
    .extractChannel('alpha')
    .toBuffer();

  const silhouetteBuffer = await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 3,
      background: transparentBackground(1),
    },
  })
    .joinChannel(alphaMask)
    .png()
    .toBuffer();

  return sharp(silhouetteBuffer)
    .trim()
    .png()
    .toBuffer();
}

async function writeTrayTemplate(outputPath, templateBuffer, size, density) {
  const inset = Math.max(1, Math.round(size * TRAY_PADDING_RATIO));
  const contentSize = Math.max(1, size - inset * 2);

  await sharp(templateBuffer)
    .resize({
      width: contentSize,
      height: contentSize,
      fit: 'contain',
      background: transparentBackground(),
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: inset,
      right: inset,
      bottom: inset,
      left: inset,
      background: transparentBackground(),
    })
    .png()
    .withMetadata({ density })
    .toFile(outputPath);
}

echo`🎨 Generating GeeClaw icons using Node.js...`;

// Check if SVG source exists
if (!fs.existsSync(SVG_SOURCE)) {
  echo`❌ SVG source not found: ${SVG_SOURCE}`;
  process.exit(1);
}

// Ensure icons directory exists
await fs.ensureDir(ICONS_DIR);

try {
  // 1. Generate Master PNG Buffer (1024x1024)
  echo`  Processing SVG source...`;
  const masterPngBuffer = await sharp(SVG_SOURCE)
    .resize(MASTER_ICON_SIZE, MASTER_ICON_SIZE)
    .png() // Ensure it's PNG
    .toBuffer();

  // Save the main icon.png (typically 512x512 for Electron root icon)
  await sharp(masterPngBuffer)
    .resize(APP_ICON_SIZE, APP_ICON_SIZE)
    .toFile(path.join(ICONS_DIR, 'icon.png'));
  echo`  ✅ Created icon.png (${APP_ICON_SIZE}x${APP_ICON_SIZE})`;

  // 2. Generate Windows .ico
  // png2icons expects a buffer. It returns a buffer (or null).
  // createICO(buffer, scalingAlgorithm, withSize, useMath)
  // scalingAlgorithm: 1 = Bilinear (better), 2 = Hermite (good), 3 = Bezier (best/slowest)
  // Defaulting to Bezier (3) for quality or Hermite (2) for speed. Let's use 2 (Hermite) as it's balanced.
  echo`🪟 Generating Windows .ico...`;
  const icoBuffer = png2icons.createICO(masterPngBuffer, png2icons.HERMITE, 0, false);
  
  if (icoBuffer) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoBuffer);
    echo`  ✅ Created icon.ico`;
  } else {
    echo(chalk.red`  ❌ Failed to create icon.ico`);
    // detailed error might not be available from png2icons simple API, often returns null on failure
  }

  // 3. Generate macOS .icns
  echo`🍎 Generating macOS .icns...`;
  const icnsBuffer = png2icons.createICNS(masterPngBuffer, png2icons.HERMITE, 0);
  
  if (icnsBuffer) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icnsBuffer);
    echo`  ✅ Created icon.icns`;
  } else {
    echo(chalk.red`  ❌ Failed to create icon.icns`);
  }

  // 4. Generate Linux PNGs (various sizes)
  echo`🐧 Generating Linux PNG icons...`;
  const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
  let generatedCount = 0;
  
  for (const size of linuxSizes) {
    await sharp(masterPngBuffer)
      .resize(size, size)
      .toFile(path.join(ICONS_DIR, `${size}x${size}.png`));
    generatedCount++;
  }
  echo`  ✅ Created ${generatedCount} Linux PNG icons`;

  // 5. Generate macOS Tray Icon Template
  echo`📍 Generating macOS tray icon template...`;
  const TRAY_SVG_SOURCE = path.join(ICONS_DIR, 'tray-icon-template.svg');
  
  if (fs.existsSync(TRAY_SVG_SOURCE)) {
    const trayTemplateBuffer = await buildTrayTemplateBuffer(TRAY_SVG_SOURCE);

    for (const { filename, size, density } of TRAY_OUTPUTS) {
      await writeTrayTemplate(
        path.join(ICONS_DIR, filename),
        trayTemplateBuffer,
        size,
        density,
      );
      echo`  ✅ Created ${filename} (${size}x${size} @ ${density}dpi)`;
    }
  } else {
    echo`  ⚠️  tray-icon-template.svg not found, skipping tray icon generation`;
  }

  echo`\n✨ Icon generation complete! Files located in: ${ICONS_DIR}`;

} catch (error) {
  echo(chalk.red`\n❌ Fatal Error: ${error.message}`);
  process.exit(1);
}
