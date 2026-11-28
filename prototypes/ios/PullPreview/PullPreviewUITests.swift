import XCTest

final class PullPreviewUITests: XCTestCase {
    @MainActor func testReleaseThreshold() {
        let app = XCUIApplication()
        app.launch()
        let dots = app.buttons["New session"].firstMatch
        let start = dots.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -160)))
        XCTAssertFalse(app.buttons["Try again"].exists)
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -290)))
        XCTAssertTrue(app.buttons["Try again"].waitForExistence(timeout: 3))
        app.buttons["Try again"].tap()
        XCTAssertTrue(dots.exists)
    }
}
