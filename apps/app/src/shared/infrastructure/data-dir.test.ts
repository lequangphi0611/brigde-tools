import { describe, expect, it } from "vitest";
import { resolveDataDir } from "./data-dir.ts";

describe("resolveDataDir (AC-10)", () => {
  it("APP_DATA_DIR tuyệt đối được trả nguyên trên mọi nền tảng", () => {
    expect(resolveDataDir({ APP_DATA_DIR: "/srv/data" }, "linux", "/home/u")).toBe("/srv/data");
    expect(resolveDataDir({ APP_DATA_DIR: "D:\\gh-data" }, "win32", "C:\\Users\\u")).toBe("D:\\gh-data");
    expect(resolveDataDir({ APP_DATA_DIR: "\\\\server\\share\\d" }, "win32", "C:\\Users\\u")).toBe("\\\\server\\share\\d");
  });

  it("APP_DATA_DIR tương đối thì ném Error", () => {
    expect(() => resolveDataDir({ APP_DATA_DIR: "data" }, "linux", "/home/u")).toThrow(Error);
    expect(() => resolveDataDir({ APP_DATA_DIR: "." }, "win32", "C:\\Users\\u")).toThrow(/APP_DATA_DIR/);
  });

  it("kiểm tuyệt đối theo nền tảng", () => {
    expect(() => resolveDataDir({ APP_DATA_DIR: "/srv/data" }, "win32", "C:\\Users\\u")).toThrow(/APP_DATA_DIR/);
    expect(() => resolveDataDir({ APP_DATA_DIR: "\\data" }, "win32", "C:\\Users\\u")).toThrow(/APP_DATA_DIR/);
    expect(() => resolveDataDir({ APP_DATA_DIR: "C:data" }, "win32", "C:\\Users\\u")).toThrow(/APP_DATA_DIR/);
    expect(() => resolveDataDir({ APP_DATA_DIR: "C:\\data" }, "linux", "/home/u")).toThrow(/APP_DATA_DIR/);
    expect(resolveDataDir({ APP_DATA_DIR: "C:/data" }, "win32", "C:\\Users\\u")).toBe("C:/data");
  });

  it("win32 dùng LOCALAPPDATA", () => {
    expect(
      resolveDataDir({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u"),
    ).toBe("C:\\Users\\u\\AppData\\Local\\gh-issue-translator");
  });

  it("win32 thiếu LOCALAPPDATA thì fallback theo homedir", () => {
    expect(resolveDataDir({}, "win32", "C:\\Users\\u")).toBe(
      "C:\\Users\\u\\AppData\\Local\\gh-issue-translator",
    );
  });

  it("nơi khác dùng XDG_DATA_HOME hoặc ~/.local/share", () => {
    expect(resolveDataDir({ XDG_DATA_HOME: "/x" }, "linux", "/home/u")).toBe("/x/gh-issue-translator");
    expect(resolveDataDir({}, "linux", "/home/u")).toBe("/home/u/.local/share/gh-issue-translator");
    expect(resolveDataDir({}, "darwin", "/Users/u")).toBe("/Users/u/.local/share/gh-issue-translator");
  });

  it("chuỗi rỗng coi như không đặt", () => {
    expect(resolveDataDir({ APP_DATA_DIR: "", XDG_DATA_HOME: "" }, "linux", "/home/u")).toBe(
      "/home/u/.local/share/gh-issue-translator",
    );
  });

  it("không bao giờ trả đường dẫn nằm trong cwd", () => {
    const cwd = process.cwd();
    for (const [env, platform, home] of [
      [{}, "linux", "/home/u"],
      [{}, "win32", "C:\\Users\\u"],
    ] as const) {
      expect(resolveDataDir(env, platform, home).startsWith(cwd)).toBe(false);
    }
  });
});
