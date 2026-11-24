package com.kalvoe.survey.devicemodel;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The phone's own model for Survey's offline agent: Gemini Nano through
 * ML Kit's GenAI Prompt API. The app's plain rules find the candidate items
 * first; this only picks among them, and the web side checks every pick
 * again before anything is written. Phones without AICore (or below
 * Android 8) answer state "none", and the agent keeps to its plain rules.
 */
@CapacitorPlugin(name = "DeviceModel")
public class DeviceModelPlugin extends Plugin {

    private GeminiNano nano;

    // ML Kit's classes are only loaded on API 26+, inside GeminiNano.
    private GeminiNano nano() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null;
        if (nano == null) nano = new GeminiNano();
        return nano;
    }

    @PluginMethod
    public void availability(PluginCall call) {
        GeminiNano model = nano();
        if (model == null) {
            call.resolve(result("none"));
            return;
        }
        model.state(state -> call.resolve(result(state)));
    }

    @PluginMethod
    public void download(PluginCall call) {
        GeminiNano model = nano();
        if (model == null) {
            JSObject out = new JSObject();
            out.put("ok", false);
            call.resolve(out);
            return;
        }
        model.download(
            bytes -> {
                JSObject progress = new JSObject();
                progress.put("bytes", bytes);
                notifyListeners("downloadProgress", progress);
            },
            ok -> {
                JSObject out = new JSObject();
                out.put("ok", ok);
                call.resolve(out);
            }
        );
    }

    @PluginMethod
    public void generate(PluginCall call) {
        GeminiNano model = nano();
        if (model == null) {
            call.reject("No model on this device.", "UNAVAILABLE");
            return;
        }
        String system = call.getString("system", "");
        String prompt = call.getString("prompt", "");
        String schemaJson = call.getString("schemaJson", null);
        model.generate(system, prompt, schemaJson, new GeminiNano.Answer() {
            @Override
            public void text(String text) {
                JSObject out = new JSObject();
                out.put("text", text);
                call.resolve(out);
            }

            @Override
            public void failed(Throwable error) {
                call.reject("The model on this device could not answer.", "FAILED", error instanceof Exception ? (Exception) error : null);
            }
        });
    }

    private static JSObject result(String state) {
        JSObject out = new JSObject();
        out.put("state", state);
        out.put("engine", "gemini-nano");
        return out;
    }
}
