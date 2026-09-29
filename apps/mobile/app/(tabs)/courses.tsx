import React, { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import type { Course } from "@rojanda/types";
import { Body, Button, Card, Empty, Input, Muted, Row, Screen, SectionTitle } from "../../src/ui";
import { useApp } from "../../src/app-context";
import { useServices } from "../../src/services/ServicesProvider";

export default function CoursesScreen() {
  const { t, user } = useApp();
  const services = useServices();
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setCourses(await services.courses.list(user.id));
  }, [services, user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const create = async () => {
    if (!user || !title.trim()) return;
    await services.courses.create(user.id, title.trim());
    setTitle("");
    load();
  };

  return (
    <Screen>
      <SectionTitle>{t.courses.newCourse}</SectionTitle>
      <Input
        value={title}
        onChangeText={setTitle}
        placeholder={t.courses.courseName}
        returnKeyType="done"
        onSubmitEditing={create}
      />
      <Button label={t.courses.createCourse} variant="primary" onPress={create} disabled={!title.trim()} />

      <SectionTitle>{t.courses.title}</SectionTitle>
      {courses.length === 0 ? (
        <Empty label={t.courses.noCourses} />
      ) : (
        courses.map((c) => (
          <Card key={c.id} onPress={() => router.push(`/course/${c.id}`)}>
            <Row style={{ justifyContent: "space-between" }}>
              <Body>{c.title}</Body>
              <Muted>{t.courses.openCourse} ›</Muted>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
