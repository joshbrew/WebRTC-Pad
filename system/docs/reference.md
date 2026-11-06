# Technical reference

[Start here](../../README.md) for the platform launchers.

## Player counts

The browser defaults to press-to-join: Play invitations reserve no controller seats, and virtual devices are created only after a guest presses a button on a controller. Host/client removal frees an individual device; other controllers retain their slots. Manual reservation remains in advanced setup. `PLAYER_COUNT` sets the console/manual default. On Windows, default `WINDOWS_CONTROLLER_TYPE=auto` mixes available XInput slots with HID for additional devices. Optional `WINDOWS_CONTROLLER_TYPE=x360` uses [XInput’s four slots](https://learn.microsoft.com/en-us/windows/win32/xinput/getting-started-with-xinput); `ds4` uses HID/PlayStation-layout devices for compatible games with larger groups. Press-to-join in Automatic/HID/Linux/macOS modes grows as controllers join, without a fixed application controller cap; browser, driver and game limits still apply. Advanced manual setup reserves an initial batch of 1–64 devices (1–4 for XInput-only output); that startup setting does not cap adaptive rooms. `MAX_PEERS` limits computers, independently of controller count.

`MAX_PEERS=0` (the default) removes the configured participant limit; set a positive value to limit players and viewers together. This is not unlimited performance: each person has a separate peer connection and stream, so host upload, encoding capacity, memory, and browser limits determine practical session size.

The host can put the game fullscreen while leaving the host browser open in the background. The browser owns the input/control connection and session UI; native capture sends encoded video through its own helper when selected. The local Node process and controller helper operate the virtual devices. Keep the host browser and Node app open.

## Call controls and stream quality

The guest sees the shared screen as the main call view, with joining and controller steps alongside it. The host sees setup before Start, then guest controls and invites in the main area with a compact preview beside them. Stop session stays on the call toolbar; Hide preview pauses only the local view. Advanced connection details are collapsed under settings. The **?** button opens floating tips beside highlighted application buttons. The guide opens at the next relevant action, highlights the matching control, and advances as you start, exchange an invite/reply, and join a controller. Other guides are collapsed under **Other guides**. It appears once for each role and can be replayed. Controller, sound, pop-out, fullscreen, and leave controls stay below the video. Layouts adapt to narrow screens, and the host/player tabs support keyboard navigation.

When the browser fullscreens the game panel, its existing call controls move inside the picture and fade after inactivity. Moving the pointer or focusing a button reveals them; exiting restores their usual position. Toolbar mouse events stay local even during desktop control. **Refresh picture** reconnects the active browser/native media path, including selected native audio with browser capture, while retaining the controller connection. A short cooldown prevents repeated clicks from stacking requests. **Pause all input** appears during desktop or exclusive input: it neutralizes controllers, releases mouse buttons/typing and selected native devices, and leaves video connected. Resume controllers or explicitly enable mouse/typing again to continue. Leaving or closing the input connection exits the fullscreen panel; temporary media recovery does not.

**Pop out** becomes available when video starts and the browser supports the Picture-in-Picture API. **Bring back** closes it; the floating window's close control works too. Physical gamepad polling remains enabled while PiP is active, even if the main tab loses focus. Keep that tab open. Keyboard controls require focus in the main page. Browser background/device policies may still affect polling; actual physical gamepads should be checked on your target browser. [Chrome's video PiP API](https://developer.chrome.com/blog/watch-video-using-picture-in-picture) supports live MediaStreams.

On the host, choose the quality button (for example **1080p · 60 fps**) to open stream settings. Resolution choices are 720p, 1080p, 1440p, 4K, or original screen size; frame rates are 15, 30, 60, or 120 fps. Changes apply while sharing and are remembered for the next session. Capture constraints and negotiated encoder limits cap resolution/frame rate, and the bitrate budget follows the chosen quality. The source readout shows what the screen/browser actually provides; a 30 fps source cannot become 120 fps. Network adaptation may reduce delivered quality.

Browser capture uses the browser’s media pipeline. Optional native capture uses FFmpeg plus a separate Pion WebRTC helper, with shared encoding for matching client profiles. Native controller injection runs in independent helper processes, with its own watchdog. No JavaScript frame-copying or software encoding loop runs on the UI thread. Browser gamepad reading remains on the main thread because the Gamepad API is exposed there; messages are small snapshots rather than queued button events. While PiP is open or background gamepad mode is enabled, a dedicated worker supplies input ticks and rendered-video callbacks provide another fallback, sharing a rate cap. This reduces dependence on hidden-page timers. Browser/OS scheduling and device policies can still reduce the sampling rate.

Manual file and copied-text exports share one prepared invite and ICE offer. Repeating either export creates no additional peer. **New invite** prepares a separate invite for another computer; earlier pending replies remain valid until their ten-minute expiry. Used or expired invites require **New invite**. Hosted link approvals continue to prepare an independent offer for each accepted computer. The capture method and encoder override are under **Capture method & encoder**; supported native capture is selected automatically unless a browser preference was saved.

## Host controller backends

### Windows 10/11

ViGEmBus defaults to automatic mixed Xbox/XInput and HID/PlayStation-layout output, with optional forced compatibility modes. Press-to-join creates and removes individual virtual devices dynamically:

1. Install the production-signed [ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases) if it is not already installed. Restart if requested by its installer.
2. From this project run:

```sh
npm run driver:windows
npm run driver:check
```

The binding is pinned to `vigemclient@1.5.3`. If a native build is needed, install Visual Studio Build Tools with Desktop development with C++, the Windows SDK, and Python. Install the binding **after** `npm ci`, which removes packages installed with `--no-save`. The Windows host installer can install ViGEmBus through winget; manual npm commands do not install the OS driver. Joining setup skips host drivers entirely.

The diagnostic reports `Ready: ViGEmBus (automatic mixed gamepads)` by default, or the selected forced Xbox/HID mode. It uses `PLAYER_COUNT` and `WINDOWS_CONTROLLER_TYPE` for a temporary driver check. In the browser, the compatibility selector chooses the output independently of incoming controller brands. App P1/P2 labels do not necessarily equal Windows’ global device indices. Only Xbox output shares XInput’s four indices with other local XInput pads.

[ViGEmBus is retired](https://github.com/nefarius/ViGEmBus#readme). This compatibility backend is usable with an existing signed installation, but a maintained replacement should be chosen before committing to long-term Windows driver distribution.

### Linux

Python 3 and a modern kernel's `uinput` interface are sufficient. There is no npm native input module or third-party Python dependency.

On distributions using an `input` group, an administrator can configure:

```sh
sudo modprobe uinput
sudo groupadd -f input
sudo usermod -aG input "$USER"
printf '%s\n' 'KERNEL=="uinput", SUBSYSTEM=="misc", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"' | sudo tee /etc/udev/rules.d/70-webrtc-pad-uinput.rules
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=uinput
```

Log out and back in after changing group membership. The Node app should run as your regular user. The relevant permission is write access to `/dev/uinput`; adjust the group/rule for your distribution. Set `PYTHON` in `.env` if the interpreter is not named `python3`.

Run `npm run driver:check` and verify `webrtc-pad-p1` through your configured player count in the emulator's input configuration. Devices expose face buttons, shoulders, sticks, analog triggers, and a D-pad. The helper uses the kernel's [modern uinput setup interface](https://www.kernel.org/doc/html/latest/input/uinput.html), closes devices on exit, and releases stale inputs independently of the server.

Linux device creation has not been hardware-tested in this Windows workspace.

### macOS — experimental host backend

A native helper in `system/native/macos-gamepad.c` creates the configured number of generic HID gamepads using Apple's IOHIDUserDevice API. Build it on a Mac with Xcode Command Line Tools:

```sh
npm run driver:macos:build
```

Device creation on current macOS may require the Apple-authorized `com.apple.developer.hid.virtual.device` entitlement. `system/native/macos-hid.entitlements.plist` records the required entitlement. A shipping build needs the appropriate Apple signing identity/provisioning, authorization for that entitlement, and notarization. Simply adding an entitlement to an ad-hoc signature does not grant authorization.

With an authorized signing identity, the signing step takes this form:

```sh
codesign --force --options runtime --entitlements system/native/macos-hid.entitlements.plist --sign 'Developer ID Application: YOUR IDENTITY' system/native/webrtc-pad-hid
npm run driver:check
```

Set `MACOS_HID_HELPER` to use a separately built, compatible signed helper. Grant browser Screen Recording permission for capture.

**macOS host support is not a verified, ready-to-distribute driver package.** Build/signing and recognition must be validated on target Macs. Generic HID recognition is primarily intended for HID/SDL-capable emulators; it does not promise Xbox identity or universal Apple GameController recognition. macOS users can already act as remote players without this helper. If creation is denied or the helper is missing, the UI reports the problem and still supports video.

## Optional desktop control

Desktop mouse and typing are separate, default-off permissions with host/guest confirmations. The video area can also work as a mouse pad with video off, using the host’s reported display dimensions. Guest cursors use colors by default; the host can toggle labels. These are shared OS mouse/keyboard inputs, while each guest’s keyboard controller uses their own virtual gamepad. See [desktop control and platform prerequisites](desktop-control.md).

## Controller recognition and mapping

Standard browser Gamepad layouts work automatically with a configurable stick deadzone and analog triggers. Nonstandard controllers require an explicit layout under **Controller mapping & options**. The live readout shows button/axis numbers; layouts are saved per controller and browser. Axis-based triggers and reversed axes are supported. Unrecognized controllers are not silently assigned an incorrect Xbox layout.

The browser recognizes and normalizes the player's hardware, then sends canonical Xbox-style controls. Node creates the virtual device on the host: selectable XInput or HID on Windows, uinput on Linux, and experimental generic HID on macOS. The player's controller does not need to be an Xbox pad. The host's emulator binds that virtual controller in its usual controller settings. See [controller integrations](controller-integrations.md) for native SDL reader options, the free SDL mapping ecosystem, and driver distribution considerations.

Inputs use an unordered WebRTC channel with zero retransmits and full state snapshots at up to 60 Hz. The host discards stale sequence numbers and trusts its own player assignments. A separate reliable WebRTC control channel carries assignments and connection updates. Inputs release on disconnect, channel loss, controller removal, or a stale-input timeout. Losing page focus releases keyboard input and pauses physical pads unless PiP or “Keep my gamepad active” is enabled. Closing PiP while unfocused releases the pad unless background gamepad input is enabled. Native helpers also have independent watchdogs. Rumble, motion, touchpads, and camera/microphone chat are not implemented.

## ICE configuration

No relay account is required for direct connections. With ICE settings unset, the app uses the [built-in public STUN catalog](public-stun.md), including Cloudflare, Google, Twilio, Nextcloud and other providers. Public services can be unavailable, and STUN cannot relay traffic through restrictive NAT/firewalls. Use TURN when a direct route cannot be established.

`STUN_URL` overrides the defaults with comma-separated addresses. `TURN_URL` adds your relay to the STUN list. A complete `ICE_JSON` overrides both lists and hosted credential lookups. The console's manual-files preset clears provider settings and follows the built-in public defaults. Existing `.env` settings are preserved unless you change them explicitly.

### Optional Metered STUN/TURN

`npm start` and `npm run dev` load an optional local `.env`. A working local configuration with the supplied Metered account settings is present in this workspace. **It is excluded from Git and distribution archives.** For another installation, copy `.env.example` to `.env` and configure your own provider settings:

```dotenv
METERED_DOMAIN=your-app.metered.live
METERED_API_KEY=your-credential-api-key
# Optional fallback if the credential API cannot be reached:
METERED_USERNAME=your-turn-username
METERED_CREDENTIAL=your-turn-password
METERED_RELAY=global.relay.metered.ca
ICE_TRANSPORT_POLICY=all
```

The local server fetches `/api/v1/turn/credentials` from your Metered app, validates the list, and caches it for five minutes. Failed lookups use an explicitly configured fallback and show a warning. Without a fallback they report an error. The API key is never served to the browser or included in a pairing file; RTC TURN usernames/passwords are included because peers need them to use the relay. Players using text-file pairing inherit the invitation's relay configuration and do not need your API key.

The provided fallback transports cover STUN on port 80, TURN UDP/TCP on port 80, TURN on port 443, and TLS TURN over TCP on port 443. Set `ICE_TRANSPORT_POLICY=relay` to test relay-only operation. Normal `all` mode prefers whatever direct or relay route ICE selects. Global-region availability depends on the Metered plan; the dynamic API supplies the provider's applicable server list. See [Metered's credential API](https://www.metered.ca/docs/turn-rest-api/) and [region documentation](https://www.metered.ca/docs/turnserver-guides/turnserver-regions/).

For other providers, use `TURN_URL` (comma-separated URLs), `TURN_USER`, and `TURN_CRED`, or supply a complete `ICE_JSON={"iceServers":[...]}` in `.env`. Explicit `ICE_JSON` takes precedence over the Metered API.

## Connection updates, recovery, and forwarded ports

Normal WebRTC keepalives, consent checks, and TURN allocation refresh are performed by the browser. They do not require a separate application socket. Media can start/stop/restart without new pairing files. Offers/answers for later renegotiation travel over the reliable peer control channel, including updated relay credentials fetched by the local host. **Refresh connection** performs an ICE restart through that channel while it is still usable; network-change notifications also attempt a refresh. No central signaling service is involved.

If the peer path is completely broken, that same path cannot carry recovery signaling. The optional **port-forwarding fallback** adds a separate WSS connection directly to the host for text-paired users. Enable `SIGNALING_FALLBACK=1` and `PUBLIC_URL=https://your-hostname` with the included Caddy/router configuration. Each new invite includes its own random peer-scoped capability. A broken peer connection can then rebuild without another file exchange; game input and media remain on WebRTC. Removing a player or ending/resuming the host session revokes its capability. Reloading either browser still requires fresh pairing. Without a reachable fallback, exchange new files after a complete failure.

Follow [the complete setup guide](port-forwarding.md), also available from host settings. Templates are in [system/config/Caddyfile](system/config/Caddyfile) and [system/config/port-forwarding.env.example](system/config/port-forwarding.env.example). The recommended setup forwards TCP 80/443 to Caddy and exposes only `/fallback`. Node stays bound to loopback, and port 8787 stays private. Keep TURN: TCP signaling reachability does not guarantee a direct WebRTC media route. Public router reachability requires validation on your own network.

An optional shared-address mode is retained in the collapsed panels. It uses this app's `/ws` signaling service, includes reconnect negotiation, and still sends media/input over WebRTC. For that alternative, expose the host server through trusted HTTPS/WSS (a local reverse proxy or `TLS_CERT` + `TLS_KEY`) and configure a public address before starting hosting. Forwarding the signaling TCP port can make a self-hosted signaling service reachable; it does not by itself guarantee browser WebRTC UDP connectivity, and it cannot overcome an ISP's CGNAT. This optional mode is opened through the host's HTTPS address; it is distinct from two-local-app text pairing.

The default local configuration binds `127.0.0.1`. Shared-address mode is separate from the restricted Caddy fallback template and needs a deliberately configured public app endpoint. A full-app reverse proxy must preserve the original Host and Origin headers. Host management and controller injection are accepted only through a loopback connection addressed as localhost/loopback; room participants cannot issue host commands. Room IDs and host keys are generated randomly. Only local host pages or holders of an active room ID can fetch that host's ICE settings.

## Validation and source package

```sh
npm run check
npm test
npm run driver:check
```

Additional opt-in smoke tests:

```sh
node system/scripts/smoke-windows.mjs
node system/scripts/smoke-pairing.mjs
node system/scripts/smoke-browser.mjs
node system/scripts/smoke-ui.mjs
node system/scripts/smoke-fallback.mjs
node system/scripts/smoke-install.mjs
node system/scripts/smoke-controller-only.mjs
node system/scripts/smoke-pre-session-source.mjs
node system/scripts/smoke-quick-start-flow.mjs
node system/scripts/smoke-quick-start-input.mjs
node system/scripts/smoke-ui-convenience.mjs
node system/scripts/smoke-pairing-usability.mjs
node system/scripts/smoke-session-tours.mjs
node system/scripts/smoke-native-ui.mjs
node system/scripts/smoke-encoder-ui.mjs
node system/scripts/smoke-native-av.mjs
```

Browser smoke scripts require a separately installed Playwright and Edge (or `BROWSER_CHANNEL=chrome`). Set `PLAYWRIGHT_MODULE` to the absolute Playwright `index.mjs` path when using an existing tooling installation. `REAL_DRIVER=1` enables the real host backend. `TEST_RELAY=1` with `node --env-file=.env system/scripts/smoke-pairing.mjs` tests the live Metered API and forced relay transport. The scripts replace only the screen chooser with animated canvas capture; WebRTC media, control channels, input delivery, and optional XInput reads are real. Tests use no central signaling service in the text-pairing case.

The fallback smoke test also needs OpenSSL (`OPENSSL_BIN` can specify its executable). It creates temporary test certificates, then verifies video and input after intentionally breaking WebRTC between two local apps. The UI smoke test exercises real PiP and fullscreen APIs, simulated gamepad input over actual WebRTC with an unfocused page, and live resolution/FPS changes. See [the validation record](validation.md) for the scope and limitations.

`python system/scripts/package.py` creates `releases/WebRTC-Pad.zip` containing source, setup instructions, tests, and helper source. It excludes local secrets, installed dependencies, old placeholder builds, browser screenshots, and the previous archive. It is a source distribution, not a signed native installer. Install Node dependencies and the relevant host backend on the destination machine.

`smoke-native-av.mjs` is a Windows hardware acceptance test. Run native setup first. It builds two temporary animated test windows, plays quiet tones from separate app processes, and measures the actual decoded preview/guest audio to verify app-only isolation and system capture. It also checks preview adoption, continuing video and controller input after audio is disabled, and cleanup. It captures the primary screen during its system-audio stage; close private windows before running it.
