# Design refresh

The interface now uses the refined WebRTC Pad design system: graphite and mint, keycap buttons, player colours, spring motion, and a light theme.

## What changed

| File | Change |
| --- | --- |
| `system/public/design/tokens/colors.css` | New colour tokens for Dark (default) and Light. Old names (`--graphite-*`, `--moss-*`, `--surface-*`, `--text-*`, `--border-*`, `--mint`, `--line`…) are aliases of the new tokens, so existing selectors keep working. The stage and video tiles stay dark in both themes. |
| `system/public/design/tokens/typography.css`, `spacing.css`, `effects.css` | Type scale nudged to the new seven styles, headings in Bricolage Grotesque, stats in JetBrains Mono, rounder radii, motion tokens (`--dur-*`, `--ease-*`). |
| `system/public/design/tokens/fonts.css`, `design/fonts/` | Bricolage Grotesque and JetBrains Mono shipped locally (SIL OFL, see `OFL.md`). |
| `system/public/design/pad.css` | New. Loaded last on every page: keycap buttons, sliding Host/Join thumb, call-bar pill, switches for check rows, spring-in sheets and dialogs, cascading menus, live-dot pulse, stage dot grid. Visual only; no layout or IDs change. Respects `prefers-reduced-motion`. |
| `style.css`, `call-shell.css`, `design-app.css`, `design/components/components.css` | Hard-coded colours replaced with tokens (dark shadows and video overlays left as they were) so both themes work. |
| `system/public/theme.js` + header button `#themeToggle` | Light/dark toggle, remembered per browser (`pad-theme` in localStorage), applied before first paint. Registered in `system/src/server.js`. |
| `system/public/call-comfort.js` | Controller test redrawn as a full standard gamepad: bumpers, analog triggers that fill with pressure, D-pad, face-button diamond, Select/Start/Home, sticks that trace their direction and light when pressed. The readout names buttons by position ("Pressed: Bottom, RB"). Button indices are unchanged. |
| Header and host setup (`pad.css`) | Host/Join stays centred (three-column header) and its thumb glides without overshoot. From 1100px wide the host setup is two columns: screen sharing on the left, guest permissions and controls on the right. |
| Second pass (`pad.css`, `app.js`, `index.html`) | Controller cards show friendly names (Xbox controller, DualSense, Switch Pro; full id in the tooltip) and a player-coloured disc once a controller has a slot. Share controllers is a real switch. Open panels make room on wide screens instead of covering the page. Call-bar names float up as tooltips on desktop. Settings tabs are compact pills. Join-with tiles lift and turn mint when open. People list: pill count, roomier rows, a friendly empty state. Fields show one focus treatment. "Open an invite" is the primary action on the join screen. |
| All HTML pages | Link `/design/pad.css` and `/theme.js`; the pop-out viewer also links the colour tokens. |

To go back to dark only, remove the `#themeToggle` button; Dark is the default.
