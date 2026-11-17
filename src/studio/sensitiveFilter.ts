/**
 * sensitiveFilter.ts
 * Sensitive and secret file detection for Mintu Studio UI.
 *
 * Used for:
 * 1. Rendering visual "[excluded (sensitive)]" badges in the project file tree.
 * 2. Preventing UI file-attachment to chat prompts.
 * (Note: Rust studio_read_file independently enforces rejection on the backend).
 */

export function isSensitiveFileOrDir(relPath: string): boolean {
  if (!relPath) return false;

  const normalized = relPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  for (const seg of segments) {
    const s = seg.toLowerCase();

    // 1. SSH directory or files
    if (s === ".ssh" || s.startsWith(".ssh/") || s.startsWith(".ssh\\")) {
      return true;
    }

    // 2. Env files (.env, .env.local, .env.production, etc.)
    // Allowed templates: .env.example, .env.sample, .env.template
    if (s.startsWith(".env")) {
      if (
        !s.endsWith(".example") &&
        !s.endsWith(".sample") &&
        !s.endsWith(".template")
      ) {
        return true;
      }
    }

    // 3. Private keys, certificates, keystores
    if (
      s.endsWith(".pem") ||
      s.endsWith(".key") ||
      s.endsWith(".pkcs12") ||
      s.endsWith(".pfx") ||
      s.endsWith(".p12") ||
      s.endsWith(".keystore") ||
      s.endsWith(".jks")
    ) {
      return true;
    }

    // 4. Standard OpenSSH private key names
    if (
      s.startsWith("id_rsa") ||
      s.startsWith("id_ed25519") ||
      s.startsWith("id_ecdsa") ||
      s.startsWith("id_dsa")
    ) {
      return true;
    }

    // 5. Common secret credential patterns
    if (
      s.includes("secret") ||
      s.includes("credential") ||
      s.includes("password") ||
      s.includes("private_key") ||
      s.includes("privatekey")
    ) {
      return true;
    }
  }

  return false;
}
