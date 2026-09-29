import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams, Stack } from "expo-router";
import type { Course, Lesson, Note } from "@rojanda/types";
import {
  Body,
  Button,
  Card,
  Empty,
  IconLabel,
  Input,
  Muted,
  Row,
  Screen,
  SectionTitle,
} from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");

  const load = useCallback(async () => {
    if (!id || !user) return;
    const [c, ls, ns] = await Promise.all([
      services.courses.get(id),
      services.lessons.listByCourse(id),
      services.notes.list(user.id, { courseId: id }),
    ]);
    setCourse(c);
    setLessons(ls);
    setNotes(ns);
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

      <SectionTitle>{t.courses.lessons}</SectionTitle>
      {lessons.length === 0 ? (
        <Empty label={t.courses.noLessons} />
      ) : (
        lessons.map((l) => (
          <Card key={l.id}>
            <Body>{l.title}</Body>
            <IconLabel
              icon={l.status === "ready" ? "correct" : "podcast"}
              label={l.status === "ready" ? t.record.ready : t.record.processing}
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
