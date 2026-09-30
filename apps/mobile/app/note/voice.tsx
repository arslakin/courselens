import React, { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import type { RecordingHandle } from "@rojanda/api";
import { colors, fontWeight, spacing } from "@rojanda/design";
import { Body, Button, Card, Input, Muted, Row, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";
import { PermissionDeniedError } from "../../src/services/ExpoRecordingService";
import { AudioPlayerButton } from "../../src/audio/AudioPlayerButton";

type Phase = "idle" | "recording" | "editing";

/**
 * Sesli Not — a QUICK spoken personal note (distinct from Dersi Kaydet, which
 * processes a whole lesson). Reuses the shared recording infrastructure
 * (services.recording via expo-av). The audio is preserved and playable; since
 * no transcription backend is connected yet, we DO NOT fabricate transcript
 * text — we clearly say transcription is pending and let the student type the
 * note themselves (optional). The note is associated with the current user and
 * the optional course/lesson passed in.
 */
export default function VoiceNoteScreen() {
  const params = useLocalSearchParams<{ courseId?: string; lessonId?: string }>();
  const { t, user } = useApp();
  const services = useServices();

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audioUri, setAudioUri] = useState<string | undefined>();
  const [text, setText] = useState("");

  const handleRef = useRef<RecordingHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startTimer = () => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const start = async () => {
    try {
      handleRef.current = await services.recording.start();
      setPhase("recording");
      startTimer();
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        Alert.alert(t.notes.permissionTitle, t.notes.permissionDenied);
      } else {
        Alert.alert(t.notes.permissionTitle, t.notes.recordError);
      }
    }
  };

  const stop = async () => {
    stopTimer();
    try {
      const { uri } = await handleRef.current!.stop();
      handleRef.current = null;
      // Ask the (pending) transcription service — returns null today (no
      // fabrication). The student can type the text instead.
      const auto = await services.transcription.transcribeVoiceNote(uri);
      setAudioUri(uri);
      setText(auto ?? "");
      setPhase("editing");
    } catch {
      setPhase("idle");
      Alert.alert(t.notes.permissionTitle, t.notes.recordError);
    }
  };

  const reRecord = () => {
    setAudioUri(undefined);
    setText("");
    setPhase("idle");
  };

  const save = async () => {
    if (!user || !audioUri) return;
    // Body may be empty (audio-only) — never fabricate text. When empty we mark
    // transcription pending so the note is honestly "audio, awaiting text".
    const body = text.trim();
    await services.notes.create(user.id, body, {
      courseId: params.courseId,
      lessonId: params.lessonId,
      kind: "voice",
      audioUri,
      transcriptionPending: body.length === 0,
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.notes.voiceNote }} />
      <Muted>{t.notes.voiceHint}</Muted>

      {phase === "idle" && (
        <>
          <Card>
            <Muted>{t.notes.voiceExample}</Muted>
          </Card>
          <Button label={t.notes.voiceStart} icon="voiceNote" variant="primary" onPress={start} />
        </>
      )}

      {phase === "recording" && (
        <View style={styles.center}>
          <View style={styles.dot} />
          <Text style={styles.timer}>{formatTime(elapsed)}</Text>
          <Body muted>{t.notes.voiceRecording}</Body>
          <Button label={t.notes.voiceStop} variant="good" onPress={stop} />
        </View>
      )}

      {phase === "editing" && (
        <>
          <SectionTitle icon="voiceNote">{t.notes.voiceSaved}</SectionTitle>
          <Card>
            <AudioPlayerButton
              uri={audioUri}
              playLabel={t.notes.voicePlay}
              pauseLabel={t.notes.voicePause}
            />
          </Card>

          <Card>
            <Body>{t.notes.voiceTranscriptionPending}</Body>
            <Muted>{t.notes.voiceTranscriptionPendingHint}</Muted>
          </Card>

          <SectionTitle>{t.notes.voiceTextOptional}</SectionTitle>
          <Input
            value={text}
            onChangeText={setText}
            multiline
            style={{ minHeight: 120, textAlignVertical: "top" }}
            placeholder={t.notes.typeHere}
          />
          <Row>
            <Button
              label={text.trim() ? t.common.save : t.notes.saveWithoutText}
              variant="primary"
              onPress={save}
            />
            <Button label={t.notes.voiceReRecord} onPress={reRecord} />
          </Row>
        </>
      )}
    </Screen>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  timer: { color: colors.text, fontSize: 44, fontWeight: fontWeight.bold, fontVariant: ["tabular-nums"] },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.danger },
});
