# Controller integration choices

The remote player's controller is read through the browser Gamepad API. The game computer needs a separate OS-visible virtual device. Recognition databases solve the first problem or an emulator's binding problem; they do not create a system controller.

## Included now

- Browser-standard layouts, a live input readout, deadzones, saved custom button/stick mappings, and button/axis trigger mappings.
- Windows: `vigemclient@1.5.3` (MIT) feeding a separately installed ViGEmBus driver (BSD-3-Clause). The binding's native threads are isolated in a helper; shutdown and stale-input release are implemented. ViGEmBus is retired, so this is a compatibility backend, not a maintained-driver promise.
- Linux: an original Python-standard-library helper using `/dev/uinput`, with configurable devices and no third-party Python packages.
- macOS: original generic HID helper source and entitlement configuration. Signed distribution and actual target-game recognition remain to be validated on Macs. No old unsigned kernel extension is bundled.

## Several controllers at one guest computer

Press-to-join is the browser default. Pairing grants Play/Watch access to a computer, without reserving controller seats. Each fresh gamepad button press adds that device to the guest’s ordered group and requests the next free host slot. Idle pads, axis drift and a button held before connecting do not enroll. Guest and host removal revoke an individual lane, neutralize it, remove its native virtual device and increment the assignment generation. Remaining controllers keep their existing host slot identities. The guest can intentionally rejoin after releasing and pressing a button again. Unplugging removes a joined pad; pause keeps it assigned but neutral.

The existing WebRTC input channel carries all enrolled controllers. The server owns lane-to-slot assignments; clients cannot forge host slots. Sequence validation is independent per lane because input is unordered. Native helpers acknowledge dynamic device creation/removal and isolate a failed new allocation from existing controllers. Controllers are not all created at session startup.

Incoming device brands are independent of the host’s output type. Standard browser mappings use face-button position, including Pro controllers whose printed letters differ. Unrecognized generic layouts require explicit saved mappings. The app forwards common gamepad buttons, four stick axes and two triggers; proprietary gyro, touchpad, wheel/flight-controller controls and arbitrary raw HID descriptors are not automatically passed through.

Windows defaults to automatic mixed output using the same installed ViGEmBus driver/binding: use available XInput slots and add HID/PlayStation-layout devices after those fill. Incoming controller brands do not choose the output type. Xbox-only and HID-only are optional compatibility overrides. Only Xbox output has the four-XInput-slot restriction, including other physical/local XInput devices. HID output can exceed four where the game supports it. Press-to-join grows as controllers join, without a fixed application controller cap. This is not a promise that every OS/game/driver or browser supports an arbitrary number of devices. Eight actual Windows HID outputs have passed native and WebRTC tests. A game that only reads XInput still requires Xbox output and its smaller limit.

The guest has individual device tests and custom mappings. Delivery receipts confirm the host bridge accepted input while its driver was available, not that the game selected the device. Manual count/reservation is retained under advanced host setup for applications that require devices to exist before opening their controller configuration. Linux supports dynamic uinput devices; macOS generic HID remains experimental and requires appropriate signing/entitlements.

## Free emulator/controller tooling

### Dolphin on Windows

Start hosting before refreshing Dolphin's devices. In Dolphin's controller settings, enable a **Standard Controller** for the desired GameCube port and open **Configure**. The Device list should offer the app's Xbox 360 controllers through SDL, Windows Gaming Input and XInput; those are alternate APIs for the same pads. Choose one API/device per player, then bind the GameCube buttons, sticks and triggers to it. Selecting a device does not replace existing keyboard bindings. Dolphin's **Default** button restored keyboard defaults during our check, so use explicit mappings or a suitable saved profile instead.

With no physical controllers taking earlier XInput indices, the first virtual pad was `XInput/0/Gamepad` in the live test. Press a button from the corresponding guest to identify the correct device when other controllers are connected. Right-click a mapping to open **Configure Input**, where live raw values can be checked. The local WebRTC test visibly reached A=1, left stick 0.8/0.6 and left trigger≈0.70, then released to zero. This verifies recognition and input delivery in Dolphin 2609a's configuration UI; no game/ROM test is claimed.

The browser reader remains the default: standard-mapped pads are normalized automatically, and raw layouts can be configured and saved. All hosts receive the same named buttons, sticks, and triggers rather than hardware-specific button numbers. Windows turns those into the selected XInput or HID output; Linux/macOS use their OS backends. A PlayStation or other recognized player pad can therefore drive the host's virtual Xbox controller without matching hardware identities. Actual model/OS/browser support still needs device testing. See the [Gamepad standard](https://www.w3.org/TR/gamepad/).

Windows x64 guests can optionally use the included original native SDL3 reader for selected gamepads and generic joysticks. It runs in a separate helper, normalizes recognized SDL mappings to the browser-standard layout, and bridges snapshots through the same WebRTC controller lanes. Custom raw layouts use the existing mapping UI. HidHide supplies controller isolation, while Interception supplies selected keyboard/mouse isolation; these are optional guest-side drivers independent of the host's virtual output backend. Setup downloads pinned SDL3 3.4.18 and Interception 1.0.1 libraries locally, preserving their upstream licenses. No kmamal binding is required or bundled. See [guest isolation setup and validation limits](guest-device-isolation.md).

[SDL_GameControllerDB](https://github.com/mdqinc/SDL_GameControllerDB) is a community controller mapping database under the zlib license. SDL2 loads it with `SDL_GameControllerAddMappingsFromFile`; SDL3 uses `SDL_AddGamepadMappingsFromFile`. The upstream project links GUI mapping tools and the official SDL `controllermap`/`testcontroller` utilities.

This is a good fit for a future native SDL client or for an emulator that already loads SDL mappings. Its GUIDs and indices are SDL-specific. A browser's raw Gamepad order is not necessarily SDL's order, so this app does not blindly import that database into browser input mapping. The included browser mapping controls provide the equivalent configuration feature without an additional library. No copy of the third-party database is redistributed here.

[SDL virtual joysticks](https://wiki.libsdl.org/SDL3/SDL_AttachVirtualJoystick) are useful when integrated into the game/emulator process. A standalone SDL virtual joystick is not a replacement for a system-level controller visible to unrelated games.

For maintained future OS backends, review the current [Sunshine input driver configuration](https://docs.lizardbyte.dev/projects/sunshine/v2026.1008.155609/md_docs_2configuration.html). Its newer Virtual HID Broker path requires a paid active license for driver-backed gamepads. It should not be represented as a free redistributable replacement for ViGEmBus or the macOS entitlement requirement. This project does not bundle or integrate that commercial backend.

## Distribution

Keep each dependency's license/notices with any redistributed binary or database. The source archive does not bundle downloaded OS drivers, controller databases, or native Node dependencies. macOS release signing/notarization and Windows driver maintenance are separate release tasks. This document records the technical integration choices; it does not grant a license to the application itself.

Sources checked October 15, 2026: [node-ViGEmClient API](https://github.com/jangxx/node-ViGEmClient), [ViGEmBus status and license](https://github.com/nefarius/ViGEmBus), [Linux uinput API](https://www.kernel.org/doc/html/latest/input/uinput.html), [Apple IOHIDUserDevice API](https://github.com/apple-oss-distributions/IOKitUser/blob/main/hid.subproj/IOHIDUserDevice.h), [Apple HID entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.hid.virtual.device), and the SDL/Sunshine pages linked above.
