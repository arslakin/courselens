import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { Lesson, Note } from "@rojanda/types";
import { nextSuggestion, type Suggestion } from "@rojanda/core";
import { colors, fontSize, fontWeight, radius, spacing, type IconKey } from "@rojanda/design";
import { Body, Card, Icon, IconLabel, Logo, Muted, Row, Screen, SectionTitle } from "../../src/ui";
import { Avatar } from "../../src/components/Avatar";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function HomeScreen() {
  const { t, user } = useApp();
  const services = useServices();
  const [recentLessons, setRecentLessons] = useState<Lesson[]>([]);
  const [recentNotes, setRecentNotes] = useState<Note[]>([]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      (async () => {
        const [courses, allLessons, notes, progress] = await Promise.all([
          services.courses.list(user.id),
          services.lessons.listRecent(user.id, 50),
          services.notes.list(user.id),
          services.progress.summary(user.id),
        ]);
        // "studied" = lessons that appear in the user's own quiz history.
        const studied = new Set(
          progress.quizAttempts.map((a) => a.lessonId).filter((x): x is string => !!x)
        );
        if (active) {
          setRecentLessons(allLessons.slice(0, 3));
          setRecentNotes(notes.slice(0, 3));
          setSuggestion(nextSuggestion(courses, allLessons, studied));
        }
      })();
      return () => {
        active = false;
      };
    }, [services, user])
  );

  const firstName = (user?.displayName ?? "").split(" ")[0] || "Öğrenci";
  const continueLesson = recentLessons.find((l) => l.status === "ready") ?? recentLessons[0];

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {/* Roj mark + wordmark: the app's primary branding moment (Home). */}
          <Logo size={26} />
          <Text style={styles.greeting}>{t.home.greeting(firstName)}</Text>
          <Muted>{t.tagline}</Muted>
        </View>
        <Pressable
          onPress={() => router.push("/(tabs)/profile")}
          accessibilityRole="button"
          accessibilityLabel={t.profile.title}
          hitSlop={8}
        >
          <Avatar user={user} size={40} />
        </Pressable>
      </View>

      {/* Quick actions — the fast starting point */}
      <View style={styles.captureRow}>
        <CaptureButton icon="takePhoto" label={t.home.takePhoto} onPress={() => router.push("/capture/photo")} />
        <CaptureButton icon="uploadSource" label={t.home.uploadSource} onPress={() => router.push("/capture/upload")} />
        <CaptureButton icon="recordLesson" label={t.home.recordLesson} primary onPress={() => router.push("/record")} />
      </View>

      {/* Suggested next action — derived only from the student's own activity */}
      {suggestion ? (
        <>
          <SectionTitle icon="suggestion">{t.home.suggestion}</SectionTitle>
          <Card onPress={() => onSuggestionPress(suggestion)}>
            <Row>
              <Icon name={suggestionIcon(suggestion)} size={20} color={colors.accent} />
              <Body>{suggestionLabel(suggestion, t)}</Body>
            </Row>
          </Card>
        </>
      ) : null}

      {/* Continue where you left off */}
      {continueLesson ? (
        <>
          <SectionTitle icon="podcast">{t.home.continueStudy}</SectionTitle>
          <Card onPress={() => router.push(`/lesson/${continueLesson.id}`)}>
            <Body>{continueLesson.title}</Body>
            <Muted>{statusLabel(continueLesson.status, t)}</Muted>
          </Card>
        </>
      ) : null}

      {/* Recent notes (compact) */}
      {recentNotes.length > 0 ? (
        <>
          <SectionTitle icon="notes">{t.home.recentNotes}</SectionTitle>
          {recentNotes.map((n) => (
            <Card key={n.id} onPress={() => router.push(`/note/${n.id}`)}>
              <Body>{n.title || n.body.slice(0, 40)}</Body>
              <IconLabel icon={n.kind === "voice" ? "voiceNote" : "newNote"} label={n.kind === "voice" ? "Sesli Not" : "Not"} />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );

  function onSuggestionPress(s: Suggestion) {
    switch (s.kind) {
      case "create_course":
        return router.push("/(tabs)/courses");
      case "record":
        return router.push("/record");
      case "quiz":
        return s.lesson ? router.push(`/lesson/${s.lesson.id}/quiz`) : undefined;
      case "flashcards":
        return s.lesson ? router.push(`/lesson/${s.lesson.id}/flashcards`) : undefined;
      case "review":
        return s.lesson ? router.push(`/lesson/${s.lesson.id}`) : undefined;
    }
  }
}

function suggestionIcon(s: Suggestion): IconKey {
  switch (s.kind) {
    case "create_course":
      return "add";
    case "record":
      return "recordLesson";
    case "quiz":
      return "quiz";
    case "flashcards":
      return "flashcards";
    case "review":
      return "summary";
  }
}

function suggestionLabel(s: Suggestion, t: ReturnType<typeof useApp>["t"]): string {
  const name = s.lesson?.title ?? "";
  switch (s.kind) {
    case "create_course":
      return t.home.suggestNoCourse;
    case "record":
      return t.home.suggestRecord;
    case "quiz":
      return t.home.suggestQuiz(name);
    case "flashcards":
      return t.home.suggestFlashcards(name);
    case "review":
      return t.home.suggestReview(name);
  }
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
  icon,
  label,
  onPress,
  primary,
}: {
  icon: IconKey;
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
      <Icon name={icon} size={26} color={primary ? colors.accent : colors.text} variant={primary ? "filled" : "outline"} />
      <Text style={[styles.captureLabel, primary && styles.captureLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  greeting: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.sm },
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
  captureLabel: { color: colors.text, fontSize: fontSize.xs, fontWeight: fontWeight.medium, textAlign: "center", marginTop: spacing.xs },
  captureLabelPrimary: { color: colors.accent },
});
