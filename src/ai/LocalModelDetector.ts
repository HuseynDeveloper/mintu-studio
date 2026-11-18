/**
 * LocalModelDetector.ts
 * Auto-detects locally running models via Rust reqwest (zero CORS issues)
 * covering Mintu Studio's managed llama-server, external llama.cpp, Ollama, and LM Studio.
 */

import { invoke } from "@tauri-apps/api/core";

export interface DetectedLocalModel {
  id: string;
  label: string;
  source: "Mintu Lokal" | "Ollama" | "llama.cpp" | "LM Studio" | "Local";
  baseUrl: string;
  port?: number;
}

interface RustDiscoveredServer {
  id: string;
  label: string;
  source: string;
  base_url: string;
  port: number;
}

/** Strips Windows/POSIX directory path and .gguf suffix so UI shows clean model names. */
export function formatModelDisplayName(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "Lokal";
  const parts = trimmed.split(/[\\/]/);
  const base = parts[parts.length - 1] || trimmed;
  return base.replace(/\.gguf$/i, "");
}

function extractPort(baseUrl?: string): number | null {
  if (!baseUrl) return null;
  const m = baseUrl.match(/:(\d{2,5})(?:\/|$)/);
  if (!m) return null;
  const p = Number(m[1]);
  return Number.isFinite(p) && p >= 1024 && p <= 65535 ? p : null;
}

export async function detectLocalModels(customBaseUrl?: string): Promise<DetectedLocalModel[]> {
  try {
    const preferredPort = extractPort(customBaseUrl);
    const servers = await invoke<RustDiscoveredServer[]>("llm_discover_active_servers", {
      preferredPort,
    });
    if (Array.isArray(servers)) {
      return servers.map((s) => ({
        id: s.id,
        label: s.label,
        source: (s.source as DetectedLocalModel["source"]) || "Local",
        baseUrl: s.base_url,
        port: s.port,
      }));
    }
  } catch {
    // Fallback below if invoked outside Tauri runtime
  }
  return [];
}
