import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { colors, spacing } from "@rojanda/design";
import { Body, Button, Card, Input, Muted, Row, Screen } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

type Phase = "idle" | "listening" | "transcribing" | "editing";

/**
 * Sesli Not — a QUICK spoken personal note (different from Dersi Kaydet, which
 * records and processes a whole lesson). Speech is captured, transcribed
 * (mock), placed into an editable note, and saved under the current
 * course/lesson if provided.
 */
export default function VoiceNoteScreen() {
  const params = useLocalSearchParams<{ courseId?: string; lessonId?: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");

  const startListening = () => setPhase("listening");

  const stopAndTranscribe = async () => {
    setPhase("transcribing");
    const transcript = await services.transcription.transcribeVoiceNote("mock://voice");
    setText(transcript ?? "");
    setPhase("editing");
  };

  const save = async () => {
    if (!user || !text.trim()) return;
    await services.notes.create(user.id, text.trim(), {
      courseId: params.courseId,
      lessonId: params.lessonId,
      kind: "voice",
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.notes.voiceNote }} />
      <Muted>{t.notes.voiceHint}</Muted>
      <Card>
        <Muted>{t.notes.voiceExample}</Muted>
      </Card>

      {phase === "idle" && (
        <Button label={t.notes.voiceNote} icon="voiceNote" variant="primary" onPress={startListening} />
      )}

      {phase === "listening" && (
        <View style={styles.center}>
          <View style={styles.dot} />
          <Body>{t.notes.voiceRecording}</Body>
          <Button label={t.record.finish} variant="good" onPress={stopAndTranscribe} />
        </View>
      )}

      {phase === "transcribing" && <Muted>{t.notes.transcribing}</Muted>}

      {phase === "editing" && (
        <>
          <Input
            value={text}
            onChangeText={setText}
            multiline
            style={{ minHeight: 140, textAlignVertical: "top" }}
            placeholder={t.notes.typeHere}
          />
          <Row>
            <Button label={t.common.save} variant="primary" onPress={save} disabled={!text.trim()} />
            <Button label={t.common.retry} onPress={() => { setText(""); setPhase("idle"); }} />
          </Row>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.danger },
});
