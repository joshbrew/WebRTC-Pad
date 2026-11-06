# Cameras, voice and diagnostics

Before joining, open **Microphone** under **Join with** to choose a device and turn on a private mic test. Speak to check the input meter; no sound is played back to your speakers or sent to anyone. Turn it off to release the mic. A prepared mic joins voice automatically after connecting if the host allows microphones. Switching to Host or closing the page releases private capture.

Start or join a session to reveal **Voice chat**. Voice works with controllers only, video, or audio-only sharing. **Join voice** asks for microphone permission; **Listen only** plays other people without opening your mic. Use **Mute mic** during the call or **Leave voice** to stop microphone capture. Leaving or ending the game session stops voice capture too.

Open **Devices & sound** to choose a microphone, select the output device where supported, or adjust listening volume. **Sound quality** contains echo/noise reduction and automatic mic gain. Microphone changes replace the outgoing track without reconnecting controllers. Headphones usually give the best results.

The same settings contain a volume slider for each connected participant, optional **Push to talk**, and a configurable talk key (Right Alt initially). Guests can also lower received game sound during speech. Ducking affects the guest's stream playback, not the host computer's game volume. Push-to-talk gates the existing microphone track; it does not repeatedly request or recreate capture. It works while this app has focus, and key release, focus loss or a hidden page closes the gate. Mic mute and host revocation still take precedence. Speech detection runs only when sound ducking is enabled and guest voice is active; its analysis nodes/context are released when disabled, leaving, or becoming host. Original game volume is restored afterward. Voice volume is not reduced with game sound.

Voice uses 48 kHz Opus with a default 128 kb/s send limit per person, or an optional 192 kb/s limit. Automatic quality control adjusts each connection separately between 64 kb/s and the chosen ceiling, based on reported packet loss and round-trip time. Turn off **Adjust quality automatically** under **Sound quality** to keep the chosen send limit. These are maximum send rates; actual bitrate depends on the codec and congestion control. Device, quality, automatic adjustment and listening preferences are remembered; microphone capture always requires an explicit action. Turning off noise reduction can preserve a more natural microphone sound in a quiet room.

Participants send voice directly to each other. The host forwards voice setup messages through the existing controller connection; it does not mix or re-encode everyone's audio. Each person sends one audio stream per other participant, so voice upload grows with the number of people. Controller and game video connections remain separate. No microphone access occurs until the person chooses to enable it.

**Whole-system audio includes the sounds played by the voice call.** Choose the game's app audio instead, or send voices to a different output device from the one being captured, to avoid sending voices back into the game sound. The host sees a reminder while a full-system stream and voice playback are active. Browser echo cancellation applies to the microphone, not to desktop loopback audio.

Game sound has a separate 192 kb/s stereo Opus send limit. It retains lower network priority than gameplay video and controls. The game's **Sound on/off** control does not mute the voice call. The host's preview controls are directly beneath the preview; disabling that preview leaves guest streams running.

## Camera sharing

Use **Camera** in the call bar to share a webcam in either direction. It starts off, and receiving cameras does not ask for access to your own camera. The settings button beside Camera selects a device, resolution and frame rate; these apply live and are independent of the game stream. Defaults are **480p, 24 fps**. Camera tracks carry no audio; use **Mic** for voice.

Capture is shared across recipients, with separate WebRTC video connections and H.264 preferred when supported, retaining other browser codecs as fallbacks. Camera upload has a combined 1.2 Mb/s ceiling and a normal 480p ceiling of 600 kb/s per recipient. These are send limits, not guaranteed rates. Every two seconds, camera quality checks its own loss/delay and fresh game-stream measurements from both the sender and recipient. Congestion reduces camera bitrate, picture size and frame rate immediately, down to 120p/5 fps when necessary. Six healthy samples are required for each recovery step. Browser priority hints are advisory; the explicit limits and feedback adaptation do not depend on the hints being supported.

Cameras use no game-video encoder profile, native desktop permission or additional microphone capture. Listener-only participants do not poll send statistics. No camera peer connections are created when everyone has cameras off. Turning a camera off releases its track; leaving the session releases all camera capture and connections. Switching hosts preserves the active camera tracks and existing connections.

Camera thumbnails can fullscreen individually. Guest layout icons also include the game and camera views. Camera tiles never send desktop mouse or typing input. **Show other cameras** stops receiving them while still allowing your own camera to be shared.

## People, personal mutes and host controls

Guests can open **People → In this session**, including while fullscreen, to see the host, other guests, and each computer's joined controllers. Multiple controllers appear under one person. The list contains display status only; other guests' connection diagnostics, addresses and stream measurements are not included.

The mic and camera icons in that guest list **mute sound or hide a camera only for you**. The host and other guests keep hearing/seeing that person. Hiding a camera also unsubscribes its video to your computer. You can restore it at any time. Personal mutes follow participants through a host switch and clear when the call ends.

On the host's participant card, the mic and camera icons control whether that guest may share with **everyone**. **More** has personal sound/camera mutes for the host and that guest's camera resolution/frame-rate ceiling. Removing microphone permission stops that guest's microphone capture. Allowing it again does not open their mic: the guest chooses to turn it on. A blocked camera remains a private preview and resumes sharing when allowed. These controls apply to camera video, not screen sharing or game sound.

**Guests & access → Camera limits** sets a live maximum camera picture size and frame rate for the whole session, including the host. It is also available before starting. Each camera uses the lowest of its own settings, the session ceiling and any individual ceiling; gameplay congestion can reduce it further when automatic adjustment is enabled. Turn off **Adjust cameras automatically for gameplay** in Camera limits to keep selected sizes and frame rates throughout the call, or turn off **Adjust camera quality automatically** for your own camera. Browser congestion control still applies. These settings are remembered. Limits update capture/sender settings without restarting the screen share or controller connection. Host limits survive a host switch; individual restrictions clear when the call ends. Microphones and cameras remain subject to the host's separate session-wide permission switches.

## Small diagnostic charts

Open **Diagnostics & charts** in **Settings** on either side of the call. Hosts can select their preview or a guest with received video measurements. Guests can see controller round-trip measurements even with video off.

A compact panel shows current numbers and one thin chart. Choose Delay, Frame rate, Video data, or Packet loss from the Chart selector. The measurements cover controller/video network round trip, video playback buffer and decoding time, received frame rate, video bitrate, and packet loss. Missing measurements appear as gaps. They measure different parts of the pipeline and do not measure total button-to-picture delay. Preview numbers describe the local preview, not a remote guest's experience.

The app retains the latest 120 samples per source from stats it already collects. **Pause recording** freezes that panel's history without affecting the stream or automatic quality control. **Reset** starts a fresh recording. **Save CSV** exports numeric values for the selected source; it contains no invitation keys, addresses, usernames, or credentials. Guests leaving are removed from the host's source selector, so save a guest's recording before they leave.

The pinned `uplot-webgpu` 0.2.0 dependency loads only after an expanded, visible panel has samples. Its GPU resources are released when the panel closes, the app switches views, or the page becomes hidden. There is no chart animation loop or additional WebRTC stats timer. Recording remains bounded while collapsed; pause it to stop recording as well. Browsers without WebGPU can still record and save CSV.

The npm archive ships ESM source rather than its advertised `dist/` entry. The app explicitly serves only the required module graph and chart CSS from the installed dependency. No CDN is needed. Its README declares the MIT License and credits the original [uPlot](https://github.com/leeoniya/uPlot). The chart stylesheet's demo-wide light-theme rules are removed when served so opening diagnostics does not change the app theme.

**Join and leave sounds** are on by default. Turn them off in call settings to remember a quiet preference.

Screen sharing keeps its own remembered automatic adjustment switch: **Adapt each friend’s quality automatically** for the host stream and **Adjust automatically for gameplay** for guest screens. Receive-resolution controls remain ceilings within the host’s offered quality. Game sound uses its separate fixed stereo Opus send limit; automatic microphone adjustment does not alter game sound.
