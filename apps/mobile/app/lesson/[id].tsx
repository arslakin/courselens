import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Lesson, Note, Source } from "@rojanda/types";
import {
  Body,
  Button,
  Card,
  IconLabel,
  Loading,
  Muted,
  Row,
  Screen,
  SectionTitle,
} from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id || !user) return;
    const l = await services.lessons.get(id);
    const [srcs, ns] = await Promise.all([
      services.sources.listByLesson(id),
      services.notes.list(user.id, { lessonId: id }),
    ]);
    setLesson(l);
    setSources(srcs);
    setNotes(ns);
    setLoading(false);
  }, [id, services, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  if (!lesson) return <Screen><Muted>{t.common.empty}</Muted></Screen>;

  const study = lesson.study;
  const ready = lesson.status === "ready" && study;
  const recording = sources.find((s) => s.kind === "recording");
  const materials = sources.filter((s) => s.kind !== "recording");
  const voiceNotes = notes.filter((n) => n.kind === "voice");
  const typedNotes = notes.filter((n) => n.kind === "typed");

  const addToNotes = async (title: string, body: string) => {
    if (!user) return;
    await services.notes.create(user.id, body, {
      title,
      courseId: lesson.courseId,
      lessonId: lesson.id,
    });
    Alert.alert(t.study.added);
    load();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: lesson.title }} />

      {/* ---- The student's OWN supplied material (clearly labeled) ---- */}
      <IconLabel icon="sources" label={t.study.fromYourSources} />

      <SectionTitle icon="uploadSource">{t.study.materials}</SectionTitle>
      {materials.length === 0 ? (
        <Muted>{t.courseWs.empty}</Muted>
      ) : (
        materials.map((s) => (
          <Card key={s.id}>
            <IconLabel icon={s.kind === "photo" ? "takePhoto" : "uploadSource"} label={s.kind.toUpperCase()} />
            {s.extractedText ? <Muted>{s.extractedText.slice(0, 120)}…</Muted> : null}
          </Card>
        ))
      )}

      <SectionTitle icon="recordLesson">{t.study.recording}</SectionTitle>
      {recording ? (
        <Card>
          <IconLabel icon="recordLesson" label={t.study.recording} />
          {lesson.durationSec ? <Muted>{Math.round(lesson.durationSec)}s</Muted> : null}
        </Card>
      ) : (
        <Muted>{t.courseWs.empty}</Muted>
      )}

      <SectionTitle icon="summary">{t.study.transcript}</SectionTitle>
      {recording?.extractedText ? (
        <Card>
          <Body>{recording.extractedText}</Body>
        </Card>
      ) : (
        <Muted>{t.courseWs.empty}</Muted>
      )}

      {/* ---- Student's own notes for this lesson ---- */}
      <SectionTitle icon="notes">{t.study.notes}</SectionTitle>
      <Row style={{ flexWrap: "wrap" }}>
        <Button
          label={t.notes.newNote}
          icon="add"
          onPress={() => router.push(`/note/new?courseId=${lesson.courseId}&lessonId=${lesson.id}`)}
        />
        <Button
          label={t.notes.voiceNote}
          icon="voiceNote"
          onPress={() => router.push(`/note/voice?courseId=${lesson.courseId}&lessonId=${lesson.id}`)}
        />
      </Row>
      {typedNotes.map((n) => (
        <Card key={n.id} onPress={() => router.push(`/note/${n.id}`)}>
          <Body>{n.title || n.body.slice(0, 60)}</Body>
        </Card>
      ))}
      {voiceNotes.length > 0 ? <SectionTitle>{t.study.voiceNotes}</SectionTitle> : null}
      {voiceNotes.map((n) => (
        <Card key={n.id} onPress={() => router.push(`/note/${n.id}`)}>
          <IconLabel icon="voiceNote" label={n.title || n.body.slice(0, 60)} />
        </Card>
      ))}

      {/* ---- AI-GENERATED study content (clearly distinguished) ---- */}
      {!ready ? (
        <Card>
          <Body>{t.record.processing}</Body>
          <Muted>{t.record.processingHint}</Muted>
        </Card>
      ) : (
        <>
          <IconLabel icon="suggestion" label={t.study.generatedByAI} />
          <Card>
            <Muted>{t.study.sourceVsGenerated}</Muted>
          </Card>

          <SectionTitle icon="summary">{t.study.summary}</SectionTitle>
          <Card>
            <Body>{study!.summary}</Body>
            <Button label={t.study.addToNotes} icon="newNote" onPress={() => addToNotes(t.study.summary, study!.summary)} />
          </Card>

          <SectionTitle icon="concepts">{t.study.concepts}</SectionTitle>
          {study!.concepts.map((c) => (
            <Card key={c.name}>
              <Body>{c.name}</Body>
              <Muted>{c.explanation}</Muted>
              <Button label={t.study.addToNotes} icon="newNote" onPress={() => addToNotes(c.name, `${c.name}: ${c.explanation}`)} />
            </Card>
          ))}

          <SectionTitle icon="explanations">{t.study.explanations}</SectionTitle>
          {study!.explanations.map((e) => (
            <Card key={e.concept}>
              <Body>{e.concept}</Body>
              <Muted>{e.plain}</Muted>
              <Button label={t.study.addToNotes} icon="newNote" onPress={() => addToNotes(e.concept, `${e.concept}\n${e.plain}`)} />
            </Card>
          ))}

          <SectionTitle>Çalışma Araçları</SectionTitle>
          <Row style={{ flexWrap: "wrap" }}>
            <Button label={t.study.flashcards} icon="flashcards" onPress={() => router.push(`/lesson/${id}/flashcards`)} />
            <Button label={t.study.quiz} icon="quiz" variant="primary" onPress={() => router.push(`/lesson/${id}/quiz`)} />
            <Button label={t.study.podcast} icon="podcast" onPress={() => router.push(`/lesson/${id}/podcast`)} />
            <Button label={t.study.ask} icon="chat" onPress={() => router.push(`/lesson/${id}/chat`)} />
          </Row>
        </>
      )}
    </Screen>
  );
}
