# Encoder and cloud-gaming comparisons

The useful change from this investigation is Intel Quick Sync's asynchronous queue: native encoding now uses depth **1**, replacing FFmpeg's default **4**. At 60 fps this removed about 58 ms of encoder delay without changing the decoded quality scores. NVIDIA retains P1, zero output delay, no B frames/lookahead, ultra-low-latency CBR and a single-frame bitrate reservoir.

## Controlled encoder measurements

Measured October 17, 2026 on Windows, Core Ultra 7 155H / Intel Arc graphics and RTX 4070 Laptop GPU, using FFmpeg 9.0.2. Every method encoded the same generated scrolling textured 1920×1080 YUV420 source at 60 fps and an 8 Mbps target. There were 90 frames per run and two paced repeats. Quality was compared against the identical uncompressed reference. These are synthetic-scene observations, not game-quality ratings.

| Method | Submission → packet median | p95 | SSIM | PSNR |
| --- | ---: | ---: | ---: | ---: |
| NVIDIA P1, current default | 2.36 ms | 2.81 ms | 0.8161 | 32.99 dB |
| NVIDIA P2 | 2.57 ms | 2.88 ms | 0.8231 | 33.12 dB |
| NVIDIA P4 | 3.42 ms | 3.97 ms | 0.8270 | 33.24 dB |
| NVIDIA P1, quarter-resolution multipass | 2.95 ms | 3.80 ms | 0.8212 | 33.15 dB |
| NVIDIA Main/CABAC, offline experiment | 2.41 ms | 2.77 ms | 0.8434 | 33.78 dB |
| Intel, previous depth 4 | 64.15 ms | 69.25 ms | 0.7957 | 32.42 dB |
| Intel, depth 1 only, new default | **6.27 ms** | **6.87 ms** | **0.7957** | **32.42 dB** |
| Intel, depth 1 + single-frame VBV + low-delay BRC | 6.16 ms | 6.80 ms | 0.7799 | 32.07 dB |
| Intel, medium preset / depth 1 | 7.37 ms | 8.08 ms | 0.8007 | 32.51 dB |
| CPU x264 veryfast / zerolatency | 3.45 ms | 5.18 ms | 0.8056 | 32.05 dB |
| CPU x264 ultrafast / zerolatency | 2.31 ms | 3.10 ms | 0.7918 | 31.79 dB |

Intel's low-delay BRC flag alone produced the same quality/timing as depth 1 in this scene. The smaller Intel VBV hurt quality without a useful extra delay saving, so production retains its previous rate control. Actual output rates ranged from roughly 8.0–8.5 Mbps. AMD AMF could not initialize because this machine lacks its runtime/hardware; Apple VideoToolbox was not tested on this Windows machine.

The benchmark matches frame submission timestamps to output packets in FFmpeg debug logs. It includes raw-frame uploads, excludes capture/network/display, and can have sub-millisecond pipe-arrival error. Native WGC/NVENC texture capture avoids those raw uploads. The script also records startup-inclusive throughput, but a cold hardware initialization dominated the first short run; **that number is not a steady-state speed ranking**. Encoders were tested sequentially to avoid competing benchmark loads.

Main/CABAC improved compression in this test, but is not enabled in the app: native peers currently negotiate baseline H.264. Sending a Main-profile bitstream under baseline signaling would be incorrect. A future profile option needs matching negotiation and compatibility handling. P2–P7 are bounded optional NVENC settings; P1 remains the latency default. Quarter-resolution multipass was measured, but has not shown an end-to-end latency improvement and is not enabled by this change.

## Full capture-to-guest comparison

These measurements use the app's actual source selection, separate host/guest pages, invite/reply files and normal video player. The clock is painted into a harmless generated window, then read after capture, encoding, loopback WebRTC and browser presentation. The host cap was 720p/60 fps, with no audio for any method.

| Method, first comparison pass | Picture age median | p95 | Source → packet reception |
| --- | ---: | ---: | ---: |
| Intel depth 4 | 106.3 ms | 138.4 ms | 89.0 ms |
| Intel depth 1 | **46.5 ms** | **49.5 ms** | **23.7 ms** |
| NVIDIA P1 | 30.8 ms | 47.5 ms | 20.4 ms |
| NVIDIA P2 | 30.7 ms | 40.6 ms | 18.3 ms |
| NVIDIA P4 | 34.6 ms | 48.3 ms | 21.1 ms |
| CPU veryfast | 43.3 ms | 48.5 ms | 21.5 ms |
| Browser window capture | 72.5 ms | 94.4 ms | 39.0 ms |

The Intel repeat measured 110.7 → 47.2 ms median, with source-to-reception falling from 89.0 → 24.1 ms. That confirms the queue fix through the real guest pipeline. The few-millisecond NVIDIA preset differences are much smaller than browser presentation variability; they do not establish P2 as a faster encoder. CPU encoding also competes with games for CPU time, which this simple scene does not simulate.

In the second pass, native methods had approximately 16.8–16.9 ms median presentation intervals and 33.0–33.8 ms p95 intervals; browser capture measured 17.0 ms median and 50.1 ms p95. Over the sampling period native delivered about 53–55 distinct presented frames/sec and browser about 42. This fixture repaints with a 15 ms WinForms timer rather than a synchronized game renderer, so these results include source/compositor cadence and do not establish perfect 60 fps pacing. [FFmpeg's WGC implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vsrc_gfxcapture_winrt.cpp) requests a minimum update interval from Windows and consumes arriving frames; a requested maximum rate does not force the source to paint at that rate. No extra buffering was added to smooth the benchmark.

The final encoder-only repeat confirmed 65.09 → 6.23 ms median submission-to-packet time, again with identical SSIM/PSNR. [Recorded results](benchmarks/2026-10-17.json) preserve both guest passes and all encoder variants, including failures and experimental settings.

### Faster capture sampling experiment

A further WGC/NVENC experiment requested 120 capture updates/sec for a 60 fps guest, selecting the first available frame in each 1/60-second timestamp bucket without lookahead or duplicate frames. This tested whether extra capture opportunities reduce wait time. Both ordinary capture and this variant measured **30.7 ms median picture age**, with 47.3/47.5 ms p95 and 20.1/20.0 ms source-to-reception. Both delivered roughly 58 measured frames/sec in that pair. [Recorded cadence results](benchmarks/2026-10-17-cadence.json) retain the comparison. The prototype was removed: it did not demonstrate a latency improvement sufficient to justify more capture work.

### Controller transport and browser mouse

Updated peers now negotiate a compact lossless controller snapshot. It is 76 bytes, compared with 307–364 bytes of JSON in the controlled input scene (360-byte average), reducing payload by about **79%**. Float64 analog values, every canonical button, independent controller lanes, safe-integer sequence counters and assignment generations round-trip exactly. This changes the wire representation, not which controller brands or mappings can be used. Older hosts/guests retain JSON compatibility, and key/mouse transitions keep their existing reliable channel.

`npm run benchmark:input` compares payload size and local codec cost over three 100,000-packet runs. [Recorded input results](benchmarks/2026-10-17-input.json) include the method and timing limitations. For three controllers each producing 120 fresh snapshots/sec, these measured payload sizes correspond to about 1.04 → 0.22 Mbps before SCTP/DTLS/UDP/IP overhead. Actual rates depend on movement and unchanged-state heartbeat pacing. This is a bandwidth reduction, not a measured reduction in Internet round-trip delay; per-packet local codec time is only a few microseconds.

The application-side send backlog is now bounded to roughly one controller group (with the prior 8 KiB ceiling retained). When busy, the next sample uses current state instead of retaining an application queue of stale movements. The browser's internal transport and the network can still buffer packets. A real-browser test simulates a busy send buffer, changes state while blocked and verifies that recovery sends the latest values. Binary and JSON fallback both pass, including quick taps, background sampling and release behavior.

Browser desktop mouse movement no longer has a 15 ms send gate. Previously, the last event of a short burst could wait for the next 30 Hz reliable heartbeat. The final position now sends immediately over the existing unreliable movement channel, with all scope and consent checks retained. Mouse regression tests verify three immediate positions in one event burst as well as clicks, typing, blur release, screen resizing, fullscreen, colored cursors and revocation in manual and press-to-join sessions.

Browser capture includes window decorations and selects its own codec; native captures the client area and sends H.264. These compare ordinary app methods rather than identical codec paths. Presentation times are estimates from headless Edge, not physical scanout or input-to-photon latency. Internet travel and loaded-game GPU behavior remain additional costs. See [latency measurement limits](latency.md).

## H.264 and H.265 options

The host now offers native H.264/H.265 and NVIDIA P1/P2/P4 controls under advanced video settings. H.264 remains the default. H.265 is selected only for guests whose browser confirms efficient hardware WebRTC decoding; older/incompatible guests receive H.264. In a real mixed-browser test, installed Chrome decoded H.265 and Edge decoded H.264, matching guests shared an encoder, and live codec/preset changes preserved the controller connections. Native Mac capture remains H.264. No CPU HEVC fallback is silently selected.

Additional synthetic-scene measurements at 1920×1080/60, 90 frames and two paced repeats per method:

| Encoder / target | Submit→packet median | p95 | SSIM | Actual Mbps |
| --- | ---: | ---: | ---: | ---: |
| NVIDIA H.264 P1 / 8 Mbps | 2.51 ms | 3.30 ms | 0.8161 | 8.00 |
| NVIDIA H.265 P1 / 8 Mbps | 2.73 ms | 3.16 ms | 0.8286 | 8.84 |
| NVIDIA H.265 P1 / 6 Mbps | 2.42 ms | 2.99 ms | 0.8199 | 6.96 |
| NVIDIA H.265 P2 / 8 Mbps | 3.56 ms | 3.88 ms | 0.8309 | 8.62 |
| Intel H.265 depth 1 / 8 Mbps | 5.85 ms | 6.35 ms | 0.8460 | 8.20 |

H.265 P1 was not inherently faster than H.264 P1. In this scene its lower-target variant had slightly better SSIM with about 13% less **actual** bitrate (the nominal target reduction was 25%). Short-run headers/keyframes and rate-control behavior explain why actual bitrate differs from the target. These are synthetic compression measurements, not a guarantee for every game. P2 modestly improved quality while taking more encoder time. Each method produced its first packet after one submitted frame.

The same-browser guest comparison used Chrome, WGC GPU scaling, native NVENC P1, a 720p/60 cap and no audio. H.264 measured 43.4 ms median/55.5 ms p95 picture age and 49.2 distinct presented frames/sec; H.265 measured 43.4/57.4 ms and 38.9 frames/sec. Earlier H.265 measured 42.4/49.5 ms and 46.7 frames/sec. These short generated-window runs include source cadence, browser scheduling and display estimation; they support compatibility/compression options, not a universal H.265 latency improvement. [Recorded codec results](benchmarks/2026-10-17-codecs.json) retain the raw values. The delivery-worker change also prevents a blocked native viewer from synchronously holding up another viewer; see [queue behavior and limits](latency.md).

[Chrome's HEVC WebRTC announcement](https://developer.chrome.com/blog/chrome-136-beta) explains the runtime capability requirement. [NVIDIA's application note](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-application-note/index.html) documents hardware and codec-dependent performance. The UI checks actual decoding capabilities instead of inferring support from the browser name.

## Reproduce

After native setup, run `npm run benchmark:encoders`. It creates a temporary raw reference, compares NVIDIA/Intel/AMD/CPU variants sequentially, saves JSON/Markdown and compressed samples under `.local/benchmarks/encoders`, and deletes the large raw reference. No desktop or sound is captured. `BENCH_FRAMES=90`, `BENCH_REPEATS=2`, `BENCH_METHODS=nvenc-p1,qsv-depth1` and `BENCH_LABEL=experiment-name` customize a run. Unavailable methods are recorded explicitly.

On Windows, install Playwright/Edge and set `PLAYWRIGHT_MODULE` to the absolute Playwright `index.mjs` path, then run `npm run benchmark:guest`. This opens and closes only generated clock windows. The browser method automatically selects the generated window and verifies its identity. Results go under `.local/benchmarks/guest`. `BENCH_METHODS=qsv-depth4,qsv-depth1` limits the comparison. Run comparisons more than once before drawing conclusions from small differences. Each successful guest run also records presentation frame intervals and measured frame rate; reported instantaneous WebRTC FPS alone does not describe smoothness.

For an individual test, `LATENCY_ENCODER=h264_qsv` and `NATIVE_QSV_ASYNC_DEPTH=4` reproduce the previous queue using `system/scripts/smoke-preview-latency.mjs`; omit the depth override for the fixed default. `NATIVE_NVENC_PRESET=p2` changes the explicit NVIDIA preset. Use `LATENCY_GUEST=1`, `LATENCY_RESOLUTION=720` and `LATENCY_FPS=60` for the table's workflow. `LATENCY_AUDIO=1` separately checks native application audio, and `LATENCY_REPORT=short-name` saves an individual JSON report. No account credentials belong in benchmark commands or reports.

For HEVC comparisons, `BENCH_METHODS=nvenc-p1,hevc-nvenc-p1,hevc-nvenc-p1-6mbps,hevc-nvenc-p2,hevc-qsv-depth1` selects the encoder variants. `LATENCY_BROWSER_CHANNEL=chrome` and `LATENCY_CODEC=h265` run the guest comparison; omit the codec override for H.264. The H.265 test verifies the actual decoded MIME type, so a compatibility fallback cannot be mistaken for an HEVC measurement. `system/scripts/smoke-codecs.mjs` exercises the real mixed Chrome/Edge codec path.

## Cloud-gaming research

- [NVIDIA's FFmpeg guidance](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/) recommends single-frame VBV, no lookahead/reordering and ultra-low-latency rate control for interactive workloads. The app already follows those choices on NVENC.
- [NVIDIA's encoder API guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html) explains the P1–P7 performance/quality tradeoff. Moving encoded output into GPU memory is useful when downstream processing also runs there; a network sender still needs packet bytes. HEVC/AV1 split-frame features are not a drop-in H.264/WebRTC improvement.
- [Sunshine's configuration](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html) uses P1 for game streaming, offers quarter-resolution multipass for rate control, and documents CABAC's compression benefit. Those ideas motivated measured comparisons rather than an assumed preset win. GPU power-state changes were not applied to the user's global settings.
- [FFmpeg's codec reference](https://ffmpeg.org/ffmpeg-codecs.html) describes QSV asynchronous depth as the parallel-operation queue. The installed encoder's option help reports its default as 4; the app explicitly chooses 1.
- [AMD's recommended FFmpeg settings](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/Recommended%20FFmpeg%20Encoder%20Settings) and [Advanced Interactive Streaming design](https://gpuopen.com/learn/building_better_applications_together_open_source_amd_advanced_interactive_streaming/) support using AMF's own interactive settings rather than NVIDIA flags. This machine cannot provide an AMD latency measurement.
