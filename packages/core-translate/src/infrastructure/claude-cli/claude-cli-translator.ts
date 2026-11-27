import { assertValidTranslationRequest } from "../../application/translation-request.ts";
import { TranslationFailure } from "../../application/translation-failure.ts";
import type { TranslationRequest, TranslationResult, Translator } from "../../application/translator.port.ts";
import { hasTranslatableText, protect, restore } from "../../domain/protected-spans.ts";
import { loadCliConfig, type CliConfig } from "./cli-config.ts";
import { CliRunFailure, runClaudeCli } from "./claude-cli-runner.ts";
import { planBatches, type BatchItem } from "./chunking.ts";
import {
  buildTranslationStdin,
  TRANSLATION_OUTPUT_JSON_SCHEMA,
  TranslationOutputSchema,
  translationSystemPrompt,
} from "./translation-prompt.ts";

const FAILURE_MESSAGE = {
  timeout: "Claude CLI chạy quá thời gian cho phép",
  process_failed: "Claude CLI chạy thất bại",
  bad_output: "Claude CLI trả kết quả không hợp lệ",
} as const;

/**
 * Adapter `Translator` gọi `claude -p` (ADR-0003, ADR-0006). Đọc cấu hình mỗi lần dịch. Các lần gọi con chạy tuần tự.
 * Message lỗi không bao giờ chứa nội dung issue.
 */
export class ClaudeCliTranslator implements Translator {
  constructor(private readonly configPath: string) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    assertValidTranslationRequest(request);
    const loaded = await loadCliConfig(this.configPath);
    if (!loaded.ok) throw new TranslationFailure("not_configured", loaded.problem);
    const config = loaded.config;

    const prepared = request.segments.map((s) => ({ id: s.id, text: s.text, ...protect(s.text) }));
    const toSend = prepared.filter((p) => hasTranslatableText(p.masked));
    const plan = planBatches(
      toSend.map((p) => ({ id: p.id, masked: p.masked })),
      request.context.hint,
      config.maxInputChars,
    );
    if (!plan.ok) throw new TranslationFailure(plan.reason, "Nội dung vượt giới hạn độ dài gửi tới Claude CLI");

    const systemPrompt = translationSystemPrompt(request.direction);
    const spansById = new Map(prepared.map((p) => [p.id, p.spans]));
    const translated = new Map<string, string>();
    let model: string | null = null;
    let first = true;
    for (const batch of plan.batches) {
      const out = await this.runBatch(config, systemPrompt, request.context.hint, batch, spansById);
      if (first) model = out.model;
      first = false;
      for (const [id, text] of out.texts) translated.set(id, text);
    }

    return {
      segments: request.segments.map((s) => ({ id: s.id, text: translated.get(s.id) ?? s.text })),
      model,
    };
  }

  private async runBatch(
    config: CliConfig,
    systemPrompt: string,
    hint: string | undefined,
    batch: ReadonlyArray<BatchItem>,
    spansById: ReadonlyMap<string, ReadonlyArray<string>>,
  ): Promise<{ texts: Map<string, string>; model: string | null }> {
    let result;
    try {
      result = await runClaudeCli({
        config,
        schema: TRANSLATION_OUTPUT_JSON_SCHEMA,
        systemPrompt,
        stdin: buildTranslationStdin(hint, batch),
      });
    } catch (e) {
      if (e instanceof CliRunFailure) {
        const message = e.hasCustomMessage ? e.message : FAILURE_MESSAGE[e.reason];
        throw new TranslationFailure(e.reason, message, undefined, e.stderrTail || undefined);
      }
      throw e;
    }

    const parsed = TranslationOutputSchema.safeParse(result.body);
    if (!parsed.success) throw bad("invalid_schema");
    const byKey = new Map<string, string>();
    for (const s of parsed.data.segments) {
      if (byKey.has(s.id)) throw bad("duplicate_segment");
      byKey.set(s.id, s.translation);
    }
    const expected = new Set(batch.map((b) => b.key));
    for (const key of byKey.keys()) if (!expected.has(key)) throw bad("unexpected_segment");
    for (const key of expected) if (!byKey.has(key)) throw bad("missing_segment");

    const texts = new Map<string, string>();
    for (const item of batch) {
      const restored = restore(byKey.get(item.key)!, spansById.get(item.id) ?? []);
      if (!restored.ok) throw bad(restored.detail);
      texts.set(item.id, restored.text);
    }
    return { texts, model: result.model };
  }
}

function bad(detail: string): TranslationFailure {
  return new TranslationFailure("bad_output", FAILURE_MESSAGE.bad_output, detail);
}
