import React, { useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, IconLabel, Input, Screen } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function NewNoteScreen() {
  const params = useLocalSearchParams<{ courseId?: string; lessonId?: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const save = async () => {
    if (!user || !body.trim()) return;
    await services.notes.create(user.id, body.trim(), {
      title: title.trim() || undefined,
      courseId: params.courseId,
      lessonId: params.lessonId,
      kind: "typed",
    });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.notes.newNote }} />
      <Input value={title} onChangeText={setTitle} placeholder={t.notes.noteTitle} />
      <Input
        value={body}
        onChangeText={setBody}
        placeholder={t.notes.typeHere}
        multiline
        style={{ minHeight: 160, textAlignVertical: "top" }}
      />
      {params.courseId ? <IconLabel icon="correct" label={t.notes.associatedCourse} /> : null}
      {params.lessonId ? <IconLabel icon="correct" label={t.notes.associatedLesson} /> : null}
      <Button label={t.common.save} variant="primary" onPress={save} disabled={!body.trim()} />
    </Screen>
  );
}
