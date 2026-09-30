/**
 * Play/pause button for a preserved audio file (recording or voice note),
 * built on useAudioPlayer. Shared by the record screen, lesson workspace, and
 * voice-note screen so playback looks and behaves the same everywhere.
 */
import React from "react";
import { Button, Muted } from "../ui";
import { useAudioPlayer } from "./useAudioPlayer";

function fmt(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function AudioPlayerButton({
  uri,
  playLabel,
  pauseLabel,
}: {
  uri: string | undefined;
  playLabel: string;
  pauseLabel: string;
}) {
  const player = useAudioPlayer(uri);
  if (!uri) return null;
  return (
    <>
      <Button
        label={player.isPlaying ? pauseLabel : playLabel}
        icon={player.isPlaying ? "pause" : "play"}
        onPress={player.toggle}
      />
      {player.durationSec > 0 ? (
        <Muted>
          {fmt(player.positionSec)} / {fmt(player.durationSec)}
        </Muted>
      ) : null}
      {player.error ? <Muted>{player.error}</Muted> : null}
    </>
  );
}
