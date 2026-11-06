# Use guest devices only on the host

**Block local controller input** is on by default after accepting HidHide setup. Declining starts regular browser sharing instead; installing later enables blocking. Explicit changes to the blocking toggle are remembered. With blocking on, opening the local Join page reserves ready connected controllers automatically, even before a call. After connecting, press a button on each controller to join a player. Background play stays on. Turn blocking off to allow controllers to work in local apps too. The Controllers list shows each connected device and its player status. Use Controller & keyboard mapping to remap a device. Blocking and setup details are under Advanced.

Windows x64, Linux and macOS guests have native local input blocking. Windows uses SDL3, HidHide for selected controllers, and Interception for selected keyboards/mice. Linux uses per-device evdev grabs; macOS uses per-device IOHID exclusive opens. Input uses the existing WebRTC connections; video is optional. Browser inputs are excluded while native mode is selected. Unselected physical devices remain local. Native Linux/macOS device behavior is experimental until validated on physical hardware.

## Windows setup

**Interception is optional.** Focused browser keyboard/mouse sharing prevents supported page actions without installing a keyboard/mouse driver. It requires this app to stay focused; Windows shortcuts and other local apps are not isolated. HidHide controller blocking is independent.

**Known Interception reconnect bug:** unplugging and reconnecting keyboards or mice can leave them unresponsive until Windows restarts. This can happen even with the app closed; releasing capture does not unload the installed driver. See the [upstream reconnect issue](https://github.com/oblitum/Interception/issues/25) and [maintainer confirmation](https://github.com/oblitum/Interception/issues/93). Use browser input for casual sharing. If affected, remove only Interception with **option 5** in `windows/shortcuts/99-Uninstall.cmd`, then restart Windows. HidHide and host controller drivers stay installed. Reinstall Interception later only if you need device-level keyboard/mouse blocking and accept this limitation.

1. Windows Start/Host/Join setup asks two separate questions: **Install HidHide for controller blocking? [y/N]** and **Install Interception for keyboard/mouse blocking? [y/N]**. Each answer is remembered independently; either, both or neither driver can be installed. Setup explains administrator approval and the required Windows restart. Declining HidHide uses regular controller sharing; declining Interception keeps keyboard/mouse sharing in browser mode. To change either answer later, close the app and run `windows/shortcuts/09-Guest-Exclusive-Setup.cmd`. Approved setup is cached for this Windows boot; later launches skip repeated checks/downloads while files remain current. The first launch after a Windows restart checks approved drivers again. A restart reminder follows installation and persists until Windows restarts; setup never restarts it automatically.
2. Reconnect controllers that were already connected when HidHide was installed; restart Windows if requested, especially after installing Interception. The app checks the actual controller driver stack and will not offer blocking before HidHide attaches. Keep Windows security features enabled if a driver cannot load. Browser sharing remains available.
3. Run `windows/shortcuts/02-Join.cmd`, connect using a Play invitation, and check **Controller status & advanced input**. The host should use the default press-to-join room.

With Node installed, `npm run setup:guest` offers the same optional setup and remembers both answers independently. Add `-- --install-drivers` to ask again, force a fresh check and re-enable selected removed drivers if accepted. Use `-- --controllers-only` to skip Interception, or `-- --reader-only` to prepare the reader without drivers. `-- --all-devices` remains supported. For unattended installation, explicitly pass `-- --yes`; without saved consent, noninteractive setup skips optional drivers. Installing drivers does not select or block keyboards/mice; sharing those devices still requires selection and confirmation. The source ZIP contains no downloaded drivers/libraries. SDL's license and Interception's non-commercial/commercial license documents remain in the local upstream folders; review upstream terms for your use/distribution.

Windows setup disables HidHide's bundled automatic updater after installation, and checks existing installations too. It verifies the updater's signature, uses its own deregistration command, and checks that its automatic startup is removed or disabled. HidHide's driver and watchdog stay installed. Updates can still be installed manually from [HidHide releases](https://github.com/nefarius/HidHide/releases). See the upstream [updater integration commands](https://docs.nefarius.at/projects/Vicius/Integrations/).

To remove input-blocking drivers, close the app and run `windows/shortcuts/99-Uninstall.cmd`: **3** removes both HidHide and Interception, **4** removes only HidHide, and **5** removes only Interception. Each selection explains the affected devices. Restart Windows after removal. Removed drivers will not reinstall automatically; run **09-Guest-Exclusive-Setup** and accept setup to reinstall later. Basic app cleanup keeps all drivers, including ViGEmBus. See [uninstall options](uninstall.md).

## Linux setup

Install 64-bit Python 3.9 or newer using your distribution’s package manager. Close the app and run `sh linux/shortcuts/09-Guest-Exclusive-Setup.sh`. It prepares missing app dependencies, checks Python/OS input APIs with a read-only inventory, and records the reader version. No input driver or global permission change is installed. Run `sh linux/shortcuts/02-Join.sh`, connect, then check **Controller status & advanced input**.

The inventory lists the `/dev/input/eventN` node for each device. Your user must have read permission on each selected node. If your desktop seat does not already grant it, temporarily grant read access only to the identified node, replacing the login and event path below:

```sh
sudo setfacl -m u:YOUR_LOGIN:r /dev/input/eventN
# To revoke that specific grant:
sudo setfacl -x u:YOUR_LOGIN /dev/input/eventN
```

Install the `acl` package if setfacl is missing. Do not grant every input node access, join a broad input-reader group just for this app, or run Node/browser as root. Event paths may change after unplug/reboot; refresh and select again. Identification reads accessible keyboards/mice without grabbing them. Exclusive sharing opens/grabs only selected nodes and rolls back the group if a device is busy, reconnected, has held keys/buttons, or loses access. `EVIOCGRAB` is independent of X11/Wayland; native capture and host mouse injection still have their separate X11 limitations.

Linux gamepads using the standard evdev gamepad codes are translated to the shared controller layout. Other button/axis layouts use **Controller & keyboard mapping** and saved browser mappings. Input event overruns and selected-device removal release the group.

## macOS setup

Install 64-bit Python 3.9 or newer from python.org or your existing package manager. Close the app and run `mac/shortcuts/09-Guest-Exclusive-Setup.command` (or `sh mac/shortcuts/09-Guest-Exclusive-Setup.command`). It checks Python and performs read-only HID enumeration; no driver is installed. Run `mac/shortcuts/02-Join.command`, connect, then check **Controller status & advanced input**.

When required, allow your terminal/Python launcher under **System Settings → Privacy & Security → Input Monitoring**, then reopen it. This guest permission differs from Accessibility permission for injecting desktop input on a Mac host. The native reader enumerates devices without opening the whole device list, then attempts `kIOHIDOptionsTypeSeizeDevice` only for the explicitly selected devices. Protected/built-in devices or conflicting readers may refuse access. The app releases the selected group and reports the refusal; it never silently falls back to copying local input. A combined keyboard/mouse HID interface is unavailable when its parts cannot be isolated independently.

Mac controllers use raw HID button/axis data. After joining, use **Controller & keyboard mapping** to map each controller model; the layout is remembered in that browser. Selecting several different controller types is supported, but proprietary HID features and devices that macOS does not expose through IOHID are not passed through.

## Select and share

1. Connect controllers and check their status. Use Refresh devices after connecting or reconnecting a device. Open **Advanced: block a keyboard or mouse** for other devices. **Identify keyboard / mouse** highlights the device you touch for ten seconds while passing its input through locally. Unsupported devices stay unavailable; hardware matches are not guessed.
2. Choose whether selected keyboards operate a controller or type on the host desktop. The host must separately allow keyboard-controller input, desktop typing and/or mouse access. Existing shared-window/full-screen permissions still apply.
3. With the default blocking option on, ready connected gamepads are reserved automatically. Keyboard/mouse groups still use **Use selected devices on host** and confirmation. Release buttons/keys before starting. Press a button on each selected gamepad to join its next player slot. Selected keyboards share one keyboard-controller lane, or type on the host. Native mouse motion uses the approved host surface dimensions, with or without video.

Other local devices do not join or forward browser events in this mode. Keep the app console/browser running; another window can be in front. Switching from browser input clears that guest's old controller claims so native devices can join deliberately.

## Release and recovery

- Turn off **Share controllers** or **Block local controller input**, pause controller sharing, switch to Host, or close the Join page to release controllers. **Pause all input** also releases blocking. Sharing stays off until explicitly re-enabled; button presses and automatic scans do not restart it. Ending the call keeps controller reservations active only while Share controllers remains enabled on the open Join page. Hosting releases all local reservations and prevents other local tabs from acquiring them. **Release devices**, pause, or disconnect releases an advanced keyboard/mouse group.
- **Ctrl + Alt + Esc** releases a selected keyboard. Windows also supports the shortcut from an unselected keyboard. For controller/mouse-only use on any OS, keep an unselected keyboard/mouse available for Release devices or console close.
- Loss of remote control-channel replies releases advanced keyboard/mouse groups. Controller-only reservations use a separate local page heartbeat and do not require a call. A separate native guardian terminates a stalled reader, including keyboard/mouse-only sessions. Stdin closure/process exit also release filters.
- Controller removal, required host-permission revocation, or keyboard/mouse reconnection releases the exclusive group. Refresh/select devices to restart. Other assigned spots remain neutral until resumed or removed. The app does not silently switch to browser input; turn off Block local controller input explicitly.

Linux/macOS exclusive access belongs to the OS device handles and ends when they close or the process exits. The native reader has a 1.5-second heartbeat lease. Its guardian occupies the same private process group and terminates a stalled reader; it cannot target an unrelated reused process ID. Lost host round trips release keyboard/mouse groups. Node/browser closure and explicit release close all reserved handles. No persistent hide rules are created on those platforms.

On Windows, HidHide 1.5.230 uses persistent rules. A separate guardian adds only selected HID collection paths and this app's executable, preserves existing rules, and restores its changes on exit. It refuses to activate unrelated inactive hide rules or inverted filtering. A rollback journal is written first; the next reader launch recovers it if the guardian was also forcibly terminated or the machine lost power. Existing applications may retain controller handles opened before hiding; close/reopen those controller readers, including Steam, before relying on isolation.

For a leftover controller hide rule, close HidHide Configuration Client and run `.local/tools/guest-input/webrtc-pad-guest.exe --recover` from the project folder. Recovery preserves unrelated rules. Simultaneous loss of reader and guardian can require recovery/relaunch; this is not kernel-enforced process-lifetime isolation. Do not delete the journal before recovery.

## Current validation and limits

The helper compiles and its real read-only scan/clean exit have been checked. The compiled guardian passes healthy/stalled-process tests without blocking devices. Separate browser tests verify native-protocol controller/key/mouse delivery over real WebRTC in the background, idle-pad behavior, browser input exclusion, lost-connection release and responsive layouts using recording drivers.

**Physical keyboard/mouse and Xbox/XInput suppression, Steam/Guide-button behavior, Bluetooth reconnects and driver compatibility after reboot still need hardware testing.** Physical PS4 blocking is described below. Physical Interception suppression has not been validated; the upstream keyboard/mouse reconnect limitation described above applies even without an active capture session. Availability is checked at runtime. Interception exposes up to ten keyboard and ten mouse handles. Host desktop input supports its documented physical keys, left/middle/right buttons and wheel. Custom gamepads use existing raw button/axis mapping; proprietary features are not automatically passed through. ViGEm host virtual outputs are excluded from guest selection.

Linux/macOS have portable adapter tests for device selection, partial-open rollback, raw and standard mapping, per-device key/button state, fast taps, stale device IDs, access refusal, emergency release and reconnect handling. The real Linux helper loads/scans in WSL Ubuntu, and the real POSIX guardian passes a healthy/stalled-process test there. WSL exposes no physical input devices in this test environment. Native browser-protocol fixtures pass with Windows, Linux and macOS configurations; they use recording output drivers and never seize physical input. CI runs portable tests, the watchdog on POSIX, read-only native setup and browser workflows on each OS. **Physical Linux/macOS isolation, macOS native API/permission behavior, Steam shortcuts and hardware hotplug still require acceptance tests on those systems.** Browser sharing needs no optional guest helper or isolation permission.

Sources: [HidHide API](https://docs.nefarius.at/projects/HidHide/API-Documentation/), [HidHide keyboard/mouse limitation](https://docs.nefarius.at/projects/HidHide/FAQ/), [Interception API and license](https://github.com/oblitum/Interception), [SDL3 gamepad API](https://wiki.libsdl.org/SDL3/CategoryGamepad).

POSIX sources: [Linux input ABI](https://github.com/torvalds/linux/blob/master/include/uapi/linux/input.h), [Linux event codes](https://www.kernel.org/doc/html/latest/input/event-codes.html), [Apple IOHIDDeviceOpen](https://developer.apple.com/documentation/iokit/1588670-iohiddeviceopen), [Apple exclusive-device option](https://developer.apple.com/documentation/iokit/1556660-anonymous/kiohidoptionstypeseizedevice).


## Controller types on Windows

HID controllers, including supported PlayStation, Switch Pro and generic gamepads, use their exact collection identity. XInput controllers also need their associated XUSB access node hidden. The reader follows the device ancestry to a registered XUSB interface and includes both identities in the same reversible rule group; it never hides an arbitrary USB parent of a generic device. A missing identity or unattached filter makes blocking unavailable instead of claiming success. Some transports may not expose an isolatable identity through SDL.

Physical Bluetooth PS4 blocking has been checked using a fresh separate reader before, during and after reservation, including reservation through the Join page without any call. Xbox/XInput, other controller models and Linux/macOS still need equivalent physical hardware validation. Existing applications may retain already-open device handles; close and reopen them after blocking starts. HidHide does not cover every Raw Input access path. See the [HidHide limitations](https://docs.nefarius.at/projects/HidHide/FAQ/) and [XInput access-path instructions](https://docs.nefarius.at/projects/HidHide/CLI-Usage/#hiding-xbox-xinput-controllers).
