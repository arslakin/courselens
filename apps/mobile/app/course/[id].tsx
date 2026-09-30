import React, { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams, Stack } from "expo-router";
import type { Course, Lesson, Note } from "@rojanda/types";
import { colors, fontSize, fontWeight, radius, spacing, type IconKey } from "@rojanda/design";
import {
  Body,
  Button,
  Card,
  Empty,
  Icon,
  IconLabel,
  Input,
  Muted,
  Row,
  Screen,
  SectionTitle,
} from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

/** A course-workspace section tile (icon + count + label). */
function WsTile({ icon, label, count }: { icon: IconKey; label: string; count: number }) {
  return (
    <View style={styles.tile}>
      <Icon name={icon} size={20} color={colors.accent} />
      <Text style={styles.tileCount}>{count}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sourceCount, setSourceCount] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");

  const load = useCallback(async () => {
    if (!id || !user) return;
    const [c, ls, ns] = await Promise.all([
      services.courses.get(id),
      services.lessons.listByCourse(id),
      services.notes.list(user.id, { courseId: id }),
    ]);
    // Sources are stored per-lesson; sum across this course's lessons only,
    // so counts reflect ONLY this course's own material.
    let sources = 0;
    for (const l of ls) sources += (await services.sources.listByLesson(l.id)).length;
    setCourse(c);
    setLessons(ls);
    setNotes(ns);
    setSourceCount(sources);
  }, [id, services, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const saveRename = async () => {
    if (!id || !renameText.trim()) return;
    await services.courses.rename(id, renameText.trim());
    setRenaming(false);
    load();
  };

  const deleteCourse = () => {
    if (!id) return;
    Alert.alert(t.courses.deleteCourse, t.courses.deleteConfirm, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.common.delete,
        style: "destructive",
        onPress: async () => {
          // Remove the course's lessons + notes, then the course itself.
          for (const l of lessons) await services.lessons.remove(l.id);
          for (const n of notes) await services.notes.remove(n.id);
          await services.courses.remove(id);
          router.back();
        },
      },
    ]);
  };

  const deleteLesson = (lessonId: string) => {
    Alert.alert(t.courses.deleteLesson, t.courses.deleteLessonConfirm, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.common.delete,
        style: "destructive",
        onPress: async () => {
          await services.lessons.remove(lessonId);
          load();
        },
      },
    ]);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: course?.title ?? t.courses.title }} />

      {renaming ? (
        <Card>
          <Input value={renameText} onChangeText={setRenameText} placeholder={t.courses.courseName} />
          <Row>
            <Button label={t.common.save} variant="primary" onPress={saveRename} />
            <Button label={t.common.cancel} onPress={() => setRenaming(false)} />
          </Row>
        </Card>
      ) : (
        <Row style={{ flexWrap: "wrap" }}>
          <Button
            label={t.courses.rename}
            icon="newNote"
            onPress={() => {
              setRenameText(course?.title ?? "");
              setRenaming(true);
            }}
          />
          <Button label={t.courses.deleteCourse} variant="danger" onPress={deleteCourse} />
        </Row>
      )}

      <Button
        label={t.home.recordLesson}
        icon="recordLesson"
        variant="primary"
        onPress={() => router.push(`/record?courseId=${id}`)}
      />

      {/* Course workspace — everything below is scoped to THIS course only. */}
      {(() => {
        const ready = lessons.filter((l) => l.status === "ready" && l.study);
        const summaries = ready.length;
        const flashcards = ready.reduce((s, l) => s + (l.study!.flashcards?.length ?? 0), 0);
        const quizzes = ready.filter((l) => (l.study!.quiz?.questions.length ?? 0) > 0).length;
        const podcasts = ready.filter((l) => l.study!.podcast).length;
        const sections: { icon: Parameters<typeof WsTile>[0]["icon"]; label: string; count: number }[] = [
          { icon: "uploadSource", label: t.courseWs.sources, count: sourceCount },
          { icon: "recordLesson", label: t.courseWs.recordings, count: lessons.length },
          { icon: "summary", label: t.courseWs.summaries, count: summaries },
          { icon: "notes", label: t.courseWs.notes, count: notes.length },
          { icon: "flashcards", label: t.courseWs.flashcards, count: flashcards },
          { icon: "quiz", label: t.courseWs.quizzes, count: quizzes },
          { icon: "podcast", label: t.courseWs.podcasts, count: podcasts },
        ];
        return (
          <View style={styles.tiles}>
            {sections.map((s) => (
              <WsTile key={s.label} icon={s.icon} label={s.label} count={s.count} />
            ))}
          </View>
        );
      })()}

      <SectionTitle>{t.courses.lessons}</SectionTitle>
      {lessons.length === 0 ? (
        <Empty label={t.courses.noLessons} />
      ) : (
        lessons.map((l) => (
          <Card key={l.id}>
            <Body>{l.title}</Body>
            <IconLabel
              icon={l.status === "ready" ? "correct" : l.status === "transcription_failed" ? "uploadSource" : "podcast"}
              label={
                l.status === "ready"
                  ? t.record.ready
                  : l.status === "transcription_failed"
                    ? t.record.transcriptionFailed
                    : t.record.processing
              }
            />
            <Row style={{ flexWrap: "wrap" }}>
              <Button label={t.courses.openCourse} onPress={() => router.push(`/lesson/${l.id}`)} />
              <Button label={t.courses.deleteLesson} variant="danger" onPress={() => deleteLesson(l.id)} />
            </Row>
          </Card>
        ))
      )}

      <SectionTitle>{t.courses.notes}</SectionTitle>
      {notes.length === 0 ? (
        <Muted>{t.common.empty}</Muted>
      ) : (
        notes.map((n) => (
          <Card key={n.id} onPress={() => router.push(`/note/${n.id}`)}>
            <Body>{n.title || n.body.slice(0, 48)}</Body>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexBasis: "30%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
    alignItems: "flex-start",
  },
  tileCount: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  tileLabel: { color: colors.muted, fontSize: fontSize.xs },
});
