package com.kalvoe.survey.devicemodel;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/** Gemini Nano on the phone, through ML Kit (API 26+ only). */
@RequiresApi(26)
final class GeminiNano {

    interface StateResult { void state(String state); }
    interface Progress { void bytes(long bytes); }
    interface Done { void ok(boolean ok); }
    interface Answer {
        void text(String text);
        void failed(Throwable error);
    }

    private final Executor executor = Executors.newSingleThreadExecutor();
    private GenerativeModelFutures model;

    private GenerativeModelFutures model() {
        if (model == null) model = GenerativeModelFutures.from(Generation.INSTANCE.getClient());
        return model;
    }

    /** "ready", "downloadable", "downloading" or "none". */
    void state(StateResult result) {
        ListenableFuture<Integer> status;
        try {
            status = model().checkStatus();
        } catch (Throwable error) {
            result.state("none");
            return;
        }
        status.addListener(() -> {
            String state = "none";
            try {
                Integer value = status.get();
                if (value != null) {
                    if (value == FeatureStatus.AVAILABLE) state = "ready";
                    else if (value == FeatureStatus.DOWNLOADABLE) state = "downloadable";
                    else if (value == FeatureStatus.DOWNLOADING) state = "downloading";
                }
            } catch (Throwable ignored) {
                state = "none";
            }
            result.state(state);
        }, executor);
    }

    void download(Progress progress, Done done) {
        try {
            model().download(new DownloadCallback() {
                @Override
                public void onDownloadProgress(long bytes) {
                    progress.bytes(bytes);
                }

                @Override
                public void onDownloadCompleted() {
                    done.ok(true);
                }

                @Override
                public void onDownloadFailed(@NonNull GenAiException error) {
                    done.ok(false);
                }
            });
        } catch (Throwable error) {
            done.ok(false);
        }
    }

    /**
     * One question, answered as JSON text. Structured output is Kotlin-only
     * in ML Kit for now, so the shape goes into the words and the web side
     * checks the answer.
     */
    void generate(String system, String prompt, String schemaJson, Answer answer) {
        StringBuilder words = new StringBuilder();
        if (system != null && !system.isEmpty()) words.append(system).append("\n\n");
        words.append(prompt);
        words.append("\n\nAnswer with one JSON object only, no other words.");
        if (schemaJson != null && !schemaJson.isEmpty()) {
            words.append(" It must fit this JSON schema: ").append(schemaJson);
        }
        ListenableFuture<GenerateContentResponse> future;
        try {
            GenerateContentRequest.Builder request = new GenerateContentRequest.Builder(new TextPart(words.toString()));
            request.setTemperature(0.1f);
            request.setTopK(1);
            request.setMaxOutputTokens(512);
            future = model().generateContent(request.build());
        } catch (Throwable error) {
            answer.failed(error);
            return;
        }
        future.addListener(() -> {
            try {
                GenerateContentResponse response = future.get();
                List<Candidate> candidates = response.getCandidates();
                String text = candidates.isEmpty() ? null : candidates.get(0).getText();
                if (text == null) answer.failed(new IllegalStateException("no answer"));
                else answer.text(text);
            } catch (Throwable error) {
                answer.failed(error);
            }
        }, executor);
    }
}
