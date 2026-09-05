import test from "node:test";
import assert from "node:assert/strict";
import {frameDifference, comparePreviewFrames} from "../web/js/vision/frameFreshness.js";

function texture(shift = 0, gain = 1, offset = 0) {
  return Uint8Array.from({length: 1024}, (_, i) => {
    const x = (i % 32 + shift + 32) % 32, y = Math.floor(i / 32);
    return gain * (30 + ((x * 37 + y * 79 + x * y * 11) % 140)) + offset;
  });
}

test("one thumbnail pixel of hand shake no longer discards a valid response", () => {
  const a = texture(), b = texture(1);
  assert.ok(frameDifference(a, b) > 12); // v0.31 would discard this response
  const comparison = comparePreviewFrames(a, b);
  assert.equal(comparison.fresh, true);
  assert.equal(comparison.difference, 0);
});

test("uniform camera exposure offset/gain does not imply geometry movement", () => {
  assert.equal(comparePreviewFrames(texture(), texture(0, 1.25, 10)).fresh, true);
});

test("larger movement or a replaced scene remains ineligible for READY", () => {
  assert.equal(comparePreviewFrames(texture(), texture(5)).fresh, false);
  assert.equal(comparePreviewFrames(texture(), new Uint8Array(1024)).fresh, false);
  assert.equal(comparePreviewFrames(texture(), null).fresh, false);
});
