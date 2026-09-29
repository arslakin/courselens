import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { colors, spacing } from "@rojanda/design";
import { Body, Button, Card, Icon, Muted, Screen } from "../../src/ui";
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
      <View style={styles.heroWrap}>
        <Icon name="takePhoto" size={44} color={colors.accent} variant="filled" />
      </View>
      <Body>{t.capture.photoHint}</Body>
      {!processed ? (
        <Button label={t.capture.photoTitle} icon="takePhoto" variant="primary" onPress={() => setProcessed(true)} />
      ) : (
        <Card>
          <Muted>{t.capture.mockProcessed}</Muted>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ heroWrap: { alignItems: "center", paddingVertical: spacing.md } });
