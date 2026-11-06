# Uninstall on Windows

Close the app console first, then double-click `windows/shortcuts/99-Uninstall.cmd`. No Node installation is needed to run it.

- **1. Basic cleanup** removes this copy's app dependencies, downloaded helpers and install record. It keeps saved settings, relay configuration, source files and all controller drivers.
- **2. Full cleanup** also erases `.env` and local data, including private configuration backups, relay credentials, logs and benchmarks. Stop any separately hosted relay first.
- **3. Both input-blocking drivers** removes **HidHide** (local controller blocking and its updater registration) and **Interception** (local keyboard/mouse blocking filters). The app and its settings stay in place.
- **4. HidHide only** removes controller blocking and its updater registration. Interception and the app stay installed.
- **5. Interception only** removes keyboard/mouse blocking. HidHide and the app stay installed.

Basic/full cleanup also asks whether to remove **both** optional blocking drivers; the default is **No**. Before confirmation, every selection lists each driver as **REMOVE** or **KEEP** with its purpose. These drivers are shared software: removing one also removes that blocking feature for other apps using it. **ViGEmBus**, which supplies the host's virtual controllers, stays installed in every mode, as do standard Windows input drivers, Node.js, Python and build tools.

Interception removal uses the checksum-verified official uninstaller with `/uninstall` and checks that its keyboard/mouse class filters are removed. If earlier app cleanup deleted the uninstaller, the script retrieves its pinned official archive and verifies it before running anything. It never deletes Windows driver files or edits input class filters by hand. If removal fails or filters remain registered, app files are kept so you can retry after restarting. The installer may require an Internet connection if its local copy is missing.

**Restart Windows after driver removal.** Filters may remain loaded until then. The script never restarts automatically and saves a reminder for later app launches until Windows restarts.

Before cleanup, the script checks for running app processes. Close them and retry if prompted. It restores any saved controller blocking rules owned by this app before removing its helper or HidHide; if recovery fails, it preserves the recovery data and stops. It refuses linked cleanup folders instead of following them outside the app folder.

Removing either driver saves its own local opt-out so normal Start/Host/Join launches do not reinstall it. Removing Interception does not disable or remove HidHide, and vice versa. To enable a removed driver again, run `windows/shortcuts/09-Guest-Exclusive-Setup.cmd`, or `npm run setup:guest -- --install-drivers`, and accept the optional setup. Opt-outs survive full cleanup. Manually deleting the entire app folder also deletes those preferences.

Optional commands from the app folder:

```powershell
# Preview the basic cleanup; change nothing.
powershell.exe -NoProfile -File system/scripts/uninstall.ps1 -PlanOnly

# Uninstall only HidHide, with confirmation.
powershell.exe -NoProfile -File system/scripts/uninstall.ps1 -Cleanup None -RemoveHidHide

# Uninstall both optional input-blocking drivers, with confirmation.
powershell.exe -NoProfile -File system/scripts/uninstall.ps1 -Cleanup None -RemoveHidHide -RemoveInterception

# Uninstall only Interception, with confirmation.
powershell.exe -NoProfile -File system/scripts/uninstall.ps1 -Cleanup None -RemoveInterception

# Remove app dependencies, preserving settings and all drivers.
powershell.exe -NoProfile -File system/scripts/uninstall.ps1 -Cleanup App
```

`-Yes` skips the script's confirmation; Windows may still request administrator access for driver removal. Running the script again safely skips files or drivers that are already removed. The script leaves source files in place; delete the app folder afterward if no longer wanted. Browser site data, firewall/router settings and separately installed relay containers are not removed.

This uninstaller is for Windows. On Linux/macOS, close the app before deleting its folder; remove any separately configured system permissions/services using the platform setup guide.
