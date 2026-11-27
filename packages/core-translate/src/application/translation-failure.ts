export type TranslationFailureReason = "not_configured" | "input_too_large" | "timeout" | "process_failed" | "bad_output";

/** Lỗi dịch. `message` không bao giờ chứa nội dung issue. */
export class TranslationFailure extends Error {
  constructor(
    readonly reason: TranslationFailureReason,
    message?: string,
    readonly detail?: string,
    /** Từ CliRunFailure, chỉ để log local. */
    readonly stderrTail?: string,
    /** Chỉ với not_configured: tên key của cấu hình bị lỗi (không kèm giá trị). */
    readonly field?: string,
  ) {
    super(message ?? reason);
    this.name = "TranslationFailure";
  }
}
