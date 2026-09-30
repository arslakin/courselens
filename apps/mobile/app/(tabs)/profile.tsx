import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { QuizLength, StudentProfile } from "@rojanda/types";
import { spacing } from "@rojanda/design";
import {
  Body,
  Button,
  Card,
  Input,
  Loading,
  Logo,
  Muted,
  Row,
  Screen,
  SectionTitle,
} from "../../src/ui";
import { Avatar } from "../../src/components/Avatar";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function ProfileScreen() {
  const { t, user, signOut } = useApp();
  const services = useServices();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [name, setName] = useState(user?.displayName ?? "");
  const [coursesCount, setCoursesCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let active = true;
      (async () => {
        const [p, courses] = await Promise.all([
          services.profile.get(user.id),
          services.courses.list(user.id),
        ]);
        if (active) {
          setProfile(p);
          setName(user.displayName);
          setCoursesCount(courses.length);
        }
      })();
      return () => {
        active = false;
      };
    }, [services, user])
  );

  if (!profile) {
    return <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}><Loading /></Screen>;
  }

  const save = async (patch: Partial<StudentProfile>) => {
    if (!user) return;
    const next = await services.profile.update(user.id, patch);
    setProfile(next);
  };
  const saveName = async () => {
    if (!user || !name.trim()) return;
    await services.profile.setDisplayName(user.id, name.trim());
  };

  const prefs = profile.preferences;

  return (
    <Screen>
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <Avatar user={user} size={72} />
        <Muted>{user?.email}</Muted>
      </View>

      <SectionTitle icon="settings">{t.profile.name}</SectionTitle>
      <Input value={name} onChangeText={setName} onBlur={saveName} placeholder={t.profile.name} />
      <Muted>{t.profile.minimalDataNote}</Muted>

      <SectionTitle>{t.profile.school}</SectionTitle>
      <Input
        value={profile.school ?? ""}
        onChangeText={(v) => setProfile({ ...profile, school: v })}
        onBlur={() => save({ school: profile.school })}
        placeholder={t.profile.school}
      />
      <SectionTitle>{t.profile.grade}</SectionTitle>
      <Input
        value={profile.grade ?? ""}
        onChangeText={(v) => setProfile({ ...profile, grade: v })}
        onBlur={() => save({ grade: profile.grade })}
        placeholder={t.profile.grade}
      />

      <SectionTitle icon="quiz">{t.profile.studyPrefs}</SectionTitle>
      <Card>
        <Body>{t.profile.quizPref}</Body>
        <Row>
          {([10, 20] as QuizLength[]).map((q) => (
            <Button
              key={q}
              label={q === 10 ? t.profile.quiz10 : t.profile.quiz20}
              variant={prefs.quizLength === q ? "primary" : "secondary"}
              onPress={() => save({ preferences: { ...prefs, quizLength: q } })}
            />
          ))}
        </Row>
      </Card>
      <Card>
        <Body>{t.profile.podcastPref}</Body>
        <Row>
          {(["short", "medium"] as const).map((p) => (
            <Button
              key={p}
              label={p === "short" ? t.profile.podcastShort : t.profile.podcastMedium}
              variant={prefs.podcastLength === p ? "primary" : "secondary"}
              onPress={() => save({ preferences: { ...prefs, podcastLength: p } })}
            />
          ))}
        </Row>
      </Card>

      <SectionTitle>{t.profile.accessibility}</SectionTitle>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Body>{t.profile.largeText}</Body>
          <Button
            label={prefs.largeText ? "Açık" : "Kapalı"}
            variant={prefs.largeText ? "good" : "secondary"}
            onPress={() => save({ preferences: { ...prefs, largeText: !prefs.largeText } })}
          />
        </Row>
      </Card>
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Body>{t.profile.reduceMotion}</Body>
          <Button
            label={prefs.reduceMotion ? "Açık" : "Kapalı"}
            variant={prefs.reduceMotion ? "good" : "secondary"}
            onPress={() => save({ preferences: { ...prefs, reduceMotion: !prefs.reduceMotion } })}
          />
        </Row>
      </Card>

      <SectionTitle icon="courses">{t.profile.coursesCount}</SectionTitle>
      <Card><Body>{coursesCount}</Body></Card>

      <Button label={t.profile.myProgress} icon="summary" variant="primary" onPress={() => router.push("/progress")} />
      <Button label={t.profile.accountPrivacy} icon="settings" onPress={() => router.push("/settings")} />
      <Button label={t.auth.signOut} variant="danger" onPress={signOut} />

      {/* About / brand — the Roj mark appears here (profile/about area). */}
      <SectionTitle>{t.profile.about}</SectionTitle>
      <Card>
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <Logo size={36} />
          <Muted>{t.profile.aboutRoj}</Muted>
        </View>
      </Card>
    </Screen>
  );
}
