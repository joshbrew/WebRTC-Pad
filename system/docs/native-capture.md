# Native desktop capture and quality

Controller sharing does not require video. Start a session without choosing a screen source, then exchange invite/reply files if you use Discord for picture and sound. The input/control connection has no audio/video sections. Video, when enabled, uses its own WebRTC connection; changing or stopping it leaves controller input connected.

## Optional native setup

```sh
npm run setup:native
```

Setup downloads a checksum-verified portable Go compiler, builds the pinned Pion WebRTC helper and the Windows WASAPI audio helper, and on Windows x64 downloads the upstream-linked FFmpeg build when needed. Tools live under `.local/tools`; capture does not start during installation. Linux/macOS need FFmpeg installed separately, with the required capture device and hardware encoder. Restart the app afterward.

Select a native window or screen under host **Screen sharing**. The selected source appears in a local preview before you start a session. This preview creates no room or virtual controllers. Start reuses the prepared native capture and preview connection. If you have disabled the local preview, use **Show preview** to check your source. Selecting a source during a running session switches sharing immediately. The **Screen sharing (optional)** method selector separates native source selection from the browser’s sharing dialog. Browser capture can also be selected and previewed before starting; its approved stream is reused when the session begins. Windows first tries DXGI Desktop Duplication through FFmpeg `ddagrab`, then automatically falls back to GPU-based Windows Graphics Capture (`gfxcapture`) if that source is unavailable. Set `NATIVE_WINDOWS_CAPTURE=dda` or `wgc` to force one. The successful method is shown in capture status. Encoded H.264 RTP travels to a separate Pion process and directly into WebRTC. Raw desktop frames never pass through Node or browser JavaScript. Native full-size NVIDIA capture passes GPU textures directly to the encoder. WGC/NVENC downscaling also stays on the capture GPU when verified source dimensions and GPU interop are available. Other paths retain scaling inside FFmpeg, including frame download when required. The UI reports the actual path.

### Native audio on Windows

Leave **Include audio** enabled in the source-selection block before or after choosing a native window or screen. It is on by default on a fresh page and captures nothing until you choose a source. Source selection preserves the checked setting, and the audio note describes the selected app or system scope before sharing.

- **Window:** captures the selected application's process tree, including its child processes. Other windows belonging to the same application may also be audible. This requires Windows build 20348 or later; unsupported systems disable the option instead of capturing all system audio.
- **Screen:** captures the default playback device's system sound, including other applications. Apps routed to a different output device are not included.

The native helper uses WASAPI loopback without a microphone or virtual audio cable. FFmpeg encodes stereo 48 kHz Opus, and the native WebRTC helper sends it alongside the video. Guests with matching or different video profiles share the same audio capture and encoding. The host preview is muted to prevent feedback. Its **Hide preview / Show preview** button pauses or restores just the local view while guests keep watching. The same saved choice appears in settings; automatic pause on switching away remains separate. Guests use **Sound on/off** to control playback. Turning native audio on or off keeps the existing video track, encoder and peer connections running. Audio capture and encoding stop when audio is disabled; an inactive audio track is reserved in the media connection so enabling sound needs no new handshake. Initial source encoding runs alongside ICE route gathering. The audio status reports readiness or a capture error; video can continue if audio fails. If you change the default playback device, reselect the source to restart audio on the new device. Linux native playback audio is implemented separately through libpulse; Mac native playback audio uses ScreenCaptureKit on macOS 13+; it remains experimental pending Mac hardware validation. See [Mac setup](macos-desktop.md).

### Audio-only sharing

Turn on **Share audio only** in the source block, then choose an app or system audio source. Supported native hosts capture and encode only audio: no screen capture or video encoder is started. Guests click **Sound off** to enable playback and can use **Refresh audio** without interrupting controllers.

Without native audio tools, choose **Browser tab / screen audio…**. The browser still requires its screen/tab sharing dialog and an approved audio source. Its local capture remains open, but no video track is sent to guests. Window audio availability depends on the browser and OS. Turning audio-only off restores the video source controls.

### Browser video with native audio

On Windows, Linux and supported Macs, browser video can use native audio even when its sharing dialog cannot include sound. Leave **Include audio** enabled, open **Choose app audio instead** beside the video source controls, then choose **Sound from**: a specific application or explicitly **System audio**. The audio app may be different from the video window. This selection only changes sound; mouse permissions continue to follow the verified video scope and separate host consent.

Native audio replaces browser-provided sound while enabled. The native helper sends shared Opus directly to each guest through a separate audio-only WebRTC connection. The host browser does not decode and re-encode this sound, and no native video encoder or native screen capture starts for this path. Preparation works before Start and is adopted into the session. Choosing **Browser sharing dialog** restores audio already supplied by the browser; unchecking **Include audio** turns all shared sound off. If restoring browser audio, if its approved stream has no audio track, choose the browser source again to request audio. Changing the sound app preserves the browser video track. Stopping sharing, ending the session, or disconnecting the host stops the native audio helper.

Browser mode opens the browser sharing dialog directly and does not scan local windows. The native audio app list is enumerated only when you explicitly opt into native audio. Audio must be offered and approved in that dialog: window audio may be unavailable, while a browser tab or entire screen may offer it depending on browser and operating system. Entire-screen audio can include other apps. The app reports whether an audio track was actually included and updates that status if it ends; requesting audio does not guarantee it. The app prefers native capture when its runtime is installed; choosing browser capture is remembered. Fresh installations without native tools use browser capture. Windows display index defaults to 0; configure `NATIVE_DISPLAY_INDEX` if you want another monitor. Capture requires the app to run in an interactive logged-in desktop session.

For advanced Windows window capture, set `NATIVE_WINDOW_HANDLE` to the current positive decimal HWND, restart Node, and check the host preview before sharing. This selects that exact window through Windows Graphics Capture; clear it to capture the monitor again. Handles change when windows reopen. The native source list is the simplest way to select a specific window. On Windows the selected window is also used for scoped desktop input after separate permission; sharing alone grants no input access. The yellow Windows capture border is enabled. See [FFmpeg’s Windows Graphics Capture options](https://ffmpeg.org/ffmpeg-filters.html#gfxcapture).

Resolution selections are maximum bounds: native scaling preserves the source aspect ratio and avoids enlarging a smaller source. A 16:10 desktop therefore has a different width from a 16:9 desktop at the same height. WGC delivers frames at the compositor’s rate up to the selected maximum; live received FPS can be lower for static windows or a busy connection. Matching actual output dimensions/FPS/bitrate share the preview encoder even when the display is not 16:9.

| GPU / platform | Encoder | Selection |
| --- | --- | --- |
| NVIDIA | `h264_nvenc` | Windows automatic first choice |
| Intel | `h264_qsv` | Windows automatic next choice |
| AMD | `h264_amf` | Windows automatic next choice |
| Apple | `h264_videotoolbox` | macOS default |
| CPU | `libx264` | Explicit opt-in |

NVENC requires NVIDIA hardware; it does not run on AMD. AMD’s encoder uses its own AMF options, including constrained baseline H.264 and low-latency CBR. See [AMD’s FFmpeg AMF guidance](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/AMF-Encoder-Settings-and-Tuning-in-FFmpeg). Override automatic selection with `NATIVE_ENCODER=h264_amf` (or another encoder above) in `.env`. CPU encoding is not silently substituted.

The host checks native encoders before sharing and shows **Ready to use NVIDIA NVENC**, **AMD AMF**, **Intel Quick Sync**, or **Apple VideoToolbox**, as applicable. **Graphics & encoder details** lists detected adapters and each candidate’s result; **Check again** repeats the check. It encodes two generated frames using the same codec options as native streaming, without capturing the screen or sound. Checks are cached for five minutes and concurrent requests share a single check. A forced recheck reuses results younger than ten seconds. Native setup also prints the selected encoder.

Automatic Windows selection uses the first passing encoder in the existing NVIDIA → Intel → AMD order, then tries it first when capture starts. An explicit `NATIVE_ENCODER` setting is checked on its own. The actual selected source, GPU interop, quality and encoder-session capacity are still verified when sharing starts; the UI then reports the encoder returned by the stream helper, including any runtime fallback. GPU names alone are never treated as proof of working encoding. macOS uses VideoToolbox; Linux automatic capture currently checks NVENC. OS adapter inventory is optional, so a missing inventory does not prevent testing the encoder directly. No scan results are sent to an external service.

Windows native NVENC has been tested here, including 1080p at 60 fps and independent lower-quality clients. Intel Quick Sync has also passed generated-scene encoding and real local guest streaming. Its single-frame asynchronous queue removes several frames of unnecessary encoding delay. AMF could not be hardware-tested on this laptop. Linux native video requires an X11 session. The native source list supports X11 windows by explicit XID, with PID/process-start checks. Desktop dimensions are detected with xrandr or configured as `NATIVE_SCREEN_SIZE=1920x1080`; native Wayland video is not implemented. Linux native audio can accompany browser video on either X11 or Wayland. See [Linux desktop setup](linux-desktop.md). macOS 13+ uses the locally built Swift ScreenCaptureKit helper for a selected window or main display, with direct VideoToolbox encoding and separate optional app/system audio. Screen Recording permission is required; a numeric screen device index is no longer needed. See [Mac setup](macos-desktop.md). These capture paths have not been hardware-tested here. macOS virtual controller injection remains experimental and separate from capture.

Advanced `.env` tuning: `NATIVE_NVENC_PRESET=p1` is the default; `p2` through `p7` trade additional encoder work for compression quality. `NATIVE_QSV_ASYNC_DEPTH=1` is the default; increasing it to 2–8 adds queued frames and is intended only for troubleshooting or controlled comparisons. The encoder readiness check uses these same settings. Leave these defaults for low-latency play. See [encoder comparisons](encoder-benchmarks.md) for measured tradeoffs and repeatable developer benchmarks.

In host stream settings, **Video codec & hardware tuning** exposes H.264 (default), optional H.265/HEVC, and NVIDIA P1/P2/P4 presets. Keep P1 for minimum encoder work. H.265 requires a working native hardware encoder and a receiving browser that confirms smooth, power-efficient WebRTC decoding at the requested size/rate. Unsupported guests receive H.264; guests can also force H.264 in **Video compatibility**. Browser capture chooses its own codec. Mac native capture currently stays on H.264; H.265 native encoding is implemented for the FFmpeg NVIDIA, Intel and AMD paths, with only NVIDIA and Intel encoder measurements on this machine. A failed H.265 startup or decode falls back without replacing the controller connection.

Matching resolution, rate, bitrate, codec and preset share an encoder. A mixed H.264/H.265 group needs separate profiles and therefore more host work. The client connection details report the actual received codec, with decoder information available on the decode-time field when the browser supplies it. See the [H.264/H.265 measurements](encoder-benchmarks.md#h264-and-h265-options).

Optional paths: `FFMPEG_BIN`, `NATIVE_MEDIA_HELPER`, and Windows `NATIVE_AUDIO_HELPER`. Native setup builds the audio helper with the built-in 64-bit .NET Framework C# compiler; no audio driver is installed. To build manually with Go 1.24+:

```sh
cd system/native/media
go build -o ../../../.local/tools/webrtc-pad-media .
```

Use an `.exe` filename on Windows. Matching client quality profiles share an encoder; different resolution/FPS/bitrate/codec/preset profiles use separate native encoder processes. `NATIVE_MAX_PROFILES=4` defaults to four simultaneous profiles, including the preview. Hardware encoder session limits can be smaller. Node handles signaling and small control messages; FFmpeg, Pion, and OS controller helpers do the intensive work in separate processes.

## Resolution, frame rate, and adaptation

Host settings are a maximum. Each client can request a smaller resolution or frame rate; the host never upscales above the source or host cap. Browser capture scales per sender, and native capture uses per-profile encoders. Changing the host frame rate restarts native video at the new rate and preserves controller connections. Browser capture requests the new rate from the source.

A 30 fps source cannot produce 60 unique frames just because the maximum is 60. Static screens can also produce fewer browser frames, and network/encoder/decoder limits can lower the received rate. The host reports the capture source settings; the client overlay and connection details report **actual decoded dimensions and frame rate**. The animated local demo adjusts its source drawing clock with host settings, rather than fixing it at 30 fps.

Host or client can enable automatic adaptation; adaptation is allowed if **either** opts in. Disable both to stop the app’s automatic resolution changes. Congestion handling in WebRTC can still reduce delivery. Repeated high loss, round trip, buffer delay, or freezing lowers only that client’s quality; sustained healthy readings recover gradually. Client requests always remain below the host cap.

Connection settings show control round trip, media round trip, bitrate, packet loss, jitter, average decode time, buffer time, and dropped frames. These measure different portions of the pipeline; none alone is total button-to-screen latency. Native bitrate is a profile cap, while measured received bitrate depends on the scene and delivery.

## Controller-only use with Discord

The host leaves screen sharing off. On the player side, **Stream on → Stream off** disables reception and tears down picture and sound. It can be toggled back on while connected. Enable **Keep my gamepad active while using Discord or another window** if a physical gamepad should continue sending while this tab is unfocused. A worker supplies input ticks without needing video. Keyboard input always requires this page’s focus; pausing/disconnecting, unplugging the controller, or losing the app connection releases held controls. Browsers/OSes can still restrict hidden-page gamepad access or scheduling, so keep the tab running and check behavior in your browser.

For a visible animated loopback test with two independent local apps/windows:

```sh
npm run demo:local
```

This developer test needs Playwright and Edge/Chrome; set `PLAYWRIGHT_MODULE` if installed elsewhere. It uses a synthetic animated scene, real WebRTC and, on Windows, real XInput. It does not replace normal screen capture or ship a test browser. The moving sweep, timestamp, frame counter and input-responsive color flash help compare source and received motion. Demo timing is approximate and specific to this same-computer test.

The host can turn off **Allow guests to use keyboard controls** in Settings. This governs the app’s keyboard-to-controller mapping, releases held mapped keys, and leaves physical gamepad input available. The app does not inject desktop typing or mouse events.


## Selecting a source and mouse access

Choose **Native capture**, then open the window/screen picker. Opening it refreshes the list. Tiles include one-shot thumbnails when available: Windows uses a small native helper, macOS 14+ uses ScreenCaptureKit, and Linux X11 uses FFmpeg. Protected, minimized, closed or unsupported windows may show an icon instead. Thumbnails stay local, are requested only for visible tiles, use at most two workers, and are discarded when the picker closes.

During a call, **Change shared window or screen** opens this picker directly; choosing a tile replaces the main source. **Add another screen or window** creates an extra view instead. Changing the main source stops capture of the old source and releases its desktop input. The `.env` window handle remains a default selection when available.

Screen sharing alone never grants mouse access. A shared window can receive window-only clicks after host and guest confirmation. Full-screen mouse control needs the additional **Allow control of my entire primary screen** permission. The Windows helper refuses clicks through a covering app and tracks window movement/size. If the shared window closes, its mouse access and capture stop while controller connections remain available.


## Preview delay and performance

Native preview receives the encoded stream over local WebRTC, so capture, encoding and browser playback contribute delay even before anyone joins. NVENC explicitly disables its extra asynchronous output queue (`-delay 0`), in addition to lookahead and frame reordering. It uses a fast preset and single-frame bitrate buffer. Capture timestamps pass through without duplicating frames. Supported WGC/NVENC profiles resize on the GPU; incompatible setups fall back to native-process scaling. Preview and guest receivers request the browser’s supported low-delay playback hints; browsers may still retain buffering for smooth playback.

The host's muted native preview receives video only. Guests play sound separately from picture, prioritizing fresh game frames over deliberate audio/video synchronization. Audio toggles do not replace or restart the video player. See [gameplay latency](latency.md) for implementation details, research and measured results.

Guest sound defaults to on and remembers an explicit mute choice. If the browser refuses automatic audio playback, **Enable sound** requests the required click; **No audio** means no usable shared audio track is arriving. Including audio and successfully capturing a silent application are separate from the guest's playback volume.

Native quality changes retain the previous transport/encoder until the guest has decoded the replacement's first frame. A failed replacement keeps the prior native transport available. Automatic quality ignores negotiation warm-up, does not reduce resolution solely because a distant route has high round-trip time, and waits for sustained improvement before increasing resolution again. A receiver that keeps getting packets but stops decoding requests a picture refresh with a retry limit; an idle source does not trigger this. Controller connections are independent of these changes.

Active native sources start replacement receivers on a fresh keyframe instead of replaying an older GOP with older timestamps. Idle sources retain their bounded startup snapshot. Waiting for a fresh frame happens while the previous guest picture continues playing.

Developers can use `npm run test:native-handover` with `PLAYWRIGHT_MODULE` set to exercise four quality changes through FFmpeg, Pion and the actual call UI, with two guests and generated pixels. It checks that the displayed picture is never cleared, the other guest retains its quality, retired encoder profiles are released, and desktop call controls fit one row. It opens no source windows, audio devices or real controller outputs. The Windows acceptance test `system/scripts/smoke-native-av.mjs` separately checks real window capture, local source thumbnails and application-only audio with disposable animated tone windows.

Native video also negotiates WebRTC's sender playout-delay extension, asking supported browsers to present fresh frames immediately. Unsupported peers keep ordinary playback. Set `NATIVE_PLAYOUT_DELAY=0` and restart to opt out if a jittery connection benefits from additional presentation smoothing. This does not set audio delay or guarantee zero total latency.

The line below the host monitor shows actual decoded dimensions/frame rate and, for native capture, measured playback-buffer delay. Hover for per-frame decode time. Buffer/decode timings exclude capture and encoding; they are not total input-to-picture latency. Hiding or pausing preview stops these readings while guest streaming continues.

Windows developers can run `system/scripts/smoke-preview-latency.mjs` with `PLAYWRIGHT_MODULE` set to time generated clock pixels through a real WGC/NVENC/WebRTC stream. `LATENCY_UI=1` checks the actual pre-session host preview and its readings; `LATENCY_GUEST=1` checks a connected guest using actual invite/reply exchange; `LATENCY_AUDIO=1` adds silent app audio; `LATENCY_FPS=30` or `60` selects the rate. An optional `LATENCY_MAX_MS` sets a local acceptance budget. This test opens only a generated window, captures no microphone or real input, uses loopback media, and closes its fixtures afterward. Measured delay depends on GPU load, capture resolution and browser scheduling.


### Share a selected area

Choose a source, then **Select an area…** to draw a rectangle over the preview, before or during a session. **Exact area dimensions** holds optional left/top/width/height fields in source pixels. The picker scales preview coordinates back to native source pixels. A second drag refines the existing crop without exposing the rest of the source. **Share full source** explicitly removes it. Native encoder output can round dimensions down to even pixels. Choose the area again if the source changes size.

Windows WGC crops on the capture GPU before optional GPU scaling. Desktop Duplication and Linux X11 use FFmpeg cropping before encoder scaling. Mac ScreenCaptureKit uses `SCStreamConfiguration.sourceRect`. Browser capture uses a canvas stream with on-demand frames, video-frame callbacks and a bounded worker clock to keep its offscreen source advancing; native capture is preferred for gameplay overhead. Audio capture scope is unchanged by a video crop. Desktop mouse and desktop typing are revoked and cannot be re-enabled while a crop is active. Gamepad and mapped keyboard-to-controller input remain independent.

Guests can open each shared view in a separate video-only window from **Shared view > Open views in separate windows**. These use separate media connections over the existing call’s signaling channel, not new player slots. Pop-outs are ordinary resizable browser windows, with their own fullscreen control; the main player’s existing Picture-in-Picture option remains available separately. Each extra window uses bandwidth and decoding resources. Native views share an encoder profile when their quality settings match; pop-outs use H.264 and do not negotiate an audio track. Closing, disconnecting, removing the source, or ending the call releases the subscription.
