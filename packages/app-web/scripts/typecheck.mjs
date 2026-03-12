import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(".next/types")) {
  run("next", ["build"]);
}

run("tsc", ["-p", "tsconfig.json", "--noEmit"]);
