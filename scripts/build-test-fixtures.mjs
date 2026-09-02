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

// Node fixtures
esbuild("packages/mcp/src/client-config.ts", "/tmp/feedback-mark-mcp-client-config.mjs", { platform: "node", target: "node18" });
esbuild("packages/protocol/src/index.ts", "/tmp/annote-protocol.mjs", { platform: "node", target: "node18" });
esbuild("packages/mcp/src/index.ts", "/tmp/annote-mcp.mjs", { platform: "node", target: "node18" });

// Ensure dist/mcp/cli.js is built for stdio test
run("tsc", ["-p", "tsconfig.mcp.json", "--noEmit"]);
mkdirSync("dist/mcp", { recursive: true });
run("esbuild", ["packages/mcp/src/cli.ts", "--bundle", "--platform=node", "--format=esm", "--target=node18", "--outfile=dist/mcp/cli.js"]);
run("chmod", ["+x", "dist/mcp/cli.js"]);

console.log("Test fixtures built");
