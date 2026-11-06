# Installation and launch

Extract the complete ZIP into a writable folder. Keep the platform folders beside `system` and `package.json`. Both people run the app; only the gaming computer needs a virtual gamepad backend.

To uninstall on Windows, close the app and run `windows/shortcuts/99-Uninstall.cmd`. Basic cleanup keeps settings and drivers. Separate choices remove local settings, HidHide controller blocking, Interception keyboard/mouse blocking, or both. Each choice lists exactly which drivers are removed or kept; ViGEmBus host virtual controllers are kept. See [uninstall options and recovery](uninstall.md).

Reinstalling the app can reuse HidHide and Interception left installed in Windows. Before asking to install either missing driver, setup checks its Windows registration and driver files; Interception also needs both keyboard/mouse filters registered. Existing drivers are reused without another installation question, even when the app's previous setup records are gone. Saved No choices remain respected. Regular launches with saved choices keep the fast startup path.

**10-Run-Invite-Server** is an optional separate signaling service for temporary names and automatic session links. It needs only the joining/base dependencies. Local apps show those controls only after `SESSION_SERVER_URL` is configured. See [hosted invite setup](invite-server.md) for HTTPS and port-forwarding distinctions.

## Windows

Double-click `Start-Windows.cmd`. Generic Start checks and prepares both hosting and joining, even if your saved view is Join. It checks the Windows controller binding and installed virtual-controller driver, repairing missing or incompatible components before launch. It retains your saved opening view. Use `windows/shortcuts/01-Host.cmd` or `windows/shortcuts/02-Join.cmd` only to select a role directly; the Join shortcut needs only the joining dependencies. Keep the command window open while playing. Later starts skip unchanged setup. An already-running app is reused without installing packages or drivers under its session; close it and run Start again if a repair is needed.

`Start-Linux.sh` and `Start-Mac.command` use the same generic readiness checks for both roles. Missing or outdated optional input readers are prepared when possible; missing OS permissions or optional reader setup failures leave browser controller sharing available. Platform system prerequisites can still require manual installation or OS approval.

Missing Node.js is installed through winget when available. Host setup installs the pinned ViGEmBus 1.22.0 driver if absent. Windows can request administrator access or a driver restart. If winget is unavailable, install [Node.js](https://nodejs.org/en/download) and, for hosting, [ViGEmBus](https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0), then retry.

The `vigemclient@1.5.3` binding is a pinned optional Windows dependency, so dependency updates retain it. Host startup checks that it loads with the current Node.js version, and host setup installs or rebuilds it if needed. It may need Visual Studio Build Tools with Desktop development with C++, Windows SDK and Python. These build tools are not downloaded automatically. If host driver setup fails, video/joining remain available and the controller cards show the host error on both computers. A guest seeing a forwarded `vigemclient` error does not need to install it; repair the host with `windows/shortcuts/01-Host.cmd`. ViGEmBus is retired; it remains this app's Windows compatibility backend.

Guests can press a button before connecting to mark that controller **Ready to join**, or select it in Controllers. Selected controllers join automatically after connecting. During a call, pressing a button or clicking Join adds the controller immediately. Local input blocking is optional: if its reader, driver or device permissions are unavailable, browser controller input remains usable and the app shows that local input is not blocked. Local games or Steam may also respond in this mode.

The restart reminder appears only for pending driver changes and names newly installed drivers. Reopening the app or command window does not restart Windows: use **Start → Power → Restart**. If setup installed a new driver after your last Windows restart, that new installation can require another restart. Old reminders are cleared after a verified Windows boot change, including older notices without a valid boot identifier.

The optional desktop-input and desktop-cursor helpers need Python 3; the overlay also needs tkinter (included in normal Windows Python installers). Linux X11 uses an overlay without tkinter; see [Linux desktop setup](linux-desktop.md). macOS has an experimental AppKit overlay; Wayland desktop overlays are unavailable.

Windows Start/Host/Join setup offers optional input blocking with separate **y/N** questions for HidHide (controllers) and Interception (keyboards/mice), explaining administrator approval and the Windows restart. Choose **No** to continue with regular sharing; each driver choice is remembered. Install later with `windows/shortcuts/09-Guest-Exclusive-Setup.cmd`, which checks Windows first and asks only about missing drivers. After approval, successful setup is cached for the current Windows boot, reader version and setup files. Later launches skip driver checks/downloads; the first launch after restarting Windows checks again. New driver installation displays a prominent restart reminder that remains on subsequent launches until Windows restarts. Setup never restarts the computer automatically. Keyboards/mice remain local until explicitly selected and confirmed in the app. Setup disables HidHide's automatic updater startup. These guest drivers are separate from the host ViGEmBus driver. See [selection, recovery and validation limits](guest-device-isolation.md). Browser sharing needs neither guest driver.

From a command prompt:

```bat
windows\shortcuts\01-Host.cmd -NoBrowser
windows\shortcuts\02-Join.cmd -NoBrowser
windows\shortcuts\08-Install-Only.cmd -Role host -SkipNodeInstall -SkipDriverInstall
```

## Mac and Linux

```sh
sh Start-Linux.sh
# Role-specific macros live in linux/shortcuts/.
# macOS equivalents:
sh Start-Mac.command
# Role-specific macros live in mac/shortcuts/.
```

Compatible Node is reused. Otherwise the launchers download the official Node 22 x64/arm64 distribution, verify SHA-256, and install it into `.local/node`. They require curl, tar and sha256sum or shasum. No shell-profile changes or global package installation occur. Unsupported architectures/distributions need a manually installed Node 22.9 or newer.

Mac `.command` launchers can open through Finder if executable permissions are preserved. If needed, use `chmod +x Start-Mac.command mac/shortcuts/*.command`; downloaded-script security policies still apply. Linux browser auto-open uses `xdg-open`; otherwise open the printed address.

Linux hosting needs Python and `/dev/uinput` access. Mac hosting requires compiler tools and may require Apple-authorized HID signing; its native backend is experimental. See [platform backend instructions](reference.md#host-controller-backends). Ordinary Mac/Linux guests need no virtual-controller backend. Guests receiving host controllers through a native endpoint need the same local backend and permissions as a host; App-only receiving needs neither. Use the main Start launcher to prepare both roles. Setup does not change uinput permissions or bypass Apple entitlements.

Optional guest isolation is available through `linux/shortcuts/09-Guest-Exclusive-Setup.sh` and `mac/shortcuts/09-Guest-Exclusive-Setup.command`. Both require 64-bit Python 3.9+ and install no input driver. Linux needs read access to the selected event nodes; macOS may require Input Monitoring and can refuse protected devices. Their setup does a read-only API/device check and never isolates input. See [device setup and permission instructions](guest-device-isolation.md). Browser guest input remains available without this setup.

## Any platform with Node installed

```sh
npm run host
npm run join
npm start -- --no-browser
node system/scripts/run.mjs install --player
```

Setup uses the lockfile and caches its checksum plus the Node ABI/platform. Changed dependencies/runtime trigger repair. Existing `.env` and optional native modules are preserved when unchanged. The last role is stored in `.local/install.json`; host verification is retained when you switch to Join. Close the running app before replacing dependencies. Launching an already-running app opens it without replacing packages underneath it.

## Optional macros

Use `04-Connection-Setup` for an optional console menu over `.env`. It hides passwords, keeps a private backup, and supports public STUN, Metered, custom TURN and self-hosted coturn.

`05-Run-Relay` starts coturn in Docker Compose; if its private configuration is missing it asks for the relay hostname and public IP first. Install Docker separately, and forward the ports in [the relay guide](self-hosted-turn.md).

`06-Run-Recovery` starts separately installed Caddy. On first use it asks for your HTTPS recovery origin without resetting existing ICE credentials. Keep the local host app running in another console and forward TCP 80/443. See [recovery setup](port-forwarding.md).

`07-Host-Native` installs/builds native capture tools when needed and opens Host with native capture selected. Capture stays off until you select a window or screen under **Screen sharing**. Selection opens a local preview before starting a session. Windows includes an optional native app/system audio toggle and builds its audio helper with the built-in .NET Framework compiler. The native macro checks helper source versions and rebuilds after updates; close the app first if an update is needed. `08-Install-Only` performs setup without launching; choose `-Role host` on Windows or `--host` on Mac/Linux for host dependencies.

The Start-Windows, Start-Linux and Start-Mac scripts in the main folder are the main launchers: it checks Node.js, app dependencies and saved setup status, then opens the app with your last host/join choice. 01-Host and 02-Join select a role and use the same setup flow; 03-Start remains a compatibility shortcut. Use 08-Install-Only if you want to prepare dependencies without launching. Node is installed automatically when supported; current packages are reused. Optional native capture and device-isolation tools remain under 07-Host-Native and 09-Guest-Exclusive-Setup, and OS permissions/restarts may still be required. Installation never replaces packages beneath a running app.


Native controller receiving is supported by the same platform backend as hosting. Linux accepts `/dev/uinput` or `/dev/input/uinput`; set `UINPUT_DEVICE` only if your distribution uses a different approved node. Device access is required with either X11 or Wayland. The app never changes input-device permissions or runs as root automatically. macOS builds explicitly target the current Intel/Apple Silicon Node architecture; a runtime architecture change invalidates cached helper readiness. A custom signed `MACOS_HID_HELPER` is preserved. Building does not grant Apple's restricted virtual HID entitlement. Native helper errors and timeouts release devices and are reported to the receiver; App-only API/MIDI/browser controller sharing remain available.
