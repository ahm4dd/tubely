import { file } from "bun";
import { ApiConfig } from "../config";
import { Video } from "../db/videos";
import { generatePresignedURL } from "../s3";

export type VideoOrientation = "landscape" | "portrait";
export type VideoOrientationsWithAspectRatios = Record<
  VideoOrientation,
  number
>;

const videoOrientations = {
  landscape: 16 / 9,
  portrait: 9 / 16,
} as const satisfies VideoOrientationsWithAspectRatios;

export async function getVideoAspectRatio(
  filePath: string,
): Promise<{ orientation: VideoOrientation & "other"; ratio: number }> {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
      cwd: ".",
    },
  );

  const { stdout, stderr } = proc;

  if ((await proc.exited) !== 0) {
    throw new Error(stderr);
  }

  type Streams = {
    programs: [];
    stream_groups: [];
    streams: [
      {
        width: number;
        height: number;
      },
    ];
  };

  let json: Streams = await Bun.readableStreamToJSON(stdout);

  const { width, height } = json.streams[0];
  const aspectRatio = width / height;

  let min: number = Infinity;
  let orientation = "other";

  Object.keys(videoOrientations).forEach((tempOrientation) => {
    const tempAspectRatio =
      videoOrientations[tempOrientation as VideoOrientation];
    const difference = Math.abs(aspectRatio - tempAspectRatio);

    if (difference <= min) {
      min = difference;
      orientation = tempOrientation;
    }

    return;
  });

  return {
    orientation: orientation as VideoOrientation & "other",
    ratio: videoOrientations[orientation as VideoOrientation],
  };
}

export async function processVideoForFastStart(filePath: string) {
  const newPath = filePath.replace(".mp4", ".processed.mp4");

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      filePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      newPath,
    ],
    {
      stdout: "pipe",
      stderr: "inherit",
      cwd: ".",
    },
  );

  const { stderr, stdout } = proc;

  if ((await proc.exited) !== 0) {
    throw new Error("Failed to process video for fast start.");
  }

  return newPath;
}

export function dbVideoToSignedVideo(cfg: ApiConfig, video: Video) {
  video.videoURL = generatePresignedURL(cfg, video.videoURL!);
  return video;
}