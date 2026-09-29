import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { Lesson, Note } from "@rojanda/types";
import { colors, fontSize, fontWeight, radius, spacing, TOUCH_TARGET } from "@rojanda/design";
import { Body, Card, Muted, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function HomeScreen() {
  const { t, user } = useApp();
  const services = useServices();
  const [recentLessons, setRecentLessons] = useState<Lesson[]>([]);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      (async () => {
        const [lessons, notes] = await Promise.all([
          services.lessons.listRecent(user.id, 3),
          services.notes.list(user.id),
        ]);
        if (active) {
          setRecentLessons(lessons);
          setRecentNotes(notes.slice(0, 3));
        }
      })();
      return () => {
        active = false;
      };
    }, [services, user])
  );

  return (
    <Screen>
      <Text style={styles.hero}>{t.appName}</Text>
      <Muted>{t.tagline}</Muted>

      <View style={styles.captureRow}>
        <CaptureButton
          emoji="📷"
          label={t.home.takePhoto}
          onPress={() => router.push("/capture/photo")}
        />
        <CaptureButton
          emoji="📁"
          label={t.home.uploadSource}
          onPress={() => router.push("/capture/upload")}
        />
        <CaptureButton
          emoji="🎙️"
          label={t.home.recordLesson}
          primary
          onPress={() => router.push("/record")}
        />
      </View>

      <View style={styles.quickRow}>
        <Card style={styles.quick} onPress={() => router.push("/(tabs)/courses")}>
          <Text style={styles.quickEmoji}>📚</Text>
          <Body>{t.home.myCourses}</Body>
        </Card>
        <Card style={styles.quick} onPress={() => router.push("/(tabs)/notes")}>
          <Text style={styles.quickEmoji}>📝</Text>
          <Body>{t.home.myNotes}</Body>
        </Card>
      </View>

      <SectionTitle>{t.home.recentLessons}</SectionTitle>
      {recentLessons.length === 0 ? (
        <Muted>{t.home.noRecentLessons}</Muted>
      ) : (
        recentLessons.map((l) => (
          <Card key={l.id} onPress={() => router.push(`/lesson/${l.id}`)}>
            <Body>{l.title}</Body>
            <Muted>{statusLabel(l.status, t)}</Muted>
          </Card>
        ))
      )}

      <SectionTitle>{t.home.recentNotes}</SectionTitle>
      {recentNotes.length === 0 ? (
        <Muted>{t.home.noRecentNotes}</Muted>
      ) : (
        recentNotes.map((n) => (
          <Card key={n.id} onPress={() => router.push(`/note/${n.id}`)}>
            <Body>{n.title || n.body.slice(0, 40)}</Body>
            <Muted>{n.kind === "voice" ? "🎙️ Sesli Not" : "📝 Not"}</Muted>
          </Card>
        ))
      )}
    </Screen>
  );
}

function statusLabel(status: Lesson["status"], t: ReturnType<typeof useApp>["t"]): string {
  switch (status) {
    case "ready":
      return t.record.ready;
    case "analyzing":
    case "transcribing":
    case "transcribed":
    case "uploaded":
      return t.record.processing;
    default:
      return "Taslak";
  }
}

function CaptureButton({
  emoji,
  label,
  onPress,
  primary,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.capture,
        primary && styles.capturePrimary,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={styles.captureEmoji}>{emoji}</Text>
      <Text style={[styles.captureLabel, primary && styles.captureLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { color: colors.text, fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  captureRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  capture: {
    flex: 1,
    minHeight: 96,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    gap: spacing.xs,
  },
  capturePrimary: { borderColor: colors.accent },
  captureEmoji: { fontSize: 28 },
  captureLabel: { color: colors.text, fontSize: fontSize.xs, fontWeight: fontWeight.medium, textAlign: "center" },
  captureLabelPrimary: { color: colors.accent },
  quickRow: { flexDirection: "row", gap: spacing.sm },
  quick: { flex: 1, minHeight: TOUCH_TARGET, alignItems: "flex-start" },
  quickEmoji: { fontSize: 22 },
});
