import { describe, expect, it } from "vitest";
import { classifyGhFailure } from "./gh-failure.ts";

describe("classifyGhFailure", () => {
  it.each([
    ["To get started with GitHub CLI, please run:  gh auth login", "not_authenticated"],
    ["gh: HTTP 401: Bad credentials (https://ghes.example.test/api/graphql)", "not_authenticated"],
    ["your authentication token is missing required scopes [read:project]", "scope_missing"],
    ['{"type":"INSUFFICIENT_SCOPES"}', "scope_missing"],
    ["gh: Could not resolve to an Organization with the login of 'acme'.", "project_not_found"],
    ["Could not resolve to a User with the login of 'x'", "project_not_found"],
    ["Field 'projectV2' doesn't exist on type 'Organization'", "projects_v2_unsupported"],
    ["error connecting to ghes.example.test: dial tcp 10.0.0.1:443: i/o timeout", "network"],
    ["tls: failed to verify certificate: x509: certificate signed by unknown authority", "network"],
    ["Get proxy: ENOTFOUND", "network"],
  ])("%s -> %s", (text, reason) => {
    expect(classifyGhFailure(text)).toBe(reason);
  });

  it.each([
    "dial tcp 10.0.0.1:443: connection refused",
    "Post https://x/api/graphql: net/http: TLS handshake timeout",
    "read tcp: connection reset by peer",
    "getaddrinfo ENOTFOUND host",
    "i/o timeout",
  ])("mẫu lỗi mạng cụ thể %s -> network", (text) => {
    expect(classifyGhFailure(text)).toBe("network");
  });

  it("chữ connect/timeout/proxy trần không phải lỗi mạng", () => {
    expect(classifyGhFailure("failed to connect the widget")).toBeNull();
    expect(classifyGhFailure("timeout")).toBeNull();
    expect(classifyGhFailure('{"data":{"title":"connect timeout in proxy docs"}}')).toBeNull();
  });

  it("projectV2 không tồn tại thắng 'Could not resolve'", () => {
    expect(classifyGhFailure("Could not resolve to an Organization; Field 'projectV2' doesn't exist")).toBe("projects_v2_unsupported");
  });

  it("không nhận ra / rỗng / Could not resolve to a node -> null", () => {
    expect(classifyGhFailure("something unexpected happened")).toBeNull();
    expect(classifyGhFailure("")).toBeNull();
    expect(classifyGhFailure("Could not resolve to a node with the global id of 'X'")).toBeNull();
  });
});
