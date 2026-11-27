// Entry point "@app/core-translate/testing": bộ hợp đồng dùng chung cho adapter nằm ngoài package (vd SQLite ở apps/app).
// Chỉ import từ file test; kéo theo vitest.
export { runTranslationCacheContract } from "./application/translation-cache.contract.ts";
export { runTranslatorContract } from "./application/translator.contract.ts";
