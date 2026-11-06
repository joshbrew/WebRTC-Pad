export const interceptionReconnectWarning='Interception has a known unplug/replug bug: keyboards or mice may stop responding until Windows restarts, even with this app closed.';
export function guestPlatform(platform){
  const release='Turn off Block local controller input, switch to Host, or close Join to release controllers. For a keyboard/mouse group, use Release devices or Ctrl + Alt + Esc on a selected keyboard. Loss of the host connection releases keyboard/mouse groups; controller-only blocking stays active while Join is open.';
  const platforms={
    win32:{name:'Windows',setup:'windows/shortcuts/09-Guest-Exclusive-Setup.cmd',intro:'Connected controllers are reserved automatically when blocking is on. Keyboard/mouse selection is advanced. For controllers, close and reopen local controller apps such as Steam after enabling isolation so they do not retain earlier device handles.',help:'Windows setup offers optional controller, keyboard and mouse blocking drivers. To install later or repair setup, close the app and run windows/shortcuts/09-Guest-Exclusive-Setup.cmd. Restart Windows after driver installation. Select a keyboard or mouse and confirm sharing to block it locally. Leave Windows security features enabled if a driver is unavailable.'},
    linux:{name:'Linux',setup:'sh linux/shortcuts/09-Guest-Exclusive-Setup.sh',intro:'Connected controllers are reserved automatically when blocking is on. Keyboard/mouse selection is advanced. Native evdev access works independently of browser focus and the desktop compositor. Your user needs read access to the selected /dev/input devices.',help:'Close the app and run sh linux/shortcuts/09-Guest-Exclusive-Setup.sh with Python 3 installed. No additional input driver is required. The device list shows permission errors; see the Linux permission guide. Do not run the app as root. Use Map beside a controller to configure its buttons.'},
    darwin:{name:'macOS',setup:'mac/shortcuts/09-Guest-Exclusive-Setup.command',intro:'Ready HID controllers are reserved automatically when blocking is on. Keyboard/mouse selection is advanced. macOS may refuse exclusive access to built-in or protected devices. Use Map beside a controller to configure its buttons.',help:'Close the app and run mac/shortcuts/09-Guest-Exclusive-Setup.command with Python 3 installed. Allow Input Monitoring for the terminal/Python launcher in System Settings → Privacy & Security, then reopen the app. No input driver is installed. Devices that macOS refuses to isolate are not shared.'}
  };
  const info=platforms[platform] || {name:'This platform',setup:null,intro:'Use browser input, or check whether native device support is available.',help:'Native guest input supports Windows x64, Linux and macOS.'};
  return {...info,help:info.help+(platform==='win32'?' '+interceptionReconnectWarning+' Browser keyboard/mouse sharing works while this app is focused, without Interception.':''),release};
}

// Native reader versions may send older setup paths. Present their messages
// as feature-specific guidance using the current launcher layout.
export function guestSetupNotes(notes,platform){
  if(!Array.isArray(notes))return [];
  const setup=guestPlatform(platform).setup;
  return notes.filter(note=>typeof note==='string' && note.trim()).map(note=>{
    if(platform==='win32' && /HidHide is not available|controller isolation is unavailable/i.test(note))return `To block controllers from controlling local apps, set up HidHide with ${setup}. Restart Windows if the installer asks. Browser controller sharing works without this driver.`;
    if(platform==='win32' && /Keyboard\/mouse isolation (?:needs|libraries are missing)|keyboard and mouse isolation is unavailable/i.test(note))return `Keyboard/mouse blocking uses optional Interception drivers. Close the app and run ${setup} to install them, then restart Windows. Native blocking is optional for browser input sharing.`;
    return note.replace(/Windows\/(?:shortcuts\/)?09-Guest-Exclusive-Setup\.cmd/gi,'windows/shortcuts/09-Guest-Exclusive-Setup.cmd');
  });
}
