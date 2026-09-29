import React from "react";
import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { colors } from "@rojanda/design";
import { getStrings } from "@rojanda/i18n";
import { Icon } from "../../src/ui";
import type { IconKey } from "@rojanda/design";

const t = getStrings("tr");

/** Tab icon: filled (Roj blue) when focused, neutral outline when inactive. */
function tabIcon(name: IconKey) {
  return ({ focused, color }: { focused: boolean; color: ColorValue }) => (
    <Icon name={name} size={22} color={color} variant={focused ? "filled" : "outline"} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent, // Roj blue for the selected tab
        tabBarInactiveTintColor: colors.muted, // neutral for inactive
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t.home.title, tabBarLabel: "RojAnda", tabBarIcon: tabIcon("home") }}
      />
      <Tabs.Screen
        name="courses"
        options={{ title: t.courses.title, tabBarLabel: t.home.myCourses, tabBarIcon: tabIcon("courses") }}
      />
      <Tabs.Screen
        name="notes"
        options={{ title: t.notes.title, tabBarLabel: t.home.myNotes, tabBarIcon: tabIcon("notes") }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t.profile.title, tabBarLabel: t.profile.title, tabBarIcon: tabIcon("profile") }}
      />
    </Tabs>
  );
}
