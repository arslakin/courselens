/**
 * Small playback hook over expo-audio for previewing a preserved recording /
 * voice note by its local URI. Kept UI-agnostic so both the lesson workspace
 * and the voice-note screen reuse it. Creates the player lazily on first play
 * and removes it on unmount / uri change to avoid leaking native resources.
 *
 * Uses expo-audio (SDK 57, bundled in Expo Go). We intentionally avoid the
 * `useAudioPlayer` hook from expo-audio here because it eagerly loads a source;
 * this wrapper keeps our existing {toggle,isPlaying,...} contract used by the
 * shared AudioPlayerButton.
 */
import { useEffect, useRef, useState } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioStatus } from "expo-audio";
import type { AudioPlayer } from "expo-audio";

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoaded: boolean;
  positionSec: number;
  durationSec: number;
  toggle: () => Promise<void>;
  error: string | null;
}

export function useAudioPlayer(uri: string | undefined): AudioPlayerState {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      // Release on unmount / uri change.
      try {
        playerRef.current?.remove();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [uri]);

  const onStatus = (status: AudioStatus) => {
    setIsPlaying(status.playing);
    setIsLoaded(status.isLoaded);
    setPositionSec(Math.round(status.currentTime ?? 0));
    if (status.duration != null) setDurationSec(Math.round(status.duration));
    // Return to start when finished so the button can play again.
    if (status.didJustFinish) {
      setIsPlaying(false);
      playerRef.current?.seekTo(0).catch(() => {});
    }
  };

  const toggle = async () => {
    if (!uri) return;
    try {
      setError(null);
      if (!playerRef.current) {
        await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
        const player = createAudioPlayer({ uri });
        player.addListener("playbackStatusUpdate", onStatus);
        playerRef.current = player;
        player.play();
        return;
      }
      if (playerRef.current.playing) {
        playerRef.current.pause();
      } else {
        playerRef.current.play();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return { isPlaying, isLoaded, positionSec, durationSec, toggle, error };
}
