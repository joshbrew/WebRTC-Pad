// macOS 13+. Original helper: ScreenCaptureKit, VideoToolbox, AppKit and AX.
// No private APIs, virtual audio driver, or permission changes during setup.
import AppKit
import ApplicationServices
import AVFoundation
import ScreenCaptureKit
import VideoToolbox
import Network

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
func env(_ name: String) -> String { ProcessInfo.processInfo.environment[name] ?? "" }
func argument(_ name: String, _ fallback: Int = 0) -> Int {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return fallback }
    return Int(args[i + 1]) ?? fallback
}
struct Failure: Error, CustomStringConvertible { let description: String; init(_ message: String) { description = message } }
func windows() -> [[String: Any]] {
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
}
func bounds(_ info: [String: Any]) -> CGRect? {
    guard let value = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: value as CFDictionary)
}
func processStart(_ pid: pid_t) -> String {
    guard let date = NSRunningApplication(processIdentifier: pid)?.launchDate else { return "" }
    return String(format: "%.6f", date.timeIntervalSince1970)
}
func dimensions(_ rect: CGRect) -> [String: Int] {
    // Video and mouse use the same points-to-pixels conversion on Retina displays.
    var ids=[CGDirectDisplayID](repeating:0,count:32), count: UInt32=0
    CGGetActiveDisplayList(UInt32(ids.count),&ids,&count)
    let id=ids.prefix(Int(count)).first { CGDisplayBounds($0).intersects(rect) } ?? CGMainDisplayID()
    let mode=CGDisplayCopyDisplayMode(id), width=CGDisplayBounds(id).width
    let scale=width > 0 ? CGFloat(mode?.pixelWidth ?? Int(width))/width : 1
    return ["width": max(1, Int(rect.width * scale)), "height": max(1, Int(rect.height * scale))]
}
struct Target {
    var id: CGWindowID = 0
    var pid: pid_t = 0
    var start = ""
    init(_ value: [String: Any] = [:]) throws {
        let kind = value["kind"] as? String ?? (env("NATIVE_WINDOW_HANDLE").isEmpty ? "desktop" : "window")
        if kind == "window" {
            guard let number = UInt32(value["id"] as? String ?? env("NATIVE_WINDOW_HANDLE")), number > 0 else { throw Failure("Choose a window again.") }
            id = number
            pid = pid_t((value["pid"] as? NSNumber)?.intValue ?? Int(env("NATIVE_WINDOW_PID")) ?? 0)
            start = value["processStart"] as? String ?? env("NATIVE_WINDOW_START")
            guard pid > 0, !start.isEmpty, info() != nil else { throw Failure("Selected window closed or changed. Choose it again.") }
        } else if kind != "desktop" && kind != "none" { throw Failure("Unsupported mouse scope.") }
    }
    func info() -> [String: Any]? {
        guard id != 0, processStart(pid) == start else { return nil }
        return windows().first { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == id && ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid }
    }
    func rect() -> CGRect? { id == 0 ? CGDisplayBounds(CGMainDisplayID()) : info().flatMap(bounds) }
}
func sources() {
    let desktop: [String: Any] = ["kind": "desktop", "id": "desktop", "label": "Main screen", "width": CGDisplayPixelsWide(CGMainDisplayID()), "height": CGDisplayPixelsHigh(CGMainDisplayID())]
    var result = [desktop]
    if CGPreflightScreenCaptureAccess() {
        for info in windows() {
            guard (info[kCGWindowLayer as String] as? Int) == 0,
                  let id = info[kCGWindowNumber as String] as? NSNumber,
                  let pid = info[kCGWindowOwnerPID as String] as? NSNumber,
                  pid.int32Value != getpid(), let rect = bounds(info), rect.width > 40, rect.height > 40 else { continue }
            let start = processStart(pid.int32Value)
            guard !start.isEmpty else { continue }
            var value: [String: Any] = ["kind": "window", "id": id.stringValue, "pid": pid, "processStart": start,
                "label": "\(info[kCGWindowOwnerName as String] as? String ?? "App") · \(info[kCGWindowName as String] as? String ?? "Window")"]
            dimensions(rect).forEach { value[$0.key] = $0.value }; result.append(value)
        }
    }
    if let data = try? JSONSerialization.data(withJSONObject: result) { FileHandle.standardOutput.write(data + Data([10])) }
}
#if compiler(>=5.9)
@available(macOS 14.0, *)
func thumbnail() async throws {
    guard CGPreflightScreenCaptureAccess() else { throw Failure("Screen Recording permission is needed for thumbnails.") }
    let target = try Target(), content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
    let filter: SCContentFilter, rect: CGRect
    if target.id != 0 {
        guard let window = content.windows.first(where: { $0.windowID == target.id && $0.owningApplication?.processID == target.pid }), let size=target.rect() else { throw Failure("Window closed.") }
        filter=SCContentFilter(desktopIndependentWindow:window);rect=size
    } else {
        guard let display=content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw Failure("Display unavailable.") }
        filter=SCContentFilter(display:display,excludingWindows:[]);rect=CGDisplayBounds(display.displayID)
    }
    let config=SCStreamConfiguration(), scale=min(320/rect.width,180/rect.height)
    config.width=max(2,Int(rect.width*scale));config.height=max(2,Int(rect.height*scale));config.showsCursor=false
    let image=try await SCScreenshotManager.captureImage(contentFilter:filter,configuration:config)
    guard let data=NSBitmapImageRep(cgImage:image).representation(using:.png,properties:[:]) else { throw Failure("Thumbnail unavailable.") }
    FileHandle.standardOutput.write(data)
}
#endif
func permissionStatus() {
    emit(["screen": CGPreflightScreenCaptureAccess(), "input": AXIsProcessTrusted(), "minimumOS": "13"])
}
func axValue(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    AXUIElementSetMessagingTimeout(element, 0.1)
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &result) == .success ? result : nil
}
func axRect(_ element: AXUIElement) -> CGRect? {
    guard let position = axValue(element, kAXPositionAttribute as CFString), CFGetTypeID(position) == AXValueGetTypeID(),
          let size = axValue(element, kAXSizeAttribute as CFString), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &p), AXValueGetValue(size as! AXValue, .cgSize, &s) else { return nil }
    return CGRect(origin: p, size: s)
}
func sameRect(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX-b.minX) < 2 && abs(a.minY-b.minY) < 2 && abs(a.width-b.width) < 2 && abs(a.height-b.height) < 2
}
// Public AX has no CGWindowID property. Require a unique bounds/title match,
// then compare the actual AX window; ambiguous or inaccessible windows fail closed.
func axWindow(_ target: Target) -> AXUIElement? {
    guard let info = target.info(), let rect = bounds(info),
          let list = axValue(AXUIElementCreateApplication(target.pid), kAXWindowsAttribute as CFString) as? [AXUIElement] else { return nil }
    let title = info[kCGWindowName as String] as? String ?? ""
    let matches = list.filter { element in
        guard let candidate = axRect(element), sameRect(candidate, rect) else { return false }
        return title.isEmpty || (axValue(element, kAXTitleAttribute as CFString) as? String) == title
    }
    return matches.count == 1 ? matches[0] : nil
}
func canPoint(_ target: Target, _ point: CGPoint) -> Bool {
    guard target.id != 0 else { return target.rect()?.contains(point) == true }
    guard let rect = target.rect(), rect.contains(point), let selected = axWindow(target) else { return false }
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success, let element = hit else { return false }
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success, pid == target.pid else { return false }
    let window = axValue(element, kAXWindowAttribute as CFString)
    return CFEqual(window ?? element, selected)
}
func canType(_ target: Target) -> Bool {
    if target.id == 0 { return true }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.pid, let selected = axWindow(target),
          let focused = axValue(AXUIElementCreateApplication(target.pid), kAXFocusedWindowAttribute as CFString) else { return false }
    return CFEqual(selected, focused)
}
let keyCodes: [String: CGKeyCode] = [
    "KeyA":0,"KeyS":1,"KeyD":2,"KeyF":3,"KeyH":4,"KeyG":5,"KeyZ":6,"KeyX":7,"KeyC":8,"KeyV":9,"KeyB":11,
    "KeyQ":12,"KeyW":13,"KeyE":14,"KeyR":15,"KeyY":16,"KeyT":17,"Digit1":18,"Digit2":19,"Digit3":20,"Digit4":21,
    "Digit6":22,"Digit5":23,"Equal":24,"Digit9":25,"Digit7":26,"Minus":27,"Digit8":28,"Digit0":29,"BracketRight":30,
    "KeyO":31,"KeyU":32,"BracketLeft":33,"KeyI":34,"KeyP":35,"Enter":36,"KeyL":37,"KeyJ":38,"Quote":39,"KeyK":40,
    "Semicolon":41,"Backslash":42,"Comma":43,"Slash":44,"KeyN":45,"KeyM":46,"Period":47,"Tab":48,"Space":49,
    "Backquote":50,"Backspace":51,"Escape":53,"MetaRight":54,"MetaLeft":55,"ShiftLeft":56,"CapsLock":57,
    "AltLeft":58,"ControlLeft":59,"ShiftRight":60,"AltRight":61,"ControlRight":62,"F1":122,"F2":120,"F3":99,
    "F4":118,"F5":96,"F6":97,"F7":98,"F8":100,"F9":101,"F10":109,"F11":103,"F12":111,
    "Home":115,"PageUp":116,"Delete":117,"End":119,"PageDown":121,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126]
final class Desktop {
    var target = try! Target(["kind":"desktop"]), enabled = false, keys = Set<String>(), buttons = Set<Int>()
    var point = CGPoint.zero, last = Date.distantPast, size: [String: Int] = [:]
    func post(_ event: CGEvent?, releasing: Bool = false) {
        guard let event = event else { return }
        if target.id == 0 { event.post(tap: .cghidEventTap) }
        // Releases remain deliverable if a window is minimized/closed while a
        // key is held, but never go to a reused PID or another application.
        else if processStart(target.pid) == target.start && (releasing || target.info() != nil) { event.postToPid(target.pid) }
    }
    func key(_ code: String, _ down: Bool) {
        guard let number = keyCodes[code] else { return }
        let event = CGEvent(keyboardEventSource: nil, virtualKey: number, keyDown: down)
        var flags: CGEventFlags = []
        if !keys.isDisjoint(with: ["ShiftLeft","ShiftRight"]) { flags.insert(.maskShift) }
        if !keys.isDisjoint(with: ["ControlLeft","ControlRight"]) { flags.insert(.maskControl) }
        if !keys.isDisjoint(with: ["AltLeft","AltRight"]) { flags.insert(.maskAlternate) }
        if !keys.isDisjoint(with: ["MetaLeft","MetaRight"]) { flags.insert(.maskCommand) }
        event?.flags = flags; post(event,releasing:!down)
    }
    func mouse(_ button: Int, _ down: Bool) {
        let b: CGMouseButton = button == 0 ? .left : button == 2 ? .right : .center
        let type: CGEventType = button == 0 ? (down ? .leftMouseDown : .leftMouseUp) : button == 2 ? (down ? .rightMouseDown : .rightMouseUp) : (down ? .otherMouseDown : .otherMouseUp)
        post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: b),releasing:!down)
    }
    func release() {
        let oldKeys = keys, oldButtons = buttons; keys.removeAll(); buttons.removeAll()
        for code in oldKeys { key(code, false) }; for button in oldButtons { mouse(button, false) }
    }
    func tick() {
        if !enabled { return }
        if !AXIsProcessTrusted() { release(); fail("Accessibility permission was removed. Desktop control stopped.") }
        guard let rect = target.rect() else { release(); enabled = false; emit(["event":"scope-lost"]); return }
        let next = dimensions(rect)
        if size != next { size = next; emit(["event":"display","display":size]) }
        if Date().timeIntervalSince(last) > 0.5 { release() }
        if !canType(target) { for code in keys { key(code, false) }; keys.removeAll() }
        if !canPoint(target, point) { for button in buttons { mouse(button, false) }; buttons.removeAll() }
    }
    func handle(_ value: [String: Any]) {
        if value["type"] as? String == "scope" {
            release(); enabled = false
            do {
                let scope = value["scope"] as? [String: Any] ?? [:]
                target = try Target(scope); enabled = scope["kind"] as? String != "none"
                if target.id != 0 && axWindow(target) == nil { throw Failure("This window cannot be identified safely through Accessibility. Choose another window.") }
                guard let rect = target.rect() else { throw Failure("Selected window is no longer visible.") }
                size = dimensions(rect); emit(["event":"scope","requestId":value["requestId"] ?? "","display":size])
            } catch { enabled = false; emit(["event":"scope","requestId":value["requestId"] ?? "","error":String(describing:error)]) }
            return
        }
        guard enabled, let rect = target.rect() else { release(); return }; last = Date()
        if let x = value["x"] as? Double, let y = value["y"] as? Double, x.isFinite, y.isFinite {
            point = CGPoint(x: rect.minX + min(1,max(0,x)) * max(0,rect.width-1), y: rect.minY + min(1,max(0,y)) * max(0,rect.height-1))
        }
        let pointer = canPoint(target, point), typing = canType(target)
        if value["type"] as? String == "state" {
            let nextKeys = typing ? Set((value["keys"] as? [String] ?? []).filter { keyCodes[$0] != nil }) : []
            let nextButtons = pointer ? Set((value["buttons"] as? [Int] ?? []).filter { (0...2).contains($0) }) : []
            let oldKeys = keys, oldButtons = buttons; keys = nextKeys; buttons = nextButtons
            for code in oldKeys.subtracting(keys) { key(code,false) }; for code in keys.subtracting(oldKeys) { key(code,true) }
            if pointer { move() }
            for button in oldButtons.subtracting(buttons) { mouse(button,false) }; for button in buttons.subtracting(oldButtons) { mouse(button,true) }
        } else if value["event"] as? String == "relative", target.id == 0, pointer {
            let dx = max(-500,min(500,value["dx"] as? Double ?? 0)), dy = max(-500,min(500,value["dy"] as? Double ?? 0))
            guard dx.isFinite, dy.isFinite else { return }
            point = CGPoint(x:min(rect.maxX-1,max(rect.minX,point.x+dx)),y:min(rect.maxY-1,max(rect.minY,point.y+dy)))
            let event = CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)
            event?.setIntegerValueField(.mouseEventDeltaX,value:Int64(dx)); event?.setIntegerValueField(.mouseEventDeltaY,value:Int64(dy)); post(event)
        } else if value["event"] as? String == "move", pointer { move() }
        else if value["event"] as? String == "wheel", pointer {
            let dx = max(-1000,min(1000,(value["dx"] as? Double ?? 0))), dy = max(-1000,min(1000,(value["dy"] as? Double ?? 0)))
            guard dx.isFinite, dy.isFinite else { return }
            let event = CGEvent(scrollWheelEvent2Source:nil, units:.pixel, wheelCount:2, wheel1:Int32(-dy), wheel2:Int32(-dx), wheel3:0)
            event?.location = point; post(event)
        } else if value["event"] as? String == "repeat", typing, let code = value["code"] as? String, keys.contains(code) { key(code,true) }
    }
    func move() {
        let type: CGEventType = buttons.contains(0) ? .leftMouseDragged : buttons.contains(2) ? .rightMouseDragged : buttons.contains(1) ? .otherMouseDragged : .mouseMoved
        post(CGEvent(mouseEventSource:nil, mouseType:type, mouseCursorPosition:point, mouseButton:buttons.contains(2) ? .right : buttons.contains(1) ? .center : .left))
    }
}

final class CursorView: NSView {
    var color = NSColor.systemGreen, text = "", pressed = false
    override func draw(_ dirtyRect: NSRect) {
        color.setFill(); NSColor.black.withAlphaComponent(0.8).setStroke()
        let path = NSBezierPath(); path.move(to:NSPoint(x:1,y:31)); path.line(to:NSPoint(x:1,y:7)); path.line(to:NSPoint(x:7,y:13)); path.line(to:NSPoint(x:13,y:1)); path.line(to:NSPoint(x:18,y:4)); path.line(to:NSPoint(x:12,y:16)); path.line(to:NSPoint(x:22,y:16)); path.close(); path.fill(); path.lineWidth=1.5; path.stroke()
        if pressed { NSBezierPath(ovalIn:NSRect(x:0,y:22,width:9,height:9)).fill() }
        if !text.isEmpty { (text as NSString).draw(at:NSPoint(x:26,y:9),withAttributes:[.foregroundColor:color,.font:NSFont.boldSystemFont(ofSize:13)]) }
    }
}
final class Overlay {
    struct Cursor { let panel: NSPanel; let view: CursorView; var value: [String:Any]; var time: Date }
    var cursors: [String:Cursor] = [:], labels = false
    let target: Target
    init() throws {
        target = try Target()
        if target.id != 0 && !AXIsProcessTrusted() { throw Failure("Allow Accessibility in Mac setup to show cursors restricted to a window.") }
    }
    func clear() { for cursor in cursors.values { cursor.panel.close() }; cursors.removeAll() }
    func handle(_ value: [String: Any]) {
        let type = value["type"] as? String ?? ""
        if type == "clear" { clear(); return }
        if type == "labels" { labels = value["enabled"] as? Bool ?? value["labels"] as? Bool ?? false; tick(); return }
        guard let id = value["id"] as? String else { return }
        if type == "remove" { cursors.removeValue(forKey:id)?.panel.close(); return }
        guard type == "cursor" else { return }
        if cursors[id] == nil {
            let panel = NSPanel(contentRect:NSRect(x:0,y:0,width:240,height:32),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
            panel.backgroundColor = .clear; panel.isOpaque = false; panel.hasShadow = false; panel.ignoresMouseEvents = true; panel.hidesOnDeactivate = false
            panel.level = .screenSaver; panel.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary,.ignoresCycle]
            let view = CursorView(frame:NSRect(x:0,y:0,width:240,height:32)); panel.contentView = view
            cursors[id] = Cursor(panel:panel,view:view,value:value,time:Date())
        } else { cursors[id]?.value=value; cursors[id]?.time=Date() }
        tick()
    }
    func tick() {
        guard let rect = target.rect() else { clear(); return }
        let desktopTop = CGDisplayBounds(CGMainDisplayID()).height
        for cursor in cursors.values {
            guard cursor.value["visible"] as? Bool != false, Date().timeIntervalSince(cursor.time) < 4,
                  let x = cursor.value["x"] as? Double, let y = cursor.value["y"] as? Double, x.isFinite, y.isFinite else { cursor.panel.orderOut(nil); continue }
            let point = CGPoint(x:rect.minX + min(1,max(0,x))*max(0,rect.width-1),y:rect.minY + min(1,max(0,y))*max(0,rect.height-1))
            if target.id != 0 && !canPoint(target,point) { cursor.panel.orderOut(nil); continue }
            let color = cursor.value["color"] as? String ?? "#b8f078"
            if color.hasPrefix("#"), let rgb = UInt32(String(color.dropFirst()),radix:16) {
                cursor.view.color=NSColor(calibratedRed:CGFloat((rgb>>16)&255)/255,green:CGFloat((rgb>>8)&255)/255,blue:CGFloat(rgb&255)/255,alpha:1)
            } else if color.hasPrefix("hsl("), let hue = Double(color.dropFirst(4).prefix { $0.isNumber || $0 == "." }) {
                cursor.view.color=NSColor(calibratedHue:CGFloat(hue.truncatingRemainder(dividingBy:360)/360),saturation:0.7,brightness:1,alpha:1)
            }
            cursor.view.text = (cursor.value["labels"] as? Bool ?? labels) ? String((cursor.value["label"] as? String ?? "").prefix(32)) : ""
            cursor.view.pressed = cursor.value["pressed"] as? Bool ?? false
            let original = CGRect(x:point.x,y:point.y,width:cursor.view.text.isEmpty ? 24 : 240,height:32), clipped = original.intersection(rect)
            guard !clipped.isNull else { cursor.panel.orderOut(nil); continue }
            cursor.panel.setFrame(NSRect(x:clipped.minX,y:desktopTop-clipped.maxY,width:clipped.width,height:clipped.height),display:false)
            cursor.view.frame=NSRect(x:0,y:clipped.height-32,width:240,height:32); cursor.view.needsDisplay=true; cursor.panel.orderFrontRegardless()
        }
    }
}

// RTP stays on loopback. Frames remain in ScreenCaptureKit/VideoToolbox; Node
// handles only control messages, not raw screen frames.
final class RTP {
    let connection: NWConnection
    var sequence = UInt16.random(in:0...65535), ssrc = UInt32.random(in:1...UInt32.max)
    init(port: UInt16) { connection=NWConnection(host:"127.0.0.1",port:NWEndpoint.Port(rawValue:port)!,using:.udp); connection.start(queue:DispatchQueue(label:"pad.rtp")) }
    func packet(_ bytes: [UInt8], _ timestamp: UInt32, _ marker: Bool) {
        var data = Data([0x80, UInt8(96 | (marker ? 0x80 : 0))])
        for value in [UInt32(sequence),timestamp,ssrc] {
            if data.count == 2 { data.append(contentsOf:[UInt8(truncatingIfNeeded:value>>8),UInt8(truncatingIfNeeded:value)]) }
            else { data.append(contentsOf:[24,16,8,0].map { UInt8(truncatingIfNeeded:value >> $0) }) }
        }
        data.append(contentsOf:bytes); sequence &+= 1; connection.send(content:data,completion:.contentProcessed { error in if let error = error { fail("RTP: \(error)") } })
    }
    static func fragments(_ nal: [UInt8]) -> [[UInt8]] {
        guard !nal.isEmpty else { return [] }
        if nal.count <= 1188 { return [nal] }
        var result: [[UInt8]] = [], offset = 1
        while offset < nal.count {
            let end = min(nal.count,offset+1186)
            result.append([(nal[0]&0xe0)|28,(nal[0]&31)|(offset == 1 ? 0x80 : 0)|(end == nal.count ? 0x40 : 0)] + Array(nal[offset..<end])); offset=end
        }
        return result
    }
    func nal(_ value: [UInt8], _ timestamp: UInt32, _ last: Bool) {
        let parts = Self.fragments(value)
        for (index,part) in parts.enumerated() { packet(part,timestamp,last && index == parts.count-1) }
    }
}
@available(macOS 13.0, *)
final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    var stream: SCStream?, encoder: VTCompressionSession?, rtp: RTP?, firstFrame=false, audio=false, running=false
    var audioPID: pid_t = 0, audioStart = "", target = try! Target(["kind":"desktop"]), converter: AVAudioConverter?, converterFormat: AVAudioFormat?
    let queue = DispatchQueue(label:"pad.capture",qos:.userInteractive)
    func start(audio: Bool) async throws {
        guard CGPreflightScreenCaptureAccess() else { throw Failure("Allow Screen Recording in the Mac setup guide, then reopen the app.") }
        self.audio=audio
        let content = try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
        guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { throw Failure("Main display is unavailable.") }
        let own = content.applications.filter { $0.processID == getpid() }
        let filter: SCContentFilter, config = SCStreamConfiguration()
        if audio {
            audioPID = pid_t(argument("--pid")); audioStart = env("NATIVE_AUDIO_START")
            if audioPID != 0 {
                guard !audioStart.isEmpty, processStart(audioPID) == audioStart, let app = content.applications.first(where: { $0.processID == audioPID }) else { throw Failure("Selected audio app closed or changed. Choose it again.") }
                filter=SCContentFilter(display:display,including:[app],exceptingWindows:[])
            } else { filter=SCContentFilter(display:display,excludingApplications:own,exceptingWindows:[]) }
            config.width=2; config.height=2; config.minimumFrameInterval=CMTime(value:1,timescale:1)
            config.capturesAudio=true; config.sampleRate=48000; config.channelCount=2; config.excludesCurrentProcessAudio=true
        } else {
            target = try Target()
            let rect: CGRect
            if target.id != 0 {
                guard let window = content.windows.first(where: { $0.windowID == target.id && $0.owningApplication?.processID == target.pid }), let live = target.rect() else { throw Failure("Selected window is unavailable.") }
                filter=SCContentFilter(desktopIndependentWindow:window); rect=live
            } else { filter=SCContentFilter(display:display,excludingApplications:own,exceptingWindows:[]); rect=CGDisplayBounds(display.displayID) }
            var source = dimensions(rect)
            let area = env("NATIVE_CAPTURE_REGION")
            if !area.isEmpty {
                let values = area.split(separator:",").compactMap { Int($0) }
                guard values.count == 4, values[0] >= 0, values[1] >= 0, values[2] >= 2, values[3] >= 2,
                      values[0] + values[2] <= source["width"]!, values[1] + values[3] <= source["height"]! else { throw Failure("Selected area is outside the source. Select it again.") }
                let sx = rect.width / CGFloat(source["width"]!), sy = rect.height / CGFloat(source["height"]!)
                config.sourceRect = CGRect(x:CGFloat(values[0])*sx,y:CGFloat(values[1])*sy,width:CGFloat(values[2])*sx,height:CGFloat(values[3])*sy)
                source = ["width":values[2],"height":values[3]]
            }
            let maxW=argument("--width",source["width"]!), maxH=argument("--height",source["height"]!)
            let scale=min(1,Double(maxW)/Double(source["width"]!),Double(maxH)/Double(source["height"]!))
            config.width=max(2,Int(Double(source["width"]!)*scale)/2*2); config.height=max(2,Int(Double(source["height"]!)*scale)/2*2)
            let fps=max(15,min(120,argument("--fps",60)))
            config.minimumFrameInterval=CMTime(value:1,timescale:CMTimeScale(fps)); config.queueDepth=3; config.showsCursor=true
            config.pixelFormat=kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            let port=argument("--port"); guard (1...65535).contains(port) else { throw Failure("Invalid RTP port.") }; rtp=RTP(port:UInt16(port))
            let callback: VTCompressionOutputCallback = { ref,_,status,_,sample in
                guard status == noErr, let ref = ref, let sample = sample else { fail("VideoToolbox failed to encode a frame.") }
                Unmanaged<Capture>.fromOpaque(ref).takeUnretainedValue().compressed(sample)
            }
            let status=VTCompressionSessionCreate(allocator:kCFAllocatorDefault,width:Int32(config.width),height:Int32(config.height),codecType:kCMVideoCodecType_H264,encoderSpecification:[kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder:true] as CFDictionary,imageBufferAttributes:nil,compressedDataAllocator:nil,outputCallback:callback,refcon:Unmanaged.passUnretained(self).toOpaque(),compressionSessionOut:&encoder)
            guard status == noErr, let encoder = encoder else { throw Failure("VideoToolbox encoder could not start (\(status)).") }
            let properties: [CFString:Any] = [kVTCompressionPropertyKey_RealTime:true,kVTCompressionPropertyKey_AllowFrameReordering:false,kVTCompressionPropertyKey_ProfileLevel:kVTProfileLevel_H264_Baseline_AutoLevel,kVTCompressionPropertyKey_AverageBitRate:max(500000,min(60000000,argument("--bitrate",8000000))),kVTCompressionPropertyKey_ExpectedFrameRate:fps,kVTCompressionPropertyKey_MaxKeyFrameInterval:fps*2]
            for (key,value) in properties { guard VTSessionSetProperty(encoder,key:key,value:value as CFTypeRef) == noErr else { throw Failure("VideoToolbox rejected encoder settings.") } }
            guard VTCompressionSessionPrepareToEncodeFrames(encoder) == noErr else { throw Failure("VideoToolbox encoder preparation failed.") }
            var hardware: CFTypeRef?; VTSessionCopyProperty(encoder,key:kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,allocator:nil,propertyValueOut:&hardware)
            emit(["event":"source","sourceSize":source,"hardware":hardware as? Bool ?? false])
        }
        let stream=SCStream(filter:filter,configuration:config,delegate:self); self.stream=stream
        try stream.addStreamOutput(self,type:audio ? .audio : .screen,sampleHandlerQueue:queue)
        try await stream.startCapture()
        if audio { emit(["format":"s16le","sampleRate":48000,"channels":2]) }
        else { running=true }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { fail("ScreenCaptureKit stopped: \(error.localizedDescription)") }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard running, sample.isValid else { return }
        if type == .audio { pcm(sample); return }
        guard type == .screen, let image=sample.imageBuffer, let encoder=encoder else { return }
        let result=VTCompressionSessionEncodeFrame(encoder,imageBuffer:image,presentationTimeStamp:sample.presentationTimeStamp,duration:sample.duration,frameProperties:nil,sourceFrameRefcon:nil,infoFlagsOut:nil)
        if result != noErr { fail("VideoToolbox frame submission failed (\(result)).") }
    }
    func pcm(_ sample: CMSampleBuffer) {
        guard let desc=sample.formatDescription, let basic=CMAudioFormatDescriptionGetStreamBasicDescription(desc), let format=AVAudioFormat(streamDescription:basic) else { fail("Unknown ScreenCaptureKit audio format.") }
        var size=0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,bufferListSizeNeededOut:&size,bufferListOut:nil,bufferListSize:0,blockBufferAllocator:nil,blockBufferMemoryAllocator:nil,flags:0,blockBufferOut:nil)
        let storage=UnsafeMutableRawPointer.allocate(byteCount:max(size,MemoryLayout<AudioBufferList>.size),alignment:16); defer { storage.deallocate() }
        let list=storage.assumingMemoryBound(to:AudioBufferList.self); var retained: CMBlockBuffer?
        guard CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,bufferListSizeNeededOut:nil,bufferListOut:list,bufferListSize:size,blockBufferAllocator:nil,blockBufferMemoryAllocator:nil,flags:0,blockBufferOut:&retained) == noErr,
              let input=AVAudioPCMBuffer(pcmFormat:format,bufferListNoCopy:list,deallocator:nil), let outputFormat=AVAudioFormat(commonFormat:.pcmFormatInt16,sampleRate:48000,channels:2,interleaved:true) else { fail("Could not read captured audio.") }
        guard sample.numSamples >= 0, sample.numSamples <= Int(input.frameCapacity) else { fail("Invalid audio frame count.") }
        input.frameLength=AVAudioFrameCount(sample.numSamples)
        if converterFormat != format { converter=AVAudioConverter(from:format,to:outputFormat); converterFormat=format }
        guard let converter=converter, let output=AVAudioPCMBuffer(pcmFormat:outputFormat,frameCapacity:AVAudioFrameCount(ceil(Double(input.frameLength)*48000/format.sampleRate))+32) else { fail("Audio conversion is unavailable.") }
        var supplied=false, error: NSError?
        let status=converter.convert(to:output,error:&error) { _,state in
            if supplied { state.pointee = .noDataNow; return nil }; supplied=true; state.pointee = .haveData; return input
        }
        guard status != .error, error == nil else { fail("Audio conversion failed.") }
        if output.frameLength > 0, let data=output.audioBufferList.pointee.mBuffers.mData { FileHandle.standardOutput.write(Data(bytes:data,count:Int(output.frameLength)*4)) }
        withExtendedLifetime(retained) {}
    }
    func compressed(_ sample: CMSampleBuffer) {
        guard let block=sample.dataBuffer, let format=sample.formatDescription, let rtp=rtp else { return }
        let time=sample.presentationTimeStamp.seconds
        guard time.isFinite, time >= 0 else { return }
        let timestamp=UInt32(truncatingIfNeeded:UInt64(time*90000))
        let attachments=CMSampleBufferGetSampleAttachmentsArray(sample,createIfNecessary:false) as? [[CFString:Any]]
        let keyframe=attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
        if keyframe {
            for index in 0...1 {
                var pointer: UnsafePointer<UInt8>?, length=0, count=0
                guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format,parameterSetIndex:index,parameterSetPointerOut:&pointer,parameterSetSizeOut:&length,parameterSetCountOut:&count,nalUnitHeaderLengthOut:nil) == noErr, let pointer=pointer else { fail("H.264 parameter sets unavailable.") }
                rtp.nal(Array(UnsafeBufferPointer(start:pointer,count:length)),timestamp,false)
            }
        }
        let length=CMBlockBufferGetDataLength(block); var bytes=[UInt8](repeating:0,count:length)
        guard bytes.withUnsafeMutableBytes({ CMBlockBufferCopyDataBytes(block,atOffset:0,dataLength:length,destination:$0.baseAddress!) }) == noErr else { fail("Could not read H.264 output.") }
        var offset=0
        while offset+4 <= length {
            let count=Int(bytes[offset])<<24 | Int(bytes[offset+1])<<16 | Int(bytes[offset+2])<<8 | Int(bytes[offset+3]); offset+=4
            guard count>0, count<=length-offset else { fail("Invalid H.264 output.") }
            rtp.nal(Array(bytes[offset..<offset+count]),timestamp,offset+count == length); offset+=count
        }
        if !firstFrame { firstFrame=true; emit(["event":"frame"]) }
    }
    func tick() {
        if audio && audioPID != 0 && processStart(audioPID) != audioStart { fail("Selected audio application closed or changed.") }
        if !audio && target.id != 0 && target.info() == nil { fail("Selected window closed or became unavailable.") }
    }
}

@main struct Main {
    static var desktop: Desktop?, overlay: Overlay?
    static var capture: Capture?
    static func main() {
        guard #available(macOS 13.0, *) else { fail("Native Mac desktop features require macOS 13 or later.") }
        _ = NSApplication.shared; NSApp.setActivationPolicy(.accessory)
        let mode=CommandLine.arguments.dropFirst().first ?? "permissions"
        if mode == "self-test" {
            let nal=[UInt8(0x65)]+[UInt8](repeating:7,count:4000), parts=RTP.fragments(nal)
            precondition(parts.count == 4 && parts[0][1] == 0x85 && parts.last![1] == 0x45)
            precondition(parts.flatMap { Array($0.dropFirst(2)) } == Array(nal.dropFirst()))
            precondition(parts.allSatisfy { $0.count <= 1188 }); precondition(RTP.fragments([]).isEmpty)
            precondition(!sameRect(CGRect(x:0,y:0,width:10,height:10),CGRect(x:0,y:0,width:20,height:10)))
            emit(["ok":true]); return
        }
        if mode == "sources" { sources(); return }
        if mode == "thumbnail" {
            #if compiler(>=5.9)
            guard #available(macOS 14.0, *) else { fail("Window thumbnails require macOS 14 or later.") }
            Task { do { try await thumbnail(); exit(0) } catch { fail(String(describing:error)) } }
            RunLoop.main.run(); return
            #else
            fail("Window thumbnails need a newer Mac helper build.")
            #endif
        }
        if mode == "permissions" { permissionStatus(); return }
        if mode == "request-screen" { _ = CGRequestScreenCaptureAccess(); permissionStatus(); return }
        if mode == "request-input" { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary); permissionStatus(); return }
        do {
            if mode == "desktop" {
                guard AXIsProcessTrusted() else { throw Failure("Allow Accessibility for the Mac helper in System Settings before enabling desktop input.") }
                desktop=Desktop(); emit(["ready":true,"relativeMouse":true,"display":dimensions(CGDisplayBounds(CGMainDisplayID()))])
            } else if mode == "overlay" {
                overlay=try Overlay(); emit(["ready":true,"target":overlay!.target.id == 0 ? "desktop" : "window"])
            } else if mode == "audio" || mode == "video" {
                let worker=Capture(); capture=worker
                Task { do { try await worker.start(audio:mode == "audio") } catch { fail(String(describing:error)) } }
            } else { throw Failure("Unknown Mac helper mode.") }
        } catch { fail(String(describing:error)) }
        DispatchQueue.global(qos:.userInteractive).async {
            while let line=readLine() {
                if line.utf8.count>65536 { continue }
                if line == "start" { capture?.queue.async { capture?.running=true }; continue }
                guard let value=try? JSONSerialization.jsonObject(with:Data(line.utf8)) as? [String:Any] else { continue }
                DispatchQueue.main.async { desktop?.handle(value); overlay?.handle(value) }
            }
            DispatchQueue.main.async { desktop?.release(); overlay?.clear(); exit(0) }
        }
        Timer.scheduledTimer(withTimeInterval:0.05,repeats:true) { _ in desktop?.tick(); overlay?.tick(); capture?.tick() }
        NSApp.run()
    }
}
