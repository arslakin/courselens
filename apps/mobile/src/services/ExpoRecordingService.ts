/**
 * Real device audio recording via expo-av, implementing the shared
 * RecordingService / RecordingHandle interfaces so screens and the core
 * pipeline stay unchanged. This is the mobile platform's implementation; the
 * in-memory MockRecordingService remains for tests and web.
 *
 * What this does:
 *  - requests microphone permission (throws PermissionDeniedError if refused)
 *  - configures the audio session for recording (iOS needs this)
 *  - start / pause / resume / stop with a real duration and a real file URI
 *  - preserves the recorded file (expo-av writes it to app storage); the URI is
 *    handed back so the caller can save it as the student's own source
 *
 * It does NOT transcribe — transcription is a separate seam
 * (TranscriptionService / AnalysisBackend.transcribe) that stays honest/pending
 * until the RojAnda backend is connected. No AWS credentials here.
 */
import { Audio } from "expo-av";
import type { RecordingHandle, RecordingService } from "@rojanda/api";

export class PermissionDeniedError extends Error {
  constructor() {
    super("microphone-permission-denied");
    this.name = "PermissionDeniedError";
  }
}

class ExpoRecordingHandle implements RecordingHandle {
  constructor(private recording: Audio.Recording) {}

  async pause(): Promise<void> {
    await this.recording.pauseAsync();
  }

  async resume(): Promise<void> {
    // expo-av resumes a paused recording by starting it again.
    await this.recording.startAsync();
  }

  async stop(): Promise<{ uri: string; durationSec: number }> {
    let durationMillis = 0;
    try {
      const status = await this.recording.stopAndUnloadAsync();
      durationMillis = status.durationMillis ?? 0;
    } finally {
      // Release the recording audio session so playback/other recordings work.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
    const uri = this.recording.getURI();
    if (!uri) throw new Error("recording-uri-unavailable");
    return { uri, durationSec: Math.max(1, Math.round(durationMillis / 1000)) };
  }
}

export class ExpoRecordingService implements RecordingService {
  async start(): Promise<RecordingHandle> {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError();

    // Allow recording (and route to speaker so the level indicator behaves).
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    return new ExpoRecordingHandle(recording);
  }
}
