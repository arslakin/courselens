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
import { retryLessonTranscription } from "@rojanda/core";
import { useApp } from "../../src/app-context";
import { useServices, useTranscriptService } from "../../src/services/ServicesProvider";
import { selectLessonTranscriptText, type LessonTranscript } from "../../src/services/ApiServices";
import { AudioPlayerButton } from "../../src/audio/AudioPlayerButton";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
}

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const transcriptService = useTranscriptService();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [serverTranscripts, setServerTranscripts] = useState<LessonTranscript[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!id || !user) return;
    const l = await services.lessons.get(id);
    const [srcs, ns] = await Promise.all([
      services.sources.listByLesson(id),
      services.notes.list(user.id, { lessonId: id }),
    ]);
    // Server-persisted transcript text (authenticated). The local recording
    // source keeps the playable audio; its text may be empty after a backend
    // recovery or on another device, so the server transcript is authoritative.
    let trs: LessonTranscript[] = [];
    if (transcriptService && l?.courseId) {
      try {
        trs = await transcriptService.listByLesson(l.courseId, id);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[lesson] transcript load failed", {
          lessonId: id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setLesson(l);
    setSources(srcs);
    setNotes(ns);
    setServerTranscripts(trs);
    setLoading(false);
  }, [id, services, transcriptService, user]);

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
  const transcriptText = selectLessonTranscriptText(serverTranscripts, recording?.extractedText);
  const materials = sources.filter((s) => s.kind !== "recording");
  const voiceNotes = notes.filter((n) => n.kind === "voice");
  const typedNotes = notes.filter((n) => n.kind === "typed");

  const retryTranscriptionHere = async (uri: string) => {
    if (!id) return;
    setRetrying(true);
    try {
      await retryLessonTranscription(services, id, uri, {
        onTranscriptionError: (err) =>
          // eslint-disable-next-line no-console
          console.warn("[lesson] retry transcription failed (recording preserved)", {
            lessonId: id,
            error: err.message,
          }),
      });
      await load();
    } catch (e) {
      Alert.alert(t.record.title, e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

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
          {lesson.durationSec ? <Muted>{formatDuration(lesson.durationSec)}</Muted> : null}
          <AudioPlayerButton
            uri={recording.uri}
            playLabel={t.study.playRecording}
            pauseLabel={t.study.pausePlayback}
          />
        </Card>
      ) : (
        <Muted>{t.courseWs.empty}</Muted>
      )}

      <SectionTitle icon="summary">{t.study.transcript}</SectionTitle>
      {transcriptText ? (
        <Card>
          <Body>{transcriptText}</Body>
        </Card>
      ) : recording ? (
        // Audio exists but transcription is not connected yet — say so honestly.
        <Card>
          <Body>{t.study.transcriptPending}</Body>
          <Muted>{t.study.transcriptPendingHint}</Muted>
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
      {lesson.status === "transcription_failed" ? (
        // Recording is preserved + playable (shown above); transcription can be
        // retried without re-recording. The recording NEVER disappears here.
        <Card>
          <Body>{t.record.transcriptionFailed}</Body>
          <Muted>{t.record.transcriptionFailedHint}</Muted>
          {recording?.uri ? (
            <Button
              label={retrying ? t.record.retrying : t.record.retryTranscription}
              icon="recordLesson"
              onPress={() => retryTranscriptionHere(recording.uri!)}
              disabled={retrying}
            />
          ) : null}
        </Card>
      ) : lesson.status === "awaiting_transcription" ? (
        <Card>
          <Body>{t.record.transcriptionPending}</Body>
          <Muted>{t.record.transcriptionPendingHint}</Muted>
        </Card>
      ) : !ready ? (
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
