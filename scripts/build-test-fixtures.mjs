import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function esbuild(src, outfile, opts = {}) {
  const platform = opts.platform ?? "browser";
  const target = opts.target ?? "es2020";
  run("esbuild", [src, "--bundle", "--format=esm", `--platform=${platform}`, `--target=${target}`, `--outfile=${outfile}`]);
}

// Browser fixtures
esbuild("src/style-intelligence.ts", "/tmp/feedback-mark-style-intelligence.mjs", { platform: "browser", target: "es2020" });
esbuild("src/animation-math.ts", "/tmp/feedback-mark-animation-math.mjs", { platform: "browser", target: "es2020" });
esbuild("src/animation-adapter.ts", "/tmp/feedback-mark-animation-adapter.mjs", { platform: "browser", target: "es2020" });
esbuild("src/animation-preview.ts", "/tmp/feedback-mark-animation-preview.mjs", { platform: "browser", target: "es2020" });
esbuild("src/animation-format.ts", "/tmp/feedback-mark-animation-format.mjs", { platform: "browser", target: "es2020" });
esbuild("src/react-adapter.ts", "/tmp/feedback-mark-react-adapter.mjs", { platform: "browser", target: "es2020" });
esbuild("src/ui-label.ts", "/tmp/feedback-mark-ui-label.mjs", { platform: "browser", target: "es2020" });
esbuild("src/settings.ts", "/tmp/feedback-mark-settings.mjs", { platform: "browser", target: "es2020" });
esbuild("src/theme.ts", "/tmp/feedback-mark-theme.mjs", { platform: "browser", target: "es2020" });
esbuild("src/background-helpers.ts", "/tmp/feedback-mark-background-helpers.mjs", { platform: "browser", target: "es2020" });
esbuild("src/structure-helpers.ts", "/tmp/feedback-mark-structure-helpers.mjs", { platform: "browser", target: "es2020" });
esbuild("src/html-escape.ts", "/tmp/feedback-mark-html-escape.mjs", { platform: "browser", target: "es2020" });
esbuild("src/annotation-storage.ts", "/tmp/feedback-mark-annotation-storage.mjs", { platform: "browser", target: "es2020" });
esbuild("src/shortcuts.ts", "/tmp/feedback-mark-shortcuts.mjs", { platform: "browser", target: "es2020" });
esbuild("src/confirm-dialog.ts", "/tmp/feedback-mark-confirm-dialog.mjs", { platform: "browser", target: "es2020" });
esbuild("src/dictation.ts", "/tmp/feedback-mark-dictation.mjs", { platform: "browser", target: "es2020" });
esbuild("src/version.ts", "/tmp/feedback-mark-version.mjs", { platform: "browser", target: "es2020" });
esbuild("src/settings-view.ts", "/tmp/feedback-mark-settings-view.mjs", { platform: "browser", target: "es2020" });

// Node fixtures
esbuild("packages/mcp/src/client-config.ts", "/tmp/feedback-mark-mcp-client-config.mjs", { platform: "node", target: "node18" });
esbuild("packages/protocol/src/index.ts", "/tmp/annote-protocol.mjs", { platform: "node", target: "node18" });
esbuild("packages/mcp/src/index.ts", "/tmp/annote-mcp.mjs", { platform: "node", target: "node18" });

// Hermetic stdio fixture: build the CLI to a temp path outside the repo so
// `npm test` never mutates tracked release files under dist/.
// The stdio test resolves this path via /tmp/annote-test-cli-path.
import { writeFileSync } from "node:fs";

const testDistDir = "/tmp/annote-test-dist/mcp";
mkdirSync(testDistDir, { recursive: true });
run("esbuild", ["packages/mcp/src/cli.ts", "--bundle", "--platform=node", "--format=esm", "--target=node18", `--outfile=${testDistDir}/cli.js`]);
run("chmod", ["+x", `${testDistDir}/cli.js`]);
writeFileSync("/tmp/annote-test-cli-path", `${testDistDir}/cli.js\n`);

console.log("Test fixtures built");
