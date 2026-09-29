import React, { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Stack } from "expo-router";
import { Body, Button, Card, Muted, Screen } from "../../src/ui";
import { useApp } from "../../src/app-context";

/**
 * 📁 Kaynak Yükle — UI only in this phase. Future: pick a PDF/doc → presigned
 * S3 upload → text extraction (reuses RojLearn extraction) → Source. Here we
 * demonstrate the flow with mock processing; no cloud upload occurs.
 */
export default function UploadCaptureScreen() {
  const { t } = useApp();
  const [processed, setProcessed] = useState(false);

  return (
    <Screen>
      <Stack.Screen options={{ title: t.capture.uploadTitle }} />
      <Text style={styles.hero}>📁</Text>
      <Body>{t.capture.uploadHint}</Body>
      {!processed ? (
        <Button label={t.capture.uploadTitle} variant="primary" onPress={() => setProcessed(true)} />
      ) : (
        <Card>
          <Muted>{t.capture.mockProcessed}</Muted>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ hero: { fontSize: 48, textAlign: "center" } });
