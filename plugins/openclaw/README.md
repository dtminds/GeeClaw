# Local OpenClaw Plugins

Place unpublished OpenClaw plugin directories here when you want GeeClaw to bundle
them without installing the plugin package into the app's top-level
`node_modules/`.

Each plugin should live at:

- `plugins/openclaw/<plugin-id>/openclaw.plugin.json`

When `pnpm run bundle:openclaw-plugins`, `pnpm build`, or `pnpm package` runs,
the bundler will copy every plugin directory under this folder into
`build/openclaw-plugins/<plugin-id>`.

Keep each local plugin self-contained. If it has runtime dependencies, make sure
they are available from that plugin directory, typically via
`plugins/openclaw/<plugin-id>/node_modules/`.
