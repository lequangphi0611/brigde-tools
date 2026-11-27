import path from "node:path";

export const DATA_DIR_NAME = "gh-issue-translator";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Thư mục dữ liệu (`dataDir`, ADR-0008). Thuần: không I/O, không đọc process.
 * Thứ tự: APP_DATA_DIR (tuyệt đối) → Windows %LOCALAPPDATA% → XDG_DATA_HOME / ~/.local/share.
 */
export function resolveDataDir(env: Env, platform: string, homedir: string): string {
  const override = env["APP_DATA_DIR"];
  if (override) {
    if (!path.posix.isAbsolute(override) && !path.win32.isAbsolute(override)) {
      throw new Error("APP_DATA_DIR phải là đường dẫn tuyệt đối");
    }
    return override;
  }
  if (platform === "win32") {
    const base = env["LOCALAPPDATA"] || path.win32.join(homedir, "AppData", "Local");
    return path.win32.join(base, DATA_DIR_NAME);
  }
  const base = env["XDG_DATA_HOME"] || path.posix.join(homedir, ".local", "share");
  return path.posix.join(base, DATA_DIR_NAME);
}
