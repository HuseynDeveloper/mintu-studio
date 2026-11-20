import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

interface MintuExtensionTestSchema {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  enabled: boolean;
  ai_rules: string[];
  snippets: Array<{ prefix: string; label: string; body: string; languages: string[] }>;
  commands: Array<{ id: string; label: string; command: string }>;
  api_templates: Array<{ name: string; method: string; url: string; headers: Record<string, string>; body: string }>;
}

test("Marketplace Registry: All 18 extensions are valid and well-formed", () => {
  const regPath = path.resolve(process.cwd(), "marketplace/registry.json");
  assert.ok(fs.existsSync(regPath), "marketplace/registry.json must exist");

  const raw = fs.readFileSync(regPath, "utf8");
  const extensions: MintuExtensionTestSchema[] = JSON.parse(raw);

  assert.ok(Array.isArray(extensions), "Registry must be a JSON array");
  assert.equal(extensions.length, 18, "Expected 18 curated extensions in marketplace registry");

  const idSet = new Set<string>();

  for (const ext of extensions) {
    assert.ok(ext.id && ext.id.trim().length > 0, "Extension must have an id");
    assert.ok(!idSet.has(ext.id), `Duplicate extension id found: ${ext.id}`);
    idSet.add(ext.id);

    assert.ok(ext.name && ext.name.trim().length > 0, `Extension ${ext.id} must have a name`);
    assert.ok(ext.version && ext.version.trim().length > 0, `Extension ${ext.id} must have a version`);
    assert.ok(ext.author && ext.author.trim().length > 0, `Extension ${ext.id} must have an author`);
    assert.ok(ext.description && ext.description.trim().length > 0, `Extension ${ext.id} must have a description`);
    assert.ok(ext.category && ext.category.trim().length > 0, `Extension ${ext.id} must have a category`);
    assert.equal(typeof ext.enabled, "boolean", `Extension ${ext.id} enabled must be boolean`);
    assert.ok(Array.isArray(ext.ai_rules), `Extension ${ext.id} ai_rules must be an array`);
    assert.ok(Array.isArray(ext.snippets), `Extension ${ext.id} snippets must be an array`);
    assert.ok(Array.isArray(ext.commands), `Extension ${ext.id} commands must be an array`);
    assert.ok(Array.isArray(ext.api_templates), `Extension ${ext.id} api_templates must be an array`);

    // Verify snippets
    for (const snip of ext.snippets) {
      assert.ok(snip.prefix && snip.prefix.trim().length > 0, `Snippet prefix missing in ${ext.id}`);
      assert.ok(snip.label && snip.label.trim().length > 0, `Snippet label missing in ${ext.id}`);
      assert.ok(snip.body && snip.body.trim().length > 0, `Snippet body missing in ${ext.id}`);
      assert.ok(Array.isArray(snip.languages) && snip.languages.length > 0, `Snippet languages missing in ${ext.id}`);
    }

    // Verify commands
    for (const cmd of ext.commands) {
      assert.ok(cmd.id && cmd.id.trim().length > 0, `Command id missing in ${ext.id}`);
      assert.ok(cmd.label && cmd.label.trim().length > 0, `Command label missing in ${ext.id}`);
      assert.ok(cmd.command && cmd.command.trim().length > 0, `Command execution string missing in ${ext.id}`);
    }
  }

  // Verify specific new extensions are present
  const expectedNewIds = [
    "mintu-flutter-dart",
    "mintu-nextjs-fullstack",
    "mintu-supabase-postgres",
    "mintu-ai-agents",
    "mintu-2d-canvas-gamedev",
  ];

  for (const expectedId of expectedNewIds) {
    assert.ok(idSet.has(expectedId), `Expected new extension ${expectedId} to be registered`);
  }
});
