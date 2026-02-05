import { io, Socket } from "socket.io-client";

const BACKOFFICE_URL = "http://192.168.10.1:3000"; // ESD MAC
// const BACKOFFICE_URL = "http://192.168.1.46:3000"; // THOMAS HOME
// const BACKOFFICE_URL = "http://10.14.73.40:3000"; // THOMAS ESD

// =====================
// Game Types
// =====================

interface GameAction {
  id: string;
  label: string;
  params?: string[];
}

interface RegisterData {
  gameId: string;
  name: string;
  availableActions: GameAction[];
  role?: string;
}

interface Command {
  type: "command";
  action: string;
  payload: Record<string, unknown>;
}

// =====================
// Audio Types
// =====================

interface AudioConfig {
  enabled: boolean;
  autoUnlock: boolean;
  debug: boolean;
}

interface PlayAmbientPayload {
  soundId: string;
  file: string;
  volume?: number;
}

interface StopAmbientPayload {
  soundId: string;
}

interface VolumeAmbientPayload {
  soundId: string;
  volume: number;
}

interface PlayPresetPayload {
  presetIdx: number;
  file: string;
}

interface PausePresetPayload {
  presetIdx: number;
}

interface SeekPresetPayload {
  presetIdx: number;
  time: number;
}

interface StopPresetPayload {
  presetIdx: number;
}

interface PlayTTSPayload {
  audioBase64: string;
  mimeType?: string;
}

interface VolumePayload {
  volume: number;
}

interface AudioStatus {
  unlocked: boolean;
  enabled: boolean;
  masterVolume: number;
  iaVolume: number;
  activeAmbients: string[];
  activePresets: number[];
}

// =====================
// Socket Connection
// =====================

const socket: Socket = io(BACKOFFICE_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  randomizationFactor: 0.5,
  timeout: 20000,
  autoConnect: true,
});

// =====================
// Game State
// =====================

let registeredData: RegisterData | null = null;
let lastKnownState: Record<string, unknown> = {};

// =====================
// Audio State
// =====================

let audioConfig: AudioConfig = {
  enabled: true,
  autoUnlock: true,
  debug: false,
};

let audioUnlocked = false;
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterVolume = 1;
let iaVolume = 1;

const ambientAudios: Map<string, HTMLAudioElement> = new Map();
const presetAudios: Map<number, HTMLAudioElement> = new Map();
let ttsAudio: HTMLAudioElement | null = null;
let progressInterval: number | null = null;

// =====================
// Audio Helpers
// =====================

function audioLog(msg: string, ...args: unknown[]): void {
  if (audioConfig.debug) {
    console.log(`[gamemaster:audio] ${msg}`, ...args);
  }
}

function initAudioContext(): void {
  if (audioCtx) return;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  audioCtx = new AudioContextClass();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = masterVolume;
  masterGain.connect(audioCtx.destination);
  audioLog("AudioContext initialized");
}

function routeThroughMaster(audio: HTMLAudioElement): void {
  if (!audioCtx || !masterGain) return;
  try {
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(masterGain);
  } catch {
    // Already routed
  }
}

function doUnlockAudio(): void {
  if (audioUnlocked || !audioConfig.enabled) return;

  initAudioContext();

  if (audioCtx) {
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start();
  }

  audioUnlocked = true;
  audioLog("Audio unlocked via user interaction");

  socket.emit("register-audio-player", {});
  startProgressReporting();
  removeUnlockListeners();
}

const unlockEvents = ["click", "touchstart", "keydown"] as const;

function addUnlockListeners(): void {
  if (typeof window === "undefined") return;
  for (const event of unlockEvents) {
    window.addEventListener(event, doUnlockAudio, {
      once: true,
      passive: true,
    });
  }
  audioLog("User interaction listeners added");
}

function removeUnlockListeners(): void {
  if (typeof window === "undefined") return;
  for (const event of unlockEvents) {
    window.removeEventListener(event, doUnlockAudio);
  }
}

function startProgressReporting(): void {
  if (progressInterval !== null) return;

  progressInterval = window.setInterval(() => {
    for (const [idx, audio] of presetAudios) {
      if (!audio.paused && audio.duration) {
        socket.emit("audio:preset-progress", {
          presetIdx: idx,
          currentTime: audio.currentTime,
          duration: audio.duration,
        });
      }
    }
  }, 250);
}

function stopProgressReporting(): void {
  if (progressInterval !== null) {
    window.clearInterval(progressInterval);
    progressInterval = null;
  }
}

function stopAllAudio(): void {
  for (const [, audio] of ambientAudios) {
    audio.pause();
    audio.src = "";
  }
  ambientAudios.clear();

  for (const [, audio] of presetAudios) {
    audio.pause();
    audio.src = "";
  }
  presetAudios.clear();

  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.src = "";
    ttsAudio = null;
  }

  audioLog("All audio stopped");
}

// =====================
// Audio Event Listeners
// =====================

function setupAudioEventListeners(): void {
  // Ambient sounds
  socket.on("audio:play-ambient", (data: PlayAmbientPayload) => {
    if (!audioUnlocked || !audioConfig.enabled) return;
    const { soundId, file, volume } = data;
    audioLog("Play ambient:", soundId, file);

    const existing = ambientAudios.get(soundId);
    if (existing) {
      existing.pause();
      existing.src = "";
    }

    const audio = new Audio(`${BACKOFFICE_URL}/sounds/${file}`);
    audio.loop = true;
    audio.volume = volume ?? 0.5;
    routeThroughMaster(audio);
    audio.play().catch((e) => audioLog("Play ambient error:", e.message));
    ambientAudios.set(soundId, audio);
  });

  socket.on("audio:stop-ambient", (data: StopAmbientPayload) => {
    const { soundId } = data;
    audioLog("Stop ambient:", soundId);
    const audio = ambientAudios.get(soundId);
    if (audio) {
      audio.pause();
      audio.src = "";
      ambientAudios.delete(soundId);
    }
  });

  socket.on("audio:volume-ambient", (data: VolumeAmbientPayload) => {
    const { soundId, volume } = data;
    const audio = ambientAudios.get(soundId);
    if (audio) {
      audio.volume = volume;
      audioLog("Ambient volume:", soundId, volume);
    }
  });

  // Presets
  socket.on("audio:play-preset", (data: PlayPresetPayload) => {
    if (!audioUnlocked || !audioConfig.enabled) return;
    const { presetIdx, file } = data;

    const existing = presetAudios.get(presetIdx);
    if (existing && existing.src) {
      audioLog("Resume preset:", presetIdx);
      existing.volume = iaVolume;
      existing.play().catch((e) => audioLog("Resume preset error:", e.message));
      return;
    }

    audioLog("Play preset:", presetIdx, file);
    const audio = new Audio(`${BACKOFFICE_URL}/presets/${file}`);
    audio.volume = iaVolume;
    routeThroughMaster(audio);

    audio.onended = () => {
      socket.emit("audio:preset-progress", {
        presetIdx,
        currentTime: audio.duration,
        duration: audio.duration,
        ended: true,
      });
      presetAudios.delete(presetIdx);
    };

    audio.play().catch((e) => audioLog("Play preset error:", e.message));
    presetAudios.set(presetIdx, audio);
  });

  socket.on("audio:pause-preset", (data: PausePresetPayload) => {
    const { presetIdx } = data;
    audioLog("Pause preset:", presetIdx);
    const audio = presetAudios.get(presetIdx);
    if (audio) audio.pause();
  });

  socket.on("audio:seek-preset", (data: SeekPresetPayload) => {
    const { presetIdx, time } = data;
    audioLog("Seek preset:", presetIdx, "to", time);
    const audio = presetAudios.get(presetIdx);
    if (audio) audio.currentTime = time;
  });

  socket.on("audio:stop-preset", (data: StopPresetPayload) => {
    const { presetIdx } = data;
    audioLog("Stop preset:", presetIdx);
    const audio = presetAudios.get(presetIdx);
    if (audio) {
      audio.pause();
      audio.src = "";
      presetAudios.delete(presetIdx);
    }
  });

  // TTS
  socket.on("audio:play-tts", (data: PlayTTSPayload) => {
    if (!audioUnlocked || !audioConfig.enabled) return;
    const { audioBase64, mimeType } = data;
    audioLog("Play TTS");

    if (ttsAudio) {
      ttsAudio.pause();
      ttsAudio.src = "";
    }

    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
    const url = URL.createObjectURL(blob);

    ttsAudio = new Audio(url);
    ttsAudio.volume = iaVolume;
    routeThroughMaster(ttsAudio);
    ttsAudio.onended = () => {
      URL.revokeObjectURL(url);
      ttsAudio = null;
    };
    ttsAudio.play().catch((e) => audioLog("TTS play error:", e.message));
  });

  // Volume controls
  socket.on("audio:volume-ia", (data: VolumePayload) => {
    iaVolume = data.volume;
    audioLog("IA volume:", Math.round(iaVolume * 100) + "%");
    for (const audio of presetAudios.values()) {
      audio.volume = iaVolume;
    }
    if (ttsAudio) ttsAudio.volume = iaVolume;
  });

  socket.on("audio:master-volume", (data: VolumePayload) => {
    masterVolume = data.volume;
    audioLog("Master volume:", Math.round(masterVolume * 100) + "%");
    if (masterGain) masterGain.gain.value = masterVolume;
  });

  // Stop all
  socket.on("audio:stop-all", () => {
    audioLog("Stop all audio");
    stopAllAudio();
  });
}

// =====================
// Game Connection Handlers
// =====================

socket.on("connect", () => {
  console.log("[gamemaster] Connected to backoffice");
  if (registeredData) {
    socket.emit("register", registeredData);
    if (Object.keys(lastKnownState).length > 0) {
      setTimeout(() => {
        socket.emit("state_update", { state: lastKnownState });
      }, 100);
    }
  }

  if (audioUnlocked && audioConfig.enabled) {
    socket.emit("register-audio-player", {});
  }
});

socket.on("disconnect", (reason: string) => {
  console.log(`[gamemaster] Disconnected: ${reason}`);
});

socket.io.on("reconnect_attempt", (attempt: number) => {
  console.log(`[gamemaster] Reconnection attempt ${attempt}`);
});

socket.io.on("reconnect", (attempt: number) => {
  console.log(`[gamemaster] Reconnected after ${attempt} attempts`);
});

socket.io.on("reconnect_failed", () => {
  console.error("[gamemaster] Reconnection failed");
});

// =====================
// Audio Visibility Handler
// =====================

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      audioCtx?.state === "suspended"
    ) {
      audioCtx.resume();
    }
  });
}

// =====================
// Audio Auto-Init
// =====================

(function initAudio() {
  if (typeof window === "undefined") return;

  setupAudioEventListeners();

  if (audioConfig.autoUnlock) {
    addUnlockListeners();
  }
})();

// =====================
// Gamemaster Export
// =====================

export const gamemaster = {
  // Game API
  register(
    gameId: string,
    name: string,
    availableActions: GameAction[] = [],
    role?: string,
  ) {
    registeredData = { gameId, name, availableActions, role };
    socket.emit("register", registeredData);
  },

  onCommand(
    callback: (cmd: {
      action: string;
      payload: Record<string, unknown>;
    }) => void,
  ) {
    // Remove previous listener to prevent duplicates (React StrictMode calls useEffect twice)
    socket.off("command");
    socket.on("command", (data: Command) => {
      callback({ action: data.action, payload: data.payload });
    });
  },

  updateState(state: Record<string, unknown>) {
    lastKnownState = { ...lastKnownState, ...state };
    socket.emit("state_update", { state: lastKnownState });
  },

  resetState() {
    lastKnownState = {};
  },

  sendEvent(name: string, data: Record<string, unknown> = {}) {
    socket.emit("event", { name, data });
  },

  sendMessage(message: unknown) {
    socket.emit("game-message", message);
  },

  onMessage(callback: (message: unknown) => void) {
    socket.off("game-message");
    socket.on("game-message", callback);
  },

  onConnect(callback: () => void) {
    socket.off("connect", callback);
    socket.on("connect", callback);
  },

  onDisconnect(callback: () => void) {
    socket.off("disconnect", callback);
    socket.on("disconnect", callback);
  },

  get isConnected(): boolean {
    return socket.connected;
  },

  // Audio API
  get isAudioReady(): boolean {
    return audioUnlocked && audioConfig.enabled;
  },

  get audioStatus(): AudioStatus {
    return {
      unlocked: audioUnlocked,
      enabled: audioConfig.enabled,
      masterVolume,
      iaVolume,
      activeAmbients: [...ambientAudios.keys()],
      activePresets: [...presetAudios.keys()],
    };
  },

  configureAudio(config: Partial<AudioConfig>): void {
    audioConfig = { ...audioConfig, ...config };
    console.log("[gamemaster] Audio configured:", audioConfig);

    if (
      config.enabled &&
      config.autoUnlock !== false &&
      typeof window !== "undefined"
    ) {
      addUnlockListeners();
    }

    if (config.enabled === false) {
      stopAllAudio();
      stopProgressReporting();
    }
  },

  unlockAudio(): boolean {
    if (audioUnlocked) return true;
    if (!audioConfig.enabled) return false;
    doUnlockAudio();
    return audioUnlocked;
  },

  disableAudio(): void {
    audioConfig.enabled = false;
    stopAllAudio();
    stopProgressReporting();
  },

  enableAudio(): void {
    audioConfig.enabled = true;
    if (audioUnlocked) {
      socket.emit("register-audio-player", {});
      startProgressReporting();
    }
  },

  socket,
};

// =====================
// Global Window Export
// =====================

declare global {
  interface Window {
    gamemaster: typeof gamemaster;
  }
}
window.gamemaster = gamemaster;
