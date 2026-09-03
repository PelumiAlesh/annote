import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SRC = new URL("../src/annotator.ts", import.meta.url);

test("Coloris URLs are version-pinned (never @latest)", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("Coloris@v0.25.0/dist/coloris.min.js"));
  assert.ok(src.includes("Coloris@v0.25.0/dist/coloris.min.css"));
  assert.ok(!src.includes("Coloris@latest"));
});

test("Coloris loads fail closed via SRI", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(src.includes("COLORIS_JS_INTEGRITY"));
  assert.ok(src.includes("COLORIS_CSS_INTEGRITY"));
  assert.ok(src.includes("script.integrity"));
  assert.ok(src.includes("link.integrity"));
  assert.ok(src.includes('crossOrigin = "anonymous"'));
});

test("vendored audit copies match the SRI hashes", async () => {
  const src = await readFile(SRC, "utf8");
  for (const [vendorPath, kind] of [
    ["../vendor/coloris/coloris.min.js", "JS"],
    ["../vendor/coloris/coloris.min.css", "CSS"],
  ]) {
    const bytes = await readFile(new URL(vendorPath, import.meta.url));
    const hash = `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
    assert.ok(src.includes(hash), `${kind} hash ${hash} not wired in annotator.ts`);
  }
});
