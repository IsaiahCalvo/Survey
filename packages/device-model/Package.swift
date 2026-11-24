// swift-tools-version: 5.9
import PackageDescription

// The name must match what the Capacitor CLI derives from the npm name
// (@survey/device-model -> SurveyDeviceModel): it writes that name into
// ios/App/CapApp-SPM/Package.swift.
let package = Package(
    name: "SurveyDeviceModel",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "SurveyDeviceModel",
            targets: ["DeviceModelPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "DeviceModelPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/DeviceModelPlugin")
    ]
)
