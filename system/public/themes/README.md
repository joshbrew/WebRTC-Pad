# Theme packs

Create one folder per appearance under `system/public/themes/`. Copy `signal/` or `cobalt/` for a working layout example. The app discovers valid packs when its server starts and loads the selected stylesheet after the shared interface styles.

`my-theme/theme.json`

```json
{
  "version": 1,
  "id": "my-theme",
  "name": "My Theme",
  "colorScheme": "dark",
  "stylesheet": "theme.css",
  "preview": "preview.webp",
  "description": "Shown on the Appearance card.",
  "order": 100
}
```

Use the folder name for `id`, with lowercase letters, digits, and hyphens. `colorScheme` can be `dark` or `light`. Use a local CSS file for `stylesheet`. CSS can reference local CSS, SVG, WOFF2, PNG, JPEG, WebP, and AVIF files inside the pack. `description`, `order`, and `preview` are optional. Set `preview` to a local image path such as `preview.webp`. A 512 × 304 screenshot fits the card in Settings → Appearance.

Scope layout and component rules to `:root[data-skin="my-theme"]`. Use `.app-header` for navigation, `#hostSetupCard` for setup, `.video-stage` for the call surface, `.call-toolbar` for the dock, and `.sectioned-settings` for settings. In pop-outs, use `.view-popout` for the window and `.floating-screens-controls` for the group controls. CSS Grid and Flexbox can give those controls a different arrangement. On narrow screens, preserve the controls’ reading and keyboard order. Use `--theme-panel-top` on `.app-header` when your header layout changes the top edge of call panels, as in Signal.

The app supplies the same controls and event handlers across appearances. Packs contain styles and assets, so a theme switch keeps the current session and media running. Check Host, Join, settings, and fullscreen at desktop and phone widths. Restart the server and refresh after adding or renaming a pack.
