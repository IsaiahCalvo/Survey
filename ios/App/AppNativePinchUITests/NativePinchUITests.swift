import XCTest

final class NativePinchUITests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launch()
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
}
