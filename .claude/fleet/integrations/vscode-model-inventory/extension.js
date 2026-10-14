// Agentic fleet: VS Code model inventory companion (optional).
// Inventory only: lists the chat models this VS Code actually offers (Language Model API) and writes them, as JSON, into
// every open workspace that has the fleet installed: .claude/fleet/project/model-routing/host-models.local.json.
// No routing, no scoring, no model call, no network. The fleet's resolver (model_router.py) reads the file.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const HIDDEN = /^(auto|copilot-utility.*|copilot-dictation.*)$/; // pseudo models: routing aliases and internal helpers

async function writeInventory() {
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
    .filter((p) => fs.existsSync(path.join(p, '.claude', 'fleet')));
  if (!folders.length) return;
  let models = [];
  try {
    models = await vscode.lm.selectChatModels();
  } catch (error) {
    models = null;
  }
  const doc = {
    host: 'vscode',
    hostVersion: vscode.version,
    provider: 'vscode-lm-api',
    providerState: models === null ? 'ERROR' : (models.length ? 'READY' : 'UNAVAILABLE'),
    generatedAt: new Date().toISOString(),
    models: (models || []).filter((m) => !HIDDEN.test(m.id)).map((m) => ({
      id: m.id, name: m.name, vendor: m.vendor, family: m.family, version: m.version,
      maxInputTokens: typeof m.maxInputTokens === 'number' ? m.maxInputTokens : null,
    })),
  };
  for (const root of folders) {
    const dir = path.join(root, '.claude', 'fleet', 'project', 'model-routing');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'host-models.local.json');
      fs.writeFileSync(file + '.tmp', JSON.stringify(doc, null, 2) + '\n', 'utf8');
      fs.renameSync(file + '.tmp', file);
      const gi = path.join(dir, '.gitignore');
      if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*.local.json\n*.local.jsonl\n', 'utf8');
    } catch (error) {
      console.error('Agentic fleet model inventory: write failed', error);
    }
  }
}

function activate(context) {
  writeInventory();
  context.subscriptions.push(vscode.lm.onDidChangeChatModels(writeInventory));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(writeInventory));
  setTimeout(writeInventory, 5000); // the Copilot models register a moment after startup
}

function deactivate() {}

module.exports = { activate, deactivate };
