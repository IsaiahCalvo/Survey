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
}
