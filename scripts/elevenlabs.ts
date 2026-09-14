/**
 * Generate demo-video media through ElevenLabs: narration, sound effects,
 * music and still images. Everything lands in `media/generated/`, which is
 * gitignored — generated assets are rendered, not committed.
 *
 *   pnpm media voices
 *   pnpm media speech "AfterVisit calls the patient." [--voice <id>] [--out name]
 *   pnpm media sfx "a phone ringing twice" [--seconds 3]
 *   pnpm media music "calm ambient piano" [--seconds 30]
 *   pnpm media image "a clinician's desk at dusk" [--model gpt-image-2] [--aspect 16:9] [--ref frame.png]
 *
 * Talks to ElevenLabs only. Never CALL-E, and never dials anyone. Every call
 * except `voices` spends credits. This footage ends up in a published video,
 * so prompts use fictional names and never a real phone number.
 */

import { config } from "dotenv";

config({ path: ".env" });

import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { ElevenLabs, ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const OUT_DIR = join(process.cwd(), "media/generated");
// "George" — a premade voice every account has.
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function positional(args: string[]): string {
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) i++;
    else words.push(args[i]);
  }
  const text = words.join(" ").trim();
  if (!text) throw new Error("Missing the text or prompt to generate from.");
  return text;
}

function outPath(args: string[], kind: string, ext: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const name = flag(args, "out") ?? `${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  return join(OUT_DIR, name.includes(".") ? name : `${name}.${ext}`);
}

async function save(audio: ReadableStream<Uint8Array>, path: string) {
  await pipeline(Readable.fromWeb(audio as WebReadableStream<Uint8Array>), createWriteStream(path));
  console.log(`wrote ${path}`);
}

/** Every `--ref <path>` as an inline image reference. */
function refs(args: string[]): ElevenLabs.ImageReference[] {
  const out: ElevenLabs.ImageReference[] = [];
  args.forEach((a, i) => {
    if (a !== "--ref" || !args[i + 1]) return;
    const path = args[i + 1];
    const mimeType = /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : "image/png";
    out.push({ type: "inline_base64", contentBase64: readFileSync(path).toString("base64"), mimeType });
  });
  return out;
}

async function image(client: ElevenLabsClient, args: string[]) {
  const request = {
    modelId: flag(args, "model") ?? "gpt-image-2",
    prompt: positional(args),
    aspectRatio: flag(args, "aspect") ?? "16:9",
    // A reference image keeps characters and style consistent across a sequence of frames.
    ...(refs(args).length ? { images: refs(args) } : {}),
  } as ElevenLabs.ImageGenerationRequest;
  const { id } = await client.flows.image.create(request);
  console.log(`generation ${id} started with ${request.modelId}`);

  // Image generation is asynchronous: poll until it settles, up to five minutes.
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const gen = await client.flows.image.get(id);
    if (gen.status === "completed") {
      const res = await fetch(gen.contentUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const path = outPath(args, "image", gen.contentMimeType.split("/")[1] ?? "png");
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      console.log(`wrote ${path}`);
      return;
    }
    if (gen.status === "failed") throw new Error(`${gen.failureReason}: ${gen.errorMessage}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Generation ${id} did not finish in five minutes.`);
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set in .env.");
  const client = new ElevenLabsClient({
    apiKey,
    // Accounts with data residency (e.g. https://api.in.residency.elevenlabs.io) must use their region.
    ...(process.env.ELEVENLABS_BASE_URL ? { baseUrl: process.env.ELEVENLABS_BASE_URL } : {}),
  });

  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "voices": {
      const { voices } = await client.voices.search({ pageSize: 100 });
      for (const v of voices) console.log(`${v.voiceId}  ${v.name}  (${v.category})`);
      return;
    }
    case "speech":
      return save(
        await client.textToSpeech.convert(flag(args, "voice") ?? DEFAULT_VOICE, {
          text: positional(args),
          modelId: "eleven_multilingual_v2",
          outputFormat: "mp3_44100_128",
        }),
        outPath(args, "speech", "mp3"),
      );
    case "sfx": {
      const seconds = flag(args, "seconds");
      return save(
        await client.textToSoundEffects.convert({
          text: positional(args),
          ...(seconds ? { durationSeconds: Number(seconds) } : {}),
        }),
        outPath(args, "sfx", "mp3"),
      );
    }
    case "music":
      return save(
        await client.music.compose({
          prompt: positional(args),
          musicLengthMs: Number(flag(args, "seconds") ?? 30) * 1000,
          forceInstrumental: true,
        }),
        outPath(args, "music", "mp3"),
      );
    case "image":
      return image(client, args);
    default:
      throw new Error("Usage: pnpm media <voices|speech|sfx|music|image> \"<text>\" [--flags]");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
