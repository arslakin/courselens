import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import type { Course } from "@rojanda/types";
import { processSourceToLesson } from "@rojanda/core";
import { colors, spacing } from "@rojanda/design";
import { Body, Button, Card, Icon, Input, Loading, Muted, Row, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useBackend, useServices } from "../../src/services/ServicesProvider";
import { readSourceText } from "../../src/capture/readSourceText";

/**
 * Fotoğraf Çek — capture a photo of study material (camera or library) and turn
 * it into a lesson. The image is preserved as the student's own source and
 * associated with the chosen course + a new lesson. Text extraction (OCR) runs
 * in the AnalysisBackend: server-side when the RojAnda backend is deployed, or a
 * clearly-labeled placeholder locally (never fabricated). Analysis is grounded
 * in whatever text is available.
 */
export default function PhotoCaptureScreen() {
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

  const capture = async (from: "camera" | "library") => {
    if (!user || !courseId || busy) return;

    if (from === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t.capture.photoTitle, t.capture.permissionDenied);
        return;
      }
    }

    const result =
      from === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    setBusy(true);
    try {
      // Images can't be OCR'd on-device here; readSourceText returns undefined
      // and the backend supplies a labeled placeholder.
      const text = await readSourceText(asset.uri, asset.mimeType ?? undefined);
      const { lesson, extractedPlaceholder } = await processSourceToLesson(services, backend, {
        userId: user.id,
        courseId,
        title: title.trim() || defaultTitle(t.capture.photoTitle),
        kind: "photo",
        uri: asset.uri,
        mime: asset.mimeType ?? "image/jpeg",
        text,
      });
      if (extractedPlaceholder) Alert.alert(t.capture.photoTitle, t.capture.noText);
      router.replace(`/lesson/${lesson.id}`);
    } catch (e) {
      setBusy(false);
      Alert.alert(t.capture.photoTitle, String(e));
    }
  };

  if (busy) {
    return (
      <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}>
        <Stack.Screen options={{ title: t.capture.photoTitle }} />
        <Loading label={t.capture.processing} />
        <Muted>{t.capture.processingHint}</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: t.capture.photoTitle }} />
      <View style={styles.heroWrap}>
        <Icon name="takePhoto" size={44} color={colors.accent} variant="filled" />
      </View>
      <Body>{t.capture.photoHint}</Body>

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
          label={t.capture.fromCamera}
          icon="takePhoto"
          variant="primary"
          onPress={() => capture("camera")}
          disabled={!courseId}
        />
        <Button
          label={t.capture.fromLibrary}
          icon="uploadSource"
          onPress={() => capture("library")}
          disabled={!courseId}
        />
      </Card>
    </Screen>
  );
}

function defaultTitle(prefix: string): string {
  return `${prefix} ${new Date().toLocaleDateString("tr-TR")}`;
}

const styles = StyleSheet.create({ heroWrap: { alignItems: "center", paddingVertical: spacing.md } });
