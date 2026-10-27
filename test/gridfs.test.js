const test = require("node:test");
const assert = require("node:assert/strict");
const { parseByteRange, isGridFsName } = require("../server/lib/gridfs");

test("GridFS storage references are explicitly namespaced", () => {
  assert.equal(isGridFsName("gridfs:0123456789abcdef01234567"), true);
  assert.equal(isGridFsName("local-file.pdf"), false);
});

test("byte ranges support explicit, open-ended, and suffix requests", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-200", 100), { start: 0, end: 99 });
});

test("invalid and unsatisfiable byte ranges are rejected", () => {
  assert.equal(parseByteRange("bytes=100-", 100), false);
  assert.equal(parseByteRange("bytes=9-2", 100), false);
  assert.equal(parseByteRange("bytes=0-1,4-5", 100), false);
  assert.equal(parseByteRange("items=0-1", 100), false);
  assert.equal(parseByteRange("bytes=-0", 100), false);
  assert.equal(parseByteRange("bytes=0-", 0), false);
});
