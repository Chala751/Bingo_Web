import { useEffect, useState, useCallback } from "react";

/**
 * useFullscreen - manages fullscreen state for a given container ref.
 *
 * Usage:
 * const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
 */
export default function useFullscreen(containerRef) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef?.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err?.message || err}`);
      });
    } else {
      document.exitFullscreen?.();
    }
  }, [containerRef]);

  return { isFullscreen, toggleFullscreen };
}
