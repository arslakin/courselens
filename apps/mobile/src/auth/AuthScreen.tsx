/**
 * Minimal authentication screen (Phase 1B): create account, confirm code, sign
 * in, error + loading states. Uses the existing RojAnda visual identity
 * (Screen/Card/Button/Input/Logo). Google/Apple buttons are PREPARED but
 * disabled until Cognito federation is configured — they never pretend to work.
 *
 * No redesign of the app; this is the pre-app gate shown when signed out.
 */
import React, { useState } from "react";
import { Alert, View } from "react-native";
import { spacing } from "@rojanda/design";
import { Body, Button, Card, Input, Logo, Muted, Row, Screen, SectionTitle } from "../ui";
import { useApp } from "../app-context";
import { AuthConfigError } from "./AuthProvider";
import { AUTH_MODE } from "../config";

type Mode = "signIn" | "signUp" | "confirm";

export function AuthScreen() {
  const { t, auth, onSignedIn } = useApp();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof AuthConfigError) {
        setError(e.message);
      } else {
        setError(t.auth.genericError);
      }
    } finally {
      setBusy(false);
    }
  };

  const doSignIn = () =>
    run(async () => {
      const session = await auth.signIn(email.trim(), password);
      await onSignedIn(session);
    });

  const doSignUp = () =>
    run(async () => {
      await auth.signUp(email.trim(), password);
      Alert.alert(t.auth.signUpTitle, t.auth.confirmSent);
      setMode("confirm");
    });

  const doConfirm = () =>
    run(async () => {
      await auth.confirmSignUp(email.trim(), code.trim());
      setMode("signIn");
    });

  const federationPending = () => Alert.alert(t.auth.signInTitle, t.auth.federationPending);

  return (
    <Screen>
      <View style={{ alignItems: "center", paddingVertical: spacing.lg }}>
        <Logo size={40} />
      </View>

      {AUTH_MODE === "mock" ? <Muted>{t.auth.devModeBadge}</Muted> : null}

      {mode === "signIn" && <SectionTitle>{t.auth.signInTitle}</SectionTitle>}
      {mode === "signUp" && <SectionTitle>{t.auth.signUpTitle}</SectionTitle>}
      {mode === "confirm" && <SectionTitle>{t.auth.confirmTitle}</SectionTitle>}

      {mode !== "confirm" && (
        <>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder={t.auth.email}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Input
            value={password}
            onChangeText={setPassword}
            placeholder={t.auth.password}
            secureTextEntry
            autoCapitalize="none"
          />
        </>
      )}

      {mode === "confirm" && (
        <Input
          value={code}
          onChangeText={setCode}
          placeholder={t.auth.confirmationCode}
          keyboardType="number-pad"
        />
      )}

      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {mode === "signIn" && (
        <>
          <Button label={t.auth.signIn} variant="primary" onPress={doSignIn} disabled={busy} />
          <Button label={t.auth.toSignUp} onPress={() => setMode("signUp")} disabled={busy} />
        </>
      )}
      {mode === "signUp" && (
        <>
          <Button label={t.auth.signUp} variant="primary" onPress={doSignUp} disabled={busy} />
          <Button label={t.auth.toSignIn} onPress={() => setMode("signIn")} disabled={busy} />
        </>
      )}
      {mode === "confirm" && (
        <Button label={t.auth.confirm} variant="primary" onPress={doConfirm} disabled={busy} />
      )}

      {/* Federation buttons — prepared, but clearly not yet functional. */}
      {mode !== "confirm" && (
        <Row style={{ flexWrap: "wrap" }}>
          <Button label={t.auth.google} icon="external" onPress={federationPending} disabled={busy} />
          <Button label={t.auth.apple} icon="external" onPress={federationPending} disabled={busy} />
        </Row>
      )}
    </Screen>
  );
}
