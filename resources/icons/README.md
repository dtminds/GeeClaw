# GeeClaw Application Icons

This directory contains the application icons for all supported platforms.

## Required Files

| File | Platform | Description |
|------|----------|-------------|
| `icon.svg` | Source | Vector source for all icons |
| `icon.icns` | macOS | Apple Icon Image format |
| `icon.ico` | Windows | Windows ICO format |
| `icon.png` | All | 512x512 PNG fallback |
| `16x16.png` - `512x512.png` | Linux | PNG set for Linux |
| `tray-icon-template.svg` | Source | macOS tray icon template source |
| `tray-icon-Template.png` | macOS | 16x16 1x status bar icon (note: "Template" suffix required) |
| `tray-icon-Template@2x.png` | macOS | 32x32 retina status bar icon |

## Generating Icons

### Using the Script

```bash
# Generate all app icons, including macOS tray assets
pnpm run icons
```

### Prerequisites

- Install project dependencies so `sharp`, `png2icons`, and `zx` are available.
- Run commands from the project root.

### Manual Generation

If you prefer to generate icons manually:

1. **macOS (.icns)**
   - Create a `.iconset` folder with properly named PNGs
   - Run: `iconutil -c icns -o icon.icns GeeClaw.iconset`

2. **Windows (.ico)**
   - Use ImageMagick: `convert icon_16.png icon_32.png icon_64.png icon_128.png icon_256.png icon.ico`

3. **Linux (PNGs)**
   - Generate PNGs at: 16, 32, 48, 64, 128, 256, 512 pixels

## Design Guidelines

### Application Icon
- **Corner Radius**: ~20% of width (200px on 1024px canvas)
- **Foreground**: White claw symbol with "X" accent
- **Safe Area**: Keep 10% margin from edges

### macOS Tray Icon
- **Format**: Transparent background with a single monochrome shape
- **Source Contract**: Provide a tray SVG whose visible content is just the icon silhouette. The generator converts all visible pixels to pure black while preserving alpha.
- **Outputs**: `tray-icon-Template.png` (16x16 @ 72dpi) and `tray-icon-Template@2x.png` (32x32 @ 144dpi)
- **Naming**: Must end with "Template.png" for automatic template mode
- **Design**: Simplified monochrome version of the main icon with thick enough strokes for a 16px menu bar target
- **Source**: Use `tray-icon-template.svg` as the source
- **Automatic Processing**: The script rasterizes at high density, trims transparent padding, adds a small safety inset, and exports both 1x and retina assets

## Updating the Icon

1. Edit `icon.svg` with your vector editor (Figma, Illustrator, Inkscape)
2. For macOS tray icon, edit `tray-icon-template.svg` and keep it to a single silhouette on a transparent background
3. Run `pnpm run icons`
4. Verify generated icons look correct
5. Commit all generated files
