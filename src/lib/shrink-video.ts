import { SHRINK_ABOVE_BYTES } from "@/lib/athlete-videos";

/**
 * Shrinks a video on the phone before it goes up: 720p on its short side, about 1.5 Mbit/s,
 * at most 30 frames a second. That is plenty to judge depth, bar path and lockout, and turns
 * a 20 s clip from ~20 MB into ~4 MB, which is what keeps uploads quick at the gym and the
 * bucket inside its free tier. It runs in the browser (WebCodecs, through mediabunny, loaded
 * only when a video is picked). A phone that can't, or a clip it can't read, sends the
 * original instead; so does a clip that is already small.
 */

const SHORT_SIDE = 720;
const VIDEO_BITS = 1_500_000;
const AUDIO_BITS = 96_000;
const MAX_FPS = 30;

export type Shrunk = { file: File; shrunk: boolean };

/** Even, as encoders want, and never larger than the original. */
function fit(width: number, height: number): { width: number; height: number } {
  const short = Math.min(width, height);
  const scale = short > SHORT_SIDE ? SHORT_SIDE / short : 1;
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export async function shrinkVideo(file: File, onProgress?: (share: number) => void): Promise<Shrunk> {
  if (file.size <= SHRINK_ABOVE_BYTES || typeof VideoEncoder === "undefined") return { file, shrunk: false };
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { file, shrunk: false };
    const size = fit(track.displayWidth, track.displayHeight);
    if (!(await mb.canEncodeVideo("avc", { ...size, quality: new mb.Quality(VIDEO_BITS) }))) return { file, shrunk: false };

    // Only a faster clip is slowed to 30 fps; a 24 or 25 fps one keeps its own rate.
    const fps = (await track.computePacketStats(60)).averagePacketRate;
    const frameRate = fps > MAX_FPS + 1 ? MAX_FPS : undefined;

    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { ...size, fit: "contain", codec: "avc", quality: new mb.Quality(VIDEO_BITS), frameRate },
      audio: { codec: "aac", quality: new mb.Quality(AUDIO_BITS) },
    });
    if (!conversion.isValid) return { file, shrunk: false };
    if (onProgress) conversion.onProgress = (share) => onProgress(Math.min(1, share));
    await conversion.execute();

    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength === 0 || buffer.byteLength >= file.size) return { file, shrunk: false };
    const name = `${file.name.replace(/\.[^.]*$/, "") || "video"}.mp4`;
    return { file: new File([buffer], name, { type: "video/mp4", lastModified: file.lastModified }), shrunk: true };
  } catch {
    return { file, shrunk: false };
  }
}
