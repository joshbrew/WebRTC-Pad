# Linux audio, window control and guest cursors

The app detects the host OS and desktop session. Windows users do not see Linux setup text. Linux X11 hosts get native window selection, window-scoped mouse/keyboard permissions and desktop cursors. Wayland hosts use the browser sharing dialog; native playback audio can accompany that video through PulseAudio or pipewire-pulse. When a Remote Desktop portal backend and Python GObject bindings are detected, Wayland can separately approve control of one screen through the system dialog. Native window-only enforcement and global overlays remain unavailable on Wayland. There is no silent whole-screen input fallback.

## Prepare the host

Use `sh linux/shortcuts/07-Host-Native.sh` to build the native WebRTC helper. Install Python 3, FFmpeg with x11grab/libopus, libpulse, libX11, libXext and libXtst through your distribution. On Ubuntu/Debian the runtime packages are:

```sh
sudo apt install python3 ffmpeg libpulse0 libx11-6 libxext6 libxtst6 x11-xserver-utils
```

Use the audio server already provided by your desktop: PulseAudio or PipeWire with its PulseAudio compatibility service. Do not replace a working desktop audio stack or run Node/browser as root. Fedora/Arch use their equivalent libpulse, libX11, libXext and libXtst packages. Native video needs an X11 login session; browser screen sharing remains the video path for Wayland. Guest gamepad isolation and host `/dev/uinput` access have separate prerequisites.

## App or system audio

### Wayland screen control

Install your desktop's `xdg-desktop-portal` backend (for example GNOME or KDE) and Python GObject bindings (`python3-gi` on Ubuntu/Debian), then restart the app. The capability check only reads portal properties; it never requests screen or input access. Choose **Desktop control → System-approved screen** and start the session. The system asks you to approve one screen and keyboard/mouse access. Select the same screen for browser video. These are independent system permissions; the app cannot prove that two separate browser/portal choices refer to the same screen.

The helper uses the portal's RemoteDesktop session and ScreenCast stream coordinates. It does not consume a second video stream or bypass the desktop's permission dialog. It keeps no restore token, supports pointer movement, buttons, scrolling, keyboard and relative mouse motion, and closes the session when access stops. Revocation and the input watchdog release held controls. A backend that denies or lacks RemoteDesktop support fails closed; XWayland is not used as a global-input fallback. Browser video and native playback audio stay independent.

`python -B system/test/wayland_portal_test.py` covers granted/partial permissions and input-coordinate behavior using recording adapters. A private D-Bus acceptance test additionally exercises actual Gio request/response subscriptions, Notify calls and session closure against a fake portal:

```sh
dbus-run-session -- env PAD_TEST_PORTAL=1 PAD_PRIVATE_PORTAL=1 python3 -B system/test/wayland_portal_test.py
```

This has passed in Ubuntu under WSL. It does not establish compatibility with every compositor, screen-scaling layout or portal version; real Wayland desktop validation remains pending. API reference: [XDG Remote Desktop portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html).

### Playback audio

Audio is included by default when available. In Native sharing, leave **Include audio** enabled and select the window or X11 desktop. A window captures that process’s playback streams and currently running descendants; the desktop selection captures the default playback output’s monitor. Multiple windows in the selected process can share its sound. Shared audio never substitutes a microphone or unfiltered system audio when app-only capture fails.

With browser video, enable **Use native audio instead of browser audio**, then explicitly select a sound app or system audio. Native audio streams separately over WebRTC; the host browser does not decode/re-encode it. On X11 the sound app list comes from native windows. Wayland does not expose a general window/PID list, so the native audio chooser currently offers system playback audio there. Browser video can still provide its own tab/app audio when its sharing dialog supports it.

The helper uses libpulse recording streams with `pa_stream_set_monitor_stream` to isolate each selected sink input, then mixes 48 kHz stereo PCM into the existing Opus encoder. Recording streams refuse source moves and verify the selected playback monitor on every read; an unexpected route stops capture. It does not move application playback, create persistent sinks, change device volumes or load audio-server modules. New playback streams are discovered while running. Default-output changes restart system monitoring on the new playback monitor. Missing app streams produce silence while waiting. A closed/replaced parent process ends app capture and requires reselection. Disabling sound, stopping sharing or closing the app releases its recording streams. Sandboxed apps and audio servers may hide process metadata or refuse monitoring; the UI reports failures without broadening capture.

## Mouse access restricted to a window

Choose the game window from **Native sharing**, check the preview, then start the session. Under **Guest cursors & desktop access**, enable mouse control and confirm. The permission follows that selected X11 client window; **entire X11 desktop** control needs a separate approval. Browser window capture is bound only when its reported identity matches one unique native window.

The helper pins XID, PID and process start identity, follows live client-area geometry and checks the input shape and topmost window at the target point before injecting. Covered/minimized targets are blocked. Window destruction, process replacement and source changes revoke scope. Keyboard injection additionally requires focus inside the selected window. Buttons/keys are released on stale input or scope loss; input checks and injections use a short X server grab to prevent another client moving a window between the check and injection. This is scope enforcement in this helper, not an OS security sandbox against hostile local X11 clients or global shortcuts implemented by the target app/desktop.

X11 native capture uses FFmpeg’s explicit `window_id`; no desktop source is substituted if that window disappears. Resizing updates the input dimensions and restarts video when the desktop-control helper reports the new size. Without active desktop control, reselect a resized window if FFmpeg ends its old capture. Decorations and unsupported window-manager popups are outside the selected client area and do not gain input access.

## Colored desktop cursors

Enable **Guest pointers** on the host for colored markers without desktop control. Tiny override-redirect windows render the markers using X11 Shape. Their input regions are empty, they do not request focus, and they are clipped to the selected window (or approved X11 desktop). Player labels remain a separate host toggle. Markers fade after inactivity and are destroyed on disconnect/stop. No tkinter or Electron dependency is needed for the Linux overlay.

An X11 overlay can be included in captured video; Linux does not provide the Windows capture-exclusion API. Some compositors or exclusive fullscreen games can cover desktop overlays. In-app colored cursors remain available independently.

## Validation

`python -B system/test/linux_desktop_test.py` runs portable policy/mixer tests. For native acceptance on an isolated X11 display with PulseAudio/pactl test tools installed:

```sh
PAD_TEST_X11=1 PAD_TEST_AUDIO=1 XDG_SESSION_TYPE=x11 WAYLAND_DISPLAY= xvfb-run -a python3 -B system/test/linux_desktop_test.py
```

The audio test starts a private silent server and two synthetic playback processes. It checks app-only frequency isolation, system mixing and recording-handle cleanup. X11 tests inject only into windows created on the isolated test display and verify occlusion, resize, focus, closure and overlay click-through. These checks have passed in Ubuntu under WSL using workspace-local runtimes. They do not validate every compositor, physical sound device, sandboxed app or PipeWire version. macOS native audio, desktop overlays and window-scoped input are not implemented by this Linux backend.

Primary API references: [PulseAudio stream API](https://www.freedesktop.org/software/pulseaudio/doxygen/stream_8h.html), [X11 Shape protocol](https://www.x.org/releases/current/doc/xextproto/shape.html), [FFmpeg x11grab](https://ffmpeg.org/ffmpeg-devices.html#x11grab).


## Receiving controllers and local app input

Guests may receive the host's controllers using **Controllers → Advanced → Receive host controllers**. **Linux virtual gamepads** uses Python 3 and uinput; it works on X11 and Wayland independently of desktop-control permission. `/dev/uinput` and `/dev/input/uinput` are supported. An explicit `UINPUT_DEVICE` can select a distribution-specific approved node. If access is denied, the app reports it instead of changing permissions or trying another node. Grant access through your distribution's user/group/udev policy; do not run the app as root or make all input devices world-writable.

The App-only endpoint, separate keyboard/mouse/MIDI streams and local input API need no uinput access. Native receiving pauses outgoing sharing to prevent virtual-controller loops; stopping or disconnecting destroys the receiver's virtual pads. The native helper neutralizes stale input independently of browser/Node activity. These paths have simulated platform, protocol and resource-cleanup tests; physical uinput/game compatibility still needs Linux hardware validation.
