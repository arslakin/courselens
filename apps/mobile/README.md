# RojAnda (mobile)

Mobile-first AI learning + note-taking app (React Native + Expo + TypeScript),
Turkish-first. This is the local development MVP: all services are **local
mocks** — no AWS, no network, no analytics. Private student data stays
on-device (AsyncStorage).

## Run locally

From the **repo root** (installs the whole monorepo):

```bash
npm install
```

Then start the app:

```bash
cd apps/mobile
npm run start        # Expo dev server; press i (iOS) / a (Android), or scan QR in Expo Go
# or: npm run ios / npm run android
```

Type-check:

```bash
cd apps/mobile && npm run typecheck
```

## Main mock flow to try

Home → 🎙️ Dersi Kaydet → (create/select course) → record → finish →
simulated transcription + analysis → lesson study set: Ders Özeti, Ana
Kavramlar, Açıklamalar, 🃏 Flashcards, ❓ 10-soruluk Quiz, 🎧 Podcast,
💬 RojAnda'ya Sor. Add items to Notlarım, create a typed note and a 🎙️ Sesli
Not, then reopen the course — data persists locally.

## Architecture note

Screens depend only on the service interfaces in `@rojanda/api`. Today those
are backed by `@rojanda/core` mocks; swapping in AWS-backed implementations
(Cognito / API Gateway + Lambda / S3 / Transcribe / Bedrock / Polly / DynamoDB)
happens in `src/services/ServicesProvider.tsx` with no screen changes.

Design tokens live in `@rojanda/design`; the accent colors are **temporary**
placeholders adapted from RojLearn — the official Roj Collective brand palette
is not yet available (see that package for details).
