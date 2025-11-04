// src/services/sound.js
import API from "./axios";

const MAX_CONCURRENT = 8;
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

class SoundService {
  constructor() {
    this.audioCache = {}; // key → Audio element (blob URL)
    this.pending = new Map(); // key → Promise<Audio>
    this.loadedLang = null;
    this.lastWinnerAt = 0;
    // Web Audio for zero-latency playback (optional, fallback to HTMLAudio)
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  /* --------------------------------------------------------------
     URL builder – identical to the old version
  -------------------------------------------------------------- */
  _url(key, lang = "am") {
    const folder = lang === "am" ? "amharic" : "voices";
    const map = {
      game_start: `${folder}/started${lang === "am" ? "ahm" : "oromic"}.opus`,
      game_pause: `${folder}/paused${lang === "am" ? "amh" : "oromic"}.opus`,
      game_finish: `${folder}/finish${lang === "am" ? "amh" : "oromic"}.opus`,
      winner: `${folder}/win${lang === "am" ? "amh" : "oromic"}.opus`,
      you_didnt_win: `${folder}/locked${lang === "am" ? "amh" : "oromic"}.opus`,
      shuffle: "effects/shuffle.opus",
      "jackpot-running": "effects/jackpot-running.opus",
      "jackpot-congrats": "effects/jackpot-congrats.opus",
    };
    if (map[key]) return `/sounds?path=${map[key]}`;
    const m = /^number_(\d{1,2})$/.exec(key);
    if (m && +m[1] >= 1 && +m[1] <= 75)
      return `/sounds?path=${folder}/${+m[1]}.opus`;
    return null;
  }

  /* --------------------------------------------------------------
     Low-level loader – returns Audio element as soon as the blob exists
  -------------------------------------------------------------- */
  async _load(key, url) {
    if (this.audioCache[key]) return this.audioCache[key];
    if (this.pending.has(key)) return this.pending.get(key);

    const p = (async () => {
      try {
        const { data } = await API.get(url, { responseType: "arraybuffer" });
        const blob = new Blob([data], { type: "audio/ogg" });
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audio.preload = "auto";
        // store raw buffer for WebAudio fast-path
        audio._buffer = data;
        this.audioCache[key] = audio;
        return audio;
      } catch (e) {
        console.error(`[Sound] ${key} failed`, e);
        const silent = new Audio(SILENT_WAV);
        this.audioCache[key] = silent;
        return silent;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, p);
    return p;
  }

  /* --------------------------------------------------------------
     preloadSounds – **keeps the old signature** (returns Promise)
  -------------------------------------------------------------- */
  async preloadSounds(language) {
    if (this.loadedLang === language && Object.keys(this.audioCache).length)
      return;

    if (this.loadedLang && this.loadedLang !== language) this._clear();

    this.loadedLang = language;
    const jobs = [];

    // static files
    const statics = [
      "game_start",
      "game_pause",
      "game_finish",
      "winner",
      "you_didnt_win",
      "shuffle",
      "jackpot-running",
      "jackpot-congrats",
    ];
    statics.forEach((k) => {
      const u = this._url(k, language);
      u && jobs.push(this._load(k, u));
    });

    // numbers 1-75
    for (let i = 1; i <= 75; i++) {
      const k = `number_${i}`;
      const u = this._url(k, language);
      u && jobs.push(this._load(k, u));
    }

    // limit concurrency
    const queue = [...jobs];
    const active = [];
    const concurrency = Math.min(MAX_CONCURRENT, jobs.length);

    await new Promise((resolve) => {
      const next = () => {
        while (active.length < concurrency && queue.length) {
          const p = queue.shift();
          active.push(p);
          p.finally(() => {
            active.splice(active.indexOf(p), 1);
            if (active.length + queue.length === 0) resolve();
            else next();
          });
        }
        if (active.length === 0 && queue.length === 0) resolve();
      };
      next();
    });

    console.log("Audio cache keys:", Object.keys(this.audioCache));
  }

  /* --------------------------------------------------------------
     playSound – **exact same API as the old version**
  -------------------------------------------------------------- */
  playSound(key, options = {}) {
    // winner / loser priority (unchanged)
    if (key === "winner") {
      this.lastWinnerAt = Date.now();
      const lose = this.audioCache["you_didnt_win"];
      if (lose) {
        try {
          lose.pause();
          lose.currentTime = 0;
        } catch {}
      }
    } else if (key === "you_didnt_win") {
      if (Date.now() - this.lastWinnerAt < 2000) return;
    }

    const audio = this.audioCache[key];
    if (!audio) {
      // lazy-load + fire-and-forget
      const url = this._url(key, options.language || this.loadedLang || "am");
      if (url) this._load(key, url).then((a) => this._playAudio(a, options));
      return;
    }
    this._playAudio(audio, options);
  }

  /* --------------------------------------------------------------
     Internal fast playback (HTMLAudio fallback + WebAudio fast-path)
  -------------------------------------------------------------- */
  _playAudio(audio, { loop = false, stop = false } = {}) {
    if (stop) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }

    // Prefer WebAudio when we have the raw buffer (zero latency)
    if (audio._buffer) {
      this.ctx
        .decodeAudioData(audio._buffer.slice(0), (buffer) => {
          const src = this.ctx.createBufferSource();
          src.buffer = buffer;
          src.loop = loop;
          src.connect(this.gain);
          src.start(0);
        })
        .catch(() => {
          // fallback to HTMLAudio
          audio.loop = loop;
          audio.currentTime = 0;
          audio.play().catch(() => {});
        });
    } else {
      audio.loop = loop;
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }

  /* --------------------------------------------------------------
     playSoundAwait – **keeps the old awaitable behaviour**
  -------------------------------------------------------------- */
  playSoundAwait(key, options = {}) {
    const audio = this.audioCache[key];
    if (!audio) {
      console.warn(`Audio for ${key} not found in cache`);
      return Promise.resolve();
    }
    if (options.stop) {
      audio.pause();
      audio.currentTime = 0;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const onEnded = () => {
        try {
          audio.removeEventListener("ended", onEnded);
        } catch {}
        resolve();
      };
      try {
        audio.loop = options.loop || false;
        audio.currentTime = 0;
        audio.addEventListener("ended", onEnded, { once: true });

        const safetyMs = Math.max(
          700,
          Math.min(2500, (audio.duration || 1) * 1000)
        );
        const t = setTimeout(() => {
          try {
            audio.removeEventListener("ended", onEnded);
          } catch {}
          resolve();
        }, safetyMs);

        audio.play().catch((err) => {
          console.error(`Error playing sound ${key}:`, err);
          try {
            audio.removeEventListener("ended", onEnded);
          } catch {}
          clearTimeout(t);
          resolve();
        });
      } catch (e) {
        console.error(`Failed to play sound ${key}:`, e);
        resolve();
      }
    });
  }

  /* --------------------------------------------------------------
     playNumberSequence – unchanged
  -------------------------------------------------------------- */
  async playNumberSequence(numbers = []) {
    for (const n of numbers) {
      const key = `number_${Number(n)}`;
      await this.playSoundAwait(key);
    }
  }

  /* --------------------------------------------------------------
     Helper: stop a sound
  -------------------------------------------------------------- */
  stop(key) {
    this.playSound(key, { stop: true });
  }

  /* --------------------------------------------------------------
     Clean up old language cache
  -------------------------------------------------------------- */
  _clear() {
    Object.values(this.audioCache).forEach((a) => {
      a.pause();
      if (a.src && a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
    });
    this.audioCache = {};
    this.pending.clear();
  }
}

/* --------------------------------------------------------------
   Export a **singleton** (exactly like the old file)
-------------------------------------------------------------- */
export default new SoundService();
