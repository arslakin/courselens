import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { ChatMessage } from "@rojanda/types";
import type { ChatMode } from "@rojanda/api";
import { colors, fontSize, fontWeight, radius, spacing } from "@rojanda/design";
import { Body, Button, Input, Muted, Row, Screen } from "../../../src/ui";
import { useApp } from "../../../src/app-context";
import { useServices } from "../../../src/services/ServicesProvider";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const services = useServices();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ChatMode>("sources");
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      services.chat.history(id).then((h) => {
        if (active) setMessages(h);
      });
      return () => {
        active = false;
      };
    }, [id, services])
  );

  const send = async () => {
    if (!id || !text.trim() || busy) return;
    const q = text.trim();
    setText("");
    setBusy(true);
    await services.chat.ask(id, q, mode);
    setMessages(await services.chat.history(id));
    setBusy(false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.chat.title }} />

      {/* Mode toggle — grounded by default; external is explicit + separate. */}
      <Row>
        <Button
          label={t.chat.modeSources}
          icon="sources"
          variant={mode === "sources" ? "primary" : "secondary"}
          onPress={() => setMode("sources")}
        />
        <Button
          label={t.chat.modeExternal}
          icon="external"
          variant={mode === "external" ? "primary" : "secondary"}
          onPress={() => setMode("external")}
        />
      </Row>
      {mode === "external" ? <Muted>{t.chat.externalDisabled}</Muted> : null}

      {messages.map((m) => (
        <View
          key={m.id}
          style={[styles.bubble, m.role === "user" ? styles.user : styles.assistant]}
        >
          {m.role === "assistant" && m.provenance ? (
            <Text style={[styles.tag, m.provenance === "external" ? styles.tagExternal : styles.tagGrounded]}>
              {m.provenance === "external" ? t.chat.externalLabel : t.chat.groundedLabel}
            </Text>
          ) : null}
          <Body>{m.text}</Body>
        </View>
      ))}

      <Input
        value={text}
        onChangeText={setText}
        placeholder={t.chat.placeholder}
        onSubmitEditing={send}
        returnKeyType="send"
        editable={!busy}
      />
      <Button label={busy ? t.common.loading : t.study.ask} variant="primary" onPress={send} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: { borderRadius: radius.md, padding: spacing.md, borderWidth: 1 },
  user: { backgroundColor: colors.surface2, borderColor: colors.border, alignSelf: "flex-end", maxWidth: "90%" },
  assistant: { backgroundColor: colors.surface, borderColor: colors.border, alignSelf: "flex-start", maxWidth: "95%" },
  tag: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, marginBottom: spacing.xs },
  tagGrounded: { color: colors.accent },
  tagExternal: { color: colors.accent2 },
});
