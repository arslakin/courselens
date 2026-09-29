import React from "react";
import { Text, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { colors } from "@rojanda/design";
import { getStrings } from "@rojanda/i18n";

const t = getStrings("tr");

function TabIcon({ emoji, color }: { emoji: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.home.title,
          tabBarLabel: "RojAnda",
          tabBarIcon: ({ color }) => <TabIcon emoji="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="courses"
        options={{
          title: t.courses.title,
          tabBarLabel: t.home.myCourses,
          tabBarIcon: ({ color }) => <TabIcon emoji="📚" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: t.notes.title,
          tabBarLabel: t.home.myNotes,
          tabBarIcon: ({ color }) => <TabIcon emoji="📝" color={color} />,
        }}
      />
    </Tabs>
  );
}
