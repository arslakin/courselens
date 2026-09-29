import React, { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Stack } from "expo-router";
import { Body, Button, Card, Muted, Screen } from "../../src/ui";
import { useApp } from "../../src/app-context";

/**
 * 📷 Fotoğraf Çek — UI only in this phase. Future: capture → OCR (Textract /
 * Bedrock vision) → text Source. Here we show the flow with mock processing;
 * no camera permission or cloud OCR is used yet.
 */
export default function PhotoCaptureScreen() {
  const { t } = useApp();
  const [processed, setProcessed] = useState(false);

  return (
    <Screen>
      <Stack.Screen options={{ title: t.capture.photoTitle }} />
      <Text style={styles.hero}>📷</Text>
      <Body>{t.capture.photoHint}</Body>
      {!processed ? (
        <Button label={t.capture.photoTitle} variant="primary" onPress={() => setProcessed(true)} />
      ) : (
        <Card>
          <Muted>{t.capture.mockProcessed}</Muted>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ hero: { fontSize: 48, textAlign: "center" } });
