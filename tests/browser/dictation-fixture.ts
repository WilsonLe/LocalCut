import type { BrowserContext } from '@playwright/test';

/** Synthetic microphone waveform with native Chrome MediaRecorder/decoding. */
export async function installDictationMicrophone(context: BrowserContext) {
  await context.addInitScript(() => {
    let stopped = 0;
    let latest: AudioContext | undefined;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const audio = new AudioContext();
        latest = audio;
        const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator();
        oscillator.frequency.value = 300;
        const gain = audio.createGain();
        gain.gain.value = 0.1;
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        await audio.resume();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            stopped++;
            stop();
            oscillator.stop();
            void audio.close();
          };
        }
        return destination.stream;
      },
    });
    Object.assign(window, {
      dictationFixture: {
        stopped: () => stopped,
        seconds: () => latest?.currentTime ?? 0,
      },
    });
  });
}
