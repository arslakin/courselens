# RojAnda — Product Requirements (Phase 1 plan)

> **Status:** planning only. No code, no AWS resources, no changes to the live
> RojLearn hackathon app. RojLearn remains a stable v1.

**RojAnda** is a mobile-first AI learning and note-taking app for students,
initially in Turkey.

**Product message:** *"RojAnda — Dersini kaydet, kaynaklarını yükle, öğrenmeye
başla."*

## What students can do
Capture course material three ways — 📷 **Fotoğraf Çek**, 📁 **Kaynak Yükle**,
🎙️ **Dersi Kaydet** — then, grounded in that material, get: a Turkish summary
(*Ders Özeti*), key concepts (*Ana Kavramlar*), plain-Turkish explanations of
hard concepts (*Açıklamalar*), flashcards, a quiz, and a short audio recap
(*podcast*). They can chat with their own materials and save everything
(courses, lessons, sources, recordings, transcripts, study materials, history)
in a personal account.

## Core product principle — grounded by default
The AI answers **only from the student's own materials** by default. If the
answer isn't in those materials, RojAnda says so rather than silently mixing in
outside knowledge. The student can explicitly tap **"Dış Kaynaklarda Ara"**
(search external sources); external information is then returned **clearly
labeled and cited separately** from the student's own material. (External search
is *designed* now, *not implemented* in early phases.)

## First workflow to prove (the MVP)
Sign in → create/select course → 🎙️ **Dersi Kaydet** → upload recording →
Turkish transcription → AI analysis → **Ders Özeti** → **Ana Kavramlar** →
**Açıklamalar** → **Flashcards** → **5-question Quiz** → save everything under
the lesson/course.

**Flashcards ship in this first MVP.** The **Podcast / audio recap** is the
first feature added immediately after the MVP.

## Localization
Turkish-first UI and Turkish model output. All user-facing strings live in an
i18n layer (locale resource files, default `tr`) so more languages can be added
later without code changes.

## Scope guardrails
- Mobile-first (React Native + Expo, one iOS/Android codebase).
- Serverless, pay-per-use, free tiers where possible. No RDS/ECS/EKS/always-on.
- Turkish-first UX and Turkish model output.
- Cost stays low during beta; no new paid infra deployed during planning.

## Out of scope for the first MVP
External-source research (interface only), photo-OCR pipeline (design only),
social/sharing features, offline mode, web app, multi-language UI.
