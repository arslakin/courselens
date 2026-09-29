import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { User } from "@rojanda/types";
import { colors, fontWeight } from "@rojanda/design";

/**
 * Avatar — initials on a colored circle. No photo upload required in MVP
 * (avoids collecting a biometric image); the color comes from the profile or
 * a stable default. Contemporary, clean, and cheap.
 */
export function Avatar({ user, size = 40 }: { user: User | null; size?: number }) {
  const name = user?.displayName ?? "Ö";
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const bg = user?.profile?.avatarColor ?? colors.accent;
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
      accessibilityLabel={name}
    >
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials || "Ö"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  initials: { color: colors.onAccent, fontWeight: fontWeight.bold },
});
