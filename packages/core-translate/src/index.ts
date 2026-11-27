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
export { FakeTranslator } from "./infrastructure/fake-translator.ts";
export { ClaudeCliTranslator } from "./infrastructure/claude-cli/claude-cli-translator.ts";
export { checkCliConfig, loadCliConfig, type CliConfig, type CliConfigResult } from "./infrastructure/claude-cli/cli-config.ts";
export { CliRunFailure, runClaudeCli, readCliResult, fixedArgs, type CliFailureReason } from "./infrastructure/claude-cli/claude-cli-runner.ts";
