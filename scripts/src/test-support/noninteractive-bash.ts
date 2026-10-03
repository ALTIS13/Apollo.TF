import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";

export function runFixtureBash(
  args: readonly string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding" | "shell"> & {
    encoding?: "utf8";
  } = {},
) {
  const executable =
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
  const environment = { ...(options.env ?? process.env) };
  // Noninteractive fixtures must not source caller-controlled startup files.
  delete environment.BASH_ENV;
  delete environment.ENV;
  return spawnSync(executable, ["--noprofile", "--norc", ...args], {
    ...options,
    env: environment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}
