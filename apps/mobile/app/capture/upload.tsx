import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import type { Course, SourceKind } from "@rojanda/types";
import { processSourceToLesson } from "@rojanda/core";
import { colors, spacing } from "@rojanda/design";
import { Body, Button, Card, Icon, Input, Loading, Muted, Row, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useBackend, useServices } from "../../src/services/ServicesProvider";
import { readSourceText } from "../../src/capture/readSourceText";

/**
 * Kaynak Yükle — pick a document (PDF / text / doc) and turn it into a lesson.
 * Plain-text formats are read on-device (real extraction). For PDF/office docs
 * the AnalysisBackend does extraction server-side; locally we preserve the file
 * and analyze a labeled placeholder rather than fabricating content. The picked
 * file is preserved as the student's own source under the chosen course.
 */
export default function UploadCaptureScreen() {
  const params = useLocalSearchParams<{ courseId?: string }>();
  const { t, user } = useApp();
  const services = useServices();
  const backend = useBackend();

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string | undefined>(params.courseId);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    services.courses.list(user.id).then((cs) => {
      setCourses(cs);
      if (!courseId && cs.length > 0) setCourseId(cs[0].id);
    });
  }, [services, user]);

  const pick = async () => {
    if (!user || !courseId || busy) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/*", "application/pdf", "application/msword", "application/json"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setBusy(true);
    try {
      const text = await readSourceText(asset.uri, asset.mimeType);
      const { lesson, extractedPlaceholder } = await processSourceToLesson(services, backend, {
        userId: user.id,
        courseId,
        title: title.trim() || asset.name || defaultTitle(t.capture.uploadTitle),
        kind: kindFor(asset.mimeType, asset.name),
        uri: asset.uri,
        mime: asset.mimeType,
        text,
      });
      if (extractedPlaceholder) Alert.alert(t.capture.uploadTitle, t.capture.noText);
      router.replace(`/lesson/${lesson.id}`);
    } catch (e) {
      setBusy(false);
      Alert.alert(t.capture.uploadTitle, String(e));
    }
  };

  if (busy) {
    return (
      <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}>
        <Stack.Screen options={{ title: t.capture.uploadTitle }} />
        <Loading label={t.capture.processing} />
        <Muted>{t.capture.processingHint}</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t.capture.uploadTitle }} />
      <View style={styles.heroWrap}>
        <Icon name="uploadSource" size={44} color={colors.accent} variant="filled" />
      </View>
      <Body>{t.capture.uploadHint}</Body>

      <SectionTitle>{t.capture.selectCourse}</SectionTitle>
      {courses.length === 0 ? (
        <>
          <Muted>{t.courses.noCourses}</Muted>
          <Button label={t.courses.newCourse} icon="add" onPress={() => router.push("/(tabs)/courses")} />
        </>
      ) : (
        <Row style={{ flexWrap: "wrap" }}>
          {courses.map((c) => (
            <Button
              key={c.id}
              label={c.title}
              variant={c.id === courseId ? "primary" : "secondary"}
              onPress={() => setCourseId(c.id)}
            />
          ))}
        </Row>
      )}

      <Input value={title} onChangeText={setTitle} placeholder={t.capture.lessonTitle} />

      <Card>
        <Button
          label={t.capture.pickDocument}
          icon="uploadSource"
          variant="primary"
          onPress={pick}
          disabled={!courseId}
        />
      </Card>
    </Screen>
  );
}

function kindFor(mime: string | undefined, name: string | undefined): SourceKind {
  const lower = `${mime ?? ""} ${name ?? ""}`.toLowerCase();
  if (lower.includes("pdf")) return "pdf";
  if (lower.includes("msword") || lower.includes(".doc") || lower.includes("officedocument")) return "doc";
  return "txt";
}

function defaultTitle(prefix: string): string {
  return `${prefix} ${new Date().toLocaleDateString("tr-TR")}`;
}

const styles = StyleSheet.create({ heroWrap: { alignItems: "center", paddingVertical: spacing.md } });
