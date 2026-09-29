import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Flashcard } from "@rojanda/types";
import { colors, fontSize, fontWeight, radius, spacing } from "@rojanda/design";
import { Button, Empty, Loading, Muted, Row, Screen } from "../../../src/ui";
import { useApp } from "../../../src/app-context";
import { useServices } from "../../../src/services/ServicesProvider";

export default function FlashcardsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const services = useServices();
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [states, setStates] = useState<Record<string, Flashcard["state"]>>({});

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      (async () => {
        const l = await services.lessons.get(id);
        if (active) setCards(l?.study?.flashcards ?? []);
      })();
      return () => {
        active = false;
      };
    }, [id, services])
  );

  if (cards === null)
    return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  if (cards.length === 0) return <Screen><Empty label={t.common.empty} /></Screen>;

  const card = cards[index];
  const mark = async (state: Flashcard["state"]) => {
    setStates((s) => ({ ...s, [card.id]: state }));
    if (id) await services.flashcards.mark(id, card.id, state);
    goNext();
  };
  const goNext = () => {
    setRevealed(false);
    setIndex((i) => (i + 1) % cards.length);
  };
  const goPrev = () => {
    setRevealed(false);
    setIndex((i) => (i - 1 + cards.length) % cards.length);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.study.flashcards }} />
      <Muted>{t.flashcards.progress(index + 1, cards.length)}</Muted>

      <Pressable
        onPress={() => setRevealed((r) => !r)}
        accessibilityRole="button"
        accessibilityLabel={revealed ? "Kart ön yüzü" : t.flashcards.showAnswer}
        style={styles.card}
      >
        <Text style={styles.face}>{revealed ? card.back : card.front}</Text>
        {!revealed ? <Muted>{t.flashcards.showAnswer}</Muted> : null}
        {states[card.id] ? (
          <Text style={styles.badge}>
            {states[card.id] === "known" ? `✓ ${t.flashcards.known}` : `↻ ${t.flashcards.review}`}
          </Text>
        ) : null}
      </Pressable>

      <Row>
        <Button label={t.common.previous} onPress={goPrev} />
        <Button label={t.common.next} onPress={goNext} />
      </Row>
      <Row>
        <Button label={`✓ ${t.flashcards.known}`} variant="good" onPress={() => mark("known")} />
        <Button label={`↻ ${t.flashcards.review}`} variant="secondary" onPress={() => mark("review")} />
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 200,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  face: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium, textAlign: "center" },
  badge: { color: colors.accent, fontSize: fontSize.xs },
});
