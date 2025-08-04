import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError, NotFoundError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }
  if (video.userID !== userID) {
    throw new UserForbiddenError("Not authorized to upload video");
  }

  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Invalid video");
  }

  const MAX_SIZE = 1024 * 1024 * 1024; // 1GB
  if (file.size > MAX_SIZE) {
    throw new BadRequestError("Video too large");
  }

  const fileType = file.type;
  if (fileType !== "video/mp4") {
    throw new BadRequestError("Wrong file format");
  }

  await Bun.write(`${cfg.assetsRoot}/${videoId}.${fileType}`, file);

  await cfg.s3Client
    .file(`${videoId}.${fileType}`, {
      bucket: cfg.s3Bucket,
      partSize: 10 * 1024 * 1024, // 10MB chunks
      queueSize: 4, // 4 chunks
      type: fileType,
    })
    .write(file, {});

  const videoUrl = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoId}.${fileType}`;

  video.videoURL = videoUrl;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}
