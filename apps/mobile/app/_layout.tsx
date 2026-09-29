import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@rojanda/design";
import { ServicesProvider } from "../src/services/ServicesProvider";
import { AppProvider } from "../src/app-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <AppProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.bg },
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </AppProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  );
}
