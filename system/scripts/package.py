"""Shareable source package; exclude local configuration and installed dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[2]
output = root / 'releases' / 'WebRTC-Pad.zip'
output.parent.mkdir(exist_ok=True)
launchers = ('Start-Windows.cmd','Start-Linux.sh','Start-Mac.command')
files = [root / name for name in ('package.json','package-lock.json','README.md','.env.example','.gitignore','.gitattributes',*launchers)]
extensions = {'.js','.cjs','.mjs','.json','.html','.css','.svg','.woff2','.py','.c','.cs','.swift','.plist','.md','.yml','.ps1','.go','.mod','.sum','.sh','.cmd','.command','.example'}
for folder in ('system','windows','linux','mac','.github'):
    for file in (root/folder).rglob('*'):
        if file.is_file() and '__pycache__' not in file.parts and (file.suffix in extensions or file.name == 'Caddyfile'):
            files.append(file)
with ZipFile(output,'w',ZIP_DEFLATED) as archive:
    for file in sorted(set(files)):
        name=file.relative_to(root).as_posix(); archive.write(file,name)
        if file.suffix in ('.sh','.command'):
            entry=archive.getinfo(name); entry.create_system=3; entry.external_attr=0o100755 << 16
with ZipFile(output) as archive:
    names=archive.namelist()
    assert all(n in names for n in ('system/public/last-session.js','system/test/last-session.test.js','system/scripts/smoke-last-session.mjs'))
    assert all(n in names for n in ('system/public/source-picker.js','system/public/video-handover.js','system/public/video-health.js','system/src/source-thumbnail.js','system/native/windows-thumbnail.cs','system/test/source-thumbnail.test.js','system/test/video-health.test.js','system/scripts/smoke-native-handover.mjs'))
    assert all(n in names for n in launchers)
    for platform,extension in (('windows','.cmd'),('linux','.sh'),('mac','.command')):
        nested_launchers=[n for n in names if n.startswith(platform+'/') and n.count('/')==1 and n.endswith(extension)]
        assert not nested_launchers, 'Launchers belong at the root or inside platform shortcuts/'
    assert all(n in names for n in ('system/public/call-settings.js','system/public/call-comfort.js','system/test/call-comfort.test.js','system/scripts/smoke-comfort.mjs','system/public/chat.js','system/test/chat.test.js','system/scripts/smoke-chat.mjs','system/public/camera.js','system/public/camera-quality.js','system/public/handoff.js','system/public/keyboard-mapping.js','system/public/controller-presence.js','system/public/host-shares.js','system/public/guest-tiles.js','system/public/capture-region.js','system/public/view-popouts.js','system/public/view-window.html','system/public/view-window.js','system/src/capture-region.js','system/public/call-shell.js','system/public/call-shell.css','system/public/design-app.css','system/public/mobile-navigation.js','system/public/design/styles.css','system/public/design/fonts/Inter-Variable-latin.woff2','system/public/design/fonts/Inter-Variable-latin-ext.woff2','system/public/design/fonts/OFL.md'))
    assert all(n in names for n in ('system/public/app-inputs.js','system/public/app-input-wire.js','system/public/app-inputs.html','system/src/app-input-bridge.js','system/test/app-input.test.js','system/test/app-input-bridge.test.js','system/scripts/smoke-app-inputs.mjs'))
    assert all(n in names for n in ('system/public/input-api.js','system/public/reverse-controllers.js','system/src/controller-receiver.js','system/test/controller-receiver.test.js','system/test/local-input-api.test.js','system/scripts/smoke-reverse-controllers.mjs'))
    assert all(n in names for n in ('system/public/controller-platform.js','system/scripts/build-macos-hid.mjs','system/test/controller-platform.test.js','system/test/gamepad-helper.test.js','system/test/linux_gamepad_test.py'))
    assert all((archive.getinfo(n).external_attr >> 16) & 0o111 for n in names if n.endswith(('.sh','.command')))
    assert '.env' not in names and not any(n.startswith(('.local/','node_modules/')) for n in names)
    assert all(n in names for n in ('system/public/media-controls.js','system/public/tile-adjustments.js','system/test/tile-adjustments.test.js','system/public/screen-room.js','system/public/screen-quality.js','system/public/screen-layout.js','system/test/screen.test.js','system/scripts/smoke-guest-screens.mjs','system/scripts/layout-gallery.mjs'))
    assert all(n in names for n in ('system/src/server.js','system/public/index.html','system/native/cursor-overlay.py','system/config/coturn.compose.yml','system/scripts/run.mjs','windows/shortcuts/01-Host.cmd','linux/shortcuts/02-Join.sh','mac/shortcuts/02-Join.command'))
    assert all(n in names for n in ('windows/shortcuts/99-Uninstall.cmd','system/scripts/uninstall.ps1','system/scripts/interception-uninstall.ps1','system/scripts/hidhide-updater.ps1','system/scripts/guest-setup-cache.mjs','system/scripts/input-driver-prompt.mjs','system/src/input-driver-choice.js','system/docs/uninstall.md'))
    assert all(n in names for n in ('system/native/macos/Desktop.swift','system/native/macos/Info.plist','system/scripts/build-macos.mjs','system/public/mac-desktop.html'))
    secrets=[]
    if (root/'.env').exists():
        for line in (root/'.env').read_text(encoding='utf-8').splitlines():
            key,sep,value=line.partition('=')
            if sep and any(w in key for w in ('API_KEY','CREDENTIAL','USERNAME','TURN_CRED','AUTH_SECRET')) and value:
                secrets.append(value.encode())
    assert not any(secret in archive.read(name) for name in names for secret in secrets), 'Local relay credentials must not be distributed'
print(f'Created {output.name}: {len(set(files))} source/setup files; local credentials and dependencies excluded.')
