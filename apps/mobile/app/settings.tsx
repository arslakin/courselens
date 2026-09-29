import React from "react";
import { Alert } from "react-native";
import { router, Stack } from "expo-router";
import { clearAllLocalData } from "@rojanda/core";
import { Body, Button, Card, IconLabel, Muted, Screen, SectionTitle } from "../src/ui";
import { useApp } from "../src/app-context";
import { useServices } from "../src/services/ServicesProvider";
import { asyncStore } from "../src/services/store";

export default function SettingsScreen() {
  const { t, user } = useApp();
  const services = useServices();

  const clearData = () => {
    Alert.alert(t.settings.clearData, t.settings.clearDataConfirm, [
      { text: t.common.cancel, style: "cancel" },
      {
        text: t.common.delete,
        style: "destructive",
        onPress: async () => {
          await clearAllLocalData(asyncStore);
          router.replace("/(tabs)");
        },
      },
    ]);
  };

  const signOut = async () => {
    await services.auth.signOut();
    router.replace("/(tabs)");
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t.settings.title }} />

      <SectionTitle icon="settings">{t.settings.account}</SectionTitle>
      <Card>
        <Body>{user?.displayName ?? "—"}</Body>
        <Muted>{user?.email ?? ""}</Muted>
      </Card>

      <SectionTitle>{t.settings.language}</SectionTitle>
      <Card>
        <IconLabel icon="correct" label={t.settings.languageTr} />
      </Card>

      <SectionTitle>{t.settings.data}</SectionTitle>
      <Card>
        <Muted>{t.settings.dataNote}</Muted>
      </Card>
      <Button label={t.settings.clearData} variant="danger" onPress={clearData} />

      <SectionTitle>{t.settings.privacy}</SectionTitle>
      <Card>
        <Muted>{t.settings.privacyNote}</Muted>
      </Card>

      <Button label={t.settings.signOut} onPress={signOut} />
      <Muted>{t.settings.version}: 0.1.0 (MVP)</Muted>
    </Screen>
  );
}
