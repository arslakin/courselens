import React, { useEffect, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet, Text, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Course } from "@rojanda/types";
import type { RecordingHandle } from "@rojanda/api";
import { processRecordedLesson, retryLessonTranscription } from "@rojanda/core";
import { colors, fontWeight, spacing } from "@rojanda/design";
import { Body, Button, Card, Input, Loading, Muted, Row, Screen, SectionTitle } from "../src/ui";
import { useApp } from "../src/app-context";
import { useServices } from "../src/services/ServicesProvider";
import { PermissionDeniedError } from "../src/services/ExpoRecordingService";
import { AudioPlayerButton } from "../src/audio/AudioPlayerButton";

type Phase = "setup" | "recording" | "paused" | "processing" | "done";

/**
 * Dersi Kaydet — records a real lecture on the device (expo-audio), preserves the
 * audio as the student's own source, and creates/associates a lesson. Because
 * no transcription backend is connected yet, we DO NOT fabricate a transcript:
 * the lesson stops in an honest "awaiting transcription" state, the audio is
 * playable, and analysis will run automatically once transcription lands.
 */
export default function RecordScreen() {
  const params = useLocalSearchParams<{ courseId?: string }>();
  const { t, user } = useApp();
  const services = useServices();

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>(params.courseId);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [elapsed, setElapsed] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [recordedUri, setRecordedUri] = useState<string | undefined>();
  const [createdLessonId, setCreatedLessonId] = useState<string | undefined>();
  const [transcriptionFailed, setTranscriptionFailed] = useState(false);
  const [transcriptReady, setTranscriptReady] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const handleRef = useRef<RecordingHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track "recording in progress" for the hardware-back guard without stale closures.
  const activeRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    services.courses.list(user.id).then((cs) => {
      setCourses(cs);
      if (!courseId && cs.length > 0) setCourseId(cs[0].id);
    });
  }, [services, user]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Prevent accidental loss of an active recording via the Android back button.
  useFocusEffect(
    React.useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (activeRef.current) {
          confirmDiscard();
          return true; // handled — block the default back
        }
        return false;
      });
      return () => sub.remove();
    }, [])
  );

  const startTimer = () => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const start = async () => {
    try {
      handleRef.current = await services.recording.start();
      activeRef.current = true;
      setElapsed(0);
      setPhase("recording");
      startTimer();
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        Alert.alert(t.record.permissionTitle, t.record.permissionDenied);
      } else {
        Alert.alert(t.record.permissionTitle, t.record.recordError);
      }
    }
  };

  const pause = async () => {
    await handleRef.current?.pause();
    stopTimer();
    setPhase("paused");
  };
  const resume = async () => {
    await handleRef.current?.resume();
    startTimer();
    setPhase("recording");
  };

  const confirmDiscard = () => {
    Alert.alert(t.record.discardTitle, t.record.discardMessage, [
      { text: t.record.keepRecording, style: "cancel" },
      {
        text: t.record.discardConfirm,
        style: "destructive",
        onPress: async () => {
          stopTimer();
          try {
            await handleRef.current?.stop();
          } catch {
            /* discard — ignore stop errors */
          }
          handleRef.current = null;
          activeRef.current = false;
          router.back();
        },
      },
    ]);
  };

  const finish = async () => {
    if (!user || !courseId || !handleRef.current) return;
    stopTimer();
    setPhase("processing");
    let uri: string;
    let durationSec: number;
    try {
      const res = await handleRef.current.stop();
      uri = res.uri;
      durationSec = res.durationSec;
    } catch {
      activeRef.current = false;
      setPhase("recording");
      Alert.alert(t.record.permissionTitle, t.record.recordError);
      return;
    }
    activeRef.current = false;
    handleRef.current = null;
    setRecordedUri(uri);

    // The audio is already captured on the device at `uri`. processRecordedLesson
    // PERSISTS the recording first (visible in Ders Kayıtları) and then attempts
    // transcription as a separate, failure-isolated step: a transcription
    // failure does NOT throw and does NOT lose the recording.
    try {
      const lessonTitle = title.trim() || defaultTitle();
      const lesson = await services.lessons.create(courseId, user.id, lessonTitle);
      setCreatedLessonId(lesson.id);

      const result = await processRecordedLesson(
        services,
        lesson.id,
        uri,
        durationSec,
        {
          onStatus: (s) => setStatusText(statusToText(s, t)),
          onTranscriptionError: (err) =>
            // eslint-disable-next-line no-console
            console.warn("[record] transcription failed (recording preserved)", {
              courseId,
              lessonId: lesson.id,
              error: err.message,
            }),
        },
        user.id // authoritative owner (Cognito sub) for filing the local source
      );
      // Recording is saved regardless of transcription outcome.
      setTranscriptionFailed(!!result.transcriptionFailed);
      setTranscriptReady(!result.transcriptionFailed && !result.awaitingTranscription);
      setPhase("done");
    } catch (e) {
      // This catch now only covers a genuine SAVE failure (creating the lesson
      // or persisting the recording) — NOT a transcription failure. The captured
      // file stays on the device, but the recorder handle is already released,
      // so this screen cannot re-save it yet (known limitation).
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.warn("[record] save failed", { courseId, durationSec, error: msg });
      activeRef.current = false;
      setPhase("recording");
      Alert.alert(t.record.title, msg || t.record.recordError);
    }
  };

  // Retry transcription for the just-recorded lesson WITHOUT re-recording. The
  // preserved audio at `recordedUri` is reused. A failure again just returns to
  // the failed state; the recording is never lost.
  const retryTranscription = async () => {
    if (!createdLessonId || !recordedUri) return;
    setRetrying(true);
    try {
      const result = await retryLessonTranscription(services, createdLessonId, recordedUri, {
        onStatus: (s) => setStatusText(statusToText(s, t)),
        onTranscriptionError: (err) =>
          // eslint-disable-next-line no-console
          console.warn("[record] retry transcription failed (recording preserved)", {
            lessonId: createdLessonId,
            error: err.message,
          }),
      });
      setTranscriptionFailed(!!result.transcriptionFailed);
      setTranscriptReady(!result.transcriptionFailed && !result.awaitingTranscription);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(t.record.title, msg || t.record.recordError);
    } finally {
      setRetrying(false);
    }
  };

  // ---- processing (brief; saving the audio) ----
  if (phase === "processing") {
    return (
      <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}>
        <Stack.Screen options={{ title: t.record.title }} />
        <Loading label={statusText || t.record.processing} />
        <Muted>{t.record.processingHint}</Muted>
      </Screen>
    );
  }

  // ---- done: audio saved; transcript ready, pending (honest), or failed (retryable) ----
  if (phase === "done") {
    return (
      <Screen>
        <Stack.Screen options={{ title: t.record.title }} />
        <SectionTitle icon="recordLesson">{t.record.saved}</SectionTitle>
        <Card>
          <Body>{formatTime(elapsed)}</Body>
          <AudioPlayerButton
            uri={recordedUri}
            playLabel={t.record.playRecording}
            pauseLabel={t.record.pausePlayback}
          />
        </Card>

        {transcriptionFailed ? (
          // Transcription attempt failed, but the recording is saved + playable.
          <Card>
            <Body>{t.record.transcriptionFailed}</Body>
            <Muted>{t.record.transcriptionFailedHint}</Muted>
            <Button
              label={retrying ? t.record.retrying : t.record.retryTranscription}
              icon="recordLesson"
              onPress={retryTranscription}
              disabled={retrying}
            />
          </Card>
        ) : transcriptReady ? (
          // Real transcript persisted and the lesson is ready.
          <Card>
            <Body>{t.record.ready}</Body>
          </Card>
        ) : (
          <Card>
            <Body>{t.record.transcriptionPending}</Body>
            <Muted>{t.record.transcriptionPendingHint}</Muted>
          </Card>
        )}

        <Button
          label={t.study.openLesson}
          icon="next"
          variant="primary"
          onPress={() => createdLessonId && router.replace(`/lesson/${createdLessonId}`)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t.record.title }} />

      {phase === "setup" && (
        <>
          <SectionTitle>{t.record.selectCourse}</SectionTitle>
          {courses.length === 0 ? (
            <>
              <Muted>{t.courses.noCourses}</Muted>
              <Button
                label={t.courses.newCourse}
                icon="add"
                onPress={() => router.push("/(tabs)/courses")}
              />
            </>
          ) : (
            <Row style={{ flexWrap: "wrap" }}>
              {courses.map((c) => (
                <Button
                  key={c.id}
                  label={c.title}
                  variant={c.id === courseId ? "primary" : "secondary"}
                  onPress={() => setCourseId(c.id)}
                />
              ))}
            </Row>
          )}
          <Input value={title} onChangeText={setTitle} placeholder={t.record.lessonTitle} />
          <Card>
            <Muted>{t.record.consentNote}</Muted>
          </Card>
          <Button
            label={t.record.start}
            icon="recordLesson"
            variant="primary"
            onPress={start}
            disabled={!courseId}
          />
        </>
      )}

      {(phase === "recording" || phase === "paused") && (
        <View style={styles.recWrap}>
          <View style={[styles.dot, phase === "recording" ? styles.dotOn : styles.dotOff]} />
          <Text style={styles.timer}>{formatTime(elapsed)}</Text>
          <Body muted>{phase === "recording" ? t.record.recording : t.record.paused}</Body>
          <Row>
            {phase === "recording" ? (
              <Button label={t.record.pause} icon="pause" onPress={pause} />
            ) : (
              <Button label={t.record.resume} icon="play" onPress={resume} />
            )}
            <Button label={t.record.finish} variant="good" onPress={finish} />
          </Row>
          <Button label={t.record.discardConfirm} variant="danger" onPress={confirmDiscard} />
        </View>
      )}
    </Screen>
  );
}

function defaultTitle(): string {
  const d = new Date();
  return `Ders ${d.toLocaleDateString("tr-TR")}`;
}

function statusToText(s: string, t: ReturnType<typeof useApp>["t"]): string {
  if (s === "transcribing") return t.record.processing;
  if (s === "awaiting_transcription") return t.record.saved;
  if (s === "transcription_failed") return t.record.transcriptionFailed;
  if (s === "analyzing") return "Analiz ediliyor…";
  if (s === "ready") return t.record.ready;
  return t.record.processing;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const styles = StyleSheet.create({
  recWrap: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl },
  timer: { color: colors.text, fontSize: 56, fontWeight: fontWeight.bold, fontVariant: ["tabular-nums"] },
  dot: { width: 16, height: 16, borderRadius: 8 },
  dotOn: { backgroundColor: colors.danger },
  dotOff: { backgroundColor: colors.muted },
});
