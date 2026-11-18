import { dirname, join } from "@tauri-apps/api/path";

/**
 * Batch queue for standalone (file) mode: run the same transcription
 * settings over several videos, one after another, and write one .srt
 * next to each source file. Timeline/Resolve/Adobe mode never uses this.
 */

export type BatchFileStatus = "queued" | "running" | "done" | "failed";

export interface BatchQueueItem {
  /** Absolute path of the source video/audio file. */
  path: string;
  status: BatchFileStatus;
  /** Short error message when status is "failed". */
  error?: string;
  /** Absolute path of the written .srt file when status is "done". */
  srtPath?: string | null;
}

export function newBatchQueueItem(path: string): BatchQueueItem {
  return { path, status: "queued", srtPath: null };
}

export function batchFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}

/** `<video-name>.srt` next to the source video, e.g. `aif201-class05.srt`. */
export async function srtPathForVideo(videoPath: string): Promise<string> {
  const dir = await dirname(videoPath);
  const base = batchFileName(videoPath);
  const stem = base.replace(/\.[^/.\\]+$/, "") || base;
  return join(dir, `${stem}.srt`);
}
