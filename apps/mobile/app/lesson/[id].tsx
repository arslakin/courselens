import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Lesson, Note, ServerStudySet, Source } from "@rojanda/types";
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
import { useServices, useStudyService, useTranscriptService } from "../../src/services/ServicesProvider";
import { selectLessonTranscriptText, type LessonTranscript } from "../../src/services/ApiServices";
import { AudioPlayerButton } from "../../src/audio/AudioPlayerButton";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
}

/**
 * Choose which server study set to surface for the lesson. Prefers a READY set,
 * otherwise the most recently updated one (so an in-flight "generating" or a
 * "failed" state is still shown). Never fabricates — returns null when empty.
 */
function pickNewestStudy(sets: ServerStudySet[]): ServerStudySet | null {
  if (!sets || sets.length === 0) return null;
  const byUpdated = [...sets].sort((a, b) =>
    (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")
  );
  return byUpdated.find((s) => s.status === "ready") ?? byUpdated[0];
}

export default function LessonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const transcriptService = useTranscriptService();
  const studyService = useStudyService();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [serverTranscripts, setServerTranscripts] = useState<LessonTranscript[]>([]);
  const [serverStudy, setServerStudy] = useState<ServerStudySet | null>(null);
  const [generating, setGenerating] = useState(false);
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
    // Server-persisted, grounded study materials (Phase 2). Read-only: this
    // NEVER triggers generation. The newest item for the lesson is shown.
    let study: ServerStudySet | null = null;
    if (studyService && l?.courseId) {
      try {
        const sets = await studyService.listByLesson(l.courseId, id);
        study = pickNewestStudy(sets);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[lesson] study load failed", {
          lessonId: id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setLesson(l);
    setSources(srcs);
    setNotes(ns);
    setServerTranscripts(trs);
    setServerStudy(study);
    setLoading(false);
  }, [id, services, transcriptService, studyService, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Re-read ONLY the server study materials (read-only; never triggers
  // generation). Used by the polling loop while a background job runs.
  const lessonCourseId = lesson?.courseId;
  const refreshStudy = useCallback(async () => {
    if (!studyService || !id || !lessonCourseId) return;
    try {
      const sets = await studyService.listByLesson(lessonCourseId, id);
      setServerStudy(pickNewestStudy(sets));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[lesson] study poll failed", {
        lessonId: id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, [studyService, id, lessonCourseId]);

  // POLLING: while a study set is "generating" (async backend job in flight),
  // poll GET /study every few seconds until it reaches ready/failed. Bounded by
  // a max attempt count so a stuck job never polls forever. Clears on unmount,
  // on status change, or when the attempt budget is exhausted.
  const pollAttemptsRef = useRef(0);
  const isGeneratingStatus = serverStudy?.status === "generating";
  useEffect(() => {
    if (!isGeneratingStatus) {
      pollAttemptsRef.current = 0;
      return;
    }
    const POLL_INTERVAL_MS = 4000;
    const MAX_POLLS = 90; // ~6 min ceiling (covers a full ~50-min lesson job)
    let cancelled = false;
    const timer = setInterval(() => {
      pollAttemptsRef.current += 1;
      if (cancelled) return;
      if (pollAttemptsRef.current > MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      refreshStudy();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isGeneratingStatus, refreshStudy]);

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

  // Generate (or regenerate) the grounded server study materials. Idempotent on
  // the backend: a plain tap returns the existing ready set without a new model
  // call; `force` is only used to refresh after the transcript changed.
  const generateServerStudy = async (force = false) => {
    if (!studyService || !lesson) return;
    setGenerating(true);
    try {
      const result = await studyService.generate(lesson.courseId, lesson.id, { force });
      setServerStudy(result);
    } catch (e) {
      Alert.alert(t.study.materialsTitle, e instanceof Error ? e.message : t.study.generateError);
    } finally {
      setGenerating(false);
    }
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

      {/* ---- Server-persisted grounded study materials (Phase 2) ----
           Shown only in API-persistence mode and only once a transcript exists.
           The transcript above is NEVER hidden or replaced by this section. */}
      {studyService && transcriptText ? (
        <>
          <SectionTitle icon="suggestion">{t.study.materialsTitle}</SectionTitle>
          <Card>
            <Muted>{t.study.fromYourSources}</Muted>
          </Card>

          {generating || serverStudy?.status === "generating" ? (
            // GENERATING state.
            <Card>
              <Body>{t.study.generating}</Body>
              <Muted>{t.study.generatingHint}</Muted>
              <Loading />
            </Card>
          ) : serverStudy?.status === "failed" ? (
            // FAILED state — retryable, nothing fabricated.
            <Card>
              <Body>{t.study.failed}</Body>
              <Muted>{t.study.failedHint}</Muted>
              <Button
                label={t.common.retry}
                icon="suggestion"
                onPress={() => generateServerStudy(false)}
                disabled={generating}
              />
            </Card>
          ) : serverStudy?.status === "ready" ? (
            // READY state — persisted content, loaded without a new model call.
            <>
              {serverStudy.stale ? (
                <Card>
                  <Body>{t.study.stale}</Body>
                  <Muted>{t.study.staleHint}</Muted>
                  <Button
                    label={t.study.regenerate}
                    icon="suggestion"
                    onPress={() => generateServerStudy(true)}
                    disabled={generating}
                  />
                </Card>
              ) : null}

              {serverStudy.summary ? (
                <>
                  <SectionTitle icon="summary">{t.study.summary}</SectionTitle>
                  <Card>
                    <Body>{serverStudy.summary}</Body>
                    <Button
                      label={t.study.addToNotes}
                      icon="newNote"
                      onPress={() => addToNotes(t.study.summary, serverStudy.summary!)}
                    />
                  </Card>
                </>
              ) : null}

              {serverStudy.concepts && serverStudy.concepts.length > 0 ? (
                <>
                  <SectionTitle icon="concepts">{t.study.keyConcepts}</SectionTitle>
                  {serverStudy.concepts.map((c, i) => (
                    <Card key={`${c.name}-${i}`}>
                      <Body>{c.name}</Body>
                      <Muted>{c.explanation}</Muted>
                      <Button
                        label={t.study.addToNotes}
                        icon="newNote"
                        onPress={() => addToNotes(c.name, `${c.name}: ${c.explanation}`)}
                      />
                    </Card>
                  ))}
                </>
              ) : null}

              {serverStudy.flashcards && serverStudy.flashcards.length > 0 ? (
                <>
                  <SectionTitle icon="flashcards">{t.study.cards}</SectionTitle>
                  {serverStudy.flashcards.map((f, i) => (
                    <Card key={`${f.front}-${i}`}>
                      <Body>{f.front}</Body>
                      <Muted>{f.back}</Muted>
                    </Card>
                  ))}
                </>
              ) : null}

              {serverStudy.quiz && serverStudy.quiz.length > 0 ? (
                <>
                  <SectionTitle icon="quiz">{t.study.quiz}</SectionTitle>
                  {serverStudy.quiz.map((q, i) => (
                    <Card key={`${q.prompt}-${i}`}>
                      <Body>{q.prompt}</Body>
                      {q.options.map((o, oi) => (
                        <Muted key={oi}>
                          {oi === q.correctIndex ? "✓ " : "• "}
                          {o}
                        </Muted>
                      ))}
                      <Muted>{q.explanation}</Muted>
                    </Card>
                  ))}
                </>
              ) : null}

              <Row style={{ flexWrap: "wrap" }}>
                <Button
                  label={t.study.regenerate}
                  icon="suggestion"
                  onPress={() => generateServerStudy(true)}
                  disabled={generating}
                />
              </Row>
            </>
          ) : (
            // NOT GENERATED state — explicit opt-in so no model call happens
            // without the student's action (no accidental AI spend).
            <Card>
              <Body>{t.study.notGenerated}</Body>
              <Muted>{t.study.notGeneratedHint}</Muted>
              <Button
                label={t.study.generate}
                icon="suggestion"
                variant="primary"
                onPress={() => generateServerStudy(false)}
                disabled={generating}
              />
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}
