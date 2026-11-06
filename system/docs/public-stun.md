# Account-free connection defaults

With no ICE environment settings, the app supplies all 23 public STUN endpoints below to WebRTC. No Metered/OpenRelay account or API request is required. The list lives in `system/src/ice.js`; `STUN_URL` or `ICE_JSON` can replace it. Explicit Metered or custom TURN configurations keep their existing priority.

| Provider | Addresses |
| --- | --- |
| Cloudflare | `stun:stun.cloudflare.com:3478` |
| Google | `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`, `stun:stun2.l.google.com:19302`, `stun:stun3.l.google.com:19302`, `stun:stun4.l.google.com:19302` |
| Twilio | `stun:global.stun.twilio.com:3478`, `stun:ashburn.stun.twilio.com:3478`, `stun:dublin.stun.twilio.com:3478`, `stun:frankfurt.stun.twilio.com:3478`, `stun:singapore.stun.twilio.com:3478`, `stun:tokyo.stun.twilio.com:3478`, `stun:sydney.stun.twilio.com:3478`, `stun:sao-paulo.stun.twilio.com:3478` |
| Nextcloud | `stun:stun.nextcloud.com:443` |
| Other public endpoints | `stun:stun.hitv.com:3478`, `stun:stun.internetcalls.com:3478`, `stun:stun.miwifi.com:3478`, `stun:stun.schlund.de:3478`, `stun:stun.sipgate.net:3478`, `stun:stun.voip.aebc.com:3478`, `stun:stun.voipbuster.com:3478`, `stun:stun.voipstunt.com:3478` |

All 23 answered a real unauthenticated STUN binding request from the development machine on October 17, 2026 (local time). Two additional candidates timed out and were excluded. Availability on another network or date can differ. Several addresses belong to the same provider and do not represent independent providers.

Run `npm run ice:check` to check the catalog from your network. This sends one binding request per address with bounded concurrency and a four-second timeout, validates the response transaction and mapped-address attribute, and reports response time without printing your public IP. It does not read your private `.env` or test TURN account credentials. This optional diagnostic does not run before every connection.

STUN discovers possible direct routes; game/video traffic does not pass through these STUN servers. More entries offer alternatives but also add DNS and discovery work during connection setup. A shorter `STUN_URL` override can reduce that work. A large STUN list still cannot bypass every NAT/firewall: configure your own TURN service or [self-host coturn](self-hosted-turn.md) when a relay is needed.

Endpoint sources: [Cloudflare service FAQ](https://developers.cloudflare.com/realtime/turn/faq/) and [connection endpoint](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/); [Google's Chromium fallback list](https://chromium.googlesource.com/experimental/chromium/src/+/refs/heads/main/chrome/browser/nearby_sharing/tachyon_ice_config_fetcher.cc); [Twilio traversal API and regional endpoint rules](https://www.twilio.com/docs/stun-turn/api) and [edge locations](https://www.twilio.com/docs/global-infrastructure/edge-locations/legacy-regions); [Nextcloud's default](https://github.com/nextcloud/spreed/blob/main/lib/Config.php); [Syncthing's public fallback list](https://github.com/syncthing/syncthing/blob/main/lib/config/config.go). The latter identifies public endpoints; it does not promise service availability or an SLA from their operators.
