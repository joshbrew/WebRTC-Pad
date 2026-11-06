# Optional port-forwarding fallback

For automatic initial joining and temporary invite links, use the separate [hosted invite service](invite-server.md). A public server handles that setup without forwarding ports on each player's router. The recovery feature below starts with file pairing; self-hosted TURN is another separate use of port forwarding.

Both people still run the app on their own computers and exchange an invite/reply file initially. This fallback gives them an independent, authenticated signaling path to the host if the WebRTC connection fails completely. Screen, audio, and controller input still travel through WebRTC, directly or through TURN.

Ordinary keepalives and connected-session updates already work without forwarding a port. Enable this only on the host when you want automatic recovery without another file exchange. You need router access, a public address that accepts inbound connections, and a hostname with trusted HTTPS. The app does not change your router or firewall automatically.

## Host setup

1. Reserve the host computer's LAN address in your router's DHCP settings, for example `192.168.1.50`. The exact menus vary by router.
2. Point your own DNS or dynamic-DNS hostname, for example `play.example.com`, at your router's public IPv4 address. A changing public IP needs dynamic DNS. Publish an IPv6 record only if you also configure IPv6 routing/firewall access.
3. Merge the following into the host's `.env`. The supplied `system/config/port-forwarding.env.example` contains the same template. Keep your existing Metered/TURN credentials.

   ```dotenv
   HOST=127.0.0.1
   PORT=8787
   PUBLIC_URL=https://play.example.com
   SIGNALING_FALLBACK=1
   PLAYER_COUNT=4
   MAX_PEERS=0
   ```

4. Install [Caddy](https://caddyserver.com/docs/install) separately. Replace `play.example.com` in `system/config/Caddyfile` with that same hostname. From the project directory run:

   ```sh
   caddy run --config system/config/Caddyfile
   ```

5. Add these router rules, replacing the example address with your host's reserved address:

   | Protocol | Public port | LAN computer | LAN port |
   | --- | --- | --- | --- |
   | TCP | 80 | 192.168.1.50 | 80 |
   | TCP | 443 | 192.168.1.50 | 443 |

   Allow inbound TCP 80/443 for Caddy in the host OS firewall. Port 80 supports certificate validation and HTTPS redirects. **Leave Node's port 8787 unforwarded.** This Caddy configuration exposes only `/fallback`; host management, injection, credentials, and the local app stay on loopback. Do not add a catch-all proxy to 8787 for this setup.

6. Restart the Node app with `npm start`. Open `http://localhost:8787` locally and check **Settings & troubleshooting → Port-forwarding fallback**. Start a session and create **new** invites. Old invites do not acquire the new setting.
7. Send each invite to its intended person and import their reply as usual. Their local app opens a secure fallback socket using a separate random capability for that invitation. **Connection settings** shows whether it is connected. Try the public hostname from outside your home network (a phone on cellular works); it should display the signaling message with a valid certificate. Then test actual pairing from outside the LAN.

Caddy handles [WebSocket proxying](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [automatic HTTPS](https://caddyserver.com/docs/automatic-https). It must stay running alongside Node and the host browser. Self-signed certificates are unsuitable for ordinary players because their browsers will reject the fallback socket. The hostname is a signaling endpoint, not a public join webpage; each person continues to open their own local app.

## Recovery behavior

The player opens the independent WSS socket after making their initial reply. If the WebRTC peer/input channel breaks, the apps exchange a fresh offer and answer through that socket and rebuild the peer connection, preserving the player's assignment. **Refresh connection** on the host also uses the socket when the WebRTC control channel is down. Disconnected fallback sockets retry while the local session remains active.

Each capability is restricted to one registered peer and carries only recovery signaling, never controller injection or host commands. Removing that person or ending/resuming the host session revokes it. Treat invites as private connection tickets. Reloading either browser loses its live pairing state; exchange fresh files. If the host computer, Node, browser, or public endpoint is offline, recovery waits for a reachable active session or requires a new invite.

For your own STUN/TURN relay, follow [self-hosted coturn setup](self-hosted-turn.md). Keep TURN configured. Forwarding TCP signaling does not fix all WebRTC UDP/NAT paths or turn Caddy into a media relay. [WebRTC leaves application signaling to the app](https://webrtc.org/getting-started/peer-connections).

## Troubleshooting

- **The public page is unreachable:** check DNS, router rules, Caddy logs, the OS firewall, and whether another service uses 80/443. Some routers do not support reaching your own public address from inside the LAN; test externally.
- **Carrier-grade NAT or two routers:** compare the router's WAN address with your public IP. A private WAN address or `100.64.0.0/10` can indicate upstream NAT; ordinary forwarding on your router alone will not expose the host. Ask your ISP for a public address, configure both routers when you control them, or use a separately reachable secure signaling endpoint. See [RFC 6598 shared address space](https://datatracker.ietf.org/doc/rfc6598/).
- **Fallback says off:** check `SIGNALING_FALLBACK=1` and a bare HTTPS origin in `PUBLIC_URL`, restart Node, and create a fresh invite. No path or query is allowed in that setting.
- **Fallback cannot connect:** check the hostname/certificate and that `/fallback` proxies to the correct Node port. A plain HTTP page at the hostname does not prove WSS works; the player's connection indicator does.
- **Fallback connected but video fails:** check TURN credentials, capture permission, network capacity, and browser compatibility. Signaling reachability does not guarantee a usable media route.
- **More controllers:** `PLAYER_COUNT` is the console/manual default; browser press-to-join adds devices only as used. Xbox output has four XInput slots shared with other local XInput devices. Automatic/HID output on Windows, Linux and experimental macOS grow as players join without a fixed application controller cap; actual driver, browser and game limits apply. Guest controller brands do not impose the XInput limit. `MAX_PEERS=0` removes the configured participant cap, while CPU/upload limits still apply.

## Local verification

`node system/scripts/smoke-fallback.mjs` starts two separate local apps, authenticates over test TLS, intentionally closes the player's real WebRTC connection, and verifies restored video and controller delivery without another file exchange. It requires Playwright, Edge/Chrome, and OpenSSL (`OPENSSL_BIN` can specify its path). The temporary self-signed certificate is accepted only by that isolated test browser. This verifies recovery logic, not your router's external reachability.
