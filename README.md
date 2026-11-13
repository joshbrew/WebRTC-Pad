# WebRTC Pad

<img width="624" height="168" alt="WebRTC Pad banner" src="https://github.com/user-attachments/assets/81a5dc61-de2a-4079-bc6f-f54f703f0657" />

Play local multiplayer games over the internet. Your friends' controllers appear as gamepads on the host computer. Use the built-in WebRTC call for video and sound, or send controllers alone while you talk and stream elsewhere.

## Quick start

Extract the ZIP and run the launcher from the main folder on each computer. It prepares missing dependencies and opens the app in your browser. Keep the app's terminal open during play.

| Windows | Linux | macOS |
| --- | --- | --- |
| Double-click `Start-Windows.cmd` | Run `sh Start-Linux.sh` | Open `Start-Mac.command` or run `sh Start-Mac.command` |

| Step | What to do |
| --- | --- |
| **1. Host** | Click **Start session**, then **Invite guests**. Send an invite file or copy its text. To include video, choose a window or screen before or during the call. |
| **2. Join** | Open the invite file or paste its text. Send the reply file or text back. The host opens or pastes the reply to connect. |
| **3. Play** | Each guest presses a button on every controller they want to use. The host selects the joined gamepads in the game or emulator. |

Use **?** for an in-app walkthrough. See the [user guide](system/docs/user-guide.md) for controls and troubleshooting.

## Features

| Feature | What you can do |
| --- | --- |
| Controllers | Send several Xbox, PlayStation, Switch Pro, or generic gamepads from one computer. Map keyboard and mouse to a gamepad, remap buttons, and test inputs live. |
| Screen and game sound | Share windows, screens, selected areas, or audio only. Set adaptive or fixed quality per screen. Tile, maximize, or pop out shares. |
| Voice and cameras | Talk and share cameras in the call. Mute people for yourself. Hosts can set guest screen, mic, and camera permissions separately. |
| Chat and files | Send session-only messages and offer files up to 64 MB. Hosts can enable clipboard text sharing. |
| Desktop control | Approve mouse and typing for a supported shared window or desktop. Visual guest pointers have their own switch. Both start off. |
| Hosting and invites | Pair with files or copied text. Add a hosted invite service for join links, or pass hosting to another player from **People**. |
| Advanced input | Set up local input blocking, receive the host's controllers, or connect MIDI and separate guest keyboard/mouse events to your own app. |
| Appearance and diagnostics | Preview alternate layouts in **Settings → Appearance**. Check latency and playback, or export diagnostics for a connection problem. |

## Platform support

Browser joining works on Windows, Linux, and macOS. Windows has the most native hosting coverage.

| Host feature | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Virtual controllers | XInput and HID via ViGEmBus | Python and `uinput` | Experimental virtual HID helper |
| Native capture and audio | Native video and supported app/system audio | Native video on X11, browser video on Wayland. Playback audio via PulseAudio or PipeWire's PulseAudio service. | Experimental ScreenCaptureKit on macOS 13+ |
| Desktop input | Window or desktop | X11 window or desktop. Wayland screen control depends on portal support. | Experimental window or desktop with Accessibility approval |

XInput supports four total devices, including local XInput controllers. HID-capable games can use additional controllers. See [installation and platform prerequisites](system/docs/install.md).

## Documentation

| Topic | Guide |
| --- | --- |
| Everyday use and troubleshooting | [User guide](system/docs/user-guide.md) |
| Install, repair, or remove | [Install and launch](system/docs/install.md) · [Windows uninstall](system/docs/uninstall.md) |
| Controllers and desktop input | [Controller setup](system/docs/controller-integrations.md) · [Device isolation](system/docs/guest-device-isolation.md) · [Desktop control](system/docs/desktop-control.md) |
| Video, voice, and latency | [Native capture](system/docs/native-capture.md) · [Voice and diagnostics](system/docs/voice-and-diagnostics.md) · [Latency](system/docs/latency.md) |
| Networking and self-hosting | [Hosted invites](system/docs/invite-server.md) · [TURN relay](system/docs/self-hosted-turn.md) · [Recovery and port forwarding](system/docs/port-forwarding.md) |
| Development and themes | [Technical reference](system/docs/reference.md) · [Validation](system/docs/validation.md) · [Theme packs](system/public/themes/README.md) |

<details>
<summary>Host, guest, and stream screenshots</summary>

| Host | Guest | Stream |
| --- | --- | --- |
| <img width="800" alt="Host interface" src="https://github.com/user-attachments/assets/83f5c0a3-c9c9-4ba5-927a-16c672c8f855" /> | <img width="800" alt="Guest interface" src="https://github.com/user-attachments/assets/01333fee-4bbe-4015-b3e6-49a29cd94350" /> | <img width="800" alt="Active stream" src="https://github.com/user-attachments/assets/77c4efd3-d61b-4a06-9e83-e2c4b324c1d5" /> |

</details>
