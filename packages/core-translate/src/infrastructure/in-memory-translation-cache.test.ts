import { runTranslationCacheContract } from "../application/translation-cache.contract.ts";
import { InMemoryTranslationCache } from "./in-memory-translation-cache.ts";

runTranslationCacheContract("InMemoryTranslationCache", { create: () => new InMemoryTranslationCache() });
