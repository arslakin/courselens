import React, { useCallback, useState } from "react";
import { Alert } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Note } from "@rojanda/types";
import { Button, Input, Loading, Muted, Row, Screen } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

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
    await services.notes.update(id, { title: title.trim() || undefined, body });
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
