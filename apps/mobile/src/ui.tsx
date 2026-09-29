/**
 * Shared, themed UI primitives for RojAnda.
 *
 * Centralizes look-and-feel using @rojanda/design tokens so screens stay clean
 * and the visual language (adapted from RojLearn) is consistent. All touch
 * targets meet the accessible minimum.
 */
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { colors, fontSize, fontWeight, radius, spacing, TOUCH_TARGET } from "@rojanda/design";

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  // KeyboardAvoidingView keeps inputs visible when the keyboard opens (notes,
  // chat, record title). "padding" on iOS, height on Android is the standard
  // pairing; uses only React Native core (no extra native dependency).
  const behavior = Platform.OS === "ios" ? "padding" : undefined;

  if (scroll) {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={behavior}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={[styles.screenContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={behavior}>
      <View style={[styles.screen, styles.screenContent, contentStyle]}>{children}</View>
    </KeyboardAvoidingView>
  );
}

export function Card({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Body({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={[styles.body, styles.muted]}>{children}</Text>;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "good";

export function Button({
  label,
  onPress,
  variant = "secondary",
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.btn,
        variantStyle[variant],
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.btnText, variant === "primary" && styles.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      style={styles.input}
      {...props}
    />
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[styles.body, styles.muted, { marginTop: spacing.sm }]}>{label}</Text> : null}
    </View>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <Text style={[styles.body, styles.muted]}>{label}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const variantStyle: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.surface2, borderColor: colors.border },
  danger: { backgroundColor: "transparent", borderColor: colors.danger },
  good: { backgroundColor: "transparent", borderColor: colors.good },
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  sectionTitle: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  body: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  muted: { color: colors.muted },
  btn: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  btnTextPrimary: { color: colors.onAccent, fontWeight: fontWeight.bold },
  input: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: fontSize.md,
    minHeight: TOUCH_TARGET,
  },
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
});
