import { TranslationFailure } from "../../application/translation-failure.ts";
import type { EngineVersion } from "../../domain/translation-cache-key.ts";
import { extractConfiguredModel, loadCliConfig } from "./cli-config.ts";
import { CLAUDE_CLI_PROMPT_VERSION } from "./translation-prompt.ts";

/** Phiên bản engine theo cấu hình hiện tại (đọc lại mỗi lần gọi, như `ClaudeCliTranslator`). Cấu hình thiếu/sai → `not_configured`. */
export async function claudeCliEngineVersion(configPath: string): Promise<EngineVersion> {
  const loaded = await loadCliConfig(configPath);
  if (!loaded.ok) throw new TranslationFailure("not_configured", loaded.problem, loaded.code, undefined, loaded.field);
  return { promptVersion: CLAUDE_CLI_PROMPT_VERSION, configuredModel: extractConfiguredModel(loaded.config.args) };
}
