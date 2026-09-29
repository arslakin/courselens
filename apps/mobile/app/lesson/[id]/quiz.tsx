import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import type { Quiz, QuizQuestion, QuizResult } from "@rojanda/types";
import { colors, fontSize, fontWeight, radius, spacing } from "@rojanda/design";
import { Alert } from "react-native";
import { Body, Button, Card, Empty, Loading, Muted, Screen, SectionTitle } from "../../../src/ui";
import { useApp } from "../../../src/app-context";
import { useServices } from "../../../src/services/ServicesProvider";

const LETTERS = ["A", "B", "C", "D"] as const;

export default function QuizScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, user } = useApp();
  const services = useServices();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [courseId, setCourseId] = useState<string | undefined>();
  const [order, setOrder] = useState<number[]>([]); // indices into quiz.questions
  const [pos, setPos] = useState(0);
  const [selected, setSelected] = useState<(0 | 1 | 2 | 3 | null)[]>([]);
  const [answered, setAnswered] = useState(false);
  const [result, setResult] = useState<QuizResult | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      (async () => {
        const l = await services.lessons.get(id);
        const q = l?.study?.quiz ?? null;
        if (active && q) {
          setQuiz(q);
          setCourseId(l?.courseId);
          setOrder(q.questions.map((_, i) => i));
          setSelected(new Array(q.questions.length).fill(null));
        } else if (active) {
          setQuiz(null);
        }
      })();
      return () => {
        active = false;
      };
    }, [id, services])
  );

  const addResultToNotes = async (r: QuizResult) => {
    if (!user) return;
    const weak = r.weakTopics.length ? `\nTekrar: ${r.weakTopics.join(", ")}` : "";
    await services.notes.create(
      user.id,
      `Quiz sonucu: ${r.score}/${r.total} (%${r.percentage})${weak}`,
      { title: "Quiz sonucu", courseId, lessonId: id, kind: "typed" }
    );
    Alert.alert(t.study.added);
  };

  if (quiz === null)
    return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  if (quiz.questions.length === 0) return <Screen><Empty label={t.common.empty} /></Screen>;

  // Results view
  if (result) {
    const incorrect = order.filter((qi) => selected[qi] !== quiz.questions[qi].correctIndex);
    return (
      <Screen>
        <Stack.Screen options={{ title: t.quiz.scoreTitle }} />
        <Card>
          <Title2>{t.quiz.scoreLine(result.score, result.total)}</Title2>
          <Text style={styles.pct}>{t.quiz.percentage(result.percentage)}</Text>
        </Card>

        <SectionTitle>{t.quiz.weakTopics}</SectionTitle>
        {result.weakTopics.length === 0 ? (
          <Muted>{t.quiz.noMistakes}</Muted>
        ) : (
          result.weakTopics.map((topic) => (
            <Card key={topic}><Body>• {topic}</Body></Card>
          ))
        )}

        <SectionTitle>{t.quiz.reviewMistakes}</SectionTitle>
        {incorrect.length === 0 ? (
          <Muted>{t.quiz.noMistakes}</Muted>
        ) : (
          incorrect.map((qi) => {
            const q = quiz.questions[qi];
            return (
              <Card key={q.id}>
                <Body>{q.prompt}</Body>
                <Muted>
                  {t.quiz.correctAnswer}: {LETTERS[q.correctIndex]}) {q.options[q.correctIndex]}
                </Muted>
                <Muted>{q.explanation}</Muted>
              </Card>
            );
          })
        )}

        <Button label={t.study.addToNotes} icon="newNote" onPress={() => addResultToNotes(result)} />

        {incorrect.length > 0 ? (
          <Button
            label={t.quiz.retryIncorrect}
            variant="primary"
            onPress={() => {
              setOrder(incorrect);
              setPos(0);
              setAnswered(false);
              setResult(null);
            }}
          />
        ) : null}
      </Screen>
    );
  }

  const qIndex = order[pos];
  const q: QuizQuestion = quiz.questions[qIndex];
  const chosen = selected[qIndex];

  const choose = (opt: 0 | 1 | 2 | 3) => {
    if (answered) return;
    const next = [...selected];
    next[qIndex] = opt;
    setSelected(next);
    setAnswered(true);
  };

  const advance = async () => {
    if (pos + 1 < order.length) {
      setPos(pos + 1);
      setAnswered(false);
    } else {
      // Grade only the questions in the current order (full run or retry set).
      const sel = order.map((qi) => (selected[qi] ?? 0) as 0 | 1 | 2 | 3);
      const subQuiz: Quiz = { id: quiz.id, questions: order.map((qi) => quiz.questions[qi]) };
      setResult(
        await services.quiz.grade(subQuiz, sel, {
          userId: user?.id,
          lessonId: id,
          courseId,
        })
      );
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.study.quiz }} />
      <Muted>{t.quiz.progress(pos + 1, order.length)}</Muted>
      <Card>
        <Body>{q.prompt}</Body>
      </Card>

      {q.options.map((opt, i) => {
        const isCorrect = i === q.correctIndex;
        const isChosen = chosen === i;
        let stateStyle: ViewStyle = styles.option;
        if (answered && isCorrect) stateStyle = styles.optionCorrect;
        else if (answered && isChosen && !isCorrect) stateStyle = styles.optionWrong;
        return (
          <Pressable
            key={i}
            onPress={() => choose(i as 0 | 1 | 2 | 3)}
            accessibilityRole="button"
            disabled={answered}
            style={({ pressed }) => [stateStyle, pressed && !answered && { opacity: 0.7 }]}
          >
            <Text style={styles.optionText}>
              {LETTERS[i]}) {opt}
            </Text>
          </Pressable>
        );
      })}

      {answered ? (
        <Card>
          <Text style={chosen === q.correctIndex ? styles.correct : styles.wrong}>
            {chosen === q.correctIndex ? t.quiz.correct : t.quiz.incorrect}
          </Text>
          <Muted>
            {t.quiz.correctAnswer}: {LETTERS[q.correctIndex]}) {q.options[q.correctIndex]}
          </Muted>
          <Muted>{q.explanation}</Muted>
          <Button
            label={pos + 1 < order.length ? t.common.next : t.quiz.finish}
            variant="primary"
            onPress={advance}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

function Title2({ children }: { children: React.ReactNode }) {
  return <Text style={styles.scoreTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  option: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 48,
    justifyContent: "center",
  },
  optionCorrect: {
    backgroundColor: colors.surface2,
    borderColor: colors.good,
    borderWidth: 2,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 48,
    justifyContent: "center",
  },
  optionWrong: {
    backgroundColor: colors.surface2,
    borderColor: colors.danger,
    borderWidth: 2,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 48,
    justifyContent: "center",
  },
  optionText: { color: colors.text, fontSize: fontSize.md },
  correct: { color: colors.good, fontWeight: fontWeight.bold, fontSize: fontSize.md },
  wrong: { color: colors.danger, fontWeight: fontWeight.bold, fontSize: fontSize.md },
  scoreTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  pct: { color: colors.accent, fontSize: fontSize.xxl, fontWeight: fontWeight.bold },
});
