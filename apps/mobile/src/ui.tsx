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
  Image,
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
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { colors, fontSize, fontWeight, ICONS, radius, spacing, TOUCH_TARGET, type IconKey } from "@rojanda/design";

/**
 * Icon — single wrapper over Ionicons so every icon shares size/color defaults
 * and screens reference semantic keys (from @rojanda/design ICONS) rather than
 * raw glyph names. `variant` picks outline vs filled.
 */
export function Icon({
  name,
  size = 22,
  color = colors.text,
  variant = "outline",
}: {
  name: IconKey;
  size?: number;
  color?: ColorValue;
  variant?: "outline" | "filled";
}) {
  const base = ICONS[name];
  const glyph = variant === "outline" ? `${base}-outline` : base;
  return <Ionicons name={glyph as React.ComponentProps<typeof Ionicons>["name"]} size={size} color={color} />;
}

/** Roj woven-kilim mark (reused asset) + optional RojAnda wordmark. */
export function Logo({ size = 28, showWordmark = true }: { size?: number; showWordmark?: boolean }) {
  return (
    <View style={styles.logoRow}>
      <Image
        source={require("../assets/roj-mark.png")}
        style={{ width: size, height: size, resizeMode: "contain" }}
        accessibilityLabel="RojAnda"
      />
      {showWordmark ? <Text style={styles.wordmark}>RojAnda</Text> : null}
    </View>
  );
}

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

export function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: IconKey }) {
  if (icon) {
    return (
      <View style={styles.sectionTitleRow}>
        <Icon name={icon} size={16} color={colors.accent} />
        <Text style={styles.sectionTitle}>{children}</Text>
      </View>
    );
  }
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
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
  icon?: IconKey;
}) {
  const iconColor =
    variant === "primary"
      ? colors.onAccent
      : variant === "danger"
        ? colors.danger
        : variant === "good"
          ? colors.good
          : colors.text;
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
      {icon ? <Icon name={icon} size={18} color={iconColor} /> : null}
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

/** Small inline icon + muted label, for list-item metadata rows. */
export function IconLabel({ icon, label }: { icon: IconKey; label: string }) {
  return (
    <View style={styles.iconLabel}>
      <Icon name={icon} size={14} color={colors.muted} />
      <Text style={[styles.body, styles.muted, styles.iconLabelText]}>{label}</Text>
    </View>
  );
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
    // Subtle elevation so white cards lift off the warm off-white background.
    shadowColor: "#0f1a2e",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pressed: { opacity: 0.7 },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  sectionTitle: { color: colors.accent, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  body: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  muted: { color: colors.muted },
  btn: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
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
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconLabel: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  iconLabelText: { fontSize: fontSize.xs },
  wordmark: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
});
