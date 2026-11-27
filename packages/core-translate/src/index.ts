export type { Language, Direction } from "./domain/language.ts";
export type {
  Translator,
  TranslationContext,
  TranslationSegment,
  TranslationRequest,
  TranslationResult,
} from "./application/translator.port.ts";
export { TranslationFailure, type TranslationFailureReason } from "./application/translation-failure.ts";
export { protect, restore, hasTranslatableText, type ProtectedText, type RestoreResult } from "./domain/protected-spans.ts";
export {
  mergeGlossary,
  relevantTerms,
  termKey,
  normalizeTermText,
  glossaryVersion,
  GLOSSARY_VERSION_EMPTY,
  type Glossary,
  type GlossaryTermInput,
} from "./domain/glossary.ts";
export { FakeTranslator } from "./infrastructure/fake-translator.ts";
export { ClaudeCliTranslator } from "./infrastructure/claude-cli/claude-cli-translator.ts";
export { checkCliConfig, loadCliConfig, type CliConfig, type CliConfigResult } from "./infrastructure/claude-cli/cli-config.ts";
export { CliRunFailure, runClaudeCli, readCliResult, fixedArgs, type CliFailureReason } from "./infrastructure/claude-cli/claude-cli-runner.ts";
export { claudeCliEngineVersion } from "./infrastructure/claude-cli/claude-cli-engine-version.ts";
export { extractConfiguredModel } from "./infrastructure/claude-cli/cli-config.ts";
export { CLAUDE_CLI_PROMPT_VERSION } from "./infrastructure/claude-cli/translation-prompt.ts";
export { translationCacheKey, cacheKeyString, type TranslationCacheKey, type EngineVersion } from "./domain/translation-cache-key.ts";
