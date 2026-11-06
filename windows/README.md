# Start here

Run **Start-Windows.cmd** in the main app folder. It checks dependencies, installs what is missing, and opens the app with your saved host/join choice. Keep the console open while playing.

Running Start again opens your default browser to the existing app. If Windows cannot open the browser, copy the address printed in the console into your browser; the app keeps running.

Role-specific and optional tools are in **shortcuts/**. Use **shortcuts/01-Host.cmd** on the game computer or **shortcuts/02-Join.cmd** on a joining computer if you want to select a role directly.

| Shortcut | Purpose |
| --- | --- |
| ../Start-Windows.cmd | Main launcher: check dependencies and reuse your host/join choice |
| shortcuts/03-Start | Alternative Start shortcut |
| shortcuts/04-Connection-Setup | Optional menu for the top-level `.env` file |
| shortcuts/05-Run-Relay | Self-host coturn; requires Docker and forwarded ports |
| shortcuts/06-Run-Recovery | Serve a recovery URL with Caddy; run the host app separately |
| shortcuts/07-Host-Native | Set up native capture, then open Host |
| shortcuts/08-Install-Only | Optional dependency setup without launching |
| shortcuts/09-Guest-Exclusive-Setup | Optional selected-device input isolation |
| shortcuts/10-Run-Invite-Server | Optional hosted temporary names and invite links; HTTPS setup required |

Double-click a shortcut. Command-line options: `-NoBrowser`, `-Role host` or `-Role player`.

Node is installed automatically if missing. Windows may request administrator approval for Node or the host ViGEmBus driver.
See [the main guide](../README.md) for pairing and router setup.
