/**
 * Real device audio recording via expo-audio, implementing the shared
 * RecordingService / RecordingHandle interfaces so screens and the core
 * pipeline stay unchanged. This is the mobile platform's implementation; the
 * in-memory MockRecordingService remains for tests and web.
 *
 * expo-audio is the SDK 57 audio module and IS bundled into Expo Go (expo-av
 * was removed from the SDK and is not available in Expo Go).
 *
 * What this does:
 *  - requests microphone permission (throws PermissionDeniedError if refused)
 *  - configures the audio session for recording
 *  - start / pause / resume / stop with a real duration and a real file URI
 *  - preserves the recorded file; the URI is handed back so the caller can save
 *    it as the student's own source
 *
 * It does NOT transcribe — transcription is a separate seam that stays
 * honest/pending until the RojAnda backend is connected. No AWS credentials.
 */
import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import type { RecordingHandle, RecordingService } from "@rojanda/api";

export class PermissionDeniedError extends Error {
  constructor() {
    super("microphone-permission-denied");
    this.name = "PermissionDeniedError";
  }
}

type Recorder = InstanceType<typeof AudioModule.AudioRecorder>;

class ExpoRecordingHandle implements RecordingHandle {
  constructor(private recorder: Recorder) {}

  async pause(): Promise<void> {
    this.recorder.pause();
  }

  async resume(): Promise<void> {
    // expo-audio resumes a paused recording by calling record() again.
    this.recorder.record();
  }

  async stop(): Promise<{ uri: string; durationSec: number }> {
    const durationSec = Math.max(1, Math.round(this.recorder.currentTime || 0));
    await this.recorder.stop();
    // Release the recording audio session so playback works afterwards.
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    const uri = this.recorder.uri;
    if (!uri) throw new Error("recording-uri-unavailable");
    return { uri, durationSec };
  }
}

export class ExpoRecordingService implements RecordingService {
  async start(): Promise<RecordingHandle> {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError();

    // Allow recording (and keep audio active in silent mode).
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync();
    recorder.record();
    return new ExpoRecordingHandle(recorder);
  }
}
