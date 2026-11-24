import Foundation
import Capacitor
#if canImport(FoundationModels)
import FoundationModels
#endif

// Apple's on-device model (Foundation Models, iOS 26 with Apple
// Intelligence on) for Survey's offline agent. The app's plain rules find the
// candidate items first; this only picks among them, in the answer shape the
// web side sends (a small JSON schema whose choices are the candidates), and
// the web side checks the answer again before anything is written.
//
// Older iPhones and iOS versions answer state "none", and the agent keeps to
// its plain rules. FoundationModels is only touched behind #available, so the
// app still starts on iOS 15.
@objc(DeviceModelPlugin)
public class DeviceModelPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceModelPlugin"
    public let jsName = "DeviceModel"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise)
    ]

    @objc func availability(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            call.resolve(["state": AppleModel.state(), "engine": "apple"])
            return
        }
        #endif
        call.resolve(["state": "none", "engine": "apple"])
    }

    // iOS fetches its model by itself once Apple Intelligence is turned on in
    // Settings; an app cannot start that download.
    @objc func download(_ call: CAPPluginCall) {
        call.resolve(["ok": false, "reason": "system"])
    }

    @objc func generate(_ call: CAPPluginCall) {
        let system = call.getString("system") ?? ""
        let prompt = call.getString("prompt") ?? ""
        let schemaJSON = call.getString("schemaJson")
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let text = try await AppleModel.generate(system: system, prompt: prompt, schemaJSON: schemaJSON)
                    call.resolve(["text": text])
                } catch {
                    call.reject("The model on this device could not answer.", "FAILED", error)
                }
            }
            return
        }
        #endif
        call.reject("No model on this device.", "UNAVAILABLE")
    }
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
enum AppleModel {
    static func state() -> String {
        let availability = SystemLanguageModel.default.availability
        if case .available = availability { return "ready" }
        if case .unavailable(let reason) = availability {
            // Apple Intelligence is on but the model is still arriving.
            return String(describing: reason).contains("modelNotReady") ? "downloading" : "none"
        }
        return "none"
    }

    static func generate(system: String, prompt: String, schemaJSON: String?) async throws -> String {
        let session = LanguageModelSession()
        let full = system.isEmpty ? prompt : "\(system)\n\n\(prompt)"
        if let schemaJSON,
           let data = schemaJSON.data(using: .utf8),
           let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           let dynamic = SchemaShape.build(root, name: "Answer"),
           let schema = try? GenerationSchema(root: dynamic, dependencies: []) {
            let response = try await session.respond(to: full, schema: schema)
            return response.content.jsonString
        }
        // A shape this file cannot turn into Apple's: ask for JSON in words;
        // the web side checks every pick either way.
        let response = try await session.respond(to: "\(full)\n\nAnswer with one JSON object only.")
        return response.content
    }
}

// The web side's answer shape (objects, arrays, strings with a fixed list of
// choices) as Apple's guided-generation shape. nil for anything else.
@available(iOS 26.0, *)
enum SchemaShape {
    static func build(_ node: [String: Any], name: String) -> DynamicGenerationSchema? {
        switch node["type"] as? String {
        case "object":
            guard let props = node["properties"] as? [String: Any] else { return nil }
            let required = node["required"] as? [String] ?? []
            // JSON objects lose their order; the required list keeps it, so
            // the model writes the action before the rest.
            let keys = required.filter { props[$0] != nil } + props.keys.filter { !required.contains($0) }.sorted()
            var properties: [DynamicGenerationSchema.Property] = []
            for key in keys {
                guard let child = props[key] as? [String: Any],
                      let schema = build(child, name: "\(name)_\(key)") else { return nil }
                properties.append(DynamicGenerationSchema.Property(
                    name: key, description: nil, schema: schema, isOptional: !required.contains(key)))
            }
            return DynamicGenerationSchema(name: name, description: nil, properties: properties)
        case "array":
            guard let items = node["items"] as? [String: Any],
                  let item = build(items, name: "\(name)_item") else { return nil }
            return DynamicGenerationSchema(arrayOf: item, minimumElements: nil, maximumElements: node["maxItems"] as? Int)
        case "string":
            if let choices = node["enum"] as? [String], !choices.isEmpty {
                return DynamicGenerationSchema(name: name, description: nil, anyOf: choices)
            }
            return DynamicGenerationSchema(type: String.self)
        default:
            return nil
        }
    }
}
#endif
