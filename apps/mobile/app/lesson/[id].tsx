import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Lesson } from "@rojanda/types";
import { Body, Button, Card, Loading, Muted, Row, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      (async () => {
        const l = await services.lessons.get(id);
        if (active) {
          setLesson(l);
          setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [id, services])
  );

  if (loading) return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  if (!lesson) return <Screen><Muted>{t.common.empty}</Muted></Screen>;

  const study = lesson.study;
  const ready = lesson.status === "ready" && study;

  const addToNotes = async (title: string, body: string) => {
    if (!user) return;
    await services.notes.create(user.id, body, {
      title,
      courseId: lesson.courseId,
      lessonId: lesson.id,
    });
    Alert.alert(t.study.added);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: lesson.title }} />

      {!ready ? (
        <Card>
          <Body>{t.record.processing}</Body>
          <Muted>{t.record.processingHint}</Muted>
        </Card>
      ) : (
        <>
          {/* Ders Özeti */}
          <SectionTitle>📝 {t.study.summary}</SectionTitle>
          <Card>
            <Body>{study!.summary}</Body>
            <Button label={t.study.addToNotes} onPress={() => addToNotes(t.study.summary, study!.summary)} />
          </Card>

          {/* Ana Kavramlar */}
          <SectionTitle>🧠 {t.study.concepts}</SectionTitle>
          {study!.concepts.map((c) => (
            <Card key={c.name}>
              <Body>{c.name}</Body>
              <Muted>{c.explanation}</Muted>
              <Button
                label={t.study.addToNotes}
                onPress={() => addToNotes(c.name, `${c.name}: ${c.explanation}`)}
              />
            </Card>
          ))}

          {/* Açıklamalar */}
          <SectionTitle>💡 {t.study.explanations}</SectionTitle>
          {study!.explanations.map((e) => (
            <Card key={e.concept}>
              <Body>{e.concept}</Body>
              <Muted>{e.plain}</Muted>
              <Button
                label={t.study.addToNotes}
                onPress={() => addToNotes(e.concept, `${e.concept}\n${e.plain}`)}
              />
            </Card>
          ))}

          {/* Navigation to interactive/other tools */}
          <SectionTitle>Çalışma Araçları</SectionTitle>
          <Row style={{ flexWrap: "wrap" }}>
            <Button label={`🃏 ${t.study.flashcards}`} onPress={() => router.push(`/lesson/${id}/flashcards`)} />
            <Button label={`❓ ${t.study.quiz}`} variant="primary" onPress={() => router.push(`/lesson/${id}/quiz`)} />
            <Button label={`🎧 ${t.study.podcast}`} onPress={() => router.push(`/lesson/${id}/podcast`)} />
            <Button label={`💬 ${t.study.ask}`} onPress={() => router.push(`/lesson/${id}/chat`)} />
            <Button
              label={`📝 ${t.study.notes}`}
              onPress={() => router.push(`/note/new?courseId=${lesson.courseId}&lessonId=${lesson.id}`)}
            />
          </Row>
        </>
      )}
    </Screen>
  );
}
