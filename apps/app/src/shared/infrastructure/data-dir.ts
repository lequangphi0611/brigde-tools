import path from "node:path";

export const DATA_DIR_NAME = "gh-issue-translator";

type Env = Readonly<Record<string, string | undefined>>;

/** Tuyệt đối theo nền tảng: win32 đòi ổ đĩa hoặc UNC (`/srv` và `\x` không có ổ đĩa là không hợp lệ). */
export function isAbsoluteFor(platform: string, p: string): boolean {
  if (platform === "win32") return path.win32.isAbsolute(p) && /^([A-Za-z]:|[\\/]{2})/.test(p);
  return path.posix.isAbsolute(p);
}

/**
 * Thư mục dữ liệu (`dataDir`, ADR-0008). Thuần: không I/O, không đọc process.
 * Thứ tự: APP_DATA_DIR (tuyệt đối) → Windows %LOCALAPPDATA% → XDG_DATA_HOME / ~/.local/share.
 * LOCALAPPDATA / XDG_DATA_HOME tương đối bị bỏ qua (theo XDG spec), để DB không rơi vào cwd.
 */
export function resolveDataDir(env: Env, platform: string, homedir: string): string {
  const override = env["APP_DATA_DIR"];
  if (override) {
    if (!isAbsoluteFor(platform, override)) {
      throw new Error("APP_DATA_DIR phải là đường dẫn tuyệt đối");
    }
    return override;
  }
  if (platform === "win32") {
    const local = env["LOCALAPPDATA"];
    const base = local && isAbsoluteFor(platform, local) ? local : path.win32.join(homedir, "AppData", "Local");
    return path.win32.join(base, DATA_DIR_NAME);
  }
  const xdg = env["XDG_DATA_HOME"];
  const base = xdg && isAbsoluteFor(platform, xdg) ? xdg : path.posix.join(homedir, ".local", "share");
  return path.posix.join(base, DATA_DIR_NAME);
}

export type DataDirSource = "APP_DATA_DIR" | "LOCALAPPDATA" | "XDG_DATA_HOME" | "fallback";

/**
 * Nguồn của `dataDir` mà `resolveDataDir` sẽ chọn (để log mà không lộ đường dẫn). Thuần, cùng quy tắc bỏ qua giá trị rỗng/tương đối.
 * APP_DATA_DIR tương đối vẫn trả "APP_DATA_DIR"; `resolveDataDir` mới là nơi ném lỗi.
 */
export function dataDirSource(env: Env, platform: string): DataDirSource {
  if (env["APP_DATA_DIR"]) return "APP_DATA_DIR";
  if (platform === "win32") {
    const local = env["LOCALAPPDATA"];
    return local && isAbsoluteFor(platform, local) ? "LOCALAPPDATA" : "fallback";
  }
  const xdg = env["XDG_DATA_HOME"];
  return xdg && isAbsoluteFor(platform, xdg) ? "XDG_DATA_HOME" : "fallback";
}
