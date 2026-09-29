import React, { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams, Stack } from "expo-router";
import type { Course, Lesson, Note } from "@rojanda/types";
import { Body, Button, Card, Empty, Muted, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!id || !user) return;
      let active = true;
      (async () => {
        const [c, ls, ns] = await Promise.all([
          services.courses.get(id),
          services.lessons.listByCourse(id),
          services.notes.list(user.id, { courseId: id }),
        ]);
        if (active) {
          setCourse(c);
          setLessons(ls);
          setNotes(ns);
        }
      })();
      return () => {
        active = false;
      };
    }, [id, services, user])
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: course?.title ?? t.courses.title }} />

      <Button
        label={`🎙️ ${t.home.recordLesson}`}
        variant="primary"
        onPress={() => router.push(`/record?courseId=${id}`)}
      />

      <SectionTitle>{t.courses.lessons}</SectionTitle>
      {lessons.length === 0 ? (
        <Empty label={t.courses.noLessons} />
      ) : (
        lessons.map((l) => (
          <Card key={l.id} onPress={() => router.push(`/lesson/${l.id}`)}>
            <Body>{l.title}</Body>
            <Muted>{l.status === "ready" ? t.record.ready : t.record.processing}</Muted>
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
