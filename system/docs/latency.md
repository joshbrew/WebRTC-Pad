# Gameplay latency

The app favors input delivery, then fresh video, then audio. Sound and picture play independently, so an audio buffer does not deliberately hold back the next game frame. Small sound/picture offsets are an accepted tradeoff for remote play.

## What the pipeline does

- Controller and mouse snapshots use unordered data channels without retransmission. Desktop key/button transitions and session controls retain their separate reliable channel. Sequence numbers reject old snapshots, and disconnect/watchdog cleanup releases held controls.
- Updated peers negotiate compact 76-byte controller snapshots. Six analog axes retain full JavaScript float64 precision, alongside every canonical button, independent controller lane, sequence and assignment generation. Older hosts/guests keep JSON compatibility. The controlled payload benchmark averaged 360 → 76 bytes, about 79% less payload before transport headers; this helps limited upstream bandwidth and multiple controllers. It is not a measured Internet latency saving. Local controller send queues are bounded to roughly a group of snapshots (at most the previous 8 KiB limit), and blocked updates are sampled fresh on recovery. This limits application-side backlog, not all browser/network buffering. Run `npm run benchmark:input` for JSON/binary size and local codec-cost comparisons.
- Browser mouse positions send as soon as a permitted pointer event arrives, without the previous 15 ms gate that could leave a final movement waiting for a 30 Hz heartbeat. Movement retains its unreliable channel; click/key transitions, scope checks, consent and release handling are unchanged. Browser event coalescing and scheduling can still limit sampling rate.
- A worker targets 120 controller samples per second even without video. It allows only one pending notification, so a busy page resumes with current input rather than a queue of old sampling requests. Unchanged full-state heartbeats are paced per controller; fresh presses, releases and axis values send immediately. Browser keyboard-to-controller transitions also send at the event, preserving brief taps between ticks. Browser gamepad sampling still runs on the page; a worker does not remove browser focus or scheduling restrictions. Native selected-device readers target 8 ms sampling. The Windows reader uses a monotonic high-resolution clock and requests finer timer resolution only while sharing; release and exit balance the request.
- Native capture, encoding and WebRTC forwarding run outside Node's browser UI. Matching guest quality profiles share an encoder. On Windows, WGC with NVIDIA encoding can resize on the capture GPU, using verified source dimensions, and pass the texture directly to NVENC. Other paths and unsupported GPU combinations retain compatible native-process scaling. `NATIVE_GPU_SCALING=0` disables the WGC fast path for troubleshooting.
- NVIDIA uses its fast P1 preset, ultra-low-latency tuning, a one-frame VBV bitrate buffer, no lookahead or B frames, and an explicit zero-frame asynchronous output delay. Faster encoding can cost compression efficiency at the same bitrate. Capture timestamps pass through without manufacturing constant-rate duplicate frames. Periodic keyframes remain for joining and loss recovery.
- Intel Quick Sync uses one in-flight frame instead of its default four-operation queue. Controlled encoding measured about 64 → 6 ms submission-to-packet delay with identical quality scores, and real guest picture age fell from 106 → 47 ms. [Encoder benchmarks](encoder-benchmarks.md) compare presets, rate-control changes, CPU encoding and browser capture with reproducible scripts.
- Receivers request zero target playback delay where supported. This is a hint, not a guarantee: browsers can keep buffering for network loss/jitter. Both players use separate audio/video streams, and native signaling does not group audio with video for synchronization. Muted host preview receives picture only; guests can still receive sound.
- Native senders also negotiate the WebRTC playout-delay RTP extension and send a zero minimum/maximum on video. This asks supported browsers to render as soon as possible instead of smoothing frame presentation. Each peer's negotiated header ID is respected, and shared source packets remain unmodified. Audio and unsupported peers retain their normal RTP handling. NACK and RTCP reporting remain enabled. `NATIVE_PLAYOUT_DELAY=0` opts out if a connection benefits from more presentation smoothing. This trades delay for less smoothing under jitter; it does not remove physical capture, encoding or display time.
- Browser game streams request high video priority and very-low audio priority, with a 192 kb/s stereo Opus send limit. Input channels request high priority. These are optional browser hints, not reserved bandwidth or a guarantee from the router. Native game audio also uses 192 kb/s and 10 ms packets. Optional voice calls use separate audio connections with low priority and individual adaptive 64–128 kb/s limits (192 kb/s optional).
- Visual diagnostics skip gamepad reads while the guest panel is hidden or the page is in the background; controller sampling and delivery continue independently. Unchanged readouts keep their existing text. Cursor markers combine incoming positions into one visual update per display frame and have no permanent expiry polling loop. Guest media statistics query only the active media connection, with at most one request in flight; controller-only mode uses control pings without collecting unused RTP statistics. Adaptive video feedback remains active in background pages.
- Native input state packets deliver controls without repainting the device settings panel. Lease/status changes and the existing heartbeat refresh those controls instead; unchanged settings no longer rewrite their text or attributes. A recording-driver browser check sent 300 state reports and observed one settings repaint while the final analog state reached the host. This is reduced UI work, not a measured reduction in end-to-end latency. Host preview playback also pauses when its Host tab is hidden, without stopping guest capture or changing the saved preview preference.

## What the numbers mean

Control round trip, playback buffer, decoding and overall picture age measure different parts of the system. A 6 ms playback buffer does not mean the game responds in 6 ms. Picture age also includes the source's paint/compositor timing, capture, encoding, delivery and presentation. Internet transport adds further delay. Input-to-picture additionally includes controller sampling, input travel and the game's response.

The host monitor shows decoded resolution, frame rate and native playback-buffer delay; hover for decode time. Guests have connection statistics. No browser statistic alone measures the complete button-to-screen path.

Guests see **Input round trip** below the picture, including in controller-only sessions. It measures a control message reaching the host and returning; it excludes controller sampling, game response and video delivery. Old video measurements clear when sharing stops, while this input measurement continues. Leaving the call clears it too.

The UI-work regression (`node system/scripts/smoke-ui-overhead.mjs`, with Playwright configured as below) counted zero diagnostic gamepad reads in an idle host or hidden page, versus four reads over 450 ms in a visible idle guest. All three states produced zero unchanged readout writes. A synchronous burst of 500 cursor positions used one layout read at the next visual frame, and clearing the layer stopped its idle layout work. Fifty hosted-help refreshes retained the existing join-button content. These are work-count checks, not measured reductions in button-to-screen latency. The controller-only browser regression separately checks background input delivery and confirms the data connection is not polled for media statistics.

### Local Windows measurement, October 17, 2026

The generated clock-window test used this laptop's RTX 4070 Laptop GPU, WGC, NVENC, Edge and loopback WebRTC. Separate host and guest pages exchanged the app's actual invite/reply files. Native application audio was enabled and guest sound was playing independently.

At a 60 fps host cap, a repeatable off/on comparison with the same native helper measured:

| Capture / presentation | Median picture age | p95 picture age | Source to packet reception | Reception to presentation | Average playback buffer |
| --- | --- | --- | --- | --- | --- |
| Native, sender hint disabled | 47.5 ms | 64.4 ms | 19.0 ms | 27.7 ms | 8.3 ms |
| Native, sender hint enabled (default) | **30.8 ms** | **47.7 ms** | 20.5 ms | **9.6 ms** | **0.6 ms** |
| Browser window capture, normal player | 69.5 ms | 84.5 ms | 33.8 ms | 35.8 ms | 9.1 ms |

A final installed-helper repeat measured **45.3 ms median/49.5 ms p95** with a negotiated sender hint and 0.63 ms buffering. Source-to-reception stayed at 20.6 ms, while reception-to-presentation rose to 25.3 ms. Thus the observed enabled range is **31–45 ms median and 48–50 ms p95**, with browser presentation scheduling still contributing variable delay. The 30.8 ms result is not a fixed latency guarantee.

Native tests included independent native application audio. Browser capture used the actual browser chooser restricted to this same generated window, without audio, rather than substituted canvas frames. Browser capture included window decorations, while native captured the client area. Native decoded about 59 fps, browser about 48 fps in these runs. The browser controls its encoder; this comparison uses each method's normal app defaults and is not a matched-codec encoder benchmark. These are local observations, not an internet latency promise. The fixture is a simple scene rather than a GPU-heavy game. Browser presentation timing is estimated in headless Edge; this does not measure physical display scanout or input-to-photon latency. Component medians are computed independently and need not sum exactly.

An alternative direct-frame canvas renderer was also compared against the normal video player in composited browser screenshots. Although frames were accessible to JavaScript roughly 20–25 ms earlier than video-frame callbacks predicted presentation, the two visibly composed pictures had **zero median clock difference** across 12 screenshots for each capture method. Native canvas was at most one fixture update ahead in that run. No alternate renderer ships: raw-frame availability alone did not establish a consistent visible saving, and the normal player retains browser hardware presentation, fullscreen and picture-in-picture.

The Windows native reader's device-free sampling-clock test measured 8 ms median/9 ms p95 intervals. Input regressions deliver immediate native button press/release bursts and browser keyboard taps through real local WebRTC. This measures scheduling and delivery, not physical controller input-to-photon latency.

Earlier measurements found the muted host preview could accumulate extra audio synchronization delay. Making that preview video-only reduced its playback buffer from roughly 32 ms to 9 ms on this machine. The separate NVENC output-queue fix reduced measured picture age by about 30 ms in an earlier like-for-like capture test. Earlier full-frame pixel analysis added measurement overhead; its absolute picture-age results should not be directly compared with the final lightweight test.

### Reproduce

Install native capture tools first. The developer test also needs Playwright and Edge; set `PLAYWRIGHT_MODULE` to the absolute path of Playwright's `index.mjs` when it is installed elsewhere. In PowerShell:

```powershell
$env:LATENCY_GUEST='1'
$env:LATENCY_AUDIO='1'
$env:LATENCY_FPS='60'
node system/scripts/smoke-preview-latency.mjs
```

`LATENCY_UI=1` tests just the pre-session host preview. `LATENCY_RESOLUTION=720` exercises downscaling, and `LATENCY_MAX_MS=80` sets an optional median acceptance budget. `NATIVE_PLAYOUT_DELAY=0` runs the native baseline without the sender hint. `LATENCY_CAPTURE=browser` uses real browser window capture; omit `LATENCY_AUDIO` for that comparison. Browser selection is restricted by window title and the captured HWND is checked against the fixture. `LATENCY_RAW_FRAMES=1` probes decoded-frame availability, and `LATENCY_COMPARE_RENDER=1` compares normal/direct-frame pictures in 12 composited screenshots. `LATENCY_HEADED=1` enables visible browser windows. The fixture opens an animated test window, encodes its clock in pixels and reads that strip at the guest's video-frame callbacks. It timestamps before pixel analysis and uses the browser's estimated presentation time; WebRTC's receive-time metadata separates pre-reception and presentation delay. No input is injected into real apps. Media uses loopback; the normal pairing path may query configured/default STUN servers. Fixtures close afterward.

For real play, choose 60 fps and leave per-guest automatic adjustment enabled. Use 120 fps when the source and receiving display actually support it; it cannot create extra motion from a slower source. Hide host preview when checking it is unnecessary. Network congestion and a fully loaded game GPU can still cause stutter; reduce the host cap or a guest's requested quality while watching the measured statistics.

## Viewer isolation and codec choice

Quality changes must preserve continuity as well as low delay. The guest warms
up a replacement video track before switching. Track swaps retain the player’s
stream object and account for native connections reusing the same track ID;
otherwise adding a replacement can silently keep the old track. The native sender keeps the
previous encoder/transport until the guest confirms a decoded replacement.
If that confirmation never arrives, its 45-second cleanup deadline now rolls
back to the previous transport instead of retiring working video. Superseded
timeouts cannot roll back a newer offer, and failed replacement chains release
their unused encoders. H.265 fallback also keeps the current picture while H.264
connects. These are failure protections, not additional steady-state buffering;
controller connections remain independent.

The main stream has a remembered minimum automatic resolution (480p by
default), selectable on the host and guest. A guest may raise the floor; the
source size and either side’s maximum always take precedence, so small windows
are never enlarged to satisfy a floor. Automatic changes retain the 20-second
spatial cooldown and sustained-pressure/recovery checks. Either side can turn
automatic quality off to keep a fixed requested resolution, bounded by the
source and host limits; stale adaptive state is then ignored. Floor-only policy
changes do not replace an otherwise identical native encoder. Browser senders
request maintained resolution so their internal spatial adaptation does not
fight the app’s floor/cooldown policy; bitrate and frame rate can still yield to
network congestion. A floor cannot guarantee smooth playback if the connection
cannot sustain it, and fixed quality does not bypass transport congestion control.

The player and native transport lifecycle are shared by Windows, Linux and Mac.
Deterministic rollback tests cover all three platform configurations. Real
generated-RTP/browser handover tests run on Windows, including a replacement
that negotiates successfully but never produces a frame, continued old-picture
playback, rollback, a later successful quality change and an unaffected second
viewer. This does not replace capture-device and graphics-driver testing on
Linux/Mac hardware.

Native viewers now have independent RTP delivery workers. Sharing an encoder no longer means one synchronous track write visits every viewer's transport. Each viewer has at most two queued complete frames and rejects queued frames older than 50 ms. Video overflow/incomplete source frames discard dependent data until a fresh keyframe, preserving decodability; per-viewer sequence numbers are assigned before NACK processing so intentionally unsent frames do not provoke retransmission requests. Audio resumes with current packets independently. Packet payloads are shared immutably across viewers. This addresses the sequential writes in [Pion's static RTP track](https://github.com/pion/webrtc/blob/v4.2.23/track_local_static.go).

The 50 ms bound applies to this application queue, not an already-blocked socket write or the browser/network buffers. A congested viewer can freeze until the next periodic keyframe (roughly one second) rather than replay old dependent frames. Deterministic tests block one writer and verify another receives every frame, queue limits, fresh-keyframe recovery, audio progress, and contiguous per-viewer sequence numbers. Local native queue measurements remained approximately 1.1–1.5 ms maximum in the recorded runs; those do not simulate a distant congested TURN/TCP network.

Codec choice is an optional hardware setting, rather than an assumed latency win. Native H.264 and H.265 P1 both measured about 43.4 ms median picture age in the same Chrome workflow on this laptop. H.264 delivered more distinct frames in that pair; source/compositor cadence and headless browser presentation remain part of the measurement. H.265 can improve compression, but the default stays H.264. The [codec measurements](encoder-benchmarks.md#h264-and-h265-options) include bitrate/quality and compatibility limits.

## Research behind these choices

- [WebRTC's playout-delay design](https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/rtp-hdrext/playout-delay/) explicitly defines zero minimum/maximum for interactive gaming and remote access. [Its timing implementation](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/video_coding/timing/timing.cc) distinguishes low-latency rendering from normal presentation scheduling. The extension is experimental and negotiated, with a compatibility opt-out.
- [Video-frame callback metadata](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) defines estimated display and last-packet receipt times. Direct decoded-frame availability and the composited picture are distinct measurements.
- [NVIDIA's FFmpeg tuning guidance](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/) describes single-frame VBV, disabled frame reordering/lookahead and capture timestamp passthrough for interactive streaming.
- [Sunshine's encoder configuration](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html) uses the fastest P1 NVENC preset for game-streaming responsiveness.
- [FFmpeg's gfxcapture documentation](https://ffmpeg.org/ffmpeg-filters.html#gfxcapture) specifies GPU output, native resizing and the compositor-dependent frame-rate cap.
- [MDN's receiver buffering reference](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget) explains that buffering requests are hints and synchronized audio/video can share the larger delay target. [Stream grouping](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack) controls which tracks are signaled together.
- [RTCDataChannel](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel) is transferable in supporting browsers. [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) and raw-frame APIs have browser-specific support; transferring an entire MediaStream is not a general shortcut. [Encoded transforms](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_Encoded_Transforms) are useful for modifying frames, not automatically reducing capture/encoder/playout delay. This app avoids adding a transform stage that has no processing job.

Windows hardware is validated here. Browser playback/worker changes are shared across platforms. Linux and Mac native paths retain their own capture/encoder implementations; these timing results do not validate their hardware performance.
