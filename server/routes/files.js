const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { z } = require("zod");
const { Lesson } = require("../models");
const { HttpError, asyncRoute, validate } = require("../lib/errors");
const { hasCourseAccess } = require("../lib/access");
const { getStoredFile, isGridFsName, openStoredFile, parseByteRange } = require("../lib/gridfs");
const { uploadDirectory } = require("../config");

const idSchema = z.string().regex(/^[a-f\d]{24}$/i);
const router = express.Router();

function setInlineHeaders(res, name, mimeType, size) {
  const safeName = encodeURIComponent(name).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  res.set({
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="media"; filename*=UTF-8''${safeName}`,
    "Content-Type": mimeType,
    "X-Content-Type-Options": "nosniff"
  });
  if (Number.isFinite(size)) res.set("Content-Length", String(size));
}

async function streamGridFs(res, storageName, name, mimeType, rangeHeader) {
  const stored = await getStoredFile(storageName);
  if (!stored) throw new HttpError(404, "الملف غير موجود في قاعدة البيانات.");
  const range = rangeHeader ? parseByteRange(rangeHeader, stored.file.length) : null;
  if (rangeHeader && !range) {
    res.status(416).set({
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${stored.file.length}`,
      "Content-Length": "0"
    }).end();
    return;
  }
  setInlineHeaders(res, name, mimeType, range ? range.end - range.start + 1 : stored.file.length);
  if (range) {
    res.status(206).set("Content-Range", `bytes ${range.start}-${range.end}/${stored.file.length}`);
  }
  const stream = openStoredFile(stored.id, range ? { start: range.start, end: range.end + 1 } : undefined);
  stream.on("error", error => res.destroy(error));
  stream.pipe(res);
}

async function streamLegacyFile(res, storageName, name, mimeType) {
  const filePath = path.join(uploadDirectory, path.basename(storageName));
  let stat;
  try { stat = await fs.promises.stat(filePath); }
  catch (error) {
    if (error.code === "ENOENT") throw new HttpError(404, "الملف غير موجود.");
    throw error;
  }
  setInlineHeaders(res, name, mimeType, stat.size);
  fs.createReadStream(filePath).on("error", error => res.destroy(error)).pipe(res);
}

async function streamProtectedFile(res, storageName, name, mimeType, rangeHeader) {
  if (isGridFsName(storageName)) return streamGridFs(res, storageName, name, mimeType, rangeHeader);
  return streamLegacyFile(res, storageName, name, mimeType);
}

router.get("/:lessonId/:resourceId", asyncRoute(async (req, res) => {
  const lessonId = validate(idSchema, req.params.lessonId);
  const resourceId = validate(idSchema, req.params.resourceId);
  const lesson = await Lesson.findOne({ _id: lessonId, published: true }).lean();
  if (!lesson || !await hasCourseAccess(req.user, lesson.course)) {
    throw new HttpError(req.user ? 403 : 401, "لا تملك صلاحية تنزيل هذا الملف.");
  }
  const resource = lesson.resources.find(row => String(row._id) === resourceId);
  if (!resource) throw new HttpError(404, "الملف غير موجود.");
  await streamProtectedFile(res, resource.storageName, resource.name, resource.mimeType, req.get("range"));
}));

const videoRouter = express.Router();
videoRouter.get("/:lessonId", asyncRoute(async (req, res) => {
  const lessonId = validate(idSchema, req.params.lessonId);
  const lesson = await Lesson.findOne({ _id: lessonId, published: true }).lean();
  if (!lesson || !await hasCourseAccess(req.user, lesson.course)) {
    throw new HttpError(req.user ? 403 : 401, "لا تملك صلاحية مشاهدة هذا الفيديو.");
  }
  if (lesson.videoFile) {
    return streamProtectedFile(
      res,
      lesson.videoFile.storageName,
      lesson.videoFile.name,
      lesson.videoFile.mimeType,
      req.get("range")
    );
  }
  throw new HttpError(404, "الفيديو غير موجود.");
}));

module.exports = { fileRoutes: router, videoRoutes: videoRouter };
