import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@rojanda/design";
import { ServicesProvider } from "../src/services/ServicesProvider";
import { AppProvider } from "../src/app-context";
import { AuthGate } from "../src/auth/AuthGate";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ServicesProvider>
        <AppProvider>
          {/* Dark status-bar content for the light theme. */}
          <StatusBar style="dark" />
          {/* AuthGate shows the auth screen when signed out; the app when signed
              in. No unconditional auto-login into a fabricated student. */}
          <AuthGate>
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
          </AuthGate>
        </AppProvider>
      </ServicesProvider>
    </SafeAreaProvider>
  );
}
