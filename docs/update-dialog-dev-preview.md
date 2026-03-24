# Update Dialog DEV Preview

This project includes a DEV-only update dialog preview hook so the auto-update UI can be tested without packaging the app or talking to a real update feed.

The hook is only enabled when `import.meta.env.DEV` is true. Packaged builds ignore it.

## Quick Start

Run the app in development mode:

```bash
pnpm dev
```

Then open the renderer devtools console and set one of the built-in presets:

```js
localStorage.setItem('geeclaw:debug-update', 'available')
location.reload()
```

Available presets:

- `available`: shows the update dialog with release notes and action buttons
- `downloading`: shows the dialog with simulated download progress
- `downloaded`: shows the dialog in the ready-to-install state with a countdown
- `true` or `1`: treated the same as `available`

Examples:

```js
localStorage.setItem('geeclaw:debug-update', 'downloading')
location.reload()
```

```js
localStorage.setItem('geeclaw:debug-update', 'downloaded')
location.reload()
```

## URL Override

You can also override the preview state with a URL parameter:

```text
http://localhost:5173/?debugUpdate=available
http://localhost:5173/?debugUpdate=downloading
http://localhost:5173/?debugUpdate=downloaded
```

If both the URL parameter and `localStorage` are present, the URL parameter wins.

## Custom Payload

To preview specific copy or release notes, store a JSON payload instead of a preset string:

```js
localStorage.setItem('geeclaw:debug-update', JSON.stringify({
  status: 'available',
  version: '1.2.3-test',
  releaseName: 'GeeClaw Canary',
  releaseNotes: '## Preview\n\n- Custom content',
}))
location.reload()
```

Supported JSON fields:

- `status`: `available` | `downloading` | `downloaded`
- `version`: version string shown in the dialog
- `releaseName`: optional display name badge
- `releaseDate`: optional ISO timestamp
- `releaseNotes`: Markdown string or release-note array
- `progress`: optional object for `downloading`
- `autoInstallCountdown`: optional number for `downloaded`
- `dismissedAnnouncementVersion`: optional dismissed version marker
- `skippedVersions`: optional skipped-version list

Example with custom progress:

```js
localStorage.setItem('geeclaw:debug-update', JSON.stringify({
  status: 'downloading',
  version: '1.2.3-test',
  releaseNotes: '## Download Test\n\n- Checking the progress layout',
  progress: {
    total: 104857600,
    delta: 2097152,
    transferred: 62914560,
    percent: 60,
    bytesPerSecond: 3145728,
  },
}))
location.reload()
```

## Reset

To clear the DEV preview and return to normal behavior:

```js
localStorage.removeItem('geeclaw:debug-update')
location.reload()
```

If you used the URL parameter override, remove `debugUpdate` from the URL as well.

## Notes

- When the DEV preview is active, the renderer skips the normal startup auto-check so the simulated state is not overwritten.
- The preview feeds the same Zustand update store used by the real dialog, so layout and interaction testing are close to the production path.
