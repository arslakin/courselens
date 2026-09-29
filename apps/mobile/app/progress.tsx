import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import type { ProgressSummary } from "@rojanda/types";
import { colors, fontSize, fontWeight, spacing } from "@rojanda/design";
import { Body, Card, IconLabel, Loading, Muted, Row, Screen, SectionTitle } from "../src/ui";
import { useApp } from "../src/app-context";
import { useServices } from "../src/services/ServicesProvider";

export default function ProgressScreen() {
  const { t, user } = useApp();
  const services = useServices();
  const [summary, setSummary] = useState<ProgressSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      services.progress.summary(user.id).then((s) => {
        if (active) setSummary(s);
      });
      return () => {
        active = false;
      };
    }, [services, user])
  );

  if (!summary) {
    return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t.progress.title }} />
      <Muted>{t.progress.encouraging}</Muted>

      {/* Stat tiles — plain counts of the student's own activity */}
      <View style={styles.tiles}>
        <Stat value={summary.coursesCount} label={t.progress.coursesStudied} />
        <Stat value={summary.lessonsReady} label={t.progress.lessonsCompleted} />
        <Stat value={summary.flashcardsStudied} label={t.progress.flashcardsStudied} />
        <Stat
          value={summary.averageQuizPercentage == null ? "—" : `%${summary.averageQuizPercentage}`}
          label={t.progress.averageScore}
        />
      </View>

      <SectionTitle icon="quiz">{t.progress.quizHistory}</SectionTitle>
      {summary.quizAttempts.length === 0 ? (
        <Muted>{t.progress.noQuizzes}</Muted>
      ) : (
        summary.quizAttempts.slice(0, 12).map((a) => (
          <Card key={a.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <Body>{a.score}/{a.total}</Body>
              <Muted>%{a.percentage}</Muted>
            </Row>
            <Muted>{new Date(a.createdAt).toLocaleDateString("tr-TR")}</Muted>
          </Card>
        ))
      )}

      <SectionTitle icon="concepts">{t.progress.difficultConcepts}</SectionTitle>
      {summary.difficultConcepts.length === 0 ? (
        <Muted>{t.progress.noDifficult}</Muted>
      ) : (
        summary.difficultConcepts.map((c) => (
          <Card key={c}>
            <IconLabel icon="previous" label={c} />
          </Card>
        ))
      )}
    </Screen>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  tileValue: { color: colors.accent, fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
  tileLabel: { color: colors.muted, fontSize: fontSize.xs },
});
