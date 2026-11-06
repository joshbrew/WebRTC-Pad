# Start here

Run **Start-Mac.command** in the main app folder. It checks dependencies, installs what is missing, and opens the app with your saved host/join choice. Keep the console open while playing.

Role-specific and optional tools are in **shortcuts/**. Use **shortcuts/01-Host.command** on the game computer or **shortcuts/02-Join.command** on a joining computer if you want to select a role directly.

| Shortcut | Purpose |
| --- | --- |
| ../Start-Mac.command | Main launcher: check dependencies and reuse your host/join choice |
| shortcuts/03-Start | Alternative Start shortcut |
| shortcuts/04-Connection-Setup | Optional menu for the top-level `.env` file |
| shortcuts/05-Run-Relay | Self-host coturn; requires Docker and forwarded ports |
| shortcuts/06-Run-Recovery | Serve a recovery URL with Caddy; run the host app separately |
| shortcuts/07-Host-Native | Set up native capture, then open Host |
| shortcuts/08-Install-Only | Optional dependency setup without launching |
| shortcuts/09-Guest-Exclusive-Setup | Optional selected-device input isolation |
| shortcuts/10-Run-Invite-Server | Optional hosted temporary names and invite links; HTTPS setup required |

Run with `sh ../Start-Mac.command`. Options: `--no-browser`, `--host` or `--player`. On macOS, Finder may require allowing a downloaded script or setting its executable permission.

Node is installed automatically if missing. Node is downloaded into this project only. Host driver permissions and platform capture tools are described in ../system/docs/install.md.
See [the main guide](../README.md) for pairing and router setup.

Native Mac video/audio, window-only desktop input and cursor markers are experimental. Use `shortcuts/07-Host-Native.command` on macOS 13+, with Apple Command Line Tools and FFmpeg installed. Follow the Mac audio & desktop setup link in app settings for Screen Recording and Accessibility permissions. See [Mac setup and validation limits](../system/docs/macos-desktop.md).
