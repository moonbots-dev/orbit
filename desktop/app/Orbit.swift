import AppKit
import WebKit

// Windows are views of one independently running Orbit process.
final class OrbitApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var main: NSWindow?
    private var hud: NSPanel?
    private var status: NSStatusItem!
    private var runtime: Process?
    private var output: Pipe?
    private var port: Int?
    private var pending = ""
    private var startupError = ""
    private var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "◉"
        status.button?.toolTip = "Orbit"
        let menu = NSMenu()
        for (title, action, key) in [("Open Orbit", #selector(showMain), "o"), ("Float Orbit", #selector(showHUD), ""), ("Hide floating Orbit", #selector(hideHUD), "")] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key); item.target = self; menu.addItem(item)
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Orbit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        status.menu = menu
        installAppMenu()
        startRuntime()
    }

    private func installAppMenu() {
        let bar = NSMenu()
        let appItem = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Orbit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; bar.addItem(appItem)
        let editItem = NSMenuItem(); editItem.title = "Edit"; let edit = NSMenu(title: "Edit")
        for (name, action, key) in [("Undo", Selector(("undo:")), "z"), ("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"), ("Paste", #selector(NSText.paste(_:)), "v"), ("Select All", #selector(NSText.selectAll(_:)), "a")] {
            edit.addItem(withTitle: name, action: action, keyEquivalent: key)
        }
        editItem.submenu = edit; bar.addItem(editItem); NSApp.mainMenu = bar
    }

    private func startRuntime() {
        guard let resources = Bundle.main.resourceURL, let executables = Bundle.main.executableURL?.deletingLastPathComponent() else { return }
        let process = Process(), pipe = Pipe()
        process.executableURL = executables.appendingPathComponent("bun")
        process.arguments = [resources.appendingPathComponent("runtime/cli.js").path, "dev", "--port", "0", "--native", "--assets", resources.appendingPathComponent("web").path]
        process.standardOutput = pipe; process.standardError = pipe
        process.currentDirectoryURL = resources
        self.runtime = process; self.output = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let value = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.handleOutput(value) }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, !self.quitting else { return }
                self.showError("Orbit's runtime stopped. Quit and reopen Orbit to restart it.\n" + self.startupError.suffix(1500))
            }
        }
        do { try process.run() }
        catch { showError("Could not start Orbit: \(error.localizedDescription)") }
    }

    private func handleOutput(_ value: String) {
        pending += value
        while let range = pending.range(of: "\n") {
            let line = String(pending[..<range.lowerBound]); pending.removeSubrange(..<range.upperBound)
            if line.hasPrefix("ORBIT_READY "), let number = Int(line.dropFirst(12)), number > 0 && number < 65536 {
                port = number; showMain()
                if CommandLine.arguments.contains("--float") { showHUD() }
            } else { startupError = String((startupError + line + "\n").suffix(3000)) }
        }
    }

    private func webView(floating: Bool) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "orbit")
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        if #available(macOS 13.3, *) { view.isInspectable = true }
        view.setValue(false, forKey: "drawsBackground")
        view.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port!)/sim?desktop=1\(floating ? "&hud=1" : "")")!))
        return view
    }

    @objc func showMain() {
        guard port != nil else { return }
        if main == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 780), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "Orbit"; window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden; window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 740, height: 580)
            window.backgroundColor = NSColor(calibratedRed: 0.70, green: 0.63, blue: 0.96, alpha: 1)
            let content = webView(floating: false)
            // Keep the traffic lights above the app's own navigation.
            window.contentView = NSView(); content.translatesAutoresizingMaskIntoConstraints = false
            window.contentView!.addSubview(content)
            NSLayoutConstraint.activate([content.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor), content.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor), content.topAnchor.constraint(equalTo: (window.contentLayoutGuide as! NSLayoutGuide).topAnchor), content.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor)])
            window.center(); main = window
        }
        NSApp.activate(ignoringOtherApps: true); main?.makeKeyAndOrderFront(nil)
    }

    @objc func showHUD() {
        guard port != nil else { return }
        if hud == nil {
            let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 340), styleMask: [.titled, .closable, .resizable, .utilityWindow, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.titleVisibility = .hidden; panel.titlebarAppearsTransparent = true
            panel.standardWindowButton(.closeButton)?.isHidden = true
            panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
            panel.standardWindowButton(.zoomButton)?.isHidden = true
            panel.isReleasedWhenClosed = false; panel.isFloatingPanel = true
            panel.level = .floating; panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isMovableByWindowBackground = true; panel.minSize = NSSize(width: 220, height: 260)
            panel.backgroundColor = NSColor(calibratedRed: 0.70, green: 0.63, blue: 0.96, alpha: 1)
            panel.contentView = webView(floating: true)
            if let screen = NSScreen.main { panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.maxX - 330, y: screen.visibleFrame.minY + 45)) }
            hud = panel
        }
        hud?.orderFrontRegardless()
    }

    @objc func hideHUD() { hud?.orderOut(nil) }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1", message.frameInfo.securityOrigin.port == port else { return }
        if let value = message.body as? [String: String], value["action"] == "save-file", let text = value["text"], text.utf8.count <= 2_100_000 {
            let panel = NSSavePanel(); panel.nameFieldStringValue = ((value["name"] ?? "orbit.ts") as NSString).lastPathComponent
            panel.begin { result in
                if result == .OK, let url = panel.url { do { try text.write(to: url, atomically: true, encoding: .utf8) } catch { self.showError(error.localizedDescription) } }
            }
            return
        }
        guard let action = message.body as? String else { return }
        switch action { case "show-main": showMain(); case "show-hud": showHUD(); case "hide-hud": hideHUD(); default: break }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == "127.0.0.1", url.port == port { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    private func showError(_ message: String) { let alert = NSAlert(); alert.messageText = "Orbit couldn't start"; alert.informativeText = message; alert.runModal() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showMain(); return true }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true; output?.fileHandleForReading.readabilityHandler = nil
        if let process = runtime, process.isRunning { process.terminate(); process.waitUntilExit() }
    }
}

let application = NSApplication.shared
let delegate = OrbitApp()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
