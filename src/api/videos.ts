import { rm } from "fs/promises";
import path from "path";
import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError, NotFoundError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { uploadVideoToS3 } from "../s3";
import {
  dbVideoToSignedVideo,
  getVideoAspectRatio,
  processVideoForFastStart,
} from "../helpers/videos";

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

  const tempFilePath = path.join("/tmp", `${videoId}.mp4`);
  await Bun.write(tempFilePath, file);
  const tempProcessedFilePath = await processVideoForFastStart(tempFilePath);
  const videoAspectRatioAndOrientation = await getVideoAspectRatio(
    tempProcessedFilePath,
  );

  let key = `${videoAspectRatioAndOrientation.orientation}/${videoId}.processed.mp4`;
  await uploadVideoToS3(cfg, key, tempProcessedFilePath, "video/mp4");

  video.videoURL = key;
  updateVideo(cfg.db, video);

  await Promise.all([
    rm(tempFilePath, { force: true }),
    rm(tempProcessedFilePath),
  ]);
  
  const signedVideo = dbVideoToSignedVideo(cfg, video);

  return respondWithJSON(200, signedVideo);
}
