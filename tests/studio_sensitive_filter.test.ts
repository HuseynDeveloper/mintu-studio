import test from "node:test";
import assert from "node:assert/strict";
import { isSensitiveFileOrDir } from "../src/studio/sensitiveFilter.ts";

test("Mintu Studio sensitive filter: flags secret and credential files", () => {
  // Env files
  assert.strictEqual(isSensitiveFileOrDir(".env"), true);
  assert.strictEqual(isSensitiveFileOrDir(".env.local"), true);
  assert.strictEqual(isSensitiveFileOrDir(".env.production"), true);
  assert.strictEqual(isSensitiveFileOrDir("config/.env"), true);
  assert.strictEqual(isSensitiveFileOrDir("backend\\.env.staging"), true);

  // SSH & Private Keys
  assert.strictEqual(isSensitiveFileOrDir(".ssh/id_rsa"), true);
  assert.strictEqual(isSensitiveFileOrDir(".ssh/config"), true);
  assert.strictEqual(isSensitiveFileOrDir("id_rsa"), true);
  assert.strictEqual(isSensitiveFileOrDir("id_ed25519"), true);
  assert.strictEqual(isSensitiveFileOrDir("server.pem"), true);
  assert.strictEqual(isSensitiveFileOrDir("ssl/cert.key"), true);
  assert.strictEqual(isSensitiveFileOrDir("app.keystore"), true);
  assert.strictEqual(isSensitiveFileOrDir("bundle.pfx"), true);

  // Keyword patterns
  assert.strictEqual(isSensitiveFileOrDir("secrets.json"), true);
  assert.strictEqual(isSensitiveFileOrDir("credentials.yaml"), true);
  assert.strictEqual(isSensitiveFileOrDir("db_password.txt"), true);
  assert.strictEqual(isSensitiveFileOrDir("auth_private_key.bin"), true);
});

test("Mintu Studio sensitive filter: allows non-sensitive project files and templates", () => {
  // Allowed templates
  assert.strictEqual(isSensitiveFileOrDir(".env.example"), false);
  assert.strictEqual(isSensitiveFileOrDir(".env.sample"), false);
  assert.strictEqual(isSensitiveFileOrDir(".env.template"), false);

  // Standard source files
  assert.strictEqual(isSensitiveFileOrDir("package.json"), false);
  assert.strictEqual(isSensitiveFileOrDir("tsconfig.json"), false);
  assert.strictEqual(isSensitiveFileOrDir("src/main.ts"), false);
  assert.strictEqual(isSensitiveFileOrDir("src/studio/StudioApp.ts"), false);
  assert.strictEqual(isSensitiveFileOrDir("src-tauri/src/lib.rs"), false);
  assert.strictEqual(isSensitiveFileOrDir("README.md"), false);
});
