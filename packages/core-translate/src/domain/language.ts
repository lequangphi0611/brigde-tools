/** Value object: chiều dịch. MVP chỉ dùng ja→vi, giai đoạn 2 thêm vi→ja. */
export type Language = "ja" | "vi";

export interface Direction {
  readonly from: Language;
  readonly to: Language;
}
