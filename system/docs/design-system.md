# Production integration

The supplied design archive is the visual reference below. The live app imports its tokens, component stylesheet, local Inter fonts and assets from `system/public/design/`. `system/public/design-app.css` adapts the existing production DOM to the kit’s layout. The font license is bundled in `design/fonts/OFL.md`.

The preview is permanently docked in the host sidebar. Setup stays in the main column; an active session has a next-action banner and invite/guest-control columns that stack on small screens. Native capture, audio, online invites, device isolation and the real guided tours retain their existing state and permissions. The archive’s uploaded app snapshot and simulated React workflows are reference material only. They do not replace the production backend or introduce React/Babel/CDN dependencies.

Diagnostics uses one selectable 110-pixel WebGPU chart with seven current numeric readings, bounded recording, pause/reset/export, and the existing visibility cleanup. Phones up to 700 pixels wide use a fixed bottom view switcher: Room/Screen/Voice/Settings for hosts and Game/Controllers/Voice/Settings for guests. Panels keep their state and connections while hidden, and guide/focus actions reveal the appropriate tab. Help pages share the same fonts and tokens. The package builder includes the new SVG/font assets and excludes the original archive and private configuration.

---

# WebRTC Pad Design System

WebRTC Pad lets friends play a game on your computer with their own controllers. Everyone runs the same local Node app in a browser. The **host** starts a session and sends an **invite** file. The **guest** opens it, sends back a **reply**, then presses a button on each controller to join. Video is optional; many groups watch on Discord and use WebRTC Pad only for input.

**One surface:** the local browser app (`system/public/index.html`), with two modes, *Host a session* and *Join a session*, plus a few static help pages that share its stylesheet.

**Source:** `uploads/WebRTC-Pad/` (from `WebRTC-Pad.zip`). Everything here comes from `system/public/style.css`, `index.html`, `ui.js`, `app.js`, `voice.js`, `sessions.js`, `cursors.js`, the guide pages, and `README.md` / `system/docs/`. No Figma, brand guide or logo files were provided.

---

## Files

| Path | What |
|---|---|
| `styles.css` | Entry point. `@import`s only. |
| `tokens/` | `fonts` · `colors` · `typography` · `spacing` · `effects` · `base` |
| `components/components.css` | `wp-*` classes, ported 1:1 from `style.css` |
| `components/<group>/` | React primitives: `.jsx` + `.d.ts` + `.prompt.md` + one card |
| `ui_kits/app/` | Click-through app (`index.html`) and a guide page (`guide.html`) |
| `guidelines/` | Foundation cards: colour, type, spacing, brand |
| `assets/` | `brand-mark.svg`, `icons/*.svg`, `icons/sprite.svg` |
| `fonts/` | Inter Variable (latin, latin-ext) |
| `SKILL.md` | Agent Skill entry |

## Components

Namespace in cards: `window.WebRTCPadDesignSystem_9fbfb8`.

- **core** · Icon, ICON_PATHS, Button, HelpButton, Kbd, Dot
- **navigation** · Brand, ModeSwitch, QuickPath
- **layout** · AppHeader, AppFooter, Eyebrow, ViewHeading, SectionHeading
- **feedback** · StatusPill, Notice, Toast, PairStatus, PairError, InlineSuccess, MicroNote, InputHealth
- **forms** · Field, TextInput, Select, TextArea, CheckRow, FileButton
- **cards** · SidebarCard, SettingsCard, CollapsibleCard, Disclosure, Step, StepNumber, QuickStart, SourceSetup, SourceBlock, NextStep, SlotCard, StatRow, PlatformNote
- **people** · Avatar, SelfPerson, PeerRow
- **controller** · KeyboardHelp, ControllerTest, MappingGrid, MappingRow, NativeDevice
- **stage** · VideoStage, StageEmpty, StageLabel, CallToolbar, ToolbarDivider, UnderStage, GuestCursor
- **overlay** · Dialog, DialogBody

Each maps to a class family in `style.css` (`.button`, `.status-pill`, `.step`, `.file-button`, `.peerRow`, `.video-stage`, `.tour-popover`…).

**Intentional additions**
- `Icon` / `ICON_PATHS`: the app uses `<use href="#i-…">` against an inline sprite; this exposes the same glyphs without the sprite.
- `Dialog` is a `div[role=dialog]`, not `<dialog>`, so it can sit statically in mocks.

**Not built:** diagnostics charts (uPlot/WebGPU), the encoder-check panel, hosted "Online invites" cards, and the macOS / Linux / device-isolation help pages (they reuse the `guide.html` styling).

## UI kit

`ui_kits/app/index.html`
- **Host:** Start a session → Download invite file or copy invite text → Open or paste reply → guest appears. Use New invite for each additional computer; screen sharing and voice are optional.
- **Join:** Open an invite → Save reply & send it back → connects → Set up my controllers.
- **?** opens the tour popover and outlines its target.

`ui_kits/app/guide.html` is the static "Help friends reconnect." page.

---

## Content

**Voice.** Friendly, practical, calm. Second person: *you*, *your friend*, *your guest*, *your host*. "We" appears once (*We'll make your reply automatically.*), "I" never. Copy explains consequences before they happen.
> Keep this page open. You can switch to your game and play fullscreen.
> Confirm access only for guests you trust.

**Casing.** Sentence case everywhere. Only eyebrows are uppercase and tracked, and they can be little taglines:
`LET'S PLAY TOGETHER` · `GOOD GAMES. GOOD COMPANY.` · `SAME GAME. DIFFERENT COUCHES.` · `JOIN A GAME`

**Headlines.** Short noun phrases (*Your game room*, *Your friend's game*) or friendly imperatives with a period (*Help friends reconnect.*, *Let's play together.*).

**Buttons** are verbs naming the outcome: *Start a session*, *Create invite*, *Save reply & send it back*, *Join with keyboard controls*, *Stop session*, *Leave*. Toggles show the current state: *Stream on / Stream off*, *Sound on / No audio*, *Hide preview*.

**Punctuation.**
- `·` joins a name and its explanation: *Play · press a controller button to join*, *1080p · 60 fps*, *Host · this computer*, *1 · Open invite*.
- `—` in options that describe a trade-off: *720p — lighter on your network*.
- `…` for choosers and progress: *Choose window or screen…*, *Making your invite…*
- Curly apostrophes, real arrows (→ ←) and keys (↑ ↓). **No emoji.**

**Errors and toasts.** One or two short clauses: what happened, then what to do.
> Open your host's invite first. · Copied. Send it to your friend. · Drop one invite or reply file at a time.

**Honest limits.** *STUN alone cannot connect every network.* Docs bold UI labels (**Start a session**) and put files and env vars in `code`.

---

## Visual foundations

**Mood.** A dark living room at night: warm graphite with one soft mint accent, quiet chrome so the game is the brightest thing on screen. Dark only.

**Colour**
- Neutrals: page `#121416`, card `#1b1e21`, stage `#0b0d0f`, hairline `#303538`, text `#f1f3ee`, muted `#949b9c`.
- Accent: mint `#d0f79b` with ink `#223313`. Hover `#e0ffb5`.
- Moss tints: hand-picked green surfaces instead of opacity (setup `#1b241a`, file drop `#252e20`, active control `#26321f`, completed step `#334429`).
- Status: amber warning `#ead8b0` on `#3a3021`; rose danger `#f5b7b7` on `#442a2d`; lilac friend avatar `#c5c9ed` on `#34364a`.
- Players: 6 pastel colours for cursors and avatar rings (mint, sky, peach, lavender, butter, pink).

**Type.** Inter, `font-synthesis: none`. Base 14/1.5, but most UI text is small: 12px buttons and inputs, 11px notes, 10px captions.

| Role | Size / weight / tracking |
|---|---|
| Stage headline | 27 / 550 / −.85px |
| H2 | 25 / 600 / −.8px |
| Wordmark | 19 / 500 + 750 / −.6px |
| H3 | 15 / 650 / −.2px |
| Eyebrow | 10 / 650 / +1.65px, uppercase |

Mono (`ui-monospace, Consolas`) is only for invite text and code.

**Layout.** 1560px max shell, 36px side padding, 100px header with a bottom hairline. Fluid main column + 326px sidebar (360px during a host session), 26px gap, 15px between sidebar cards. Breakpoints 1450 / 1190 / 860 / 560. Spacing values are irregular (5, 7, 9, 13, 15, 17, 21, 22, 26…); copy them exactly.

**Cards.** Flat: `#1b1e21`, 1px `#303538` border, 17px radius, 22px padding, **no shadow**. The setup card is the moss variant (20px radius). Sections inside a card are split by 1px hairlines, not nested boxes. Settings cards use "+" / "−" on the right.

**Radii.** 4 kbd · 8 status · 9 input · 10 button · 12 notice · 13 tab track · 16 tour · 17 card · 20 stage/dialog · 30 pill · 50% avatar.

**Borders.** 1px everywhere. Dashed only for the file drop zone. The tour popover gets a 2px mint border, 5px on the side facing its target.

**Shadows.** Only on floating layers: tab `0 2px 4px #0002`, toast `0 10px 40px #0005`, tour `0 15px 65px #000b`, dialog `0 30px 100px #0008`. A live dot gets a faint 3px mint ring.

**Imagery.** No photos. The single illustration is drawn in CSS: a rounded "screen" tilted −4° with a hard offset shadow, the hero glyph, two "+" sparks and a soft mint glow. The guest mouse pad has a faint 32px mint grid. Gradients are rare and subtle, never full-bleed.

**Transparency and blur.** Only over video: stage label `#121719da` + 10px blur, quality badge `#101714dc`, dialog backdrop `#040805b8` + 5px blur.

**Motion.** Minimal. Background/border transitions .15s, fullscreen toolbar fade .18s, default easing, no bounces. `prefers-reduced-motion` turns transitions off.

**States**
- Hover lightens: `#303639 → #3e4649`, mint → `#e0ffb5`, danger → `#63363c`.
- No press transform.
- Disabled: opacity .38.
- Focus: 2px mint outline, 4px offset.
- Tour target: 3px mint outline + soft glow.

**Fixed elements.** Toast bottom-centre, tour popover next to its target, demo notice bottom-left. The header doesn't stick.

---

## Iconography

- **Source:** a hand-made inline SVG sprite in `index.html` with 13 symbols: pad, share, stop, people, file, download, copy, volume, expand, leave, check, arrow, settings. The pop-out glyph is inline on its button; the guest cursor comes from `cursors.js`.
- **Style:** 24 grid, outline, 1.7 stroke, round caps and joins, `currentColor`.
- **Sizes:** 20 default · 17 in buttons · 18 card headings · 16 settings · 14 under-stage · 12 inline success · 25 brand tile · 54 stage hero (1.1 stroke).
- **Files:** `assets/icons/<name>.svg`, the full sprite in `assets/icons/sprite.svg`, and the `Icon` component.
- **Not used:** icon fonts, PNG icons, emoji.
- **Unicode as icons:** `?` and `×` help buttons, `+` / `−` disclosure markers, `+` sparks, `←` back link, arrow keys in `<kbd>`. Chevrons on `<details>` are CSS.
- **Missing a glyph?** Use [Lucide](https://lucide.dev) at 1.7 stroke and flag it as a substitution.

## Brand mark

There's no logo file in the source. The in-app mark is the `pad` glyph on a 36px mint tile (12px radius) next to "WebRTC **Pad**". `assets/brand-mark.svg` is copied straight from that markup, and `Brand` renders the full lockup. Don't invent other marks.

## Fonts

`style.css` lists Inter first but the app doesn't ship it, so on Windows it actually renders in Segoe UI. This system ships Inter Variable (Google Fonts v20) so designs look the same everywhere.
