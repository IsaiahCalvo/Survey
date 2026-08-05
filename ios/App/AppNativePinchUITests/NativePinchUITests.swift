import XCTest

final class NativePinchUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
    }

    private func waitForViewer() -> (XCUIElement, XCUIElement) {
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "Capacitor web view did not appear")
        let gestureSurface = app.buttons["PDF gesture surface"]
        XCTAssertTrue(gestureSurface.waitForExistence(timeout: 30), "Named PDF gesture surface did not become accessible")
        return (webView, gestureSurface)
    }

    private func scrollPosition() -> (left: Int, top: Int) {
        let marker = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF scroll position ")
        ).firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 5), "PDF scroll marker did not appear")
        let values = marker.label.replacingOccurrences(of: "PDF scroll position ", with: "")
            .split(separator: " ").compactMap { Int($0) }
        XCTAssertEqual(values.count, 2, "Malformed PDF scroll marker: \(marker.label)")
        return (values.first ?? 0, values.last ?? 0)
    }

    func testTwoFingerPinchChangesPdfZoom() throws {
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "Capacitor web view did not appear")

        let zoomMenu = app.buttons["Zoom and fit options"]
        XCTAssertTrue(zoomMenu.waitForExistence(timeout: 30), "Real mobile PDF viewer did not become accessible")

        zoomMenu.tap()
        let fitPage = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fit page")).firstMatch
        let fitWidth = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fit width")).firstMatch
        let fitHeight = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fit height")).firstMatch
        XCTAssertTrue(fitPage.waitForExistence(timeout: 5), "Zoom state options did not become accessible")
        // Make the baseline deterministic even when Simulator retained the
        // previous run's manual zoom preference.
        fitPage.tap()
        sleep(1)
        zoomMenu.tap()
        XCTAssertTrue(fitPage.waitForExistence(timeout: 5), "Fit menu did not reopen for baseline assertion")
        let selectedBefore = [fitPage, fitWidth, fitHeight].filter(\.isSelected).map(\.label)
        XCTAssertEqual(selectedBefore, ["Fit page"], "Harness could not establish the fit-page baseline")
        zoomMenu.tap()
        sleep(1)

        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        before.name = "before-native-pinch"
        before.lifetime = .keepAlways
        add(before)

        // XCTest synthesizes a native two-contact gesture at the iOS input layer.
        // This is deliberately not a JavaScript TouchEvent or browser mouse shim.
        let gestureSurface = app.buttons["PDF gesture surface"]
        XCTAssertTrue(gestureSurface.waitForExistence(timeout: 10), "Named PDF gesture surface did not become accessible")
        gestureSurface.pinch(withScale: 0.5, velocity: -1.0)

        // Let the viewer commit the gesture and finish its raster resize before
        // taking evidence. The JS path owns zoom state; XCTest owns the input.
        sleep(2)

        let anchorMarker = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF anchor settle error ")
        ).firstMatch
        XCTAssertTrue(anchorMarker.waitForExistence(timeout: 5), "Anchor settle marker did not appear")
        let anchorError = Double(anchorMarker.label.replacingOccurrences(of: "PDF anchor settle error ", with: "")) ?? .infinity
        XCTAssertLessThanOrEqual(anchorError, 1.0, "Pinch release did not commit the previewed anchor")

        zoomMenu.tap()
        XCTAssertTrue(fitPage.waitForExistence(timeout: 5), "Fit menu did not open after native pinch")
        let switchedToManualZoom = NSPredicate { _, _ in
            [fitPage, fitWidth, fitHeight].allSatisfy { !$0.isSelected }
        }
        let waiter = XCTNSPredicateExpectation(predicate: switchedToManualZoom, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [waiter], timeout: 10), .completed,
                       "Native pinch did not switch the app from fit mode to manual zoom")

        let selectedAfter = [fitPage, fitWidth, fitHeight].filter(\.isSelected).map(\.label)
        XCTAssertTrue(selectedAfter.isEmpty)
        zoomMenu.tap()
        sleep(1)

        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        after.name = "after-native-pinch"
        after.lifetime = .keepAlways
        add(after)
        print("NATIVE_PINCH_EVIDENCE nativeTwoContact=true beforeFit=\(selectedBefore) afterFit=\(selectedAfter) zoomState=manual")
    }

    func testRapidPinchZoomDoesNotReloadOrLosePdf() throws {
        _ = waitForViewer()
        let sessionQuery = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF viewer session ")
        )
        XCTAssertTrue(sessionQuery.firstMatch.waitForExistence(timeout: 10), "Viewer session marker did not appear")
        let originalSession = sessionQuery.firstMatch.label
        let zoomQuery = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF zoom scale ")
        )
        XCTAssertTrue(zoomQuery.firstMatch.waitForExistence(timeout: 10), "Viewer zoom marker did not appear")
        let zoomMenu = app.buttons["Zoom and fit options"]
        XCTAssertTrue(zoomMenu.waitForExistence(timeout: 10), "Zoom menu did not appear for stress baseline")
        zoomMenu.tap()
        let fitPage = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fit page")).firstMatch
        XCTAssertTrue(fitPage.waitForExistence(timeout: 5), "Fit page did not appear for stress baseline")
        fitPage.tap()
        sleep(1)
        let before = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        before.name = "before-rapid-pinch-stress"
        before.lifetime = .keepAlways
        add(before)

        for index in 0..<8 {
            let zoomInSurface = app.buttons["PDF gesture surface"]
            XCTAssertTrue(zoomInSurface.waitForExistence(timeout: 5), "PDF gesture surface missing before rapid pinch cycle \(index)")
            zoomInSurface.pinch(withScale: 2.0, velocity: 4.0)
            let zoomOutSurface = app.buttons["PDF gesture surface"]
            XCTAssertTrue(zoomOutSurface.waitForExistence(timeout: 5), "PDF gesture surface missing after zoom-in cycle \(index)")
            zoomOutSurface.pinch(withScale: 0.5, velocity: -4.0)
            XCTAssertTrue(app.buttons["PDF gesture surface"].exists, "PDF gesture surface disappeared during rapid pinch cycle \(index)")
            let zoomState = app.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", "PDF zoom scale ")
            ).firstMatch
            print("NATIVE_PINCH_CYCLE index=\(index) state=\(zoomState.label)")
        }

        sleep(2)
        XCTAssertTrue(app.buttons["PDF gesture surface"].exists, "PDF gesture surface disappeared after rapid pinch stress")
        XCTAssertEqual(sessionQuery.firstMatch.label, originalSession, "WKWebView reloaded during rapid pinch stress")
        zoomMenu.tap()
        XCTAssertTrue(fitPage.waitForExistence(timeout: 5), "Fit page did not appear after rapid pinch stress")
        fitPage.tap()
        sleep(2)
        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        after.name = "after-rapid-pinch-stress"
        after.lifetime = .keepAlways
        add(after)
        print("NATIVE_PINCH_STRESS_EVIDENCE cycles=8 sessionStable=true viewerVisible=true")
    }

    func testDeepZoomDoesNotTerminateWebContentProcess() throws {
        _ = waitForViewer()
        let sessionQuery = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF viewer session ")
        )
        XCTAssertTrue(sessionQuery.firstMatch.waitForExistence(timeout: 10), "Viewer session marker did not appear")
        let originalSession = sessionQuery.firstMatch.label
        // The dev fixture opens fit-to-page by contract. Avoid coupling this
        // memory test to the animated toolbar menu, which has its own coverage.
        sleep(1)

        // Regression: the previous stress test paired every 2x pinch with a 0.5x
        // pinch, so it never exercised the physical-phone crash at roughly 9-10x.
        // Accumulate zoom first, then prove the same WKWebView session survives.
        for index in 0..<5 {
            let surface = app.buttons["PDF gesture surface"]
            XCTAssertTrue(surface.waitForExistence(timeout: 5), "PDF gesture surface missing before deep pinch \(index)")
            surface.pinch(withScale: 2.0, velocity: 2.0)
            sleep(1)
            XCTAssertTrue(app.buttons["PDF gesture surface"].exists, "PDF gesture surface disappeared at deep pinch \(index)")
            XCTAssertEqual(sessionQuery.firstMatch.label, originalSession, "WKWebView reloaded at deep pinch \(index)")
            let zoomState = app.descendants(matching: .any).matching(
                NSPredicate(format: "label BEGINSWITH %@", "PDF zoom scale ")
            ).firstMatch
            print("NATIVE_DEEP_PINCH index=\(index) state=\(zoomState.label)")
        }

        let finalZoomLabel = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF zoom scale ")
        ).firstMatch.label
        let finalZoom = Int(finalZoomLabel.replacingOccurrences(of: "PDF zoom scale ", with: "")) ?? .max
        XCTAssertLessThanOrEqual(finalZoom, 800, "Mobile zoom exceeded the WebKit-safe 800% ceiling")

        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        after.name = "after-deep-pinch-stress"
        after.lifetime = .keepAlways
        add(after)
        print("NATIVE_DEEP_PINCH_EVIDENCE pinches=5 sessionStable=true viewerVisible=true")
    }

    func testSlowZoomOutFromDeepScaleDoesNotTerminateWebContentProcess() throws {
        _ = waitForViewer()
        let sessionQuery = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF viewer session ")
        )
        XCTAssertTrue(sessionQuery.firstMatch.waitForExistence(timeout: 10), "Viewer session marker did not appear")
        let originalSession = sessionQuery.firstMatch.label
        let liveFloorQuery = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF live zoom floor ")
        )
        XCTAssertTrue(liveFloorQuery.firstMatch.waitForExistence(timeout: 10), "Live zoom floor marker did not appear")

        // Exact physical-phone regression: slow contraction from a deep scale.
        // Slow movement previously gave WebKit time to raster an 80+ MP source
        // surface and terminate its WebContent process; a fast pinch often hid it.
        for cycle in 0..<3 {
            for step in 0..<5 {
                let zoomInSurface = app.buttons["PDF gesture surface"]
                XCTAssertTrue(zoomInSurface.waitForExistence(timeout: 5), "Gesture surface missing before deep zoom cycle \(cycle), step \(step)")
                zoomInSurface.pinch(withScale: 2.0, velocity: 2.0)
                usleep(350_000)
            }

            let zoomOutSurface = app.buttons["PDF gesture surface"]
            XCTAssertTrue(zoomOutSurface.waitForExistence(timeout: 5), "Gesture surface missing before slow zoom-out cycle \(cycle)")
            zoomOutSurface.pinch(withScale: 0.0625, velocity: -0.1)
            sleep(2)

            XCTAssertTrue(app.buttons["PDF gesture surface"].exists, "PDF gesture surface disappeared after slow zoom-out cycle \(cycle)")
            XCTAssertEqual(sessionQuery.firstMatch.label, originalSession, "WKWebView reloaded during slow deep zoom-out cycle \(cycle)")
            let floorLabel = liveFloorQuery.firstMatch.label
            let floor = Double(floorLabel.replacingOccurrences(of: "PDF live zoom floor ", with: "")) ?? 0
            XCTAssertGreaterThanOrEqual(floor, 0.66, "Unsafe deep-layer downscale reached the compositor: \(floorLabel)")
            print("NATIVE_SLOW_ZOOM_OUT cycle=\(cycle) floor=\(floorLabel) sessionStable=true")
        }

        let after = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        after.name = "after-slow-deep-zoom-out-stress"
        after.lifetime = .keepAlways
        add(after)
        print("NATIVE_SLOW_ZOOM_OUT_EVIDENCE cycles=3 sessionStable=true floorBounded=true")
    }

    func testPanFlickCoastsDiagonallyAfterRelease() throws {
        let (_, surface) = waitForViewer()
        let zoomMenu = app.buttons["Zoom and fit options"]
        XCTAssertTrue(zoomMenu.waitForExistence(timeout: 10), "Zoom menu did not appear for momentum baseline")
        zoomMenu.tap()
        let fitPage = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Fit page")).firstMatch
        XCTAssertTrue(fitPage.waitForExistence(timeout: 5), "Fit page did not appear for momentum baseline")
        fitPage.tap()
        sleep(1)
        surface.pinch(withScale: 3.0, velocity: 2.0)
        sleep(1)

        // Pinch anchoring leaves scroll room toward the origin. Flick back into
        // that room so the test measures momentum instead of a clamped edge.
        let start = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.40))
        let end = surface.coordinate(withNormalizedOffset: CGVector(dx: 0.60, dy: 0.60))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .fast, thenHoldForDuration: 0)
        let coastMarker = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "PDF pan coast distance ")
        ).firstMatch
        XCTAssertTrue(coastMarker.waitForExistence(timeout: 5), "PDF pan coast marker did not appear")
        let coasted = NSPredicate { _, _ in
            let values = coastMarker.label.replacingOccurrences(of: "PDF pan coast distance ", with: "")
                .split(separator: " ").compactMap { Int($0) }
            return values.count == 2 && values[0] > 1 && values[1] > 1
        }
        expectation(for: coasted, evaluatedWith: coastMarker)
        waitForExpectations(timeout: 3)
        let finalPosition = scrollPosition()
        print("NATIVE_PAN_MOMENTUM coast=\(coastMarker.label) final=\(finalPosition) diagonal=true")
    }
}
