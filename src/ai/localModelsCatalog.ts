/**
 * localModelsCatalog.ts
 * Curated catalog of real, verified GGUF Local LLM models from HuggingFace.
 * Downloaded models NEVER auto-start — the user launches them manually in Settings.
 */

export type ModelCategory = "coding" | "reasoning" | "general";

export interface LocalModelCatalogItem {
  id: string;
  name: string;
  category: ModelCategory;
  categoryLabel: string;
  params: string;
  sizeHuman: string;
  sizeGb: number;
  minRamGb: number;
  recommendedCtx: number;
  url: string;
  description: string;
}

export const LOCAL_MODELS_CATALOG: LocalModelCatalogItem[] = [
  {
    id: "qwen2.5-coder-1.5b",
    name: "Qwen 2.5 Coder 1.5B",
    category: "coding",
    categoryLabel: "Kodlaşdırma",
    params: "1.5B · Q4_K_M",
    sizeHuman: "1.12 GB",
    sizeGb: 1.12,
    minRamGb: 4,
    recommendedCtx: 8192,
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    description: "Çox sürətli kodlaşdırma modeli. TypeScript, Rust, Python və sürətli izahlar üçün əladır.",
  },
  {
    id: "qwen2.5-coder-3b",
    name: "Qwen 2.5 Coder 3B",
    category: "coding",
    categoryLabel: "Kodlaşdırma",
    params: "3B · Q4_K_M",
    sizeHuman: "1.93 GB",
    sizeGb: 1.93,
    minRamGb: 6,
    recommendedCtx: 8192,
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    description: "Sürət və kod keyfiyyəti arasında ideal balans. Diff təklifləri və refaktorinq üçün tövsiyə olunur.",
  },
  {
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    category: "coding",
    categoryLabel: "Kodlaşdırma",
    params: "7B · Q4_K_M",
    sizeHuman: "4.68 GB",
    sizeGb: 4.68,
    minRamGb: 10,
    recommendedCtx: 8192,
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    description: "Güclü lokal proqramlaşdırma modeli. Mürəkkəb bug düzəlişi, test yazma və çoxfayllı analiz üçün.",
  },
  {
    id: "deepseek-r1-distill-qwen-1.5b",
    name: "DeepSeek R1 Distill 1.5B",
    category: "reasoning",
    categoryLabel: "Məntiq",
    params: "1.5B · Q4_K_M",
    sizeHuman: "1.12 GB",
    sizeGb: 1.12,
    minRamGb: 4,
    recommendedCtx: 8192,
    url: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf",
    description: "Addım-addım düşünən yüngül reasoning modeli. Alqoritm və məntiqi analiz üçün sürətli seçim.",
  },
  {
    id: "deepseek-r1-distill-qwen-7b",
    name: "DeepSeek R1 Distill 7B",
    category: "reasoning",
    categoryLabel: "Məntiq",
    params: "7B · Q4_K_M",
    sizeHuman: "4.68 GB",
    sizeGb: 4.68,
    minRamGb: 10,
    recommendedCtx: 8192,
    url: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf",
    description: "Dərin arxitektura analizi və mürəkkəb problemlərin həlli üçün güclü DeepSeek-R1 modeli.",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B Instruct",
    category: "general",
    categoryLabel: "Ümumi",
    params: "3B · Q4_K_M",
    sizeHuman: "2.02 GB",
    sizeGb: 2.02,
    minRamGb: 6,
    recommendedCtx: 4096,
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    description: "Meta-nın çoxdilli, təmiz və sürətli modeli. Ümumi izahlar və kod köməyi üçün.",
  },
  {
    id: "phi-3.5-mini-instruct",
    name: "Microsoft Phi-3.5 Mini",
    category: "coding",
    categoryLabel: "Kodlaşdırma",
    params: "3.8B · Q4_K_M",
    sizeHuman: "2.39 GB",
    sizeGb: 2.39,
    minRamGb: 8,
    recommendedCtx: 8192,
    url: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    description: "Microsoft-un kod və texniki sənədlər üzrə güclü, yığcam 3.8B modeli.",
  },
  {
    id: "gemma-2-2b-it",
    name: "Google Gemma 2 2B Instruct",
    category: "general",
    categoryLabel: "Ümumi",
    params: "2B · Q4_K_M",
    sizeHuman: "1.71 GB",
    sizeGb: 1.71,
    minRamGb: 6,
    recommendedCtx: 4096,
    url: "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf",
    description: "Google-un səlis cavablar verən yüngül və keyfiyyətli 2B modeli.",
  },
  {
    id: "qwen2.5-1.5b",
    name: "Qwen 2.5 1.5B Instruct",
    category: "general",
    categoryLabel: "Ümumi",
    params: "1.5B · Q4_K_M",
    sizeHuman: "1.12 GB",
    sizeGb: 1.12,
    minRamGb: 4,
    recommendedCtx: 4096,
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    description: "Azərbaycan, Türk, İngilis və Rus dillərində stabil işləyən yığcam model.",
  },
  {
    id: "qwen2.5-0.5b",
    name: "Qwen 2.5 0.5B Instruct",
    category: "general",
    categoryLabel: "Ümumi",
    params: "0.5B · Q4_K_M",
    sizeHuman: "491 MB",
    sizeGb: 0.49,
    minRamGb: 2,
    recommendedCtx: 4096,
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    description: "Ən yüngül və ani cavab verən model. Zəif kompüterlərdə belə rahat işləyir.",
  },
  {
    id: "smollm2-1.7b",
    name: "SmolLM2 1.7B Instruct",
    category: "general",
    categoryLabel: "Ümumi",
    params: "1.7B · Q4_K_M",
    sizeHuman: "1.06 GB",
    sizeGb: 1.06,
    minRamGb: 4,
    recommendedCtx: 4096,
    url: "https://huggingface.co/bartowski/SmolLM2-1.7B-Instruct-GGUF/resolve/main/SmolLM2-1.7B-Instruct-Q4_K_M.gguf",
    description: "HuggingFace-in ultra-sürətli lokal modeli. Sürətli sual-cavab üçün uyğundur.",
  },
  {
    id: "mistral-7b-instruct-v0.3",
    name: "Mistral 7B Instruct v0.3",
    category: "general",
    categoryLabel: "Ümumi",
    params: "7B · Q4_K_M",
    sizeHuman: "4.37 GB",
    sizeGb: 4.37,
    minRamGb: 10,
    recommendedCtx: 8192,
    url: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf",
    description: "Geniş bilik bazasına malik klassik 7B model. Güclü RAM olan sistemlər üçün.",
  },
];
