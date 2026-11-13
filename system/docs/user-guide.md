# WebRTC Pad user guide

[Quick start and feature list](../../README.md)

## Start and connect

Extract the whole ZIP into a writable folder and run the start script for your operating system. It prepares missing dependencies and opens the browser. Later launches reuse completed setup. Keep the app’s terminal and browser open during the call. See [installation and prerequisites](install.md) for Node, driver setup, and troubleshooting.

1. On the gaming computer, open **Host a session**. For controller-only play, click **Start session** without selecting a share. To send picture, choose a window or screen before starting, or use **Share screen** during the call. For sound only, turn on **Share audio only** and choose a source.
2. In **Invite guests**, choose **Play** or **Just watching**. Download an invite file or copy its text and send it to your guest. Both export the same prepared invite. Use **New invite** for another computer, even if you are still waiting for an earlier reply.
3. On the guest computer, open **Join a session**. Open or drop the invite file on the page, or use **Paste invite text**. Send the generated reply file or copy the reply text back to the host. The host opens or drops the reply file on the page, or uses **Paste reply text**. Keep both apps open while the exchange completes.
4. On each guest computer, press a button on each controller you want to join. The host can confirm the joined players in **Controllers** or **People** and assign those gamepads in the game or emulator.

For a walkthrough, click **?** and choose the guide for controller play, keyboard and mouse play, remote desktop control, or connection help. Hosted invites and a separate recovery route are optional. The local file/text workflow works when a direct route or configured relay is reachable. If Firefox times out during a manual exchange, try a Chromium browser for file pairing or [configure hosted invites](invite-server.md).

## Controllers and input

| Task | Where to go |
| --- | --- |
| Join before or during a call | In **Join with** or **Controllers**, press a button or select the device. Preselected devices join when a Play invite connects. During a call, a new press joins the next available player. |
| Play with a keyboard or mouse | On the guest, choose **Use keyboard & mouse as a controller**. It sends gamepad inputs and works without desktop-control permission. |
| Map or test a controller | Click **Map** on the device card for templates, custom bindings, deadzones, calibration, and portable profiles. Expand **Test** to see live sticks, triggers, and buttons. The host can also test incoming pads. |
| Remove or reorder players | Click **×** beside an assigned controller. The guest can join it again with a fresh button press. **Remember this controller order** in Advanced saves the order for preselected devices on future joins. |
| Pause or block local input | Open **Controllers** to pause sharing. Under **Advanced**, use **Block local controller input** if the optional local helper is set up. |
| Receive the host’s controllers | The host enables **Share my controllers with guests** and selects devices. Each guest opts in under **Controllers → Advanced → Receive host controllers** and chooses a local virtual device or the app-only API. |
| Connect a custom app | Enable **MIDI & app-only input** on the host. The in-app `/app-inputs` guide covers MIDI, independent keyboard/mouse events, the local WebSocket API, and SDK. |

One invite connects a whole computer or TV. Players can use different controller brands, and idle devices take no spots. Browsers may require a button press while the app has focus before they list a controller. Saved mappings change the inputs sent to the host. The host’s output setting chooses the virtual device type seen by the game.

Windows defaults to available XInput slots and can add HID gamepads for larger groups. XInput has four total slots, shared with physical XInput devices. Capacity beyond that depends on HID support in the game, OS, and driver. **Advanced controller setup** offers manual reservations and output overrides for compatibility. See [controller integration and emulator setup](controller-integrations.md) and [host backends](reference.md#host-controller-backends).

Background gamepad sharing is on by default. Browser keyboard input needs focus, and gameplay input pauses while editing mappings or typing in chat. Optional local isolation is separate from streaming. Turning off controller sharing, switching to Host, or closing Join releases the controller reservation. A reservation can stay active between calls while Join is open and sharing is enabled. On Windows, HidHide and Interception are separate opt-ins. Interception has a known unplug/replug issue. See [device isolation, release, and recovery](guest-device-isolation.md).

**Pause all input** releases held controls and selected native devices while the call stays open. Brief connection interruptions also release held inputs. The app keeps player assignments while it tries to reconnect.

Windows virtual controller outputs can send vibration back to supported guest gamepads. The guest can disable it in Advanced. Browser and hardware support varies. With reverse controller sharing, native receiving pauses outgoing sharing to avoid a virtual-device loop. The app-only receiver can work in both directions.

App-only keyboard, mouse, and MIDI events keep each guest and device distinct. They go to integrations instead of the operating system’s input injector. The local API provides status at `GET /api/inputs` and session creation at `POST /api/inputs/sessions`, with separate subscription and publishing credentials. The in-app `/app-inputs` guide documents the event schema and the `InputClient` SDK. Web MIDI needs a supported browser on localhost or HTTPS. The app excludes SysEx and can forward MIDI to an existing output port.

## Screen, sound, and layouts

| Task | Where to go |
| --- | --- |
| Preview, start, or swap a source | Choose a source in **Screen sharing** before starting, or use **Share screen** in the call. **Hide preview** only affects your local view. |
| Share another window or screen | Use **Add screen or window** beside the host’s share button. The share list has per-screen quality, sound, and stop controls. |
| Share a rectangle | Choose a source, click **Select an area…**, draw the rectangle, and choose **Share selected area**. Use **Share full source** to remove the crop. |
| Adjust quality | Open **Settings → Screen → Stream quality** on the host. Use **Global** or pick an individual screen. Adaptive quality can use a minimum resolution. Fixed quality follows the selected limits. Guests set their own maximum under **Stream**. |
| Rearrange the call | Use the layout icons for a single view, grid, side by side, top and bottom, a featured view, or Streamer. Double-click a screen to maximize it. Drag tile dividers or Streamer camera overlays to adjust them. **Reset layouts** restores the defaults. |
| Watch in a separate window | Use **Pop out** for the screen layout or a tile’s Pop out control for that screen. The group window remembers its layout independently. **Add a screen…** adds another available share without closing the window. Fullscreen and layout controls are available inside it. |

**Include audio** is on by default. Browser sharing depends on the picker’s audio options, which vary by source and browser. With supported native capture, a window can share its app’s audio and a whole screen can share system playback. System sound can include calls and notifications. Crop selection affects picture only. Extra shares have separate sound controls. Guests can hide the picture while leaving sound and controllers active, pause the whole stream, or choose **Refresh picture** without rejoining controllers. See [capture methods, audio, encoders, and quality](native-capture.md) and [latency measurements](latency.md).

**Start session** reuses an active preview and otherwise leaves capture off. The app remembers the last Host/Join page and many quality, device, permission, and layout preferences. Remembered sources and named **Saved setups** are available from the sharing controls. A saved preference does not start a microphone, camera, or desktop control. Selecting **Apply settings** in a saved setup updates choices before capture. Switching to Join releases an unused host preview.

On hosts that support desktop input, **Keyboard & mouse** allows **Shared window only** or **Entire desktop**. Both start off. **Guest pointers** is a separate visual option, also off by default. Several guests can point independently. Approved mouse control uses the host’s one system pointer. Guests can also use a mouse pad with video off. See [desktop scope, permissions, and overlays](desktop-control.md).

## Voice, cameras, chat, and switching hosts

| Task | Where to go |
| --- | --- |
| Set up devices before joining | **Join with** shows ready controllers and camera/microphone controls. A camera preview stays private until connected and permitted. |
| Talk or listen | Use **Mic** or **Listen only**. Voice settings include input gain, a meter, output, volume, push-to-talk, and optional sound ducking. |
| Share a camera or screen as a guest | Use the call controls after connecting. The host separately allows guest screens, cameras, and microphones in **Guests & access**. |
| Mute for yourself or manage the call | In **People**, use a participant’s mic or camera controls for personal mute/hide. The host has separate controls to apply permissions or limits for the call. |
| Message or send a file | Open **Chat**. Press Enter to send and Shift+Enter for a new line. Use the paperclip next to Send to offer a file. |
| Switch the game host | In **People**, choose **Make host** beside a guest. They accept and the app prepares their local hosting setup before moving the group. |

Camera settings are independent of shared screens. The default camera target is 480p at 24 fps. Call-wide and per-guest limits are available, with optional adaptive quality. The Streamer layout places a camera or avatar over its owner’s screen. Personal media controls affect your endpoint. See [voice, cameras, moderation, and diagnostics](voice-and-diagnostics.md).

Chat keeps up to 100 messages, with 1,000 characters per message, in memory for the call. New guests receive recent history. The chat works over fullscreen video and clears when you leave. The host can disable file offers or enable optional **Clipboard text sharing** under **Guests & access**. Clipboard sharing requires explicit Send and Copy actions and supports up to 8,000 characters.

Files are offered up to 64 MB each. The recipient clicks **Receive**, then **Save file**. Transfers use a separate channel paced at up to 256 KB/s each, yield to input and video traffic, and allow one incoming download at a time with a 128 MB received-file cache. Offers clear when the relevant participant leaves, when file sharing is disabled, or when the host changes. Previously saved copies stay on disk.

A host change keeps voice, cameras, and recent chat. The old host’s screen share stops, and desktop input permissions start off on the new host. The new host needs the local app and a working controller backend for controller players. They can choose a new screen or continue with controllers only. Create new invitations after switching. Declining or cancelling preparation keeps the existing host in place.

## Troubleshooting and appearance

| Symptom | What to try |
| --- | --- |
| A controller is missing or the game ignores it | Focus Join and press a button. Check **Controllers → Test**, then verify the player assignment and select the virtual gamepad in the host’s game. See [controller setup](controller-integrations.md). |
| The picture is black, choppy, or silent | Check the host preview and chosen audio source. On the guest, turn on sound and try **Refresh picture**. Adjust the stream limits if playback stutters. |
| The guest cannot connect | Keep both apps open, exchange a fresh invite/reply, and try **Settings → Connection → Test this connection**. Public STUN helps find direct routes. Restrictive networks may need [TURN](self-hosted-turn.md). |
| You need a report | Open **Having trouble?** from **?** or Settings, choose the issue, and click **Save diagnostic file**. For live measurements, open **Diagnostics & charts** and export CSV if needed. |

On the host, **People → More → Check guest view** requests a small snapshot of the guest’s received game picture and readings for frame rate, buffering, decoding, and audio. It uses the received game stream, and the guest sees a notice. Diagnostic files redact addresses, credentials, and device names and omit chat and input content.

Move the pointer or tab to controls in fullscreen to reveal them. The same call panels work at narrow widths. Join and leave sounds are on by default and can be turned off in settings. Use **Settings → Appearance** for previews of Classic, Signal, Cobalt, and Light. Layout changes apply during the call. To add a custom layout, see the [theme pack guide](../public/themes/README.md).

## Optional services and launch shortcuts

Role and setup shortcuts live under `windows/shortcuts/`, `linux/shortcuts/`, and `mac/shortcuts/`.

| Shortcut | Purpose |
| --- | --- |
| `01-Host` / `02-Join` / `03-Start` | Open a specific role or reuse your last view. |
| `04-Connection-Setup` | Edit the local `.env` in a guided console menu. |
| `05-Run-Relay` | Run a [coturn relay](self-hosted-turn.md) for networks that need TURN. |
| `06-Run-Recovery` | Run the separate [HTTPS recovery endpoint](port-forwarding.md). |
| `07-Host-Native` / `08-Install-Only` | Prepare native capture and open Host, or prepare dependencies only. |
| `09-Guest-Exclusive-Setup` | Prepare [optional local device isolation](guest-device-isolation.md). |
| `10-Run-Invite-Server` | Run [hosted signaling](invite-server.md) for temporary names and approval links. |
| `99-Uninstall.cmd` | Clean up the Windows app or optionally remove settings and blocking drivers. See [uninstall options](uninstall.md). |

Manual pairing uses [public STUN defaults](public-stun.md) when no ICE settings are configured. Hosted invites automate the exchange. TURN carries media and input if the peers need a relay. Recovery helps an existing call re-establish a connection. Each service has its own setup and the app only shows its controls when available.

## Platform details

| Native feature | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Virtual gamepads | ViGEmBus XInput and HID | Python with write access to `uinput` | Experimental virtual HID, which may require Apple-authorized signing |
| Video | Native capture with supported hardware encoders | Native capture on X11. Use the browser on Wayland. | Experimental ScreenCaptureKit and VideoToolbox on macOS 13+ |
| Playback audio | App or system capture when supported by Windows and the native helper | App or system capture on X11. System capture on Wayland. | Experimental app and system capture on macOS 13+ |
| Scoped desktop input | Selected window or whole desktop | X11 window or desktop. Wayland screen control requires a compatible portal. | Experimental, with Accessibility permission |
| Desktop cursor overlay | Supported for verified sources | X11 click-through overlay | Experimental click-through AppKit overlay |
| Guest device isolation | SDL3 with optional HidHide or Interception | evdev with access to the selected devices | Experimental per-device HID access with Input Monitoring |

Windows has the most hands-on coverage. See [Linux setup](linux-desktop.md), [macOS setup](macos-desktop.md), and [validation notes](validation.md) for tested paths and pending hardware checks.

For development, `npm test` runs the test suite, `npm run check` checks JavaScript syntax, and `npm run package` builds `releases/WebRTC-Pad.zip` without local credentials or dependencies.
