# Optional hosted invites

The default app exchanges invite/reply files. Hosted invitations appear **only** when `SESSION_SERVER_URL` is set, or when visiting a standalone invite server. No username, account or password is required. A temporary name lets someone send a direct invite while you are online; leaving it blank creates a guest name.

For manual pairing, creating an invite downloads it automatically; opening that invite creates and downloads the reply. Save again remains available. Hosted invitation exchanges do not download files. Firefox can time out while a manual reply is sent back, so use hosted automatic invitations for Firefox or use Chrome, Edge or Brave for file pairing. The browser timing issue can happen despite valid relay candidates; it does not mean that adding more STUN servers will help. See [Mozilla’s delayed-answer issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1792370).

## Run the invite service

Use **10-Run-Invite-Server** in your platform folder, or run `npm run session:server`. The launcher installs missing Node dependencies and skips setup when current. It runs a separate Node console service on `127.0.0.1:8790`; it does not install controller/capture drivers or launch a game. Keep it running for invitations.

For Internet use, put it behind a trusted HTTPS reverse proxy. Copy `system/config/session-server.Caddyfile.example`, replace the hostname and run Caddy with that file. Caddy [proxies HTTP and WebSocket connections together](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming). On a VPS, allow incoming HTTPS and configure DNS. When hosting behind a home router, forward the HTTPS port to that server. Participants connecting to a public service make outbound connections and do not need to forward their own ports.

`SESSION_SERVER_HOST` and `SESSION_SERVER_PORT` change the service bind address/port. Keep the loopback default when the reverse proxy runs on the same machine. `TLS_CERT`/`TLS_KEY` can alternatively provide TLS directly. Do not expose plain HTTP on the Internet; HTTP is supported on loopback for local development.

## Enable it in local apps

In each local host/guest `.env`, set:

```dotenv
SESSION_SERVER_URL=https://invite.example.com
```

Restart the app after saving. Leave this blank to keep the normal file-only interface. `SESSION_SERVER_ENABLED=1` enables the endpoint in a regular app; `SESSION_SERVER_ONLY=1` additionally disables all local hosting, capture and input endpoints. The standalone launcher sets both internally, so no extra flags are needed there. A signaling-only server serves a joining page with its hosting tab hidden.

## Host and join

1. The game host starts a session in their **local app**. Video remains optional.
2. Click **Go online** and **Create session link**. Copy the link to your chat app. Each visitor clicks **Ask to join**, and the host clicks **Accept guest**. The app exchanges the WebRTC offer/reply automatically.
3. Alternatively, both people go online on the same invite server. The host enters the other person's temporary name and clicks **Send direct invite**. Only that temporary sign-in receives/can accept the direct invitation. The recipient clicks **Accept invite**; another approval is not required because the host already selected them.
4. After connecting, press a button on each controller to join. One guest computer can send several controllers. Host desktop-control permissions stay off until explicitly enabled as usual.

Guests can open the HTTPS link in their browser for browser controllers, or paste it into their locally running app for optional native device support. The local app must be configured for that same invite server. The `?` walkthrough follows the selected link or file workflow. **Use invite/reply files instead** remains available when you want manual pairing.

## Lifetime and limits

The share link is a random capability in the URL fragment; it is not placed in the HTTP request URL. Anyone with it may **request** access, but the host must approve each sign-in. Direct invitations are additionally bound to the selected temporary sign-in, not just the displayed name. Names are only temporary labels on this service, not verified identities or permanent handles. Another person can reuse a name after its previous sign-in expires.

Stopping the host session invalidates its link and direct invitations. Removing a guest revokes their membership and direct tokens. Server restart clears all temporary names, rooms and links. A dropped signaling socket reserves its sign-in and room for 60 seconds while the app reconnects; after that, the room expires. Gameplay can continue over an established peer connection during a short signaling outage. Refreshing a local host page still requires the app's normal session-resume flow. There are no accounts, persistent directory or offline invitation delivery.

The service bounds message sizes, unauthenticated sign-in time, request rate and active temporary sign-ins to limit accidental resource exhaustion. `SESSION_SERVER_MAX_CLIENTS` defaults to 512 concurrent/reserved temporary sign-ins and can be configured from 1 to 65536; this service capacity is separate from the number of controllers each computer can stream. It is a small self-hosted signaling service, not a public account system or an authenticated friend directory. Use a server operated by someone you trust: signaling carries connection descriptions and temporary TURN credentials, which are necessary to establish the session. Provider API keys are not included.

## What port forwarding does

- **Hosted invites/signaling:** HTTPS/WebSocket traffic exchanges invitations, approval, and connection descriptions. This automates the initial join/reply flow. A public server can do this without either player's router being forwarded.
- **Existing forwarded recovery:** `SIGNALING_FALLBACK=1` exposes a separate capability-authenticated recovery path on the gaming host. It starts with file pairing and helps recover a failed connection; it is not a username or invite directory.
- **Self-hosted TURN:** forwards the configured TURN listener and relay ports so a relay can carry WebRTC media/data when direct connections fail. Merely hosting a WebSocket invite server does not provide TURN or proxy game traffic. See [coturn setup](self-hosted-turn.md).

The new invite service carries setup messages only. Established controller, video and audio connections use WebRTC directly or the configured TURN relay. In-call updates use the existing WebRTC control path; the forwarded recovery feature remains separate.
