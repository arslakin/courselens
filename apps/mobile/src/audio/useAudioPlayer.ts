/**
 * Small playback hook over expo-av Audio.Sound for previewing a preserved
 * recording / voice note by its local URI. Kept UI-agnostic so both the lesson
 * workspace and the voice-note screen reuse it. Loads lazily on first play and
 * unloads on unmount to avoid leaking native audio sessions.
 */
import { useEffect, useRef, useState } from "react";
import { Audio, type AVPlaybackStatus } from "expo-av";

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoaded: boolean;
  positionSec: number;
  durationSec: number;
  toggle: () => Promise<void>;
  error: string | null;
}

export function useAudioPlayer(uri: string | undefined): AudioPlayerState {
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      // Unload on unmount / uri change.
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, [uri]);

  const onStatus = (status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      if (status.error) setError(status.error);
      return;
    }
    setIsPlaying(status.isPlaying);
    setPositionSec(Math.round((status.positionMillis ?? 0) / 1000));
    if (status.durationMillis != null) setDurationSec(Math.round(status.durationMillis / 1000));
    // Reset to start when finished so the button can play again.
    if (status.didJustFinish) {
      setIsPlaying(false);
      soundRef.current?.setPositionAsync(0).catch(() => {});
    }
  };

  const toggle = async () => {
    if (!uri) return;
    try {
      setError(null);
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, onStatus);
        soundRef.current = sound;
        setIsLoaded(true);
        return;
      }
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return { isPlaying, isLoaded, positionSec, durationSec, toggle, error };
}
