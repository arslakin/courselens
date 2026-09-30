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
  IOSOutputFormat,
  AudioQuality,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type RecordingOptions,
} from "expo-audio";
import type { RecordingHandle, RecordingService } from "@rojanda/api";

/**
 * Explicit RojAnda recording options — speech-optimized, compressed AAC/M4A.
 *
 * WHY NOT RecordingPresets.HIGH_QUALITY: on iOS that preset sets an AAC
 * `outputFormat` AND `linearPCM*` keys together; AVAudioRecorder then falls
 * back to uncompressed LPCM-in-.m4a, which Amazon Transcribe rejects as
 * "The data in your input media file isn't valid." We therefore specify our
 * own options and DELIBERATELY OMIT every linearPCM* field so iOS honors AAC.
 *
 *  - container/extension: .m4a
 *  - iOS codec: MPEG4AAC (real AAC, no linearPCM* keys)
 *  - Android codec: MPEG4 container + AAC encoder
 *  - mono (speech), 44.1 kHz, ~96 kbps  → ~65 MB for a 90-min lecture
 *
 * Compatible with the backend's Amazon Transcribe MediaFormat=mp4 pipeline
 * (AAC-in-m4a). No backend change.
 */
export const ROJANDA_RECORDING_OPTIONS: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 44100,
  numberOfChannels: 1, // mono — best for speech + smaller files
  bitRate: 96000, // ~96 kbps
  ios: {
    extension: ".m4a",
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    // NO linearPCMBitDepth / linearPCMIsBigEndian / linearPCMIsFloat — their
    // presence is what forces LPCM instead of AAC on iOS.
  },
  android: {
    extension: ".m4a",
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  // Web is not a RojAnda recording target in Phase 1, but the type requires it.
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 96000,
  },
};

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

    // Use the SAME explicit AAC options for BOTH recorder creation and
    // prepareToRecordAsync so the applied encoder is consistent. expo-audio
    // applies the iOS-specific format inside prepareToRecordAsync via
    // createRecordingOptions; passing our clean AAC options (no linearPCM*
    // keys) makes iOS record real AAC that Transcribe (MediaFormat mp4)
    // accepts, instead of falling back to LPCM.
    const recorder = new AudioModule.AudioRecorder(ROJANDA_RECORDING_OPTIONS);
    await recorder.prepareToRecordAsync(ROJANDA_RECORDING_OPTIONS);
    recorder.record();
    return new ExpoRecordingHandle(recorder);
  }
}
