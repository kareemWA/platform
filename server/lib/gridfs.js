const fs = require("node:fs");
const mongoose = require("mongoose");
const { pipeline } = require("node:stream/promises");

const bucketName = "media";
const gridFsPrefix = "gridfs:";

function getBucket() {
  if (!mongoose.connection.db) throw new Error("MongoDB is not connected.");
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
}

function isGridFsName(name) {
  return typeof name === "string" && name.startsWith(gridFsPrefix);
}

function parseGridFsId(name) {
  if (!isGridFsName(name)) throw new Error("Invalid GridFS file reference.");
  const id = name.slice(gridFsPrefix.length);
  if (!/^[a-f\d]{24}$/i.test(id)) throw new Error("Invalid GridFS file reference.");
  return new mongoose.Types.ObjectId(id);
}

async function storeFile(filePath, filename, contentType, metadata = {}) {
  const id = new mongoose.Types.ObjectId();
  const upload = getBucket().openUploadStream(filename, {
    id,
    contentType,
    metadata
  });
  try {
    await pipeline(fs.createReadStream(filePath), upload);
    return `${gridFsPrefix}${id.toHexString()}`;
  } catch (error) {
    try {
      await mongoose.connection.db.collection(`${bucketName}.chunks`).deleteMany({ files_id: id });
      await mongoose.connection.db.collection(`${bucketName}.files`).deleteOne({ _id: id });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "GridFS upload failed and its partial data could not be cleaned up.");
    }
    throw error;
  }
}

async function deleteStoredFile(name) {
  if (!isGridFsName(name)) return false;
  await getBucket().delete(parseGridFsId(name));
  return true;
}

async function getStoredFile(name) {
  const id = parseGridFsId(name);
  const file = await mongoose.connection.db.collection(`${bucketName}.files`).findOne({ _id: id });
  return file ? { id, file } : null;
}

function openStoredFile(id, range) {
  return getBucket().openDownloadStream(id, range || {});
}

function parseByteRange(header, size) {
  if (typeof header !== "string" || !header.startsWith("bytes=") || header.includes(",")) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

module.exports = {
  gridFsPrefix,
  isGridFsName,
  storeFile,
  deleteStoredFile,
  getStoredFile,
  openStoredFile,
  parseByteRange
};
