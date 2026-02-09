import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SANDBOX_DIR = path.join(REPO_ROOT, "docs", "dingtalk-sandbox");

function fail(message) {
  console.error(`[sandbox:validate] ${message}`);
  process.exitCode = 1;
}

function readText(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  return fs.readFileSync(abs, "utf-8");
}

function readJson(relPath) {
  const raw = readText(relPath);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${relPath}: invalid JSON: ${(err && err.message) || String(err)}`);
  }
}

function extractScriptJson(html, scriptId) {
  const re = new RegExp(
    `<script[^>]*\\bid=[\"']${scriptId}[\"'][^>]*>([\\s\\S]*?)<\\/script>`,
    "m"
  );
  const match = html.match(re);
  if (!match) {
    throw new Error(`index.html: missing embedded script id="${scriptId}"`);
  }
  const content = (match[1] ?? "").trim();
  if (!content) {
    throw new Error(`index.html: embedded script id="${scriptId}" is empty`);
  }
  return JSON.parse(content);
}

function canonicalJson(obj) {
  return JSON.stringify(obj, null, 2);
}

function assertFileExists(relPath, ctx) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    fail(`${ctx}: missing file: ${relPath}`);
  }
}

function validateModel(model) {
  const ids = new Set();
  const lanes = new Set((model.lanes ?? []).map((l) => l.id));

  for (const lane of model.lanes ?? []) {
    for (const key of ["x", "y", "w", "h"]) {
      if (typeof lane[key] !== "number") {
        fail(`lane.${lane.id}.${key} should be number`);
      }
    }
  }

  for (const node of model.nodes ?? []) {
    if (!node.id || typeof node.id !== "string") {
      fail(`node with missing/invalid id`);
      continue;
    }
    if (ids.has(node.id)) {
      fail(`duplicate node id: ${node.id}`);
    }
    ids.add(node.id);

    if (node.lane && !lanes.has(node.lane)) {
      fail(`node ${node.id}: unknown lane ${node.lane}`);
    }
    if (typeof node.x !== "number" || typeof node.y !== "number") {
      fail(`node ${node.id}: x/y must be numbers`);
    }
    if (node.file) {
      assertFileExists(node.file, `node ${node.id}`);
    }
    if (node.codeRef?.path) {
      assertFileExists(node.codeRef.path, `node ${node.id} codeRef`);
    }
  }

  const edgeIds = new Set();
  for (const edge of model.edges ?? []) {
    if (!edge.id || typeof edge.id !== "string") {
      fail(`edge with missing/invalid id`);
      continue;
    }
    if (edgeIds.has(edge.id)) {
      fail(`duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    if (!ids.has(edge.from)) fail(`edge ${edge.id}: missing from node ${edge.from}`);
    if (!ids.has(edge.to)) fail(`edge ${edge.id}: missing to node ${edge.to}`);
    if (edge.codeRef?.path) {
      assertFileExists(edge.codeRef.path, `edge ${edge.id} codeRef`);
    }
  }

  return { nodeIds: ids, edgeIds };
}

function validateScenarios(scenarios, modelRefs) {
  const scenarioIds = new Set();
  for (const scenario of scenarios.scenarios ?? []) {
    if (!scenario.id || typeof scenario.id !== "string") {
      fail(`scenario with missing/invalid id`);
      continue;
    }
    if (scenarioIds.has(scenario.id)) {
      fail(`duplicate scenario id: ${scenario.id}`);
    }
    scenarioIds.add(scenario.id);

    const stepIds = new Set();
    for (const step of scenario.steps ?? []) {
      if (!step.id || typeof step.id !== "string") {
        fail(`scenario ${scenario.id}: step with missing/invalid id`);
        continue;
      }
      if (stepIds.has(step.id)) {
        fail(`scenario ${scenario.id}: duplicate step id: ${step.id}`);
      }
      stepIds.add(step.id);

      for (const nodeId of step.focus?.nodes ?? []) {
        if (!modelRefs.nodeIds.has(nodeId)) {
          fail(`scenario ${scenario.id} step ${step.id}: unknown focus node: ${nodeId}`);
        }
      }
      for (const edgeId of step.focus?.edges ?? []) {
        if (!modelRefs.edgeIds.has(edgeId)) {
          fail(`scenario ${scenario.id} step ${step.id}: unknown focus edge: ${edgeId}`);
        }
      }
      for (const token of step.tokens ?? []) {
        if (!modelRefs.edgeIds.has(token.edge)) {
          fail(`scenario ${scenario.id} step ${step.id}: unknown token edge: ${token.edge}`);
        }
      }
    }
  }
}

function main() {
  if (!fs.existsSync(SANDBOX_DIR)) {
    fail(`missing dir: ${path.relative(REPO_ROOT, SANDBOX_DIR)}`);
    return;
  }

  const model = readJson("docs/dingtalk-sandbox/model.json");
  const scenarios = readJson("docs/dingtalk-sandbox/scenarios.json");
  const indexHtml = readText("docs/dingtalk-sandbox/index.html");

  if (indexHtml.includes("__MODEL_JSON__") || indexHtml.includes("__SCENARIOS_JSON__")) {
    fail("index.html still contains placeholder tokens (__MODEL_JSON__/__SCENARIOS_JSON__)");
  }

  const embeddedModel = extractScriptJson(indexHtml, "oc-model");
  const embeddedScenarios = extractScriptJson(indexHtml, "oc-scenarios");

  if (canonicalJson(embeddedModel) !== canonicalJson(model)) {
    fail("index.html embedded oc-model does not match model.json");
  }
  if (canonicalJson(embeddedScenarios) !== canonicalJson(scenarios)) {
    fail("index.html embedded oc-scenarios does not match scenarios.json");
  }

  const refs = validateModel(model);
  validateScenarios(scenarios, refs);

  if (process.exitCode) {
    console.error("[sandbox:validate] FAILED");
    process.exit(1);
  }

  console.log(
    `[sandbox:validate] OK: ${model.nodes?.length ?? 0} nodes, ${model.edges?.length ?? 0} edges, ${scenarios.scenarios?.length ?? 0} scenarios`
  );
}

main();

