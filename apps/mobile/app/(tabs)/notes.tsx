import React, { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import type { Note } from "@rojanda/types";
import { Body, Button, Card, Empty, IconLabel, Row, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function NotesScreen() {
  const { t, user } = useApp();
  const services = useServices();
  const [notes, setNotes] = useState<Note[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      (async () => {
        const list = await services.notes.list(user.id);
        if (active) setNotes(list);
      })();
      return () => {
        active = false;
      };
    }, [services, user])
  );

  return (
    <Screen>
      <Row>
        <Button
          label={t.notes.newNote}
          icon="add"
          variant="primary"
          onPress={() => router.push("/note/new")}
        />
        <Button
          label={t.notes.voiceNote}
          icon="voiceNote"
          onPress={() => router.push("/note/voice")}
        />
      </Row>

      <SectionTitle>{t.notes.title}</SectionTitle>
      {notes.length === 0 ? (
        <Empty label={t.common.empty} />
      ) : (
        notes.map((n) => (
          <Card key={n.id} onPress={() => router.push(`/note/${n.id}`)}>
            <Body>{n.title || n.body.slice(0, 48)}</Body>
            <IconLabel icon={n.kind === "voice" ? "voiceNote" : "newNote"} label={n.kind === "voice" ? "Sesli Not" : "Not"} />
          </Card>
        ))
      )}
    </Screen>
  );
}
