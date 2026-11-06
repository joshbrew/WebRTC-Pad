# Run your own STUN/TURN relay

Yes: the host can also run a real STUN/TURN server. This project supplies coturn configuration; Node itself is not a TURN implementation. A TURN relay carries encrypted WebRTC packets when a direct route fails. The same relay works for controller-only sessions and optional video connections.

You need a public IPv4 address, router/firewall access, and a DNS hostname pointing at that address. For carrier-grade NAT, use a reachable machine elsewhere or obtain a public address from your ISP. You cannot forward through a router you do not control.

1. Install Docker with Compose. On Windows/macOS use Docker Desktop; on Linux Docker Engine is sufficient. Reserve the relay computer’s LAN address in your router.
2. From this project folder, generate settings with your actual public address:

   ```sh
   npm run setup:turn -- --hostname turn.example.com --public-ip 203.0.113.10
   ```

   The sample IP is documentation-only. The command generates a random shared secret in `.local/coturn/turnserver.conf` and `.local/coturn/app.env`. It refuses to overwrite existing settings. These files are private and excluded from the source download.
3. Merge `app.env` into the host’s `.env`. Preserve the other app settings. Explicit `TURN_URL` takes priority over Metered settings; `ICE_JSON`, if present, takes priority over both. The host mints expiring coturn credentials for invitations. Friends receive temporary credentials, never the master secret or the Metered API key. Default lifetime is 24 hours; `TURN_TTL_SECONDS` allows 3600–604800 seconds. For longer sessions, create fresh connections before those credentials expire.
4. Start the relay:

   ```sh
   docker compose -f system/config/coturn.compose.yml up -d
   docker compose -f system/config/coturn.compose.yml logs --tail=50
   ```

5. Forward these **same-number** ports to the relay computer, and allow them in its firewall:

   | Protocol | Public ports | Relay computer ports |
   | --- | --- | --- |
   | UDP and TCP | 3478 | 3478 |
   | UDP | 49160–49359 | 49160–49359 |

   The relay range is essential. Opening 3478 alone can discover candidates without delivering media. Keep the public-to-private relay port numbers identical. The configuration disables TCP relay allocations, while allowing clients to connect to TURN over TCP. Relay traffic to peers uses UDP. See the [coturn configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf) and [official container instructions](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md).
6. Restart the app, create fresh invitations, and test with somebody outside your LAN. For a diagnostic, temporarily set `ICE_TRANSPORT_POLICY=relay` to require the relay, then restore `all` to allow faster direct paths. A successful local test does not verify your router’s forwarding. Some routers lack NAT loopback, so testing your public address from the same LAN may fail even when external access works.

The template advertises `external-ip=YOUR_PUBLIC_IP`. On a Linux installation with multiple interfaces or special NAT, coturn may require `external-ip=PUBLIC_IP/LOCAL_IP`; use the actual listening/relay interface. Docker Desktop adds another NAT boundary, so confirm the published UDP range is reachable from outside. Updating DNS alone does not update coturn’s configured public IP: update `external-ip` and restart the container when it changes.

The provided setup uses authenticated TURN on 3478 without TLS. WebRTC media/data remains encrypted, but networks that block 3478/UDP can require a separately configured trusted-certificate `turns:` listener. Do not point `turns:` at Caddy’s HTTPS listener; TURN is a different protocol. Caddy and coturn can coexist on their separate ports.

## Signaling recovery is separate

STUN/TURN makes a WebRTC route possible. To recover after **both** the control and video connections fail, enable the independent [port-forwarded signaling fallback](port-forwarding.md) as well. It uses Caddy on TCP 80/443 and only exposes a scoped recovery endpoint. File pairing and updates over the live control connection work without it.

## Stop or inspect

```sh
docker compose -f system/config/coturn.compose.yml ps
docker compose -f system/config/coturn.compose.yml down
```

The 200-port range and coturn allocation quotas are capacity limits, not a promise of arbitrary simultaneous full-quality video. Every browser/native connection may need relay allocations. Relay bandwidth also counts against this computer’s upload/download. Expand the range and quotas together when needed, and update the router/firewall rules too.

## Verified locally

The browser pairing smoke test has been run against a real coturn process with `ICE_TRANSPORT_POLICY=relay`, including video, audio, controller press/release, and control-channel ICE restart. This verifies coturn authentication and application integration; your own router must still be tested externally.
