// src/components/bingo/hooks/useSoundEffects.js
import { useEffect } from "react";
import SoundService from "../../../services/sound";

export default function useSoundEffects({ language }) {
  // Pre-load **once** per language change
  useEffect(() => {
    SoundService.preloadSounds(language).catch(() => {});
  }, [language]);

  // Expose tiny API
  return {
    play: (key, opts) => SoundService.play(key, { ...opts, language }),
    stop: (key) => SoundService.stop(key),
  };
}
