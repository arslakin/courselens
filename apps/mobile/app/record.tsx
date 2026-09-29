import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import type { Course } from "@rojanda/types";
import type { RecordingHandle } from "@rojanda/api";
import { processRecordedLesson } from "@rojanda/core";
import { colors, fontWeight, spacing } from "@rojanda/design";
import { Body, Button, Card, Input, Loading, Muted, Row, Screen, SectionTitle } from "../src/ui";
import { useApp } from "../src/app-context";
import { useServices } from "../src/services/ServicesProvider";

type Phase = "setup" | "recording" | "paused" | "processing";

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

  const handleRef = useRef<RecordingHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const startTimer = () => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const start = async () => {
    handleRef.current = await services.recording.start();
    setPhase("recording");
    startTimer();
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

  const finish = async () => {
    if (!user || !courseId || !handleRef.current) return;
    stopTimer();
    setPhase("processing");
    const { uri, durationSec } = await handleRef.current.stop();
    const lessonTitle = title.trim() || defaultTitle();
    const lesson = await services.lessons.create(courseId, user.id, lessonTitle);
    await processRecordedLesson(services, lesson.id, uri, durationSec, {
      onStatus: (s) => setStatusText(statusToText(s, t)),
    });
    router.replace(`/lesson/${lesson.id}`);
  };

  if (phase === "processing") {
    return (
      <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}>
        <Stack.Screen options={{ title: t.record.title }} />
        <Loading label={statusText || t.record.processing} />
        <Muted>{t.record.processingHint}</Muted>
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
            <Muted>{t.courses.noCourses}</Muted>
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
            label={`🎙️ ${t.record.start}`}
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
              <Button label={t.record.pause} onPress={pause} />
            ) : (
              <Button label={t.record.resume} onPress={resume} />
            )}
            <Button label={t.record.finish} variant="good" onPress={finish} />
          </Row>
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
  if (s === "transcribing") return "Metne dönüştürülüyor…";
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
