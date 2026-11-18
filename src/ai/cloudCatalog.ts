/**
 * Mintu Cloud AI Providers Catalog + User Custom Cloud Providers Manager
 */

export interface CloudProviderConfig {
  id: string;
  name: string;
  badge: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  docUrl: string;
  keyPrefix: string;
  isUserCustom?: boolean;
}

export const CLOUD_PROVIDERS: Record<string, CloudProviderConfig> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    badge: "Cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
    docUrl: "https://aistudio.google.com/app/apikey",
    keyPrefix: "AIza",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    badge: "Cloud",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-20250514",
    models: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    docUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    badge: "Cloud",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4.1", "gpt-4.1-mini"],
    docUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    badge: "Cloud",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "codestral-latest",
    models: ["codestral-latest", "mistral-large-latest", "devstral-small-latest", "mistral-medium-latest", "ministral-8b-latest"],
    docUrl: "https://console.mistral.ai/api-keys",
    keyPrefix: "",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    badge: "Cloud",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    docUrl: "https://platform.deepseek.com/api_keys",
    keyPrefix: "sk-",
  },
  xai: {
    id: "xai",
    name: "xAI Grok",
    badge: "Cloud",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    models: ["grok-3", "grok-3-mini", "grok-2-latest"],
    docUrl: "https://console.x.ai/",
    keyPrefix: "xai-",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter (All Models)",
    badge: "Cloud",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-sonnet-4",
    models: [
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro",
      "deepseek/deepseek-r1",
      "mistralai/codestral-2501",
      "openai/gpt-4o",
    ],
    docUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
  },
  groq: {
    id: "groq",
    name: "Groq (Ultra-Fast)",
    badge: "Cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b", "qwen-2.5-coder-32b", "llama-3.1-8b-instant"],
    docUrl: "https://console.groq.com/keys",
    keyPrefix: "gsk_",
  },
  qwen: {
    id: "qwen",
    name: "Qwen (DashScope)",
    badge: "Cloud",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-max",
    models: ["qwen-max", "qwen-plus", "qwen-coder-plus", "qwen-turbo"],
    docUrl: "https://dashscope.console.aliyun.com/apiKey",
    keyPrefix: "sk-",
  },
  kimi: {
    id: "kimi",
    name: "Moonshot Kimi",
    badge: "Cloud",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-32k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    docUrl: "https://platform.moonshot.cn/console/api-keys",
    keyPrefix: "sk-",
  },
  together: {
    id: "together",
    name: "Together AI",
    badge: "Cloud",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-Coder-32B-Instruct", "deepseek-ai/DeepSeek-R1"],
    docUrl: "https://api.together.xyz/settings/api-keys",
    keyPrefix: "",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity Sonar",
    badge: "Cloud",
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar-pro",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro"],
    docUrl: "https://www.perplexity.ai/settings/api",
    keyPrefix: "pplx-",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras Inference",
    badge: "Cloud",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    models: ["llama-3.3-70b", "qwen-3-32b"],
    docUrl: "https://cloud.cerebras.ai/",
    keyPrefix: "csk-",
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    badge: "Cloud",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    defaultModel: "command-a-03-2025",
    models: ["command-a-03-2025", "command-r-plus-08-2024"],
    docUrl: "https://dashboard.cohere.com/api-keys",
    keyPrefix: "",
  },
  custom: {
    id: "custom",
    name: "Custom (OpenAI-Compatible)",
    badge: "Custom",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "deepseek-chat", "mistral-large-latest"],
    docUrl: "",
    keyPrefix: "",
  },
};

const CUSTOM_PROVIDERS_KEY = "mintu_studio_custom_cloud_providers_v1";

export function getCustomCloudProviders(): CloudProviderConfig[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(CUSTOM_PROVIDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => p && typeof p.id === "string" && typeof p.name === "string");
    }
  } catch {}
  return [];
}

export function saveCustomCloudProvider(input: {
  name: string;
  baseUrl: string;
  defaultModel: string;
  models?: string[];
}): CloudProviderConfig {
  const cleanName = input.name.trim();
  const slug = cleanName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  const id = `custom_${slug || Date.now()}`;
  const modelList = Array.from(
    new Set([input.defaultModel.trim(), ...(input.models || [])].filter(Boolean))
  );
  const entry: CloudProviderConfig = {
    id,
    name: cleanName,
    badge: "Custom",
    baseUrl: input.baseUrl.trim(),
    defaultModel: input.defaultModel.trim(),
    models: modelList.length > 0 ? modelList : [input.defaultModel.trim()],
    docUrl: "",
    keyPrefix: "",
    isUserCustom: true,
  };
  const existing = getCustomCloudProviders().filter((p) => p.id !== id);
  existing.unshift(entry);
  try {
    localStorage.setItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(existing));
  } catch {}
  return entry;
}

export function deleteCustomCloudProvider(id: string): void {
  const existing = getCustomCloudProviders().filter((p) => p.id !== id);
  try {
    localStorage.setItem(CUSTOM_PROVIDERS_KEY, JSON.stringify(existing));
  } catch {}
}

export function getAllCloudProviders(): Record<string, CloudProviderConfig> {
  const all: Record<string, CloudProviderConfig> = {};
  for (const cp of getCustomCloudProviders()) {
    all[cp.id] = cp;
  }
  for (const [k, v] of Object.entries(CLOUD_PROVIDERS)) {
    all[k] = v;
  }
  return all;
}
