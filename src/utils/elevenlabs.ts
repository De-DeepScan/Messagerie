// src/utils/elevenlabs.ts

const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
const BASE_URL = "https://api.elevenlabs.io/v1";

interface Voice {
  voice_id: string;
  name: string;
}

let cachedVoiceId: string | null = null;

export async function getVoiceIdByName(voiceName: string): Promise<string | null> {
  if (cachedVoiceId) return cachedVoiceId;

  try {
    const response = await fetch(`${BASE_URL}/voices`, {
      headers: {
        "xi-api-key": API_KEY,
      },
    });

    if (!response.ok) throw new Error("Failed to fetch voices");

    const data = await response.json();
    const voice = data.voices.find((v: Voice) => 
      v.name.toLowerCase() === voiceName.toLowerCase()
    );

    if (voice) {
      cachedVoiceId = voice.voice_id;
      return voice.voice_id;
    }
    
    console.warn(`ElevenLabs: Voice "${voiceName}" not found.`);
    return null;
  } catch (error) {
    console.error("ElevenLabs Error:", error);
    return null;
  }
}

export async function generateSpeech(text: string, voiceId: string): Promise<HTMLAudioElement | null> {
  try {
    const response = await fetch(`${BASE_URL}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": API_KEY,
      },
      body: JSON.stringify({
        text: text,
        // CHANGED: Use multilingual model to support French
        model_id: "eleven_multilingual_v2", 
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) throw new Error("Failed to generate speech");

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    
    audio.onended = () => URL.revokeObjectURL(url);
    
    return audio;
  } catch (error) {
    console.error("ElevenLabs TTS Error:", error);
    return null;
  }
}