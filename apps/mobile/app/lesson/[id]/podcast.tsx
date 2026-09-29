import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Podcast } from "@rojanda/types";
import { colors, radius, spacing } from "@rojanda/design";
import { Body, Button, Card, Icon, Loading, Muted, Screen } from "../../../src/ui";
import { useApp } from "../../../src/app-context";
import { useServices } from "../../../src/services/ServicesProvider";

export default function PodcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useApp();
  const services = useServices();
  const [podcast, setPodcast] = useState<Podcast | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      (async () => {
        const l = await services.lessons.get(id);
        if (active) setPodcast(l?.study?.podcast ?? null);
      })();
      return () => {
        active = false;
      };
    }, [id, services])
  );

  if (podcast === undefined)
    return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: t.podcast.title }} />
      <View style={styles.heroWrap}>
        <Icon name="podcast" size={44} color={colors.accent} variant="filled" />
      </View>
      <Body>{t.podcast.subtitle}</Body>

      <Card>
        {/* Placeholder player — real Polly audio comes later. */}
        <View style={styles.player}>
          <Button
            label={playing ? t.podcast.pause : t.podcast.play}
            icon={playing ? "pause" : "play"}
            variant="primary"
            onPress={() => setPlaying((p) => !p)}
          />
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: playing ? "40%" : "0%" }]} />
          </View>
          <Muted>{podcast ? `${podcast.durationSec ?? 60}s` : "—"}</Muted>
        </View>
        <Muted>{t.podcast.placeholder}</Muted>
      </Card>

      {podcast ? (
        <Card>
          <Muted>Metin (özet):</Muted>
          <Body>{podcast.script}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroWrap: { alignItems: "center", paddingVertical: spacing.md },
  player: { gap: spacing.sm },
  progressTrack: { height: 6, backgroundColor: colors.surface2, borderRadius: radius.pill, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.accent },
});
