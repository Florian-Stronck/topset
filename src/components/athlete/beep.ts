/** A short tone through a context a tap opened (phones only allow sound a touch started); silent without one. */
export function beep(ctx: AudioContext | null, frequency = 880, seconds = 0.8) {
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + seconds);
  } catch {
    // No sound is no reason to lose the round.
  }
}

/** The page's sound, made on a tap; null where the browser has none. */
export function openAudio(held: AudioContext | null): AudioContext | null {
  try {
    const ctx = held ?? new AudioContext();
    void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}
