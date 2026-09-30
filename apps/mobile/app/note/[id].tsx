import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Note } from "@rojanda/types";
import { Body, Button, Card, Input, Loading, Muted, Row, Screen } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";
import { AudioPlayerButton } from "../../src/audio/AudioPlayerButton";

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const services = useServices();
  const [note, setNote] = useState<Note | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      (async () => {
        const n = await services.notes.get(id);
        if (active) {
          setNote(n);
          setTitle(n?.title ?? "");
          setBody(n?.body ?? "");
        }
      })();
      return () => {
        active = false;
      };
    }, [id, services])
  );

  if (note === undefined)
    return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  if (note === null) return <Screen><Muted>{t.common.empty}</Muted></Screen>;

  const save = async () => {
    if (!id) return;
    // Once the student writes text, the note is no longer awaiting a transcript.
    const patch: Partial<Note> = { title: title.trim() || undefined, body };
    if (body.trim().length > 0) patch.transcriptionPending = false;
    await services.notes.update(id, patch);
    Alert.alert(t.notes.saved);
  };
  const remove = async () => {
    if (!id) return;
    await services.notes.remove(id);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: note.kind === "voice" ? t.notes.voiceNote : t.notes.title }} />

      {/* Voice note: play the preserved original audio. */}
      {note.audioUri ? (
        <Card>
          <AudioPlayerButton
            uri={note.audioUri}
            playLabel={t.notes.voicePlay}
            pauseLabel={t.notes.voicePause}
          />
        </Card>
      ) : null}

      {/* Honest transcription-pending notice when there's audio but no text. */}
      {note.kind === "voice" && note.transcriptionPending ? (
        <Card>
          <Body>{t.notes.voiceTranscriptionPending}</Body>
          <Muted>{t.notes.voiceTranscriptionPendingHint}</Muted>
        </Card>
      ) : null}

      <Input value={title} onChangeText={setTitle} placeholder={t.notes.noteTitle} />
      <Input
        value={body}
        onChangeText={setBody}
        placeholder={t.notes.typeHere}
        multiline
        style={{ minHeight: 200, textAlignVertical: "top" }}
      />
      <Row>
        <Button label={t.common.save} variant="primary" onPress={save} />
        <Button label={t.common.delete} variant="danger" onPress={remove} />
      </Row>
    </Screen>
  );
}
