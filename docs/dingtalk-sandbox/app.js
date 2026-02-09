const APP_VERSION = "2026-02-07";

function qs(sel, el = document) {
  return el.querySelector(sel);
}

function qsa(sel, el = document) {
  return Array.from(el.querySelectorAll(sel));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return deepClone(patch);
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
      continue;
    }
    out[k] = deepClone(v);
  }
  return out;
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toast(message) {
  const host = qs("#toast");
  if (!host) return;
  host.innerHTML = "";

  const inner = document.createElement("div");
  inner.className = "toast__inner";
  inner.textContent = message;
  host.appendChild(inner);

  requestAnimationFrame(() => {
    inner.classList.add("is-visible");
  });

  window.setTimeout(() => {
    inner.classList.remove("is-visible");
    window.setTimeout(() => {
      if (inner.parentNode === host) host.removeChild(inner);
    }, 220);
  }, 1600);
}

async function copyText(text) {
  const raw = String(text ?? "");
  if (!raw) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(raw);
      toast("已复制");
      return;
    }
  } catch {
    // fall through
  }

  const ta = document.createElement("textarea");
  ta.value = raw;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    toast("已复制");
  } catch {
    toast("复制失败: 请手动复制");
  } finally {
    document.body.removeChild(ta);
  }
}

function readEmbeddedJson(id) {
  const el = qs(`#${id}`);
  if (!el) return null;
  const text = el.textContent ?? "";
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("Failed to parse embedded JSON", id, err);
    return null;
  }
}

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  return await resp.json();
}

function setStatus(kind, message) {
  const pill = qs("#status-pill");
  if (!pill) return;
  pill.classList.remove("is-ok", "is-warn", "is-bad");
  if (kind === "ok") pill.classList.add("is-ok");
  if (kind === "warn") pill.classList.add("is-warn");
  if (kind === "bad") pill.classList.add("is-bad");
  pill.textContent = message;
}

function computeEdgePath(from, to) {
  const x1 = from.x;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const bend = Math.max(120, Math.min(320, Math.abs(dx) * 0.55));
  const c1x = x1 + (dx >= 0 ? bend : -bend);
  const c1y = y1 + dy * 0.12;
  const c2x = x2 - (dx >= 0 ? bend : -bend);
  const c2y = y2 - dy * 0.12;

  const d = `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
  const mx = x1 + dx * 0.5;
  const my = y1 + dy * 0.5;
  return { d, mid: { x: mx, y: my } };
}

function truncateMiddle(text, maxChars) {
  const raw = String(text ?? "");
  if (raw.length <= maxChars) return raw;
  if (maxChars <= 1) return "…";
  const head = Math.max(1, Math.floor((maxChars - 1) * 0.6));
  const tail = Math.max(1, maxChars - 1 - head);
  return `${raw.slice(0, head)}…${raw.slice(raw.length - tail)}`;
}

function wrapText(text, opts) {
  const raw = String(text ?? "").trim();
  const maxCharsPerLine = Math.max(6, opts.maxCharsPerLine ?? 24);
  const maxLines = Math.max(1, opts.maxLines ?? 2);
  const ellipsis = opts.ellipsis ?? "…";

  if (!raw) return [""];

  const hasSpaces = /\s/.test(raw);
  const tokens = hasSpaces ? raw.split(/\s+/).filter(Boolean) : Array.from(raw);
  const lines = [];
  let line = "";

  const pushLine = () => {
    if (line.trim().length) lines.push(line.trim());
    line = "";
  };

  for (const tok of tokens) {
    const next = line ? `${line}${hasSpaces ? " " : ""}${tok}` : tok;
    if (next.length <= maxCharsPerLine) {
      line = next;
      continue;
    }
    if (line) {
      pushLine();
    }
    if (tok.length <= maxCharsPerLine) {
      line = tok;
      continue;
    }
    // Token is too long; hard-break it.
    let start = 0;
    while (start < tok.length) {
      const chunk = tok.slice(start, start + maxCharsPerLine);
      lines.push(chunk);
      start += maxCharsPerLine;
      if (lines.length >= maxLines) break;
    }
    line = "";
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && line) pushLine();

  if (lines.length > maxLines) lines.length = maxLines;

  // If we filled max lines but there's remaining content, ellipsize last line.
  const usedChars = lines.join("").length;
  if (lines.length === maxLines && usedChars < raw.length) {
    const last = lines[lines.length - 1] ?? "";
    const maxLast = Math.max(2, maxCharsPerLine - ellipsis.length);
    lines[lines.length - 1] =
      (last.length > maxLast ? last.slice(0, maxLast) : last) + ellipsis;
  }

  return lines;
}

function setSvgMultilineText(textEl, lines, x, y, lineHeight) {
  while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
  // First line sits at provided y; subsequent lines are dy offsets.
  for (let i = 0; i < lines.length; i += 1) {
    const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tspan.setAttribute("x", String(x));
    if (i === 0) {
      tspan.setAttribute("y", String(y));
    } else {
      tspan.setAttribute("dy", String(lineHeight));
    }
    tspan.textContent = lines[i];
    textEl.appendChild(tspan);
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isGroupChatType(chatType) {
  return /group|chat|2|multi/i.test(chatType ?? "");
}

function shouldEnforcePrefix(requirePrefix, chatType) {
  return Boolean(requirePrefix) && isGroupChatType(chatType);
}

function startsWithPrefix(text, prefix) {
  if (!prefix) return true;
  return String(text ?? "").trim().toLowerCase().startsWith(String(prefix).trim().toLowerCase());
}

function buildSessionKey(chat, agentId = "main", opts = {}) {
  const conv = chat.conversationId || "unknownConv";
  const sender = chat.senderId || "unknownSender";
  const chatType = (chat.chatType || "").toLowerCase();
  const isGroup = /group|chat|2|multi/.test(chatType);
  const isolateGroupBySender = opts.isolateGroupBySender ?? false;
  const baseKey = isGroup
    ? isolateGroupBySender
      ? `dingtalk:group:${conv}:user:${sender}`
      : `dingtalk:group:${conv}`
    : `dingtalk:dm:${sender}`;
  return `agent:${agentId}:${baseKey}`;
}

function evaluateInboundFilters(params) {
  const account = params.account ?? {};
  const chat = params.chat ?? {};

  const isGroup = isGroupChatType(chat.chatType);
  const reasons = [];

  if (account.selfUserId && chat.senderId && account.selfUserId === chat.senderId) {
    reasons.push("self_message");
  }

  const allowFrom = Array.isArray(account.allowFrom) ? account.allowFrom : [];
  if (allowFrom.length > 0 && chat.senderId && !allowFrom.includes(chat.senderId)) {
    reasons.push("blocked_by_allowlist");
  }

  if (shouldEnforcePrefix(account.requirePrefix, chat.chatType)) {
    if (!startsWithPrefix(chat.text, account.requirePrefix)) {
      reasons.push("prefix_required_not_met");
    }
  } else if (isGroup && account.requireMention && !account.requirePrefix) {
    const bypass = Array.isArray(account.mentionBypassUsers) ? account.mentionBypassUsers : [];
    const isBypassUser = chat.senderId && bypass.includes(chat.senderId);
    if (!isBypassUser && !chat.isInAtList) {
      reasons.push("mention_required_not_met");
    }
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    isGroup,
  };
}

function normalizeKindLabel(kind) {
  const k = String(kind ?? "");
  if (k === "control") return "CONTROL";
  if (k === "data") return "DATA";
  return k.toUpperCase();
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    const arr = out.get(k) ?? [];
    arr.push(item);
    out.set(k, arr);
  }
  return out;
}

function sortByLabelZh(a, b) {
  const av = String(a.labelZh ?? "");
  const bv = String(b.labelZh ?? "");
  return av.localeCompare(bv, "zh-Hans-CN");
}

function renderPanel(el, header, subtitle, bodyNode) {
  el.innerHTML = "";
  const headerEl = document.createElement("div");
  headerEl.className = "panel__header";
  headerEl.innerHTML = `
    <div class="panel__title">${escapeHtml(header)}</div>
    ${subtitle ? `<div class="panel__subtitle">${escapeHtml(subtitle)}</div>` : ""}
  `;
  const bodyEl = document.createElement("div");
  bodyEl.className = "panel__body";
  if (bodyNode) bodyEl.appendChild(bodyNode);
  el.appendChild(headerEl);
  el.appendChild(bodyEl);
}

function createNode(tag, className, html) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function createButton(label, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn ${opts.kind ? `is-${opts.kind}` : ""}`.trim();
  btn.textContent = label;
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

function buildGraph(model, handlers) {
  const svg = qs("#graph");
  if (!svg) throw new Error("missing #graph");
  svg.innerHTML = "";

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(233,226,214,0.55)"></path>
    </marker>
  `;
  svg.appendChild(defs);

  const lanesG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  lanesG.setAttribute("data-layer", "lanes");

  for (const lane of model.lanes ?? []) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(lane.x));
    rect.setAttribute("y", String(lane.y));
    rect.setAttribute("width", String(lane.w));
    rect.setAttribute("height", String(lane.h));
    rect.setAttribute("rx", "0");
    rect.setAttribute("class", "lane");
    lanesG.appendChild(rect);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(lane.x + 14));
    label.setAttribute("y", String(lane.y + 26));
    label.setAttribute("class", "lane__label");
    label.textContent = lane.labelZh ?? lane.id;
    lanesG.appendChild(label);
  }
  svg.appendChild(lanesG);

  const edgesG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  edgesG.setAttribute("data-layer", "edges");
  svg.appendChild(edgesG);

  const edgeLabelsG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  edgeLabelsG.setAttribute("data-layer", "edge-labels");
  svg.appendChild(edgeLabelsG);

  const nodesG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  nodesG.setAttribute("data-layer", "nodes");
  svg.appendChild(nodesG);

  const tokensG = document.createElementNS("http://www.w3.org/2000/svg", "g");
  tokensG.setAttribute("data-layer", "tokens");
  svg.appendChild(tokensG);

  const nodesById = new Map();
  for (const node of model.nodes ?? []) {
    nodesById.set(node.id, node);
  }

  const edgeEls = new Map();
  const edgePathEls = new Map();
  const edgeLabelEls = new Map();
  const edgeLabelGroups = new Map();

  for (const edge of model.edges ?? []) {
    const from = nodesById.get(edge.from);
    const to = nodesById.get(edge.to);
    if (!from || !to) continue;
    const { d, mid } = computeEdgePath(from, to);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const nx0 = -dy;
    const ny0 = dx;
    const nLen = Math.hypot(nx0, ny0) || 1;
    const ox = (nx0 / nLen) * 14;
    const oy = (ny0 / nLen) * 14;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("id", `edge-${edge.id}`);
    path.setAttribute("class", `edge ${edge.flowType === "data" ? "edge--data" : "edge--control"}`);
    path.setAttribute("marker-end", "url(#arrow)");
    path.addEventListener("mouseenter", () => {
      const g = edgeLabelGroups.get(edge.id);
      if (g) g.classList.add("is-visible");
    });
    path.addEventListener("mouseleave", () => {
      const g = edgeLabelGroups.get(edge.id);
      if (!g) return;
      // Don't hide if edge is currently active (focus/selection).
      if (path.classList.contains("is-active")) return;
      if (handlers.isEdgePinned?.(edge.id)) return;
      g.classList.remove("is-visible");
    });
    path.addEventListener("click", (ev) => {
      ev.stopPropagation();
      handlers.onSelectEdge(edge.id);
    });
    edgesG.appendChild(path);
    edgeEls.set(edge.id, path);
    edgePathEls.set(edge.id, path);

    if (edge.labelZh) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "edge-label");
      g.setAttribute("data-edge-id", edge.id);
      edgeLabelsG.appendChild(g);
      edgeLabelGroups.set(edge.id, g);

      const labelText = truncateMiddle(edge.labelZh, 34);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(mid.x + ox));
      text.setAttribute("y", String(mid.y + oy));
      text.setAttribute("class", "edge__label");
      text.textContent = labelText;
      g.appendChild(text);
      edgeLabelEls.set(edge.id, text);

      // Background rect: sized after text is in DOM.
      const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bg.setAttribute("rx", "8");
      bg.setAttribute("ry", "8");
      g.insertBefore(bg, text);
      requestAnimationFrame(() => {
        try {
          const box = text.getBBox();
          const padX = 8;
          const padY = 6;
          bg.setAttribute("x", String(box.x - padX));
          bg.setAttribute("y", String(box.y - padY));
          bg.setAttribute("width", String(box.width + padX * 2));
          bg.setAttribute("height", String(box.height + padY * 2));
        } catch {
          // ignore; some browsers may throw if SVG not yet laid out.
        }
      });
    }
  }

  const nodeEls = new Map();

  for (const node of model.nodes ?? []) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("id", `node-${node.id}`);
    g.setAttribute("class", `node node--${node.kind ?? "module"}`);
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      handlers.onSelectNode(node.id);
    });

    const w = node.w ?? 240;
    const h = node.h ?? 76;
    const x = node.x - w / 2;
    const y = node.y - h / 2;

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "16");
    g.appendChild(rect);

    const kicker = document.createElementNS("http://www.w3.org/2000/svg", "text");
    kicker.setAttribute("x", String(x + 14));
    kicker.setAttribute("y", String(y + 24));
    kicker.setAttribute("class", "node__kicker");
    kicker.textContent = node.kind ? normalizeKindLabel(node.kind) : "MODULE";
    g.appendChild(kicker);

    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const titleX = x + 14;
    const titleY = y + 48;
    title.setAttribute("x", String(titleX));
    title.setAttribute("y", String(titleY));
    title.setAttribute("class", "node__title");
    const titleRaw = node.labelZh ?? node.id;
    const maxCharsPerLine = Math.floor((w - 28) / 7.2);
    const lines = wrapText(titleRaw, { maxCharsPerLine, maxLines: 2 });
    setSvgMultilineText(title, lines, titleX, titleY, 14);
    g.appendChild(title);

    nodesG.appendChild(g);
    nodeEls.set(node.id, g);
  }

  svg.addEventListener("click", () => handlers.onClearSelection());

  return { nodeEls, edgeEls, edgePathEls, edgeLabelEls, edgeLabelGroups, tokensG };
}

function buildScenarioStates(scenario) {
  const out = [];
  let state = deepClone(scenario.initialState ?? {});
  for (const step of scenario.steps ?? []) {
    state = deepMerge(state, step.statePatch ?? {});
    out.push(deepClone(state));
  }
  return out;
}

function mainView() {
  const left = qs("#panel-left");
  const right = qs("#panel-right");
  const buildId = qs("#build-id");
  if (buildId) buildId.textContent = `sandbox ${APP_VERSION}`;

  const embeddedModel = readEmbeddedJson("oc-model");
  const embeddedScenarios = readEmbeddedJson("oc-scenarios");

  if (!embeddedModel || !embeddedScenarios) {
    setStatus(
      "warn",
      "嵌入数据缺失：建议用本地 HTTP server 打开（但页面仍会尝试 fetch）"
    );
  }

  const boot = async () => {
    const model =
      embeddedModel ??
      (await fetchJson("./model.json").catch((err) => {
        console.warn("fetch model failed", err);
        return null;
      }));
    const scenariosData =
      embeddedScenarios ??
      (await fetchJson("./scenarios.json").catch((err) => {
        console.warn("fetch scenarios failed", err);
        return null;
      }));

    if (!model || !scenariosData) {
      setStatus("bad", "加载失败：请用 python -m http.server 打开此目录");
      if (left) {
        renderPanel(
          left,
          "加载失败",
          "模型/scenarios JSON 无法加载。通常是浏览器 file:// 限制。",
          createNode(
            "div",
            "",
            `
              <div class="card">
                <div class="card__kicker">HOW TO OPEN</div>
                <div class="card__title">使用本地 HTTP server</div>
                <div class="card__body">
                  在 <span class="mono">docs/dingtalk-sandbox/</span> 目录运行：
                  <div style="margin-top:10px"><code class="inline">python -m http.server</code></div>
                  然后打开：
                  <div style="margin-top:10px"><code class="inline">http://localhost:8000/</code></div>
                </div>
              </div>
            `
          )
        );
      }
      return;
    }

    const scenarios = (scenariosData.scenarios ?? []).map((s) => ({
      ...s,
      _computedStates: buildScenarioStates(s),
    }));

    setStatus("ok", `已加载：${model.nodes.length} nodes / ${model.edges.length} edges`);

    const app = {
      view: "tour",
      model,
      scenarios,
      selection: { type: null, id: null },
      tour: {
        scenarioId: scenarios[0]?.id ?? "",
        stepIndex: 0,
        playing: false,
        speed: 1.0,
        timer: 0,
      },
      sim: {
        agentId: "main",
        account: {
          allowFrom: [],
          requireMention: true,
          requirePrefix: "",
          mentionBypassUsers: [],
          isolateContextPerUserInGroup: false,
          selfUserId: "",
        },
        chat: {
          chatType: "direct",
          conversationId: "cid_dm_001",
          senderId: "user001",
          text: "你好，帮我总结一下今天的待办",
          isInAtList: false,
        },
      },
    };

    const graph = buildGraph(model, {
      onSelectNode: (id) => {
        app.selection = { type: "node", id };
        render();
      },
      onSelectEdge: (id) => {
        app.selection = { type: "edge", id };
        render();
      },
      onClearSelection: () => {
        app.selection = { type: null, id: null };
        render();
      },
      isEdgePinned: (edgeId) => app.selection.type === "edge" && app.selection.id === edgeId,
    });

    function getScenario() {
      return app.scenarios.find((s) => s.id === app.tour.scenarioId) ?? app.scenarios[0];
    }

    function getStep() {
      const scenario = getScenario();
      const idx = clamp(app.tour.stepIndex, 0, Math.max(0, (scenario.steps?.length ?? 1) - 1));
      const step = scenario.steps?.[idx];
      const computedState = scenario._computedStates?.[idx] ?? scenario.initialState ?? {};
      return { scenario, idx, step, computedState };
    }

    function clearHighlights() {
      for (const el of graph.nodeEls.values()) el.classList.remove("is-active");
      for (const el of graph.edgeEls.values()) el.classList.remove("is-active");
      for (const g of graph.edgeLabelGroups.values()) g.classList.remove("is-visible");
    }

    function applyFocus(focus) {
      clearHighlights();
      const nodes = focus?.nodes ?? [];
      const edges = focus?.edges ?? [];
      for (const id of nodes) graph.nodeEls.get(id)?.classList.add("is-active");
      for (const id of edges) {
        graph.edgeEls.get(id)?.classList.add("is-active");
        graph.edgeLabelGroups.get(id)?.classList.add("is-visible");
      }
    }

    function applySelection() {
      for (const el of graph.nodeEls.values()) el.classList.remove("is-selected");
      if (app.selection.type === "node") {
        graph.nodeEls.get(app.selection.id)?.classList.add("is-selected");
      }
      if (app.selection.type === "edge") {
        const id = app.selection.id;
        graph.edgeEls.get(id)?.classList.add("is-active");
        graph.edgeLabelGroups.get(id)?.classList.add("is-visible");
      }
    }

    function clearTokens() {
      graph.tokensG.innerHTML = "";
    }

    function spawnToken(token) {
      const path = graph.edgePathEls.get(token.edge);
      if (!path) return;
      const kind = token.kind === "data" ? "token--data" : "";

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", `token ${kind}`.trim());
      circle.setAttribute("r", "7");
      graph.tokensG.appendChild(circle);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "token__label");
      label.textContent = token.label ?? "";
      graph.tokensG.appendChild(label);

      const duration = 900 / clamp(app.tour.speed ?? 1, 0.4, 2.5);
      const len = path.getTotalLength();
      const start = performance.now();

      const tick = (now) => {
        const t = clamp((now - start) / duration, 0, 1);
        const p = path.getPointAtLength(len * t);
        circle.setAttribute("cx", String(p.x));
        circle.setAttribute("cy", String(p.y));
        label.setAttribute("x", String(p.x + 10));
        label.setAttribute("y", String(p.y - 10));
        if (t < 1) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    }

    function applyTokens(tokens) {
      clearTokens();
      for (const token of tokens ?? []) spawnToken(token);
    }

    function renderSelectionDetails() {
      const box = document.createElement("div");

      const { type, id } = app.selection;
      if (!type || !id) {
        box.innerHTML = `
          <div class="card">
            <div class="card__kicker">HINT</div>
            <div class="card__title">点击图中的节点/边</div>
            <div class="card__body">
              你会看到对应的源码索引（文件、rg/sed 提示）以及该组件在控制流/数据流中的位置。
            </div>
          </div>
        `;
        return box;
      }

      if (type === "node") {
        const node = model.nodes.find((n) => n.id === id);
        if (!node) return box;

        const chips = [
          `<span class="chip chip--accent">${escapeHtml(node.kind ?? "module")}</span>`,
          node.lane ? `<span class="chip">${escapeHtml(node.lane)}</span>` : "",
          node.file ? `<span class="chip">${escapeHtml(node.file)}</span>` : "",
        ]
          .filter(Boolean)
          .join("");

        const codeRef = node.codeRef;
        const actions = document.createElement("div");
        actions.className = "btnrow";
        if (node.file) {
          actions.appendChild(
            createButton("复制路径", { onClick: () => copyText(node.file) })
          );
        }
        if (codeRef?.hintRg) {
          actions.appendChild(
            createButton("复制 rg", { kind: "primary", onClick: () => copyText(codeRef.hintRg) })
          );
        }
        if (codeRef?.hintSed) {
          actions.appendChild(
            createButton("复制 sed", { onClick: () => copyText(codeRef.hintSed) })
          );
        }

        box.innerHTML = `
          <div class="card">
            <div class="card__kicker">NODE</div>
            <div class="card__title">${escapeHtml(node.labelZh ?? node.id)}</div>
            <div class="card__body">${escapeHtml(node.summary ?? "")}</div>
            <div class="card__meta">${chips}</div>
          </div>
        `;
        if (node.symbol) {
          box.appendChild(
            createNode(
              "div",
              "card",
              `<div class="card__kicker">SYMBOL</div><div class="card__body mono">${escapeHtml(
                node.symbol
              )}</div>`
            )
          );
        }
        if (node.file || codeRef) {
          const code = document.createElement("div");
          code.className = "card";
          code.innerHTML = `
            <div class="card__kicker">CODE</div>
            <div class="card__body">
              ${node.file ? `<div><span class="muted">path:</span> <span class="mono">${escapeHtml(node.file)}</span></div>` : ""}
              ${codeRef?.hintRg ? `<div style="margin-top:8px"><span class="muted">rg:</span> <span class="mono">${escapeHtml(codeRef.hintRg)}</span></div>` : ""}
              ${codeRef?.hintSed ? `<div style="margin-top:8px"><span class="muted">sed:</span> <span class="mono">${escapeHtml(codeRef.hintSed)}</span></div>` : ""}
            </div>
          `;
          code.appendChild(actions);
          box.appendChild(code);
        }
        return box;
      }

      if (type === "edge") {
        const edge = model.edges.find((e) => e.id === id);
        if (!edge) return box;
        const from = model.nodes.find((n) => n.id === edge.from);
        const to = model.nodes.find((n) => n.id === edge.to);

        const actions = document.createElement("div");
        actions.className = "btnrow";
        if (edge.codeRef?.hintRg) {
          actions.appendChild(
            createButton("复制 rg", { kind: "primary", onClick: () => copyText(edge.codeRef.hintRg) })
          );
        }
        if (edge.codeRef?.path) {
          actions.appendChild(
            createButton("复制路径", { onClick: () => copyText(edge.codeRef.path) })
          );
        }

        box.innerHTML = `
          <div class="card">
            <div class="card__kicker">EDGE</div>
            <div class="card__title">${escapeHtml(edge.labelZh ?? edge.id)}</div>
            <div class="card__body">
              <div><span class="muted">from:</span> ${escapeHtml(from?.labelZh ?? edge.from)}</div>
              <div style="margin-top:6px"><span class="muted">to:</span> ${escapeHtml(to?.labelZh ?? edge.to)}</div>
              ${edge.condition ? `<div style="margin-top:10px"><span class="muted">condition:</span> ${escapeHtml(edge.condition)}</div>` : ""}
            </div>
            <div class="card__meta">
              <span class="chip chip--accent">${escapeHtml(edge.flowType)}</span>
              ${edge.codeRef?.path ? `<span class="chip">${escapeHtml(edge.codeRef.path)}</span>` : ""}
            </div>
          </div>
        `;
        if (edge.codeRef?.hintRg || edge.codeRef?.path) {
          const code = document.createElement("div");
          code.className = "card";
          code.innerHTML = `
            <div class="card__kicker">CODE</div>
            <div class="card__body">
              ${edge.codeRef?.path ? `<div><span class="muted">path:</span> <span class="mono">${escapeHtml(edge.codeRef.path)}</span></div>` : ""}
              ${edge.codeRef?.hintRg ? `<div style="margin-top:8px"><span class="muted">rg:</span> <span class="mono">${escapeHtml(edge.codeRef.hintRg)}</span></div>` : ""}
            </div>
          `;
          code.appendChild(actions);
          box.appendChild(code);
        }
        return box;
      }

      return box;
    }

    function renderDataInspector() {
      const box = document.createElement("div");
      const view = app.view;

      if (view === "tour") {
        const { scenario, idx, step, computedState } = getStep();
        const title = step?.titleZh ?? "(unknown step)";
        const body = step?.bodyZh ?? "";
        box.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">STEP</div>
              <div class="card__title">${escapeHtml(title)}</div>
              <div class="card__body">${escapeHtml(body)}</div>
              <div class="card__meta">
                <span class="chip">${escapeHtml(scenario.titleZh ?? scenario.id)}</span>
                <span class="chip chip--accent">${idx + 1}/${scenario.steps?.length ?? 0}</span>
              </div>
            `
          )
        );

        const pre = document.createElement("pre");
        pre.textContent = prettyJson(computedState);
        box.appendChild(
          createNode(
            "div",
            "card",
            `<div class="card__kicker">STATE</div><div class="card__body" style="padding:0"></div>`
          )
        );
        box.lastChild.querySelector(".card__body").appendChild(pre);

        return box;
      }

      if (view === "sim") {
        const sessionKey = buildSessionKey(app.sim.chat, app.sim.agentId, {
          isolateGroupBySender: app.sim.account.isolateContextPerUserInGroup,
        });
        const filters = evaluateInboundFilters({
          account: app.sim.account,
          chat: app.sim.chat,
        });
        const out = {
          agentId: app.sim.agentId,
          sessionKey,
          filters,
          derived: {
            isGroup: filters.isGroup,
            shouldEnforcePrefix: shouldEnforcePrefix(
              app.sim.account.requirePrefix,
              app.sim.chat.chatType
            ),
          },
          next: filters.accepted
            ? [
                "build ctx",
                "dispatchReplyWithBufferedBlockDispatcher(ctx)",
                "deliver(block/final) -> sessionWebhook",
              ]
            : ["return (filtered)"],
        };

        const pre = document.createElement("pre");
        pre.textContent = prettyJson(out);

        const header = createNode(
          "div",
          "card",
          `
            <div class="card__kicker">SIM RESULT</div>
            <div class="card__title">${filters.accepted ? "✅ 通过过滤" : "⛔ 被过滤"}</div>
            <div class="card__body">${
              filters.accepted
                ? "这条消息会进入 Openclaw dispatch。"
                : `原因: ${escapeHtml(filters.reasons.join(", "))}`
            }</div>
          `
        );

        const actions = document.createElement("div");
        actions.className = "btnrow";
        actions.appendChild(
          createButton("复制 sessionKey", {
            kind: "primary",
            onClick: () => copyText(sessionKey),
          })
        );
        header.appendChild(actions);

        box.appendChild(header);
        box.appendChild(
          createNode(
            "div",
            "card",
            `<div class="card__kicker">JSON</div><div class="card__body" style="padding:0"></div>`
          )
        );
        box.lastChild.querySelector(".card__body").appendChild(pre);

        // Also highlight a likely path on the graph.
        const focus = filters.accepted
          ? { nodes: ["plugin_message_parser", "plugin_monitor", "oc_dispatcher"], edges: ["e_monitor_dispatch"] }
          : { nodes: ["plugin_monitor"], edges: [] };
        applyFocus(focus);
        applyTokens(filters.accepted ? [{ edge: "e_monitor_dispatch", kind: "control", label: "dispatch" }] : []);

        return box;
      }

      if (view === "index") {
        const pre = document.createElement("pre");
        pre.textContent = prettyJson({
          nodes: model.nodes.length,
          edges: model.edges.length,
          lanes: model.lanes.length,
        });
        box.appendChild(
          createNode(
            "div",
            "card",
            `<div class="card__kicker">MODEL</div><div class="card__body" style="padding:0"></div>`
          )
        );
        box.lastChild.querySelector(".card__body").appendChild(pre);
        return box;
      }

      if (view === "glossary") {
        box.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">GLOSSARY</div>
              <div class="card__title">建议从这 5 个概念开始</div>
              <div class="card__body">
                <div><span class="mono">sessionWebhook</span>：钉钉回话级 webhook，回复都走它。</div>
                <div style="margin-top:8px"><span class="mono">SessionKey</span>：Openclaw 会话键；决定上下文隔离粒度。</div>
                <div style="margin-top:8px"><span class="mono">deliver(kind)</span>：Openclaw 回调；kind=block/final。</div>
                <div style="margin-top:8px"><span class="mono">[DING:*]</span>：媒体协议标签；插件负责上传与发送。</div>
                <div style="margin-top:8px"><span class="mono">AI Card</span>：卡片状态机，create/deliver/stream/update。</div>
              </div>
            `
          )
        );
        return box;
      }

      return box;
    }

    function renderLeft() {
      if (!left) return;

      if (app.view === "tour") {
        left.dataset.activeView = "tour";
        const scenario = getScenario();
        const { idx, step } = getStep();

        const container = document.createElement("div");

        const field = document.createElement("div");
        field.className = "field";
        const label = document.createElement("div");
        label.className = "label";
        label.innerHTML = `<span>场景</span><span class="muted mono">${escapeHtml(scenario.id)}</span>`;
        const select = document.createElement("select");
        for (const s of app.scenarios) {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = s.titleZh ?? s.id;
          if (s.id === app.tour.scenarioId) opt.selected = true;
          select.appendChild(opt);
        }
        select.addEventListener("change", () => {
          app.tour.scenarioId = select.value;
          app.tour.stepIndex = 0;
          stopPlay();
          render();
        });
        field.appendChild(label);
        field.appendChild(select);
        container.appendChild(field);

        const btns = document.createElement("div");
        btns.className = "btnrow";

        const prevBtn = createButton("上一步", {
          onClick: () => {
            stopPlay();
            app.tour.stepIndex = clamp(app.tour.stepIndex - 1, 0, (scenario.steps?.length ?? 1) - 1);
            render();
          },
        });
        const playBtn = createButton(app.tour.playing ? "暂停" : "播放", {
          kind: "primary",
          onClick: () => {
            if (app.tour.playing) stopPlay();
            else startPlay();
            render();
          },
        });
        const nextBtn = createButton("下一步", {
          onClick: () => {
            stopPlay();
            app.tour.stepIndex = clamp(app.tour.stepIndex + 1, 0, (scenario.steps?.length ?? 1) - 1);
            render();
          },
        });
        const resetBtn = createButton("重置", {
          onClick: () => {
            stopPlay();
            app.tour.stepIndex = 0;
            render();
          },
        });
        btns.appendChild(prevBtn);
        btns.appendChild(playBtn);
        btns.appendChild(nextBtn);
        btns.appendChild(resetBtn);
        container.appendChild(btns);

        const speedField = document.createElement("div");
        speedField.className = "field";
        speedField.style.marginTop = "12px";
        speedField.innerHTML = `
          <div class="label"><span>播放速度</span><span class="muted mono" id="speed-label"></span></div>
          <input type="range" min="0.5" max="2.0" step="0.1" value="${String(app.tour.speed)}" />
        `;
        const range = qs("input[type=\"range\"]", speedField);
        const speedLabel = qs("#speed-label", speedField);
        const syncSpeedLabel = () => {
          if (speedLabel) speedLabel.textContent = `${Number(app.tour.speed).toFixed(1)}x`;
        };
        syncSpeedLabel();
        range.addEventListener("input", () => {
          app.tour.speed = Number(range.value);
          syncSpeedLabel();
        });
        container.appendChild(speedField);

        const steps = document.createElement("div");
        steps.className = "list";
        for (let i = 0; i < (scenario.steps?.length ?? 0); i += 1) {
          const s = scenario.steps[i];
          const item = document.createElement("div");
          item.className = "card";
          item.style.cursor = "pointer";
          item.style.borderColor = i === idx ? "rgba(214,255,77,0.35)" : "";
          item.style.background = i === idx ? "rgba(214,255,77,0.07)" : "";
          item.innerHTML = `
            <div class="card__kicker">STEP ${i + 1}</div>
            <div class="card__title">${escapeHtml(s.titleZh ?? s.id)}</div>
            <div class="card__body">${escapeHtml((s.bodyZh ?? "").slice(0, 84))}${(s.bodyZh ?? "").length > 84 ? "…" : ""}</div>
          `;
          item.addEventListener("click", () => {
            stopPlay();
            app.tour.stepIndex = i;
            render();
          });
          steps.appendChild(item);
        }
        container.appendChild(steps);

        renderPanel(
          left,
          "导览",
          scenario.summaryZh ?? "按步骤播放一条真实链路；同时高亮图中的节点/边。",
          container
        );
        return;
      }

      if (app.view === "sim") {
        if (left.dataset.activeView === "sim") {
          return;
        }
        left.dataset.activeView = "sim";
        const container = document.createElement("div");

        const split = document.createElement("div");
        split.className = "split";
        split.appendChild(
          createNode(
            "div",
            "field",
            `
              <div class="label"><span>chatType</span><span class="muted mono">direct/group</span></div>
              <select id="sim-chatType">
                <option value="direct">direct (私聊)</option>
                <option value="group">group (群聊)</option>
              </select>
            `
          )
        );
        split.appendChild(
          createNode(
            "div",
            "field",
            `
              <div class="label"><span>agentId</span><span class="muted mono">SessionKey 前缀</span></div>
              <input id="sim-agentId" type="text" value="${escapeHtml(app.sim.agentId)}" />
            `
          )
        );
        container.appendChild(split);

        const f1 = createNode(
          "div",
          "field",
          `
            <div class="label"><span>conversationId</span><span class="muted mono">cid...</span></div>
            <input id="sim-conv" type="text" value="${escapeHtml(app.sim.chat.conversationId)}" />
          `
        );
        container.appendChild(f1);

        const f2 = createNode(
          "div",
          "field",
          `
            <div class="label"><span>senderId</span><span class="muted mono">staffId/userId</span></div>
            <input id="sim-sender" type="text" value="${escapeHtml(app.sim.chat.senderId)}" />
          `
        );
        container.appendChild(f2);

        const f3 = createNode(
          "div",
          "field",
          `
            <div class="label"><span>text</span><span class="muted mono">消息正文</span></div>
            <textarea id="sim-text">${escapeHtml(app.sim.chat.text)}</textarea>
          `
        );
        container.appendChild(f3);

        const toggles = createNode(
          "div",
          "card",
          `
            <div class="card__kicker">FILTERS</div>
            <div class="card__body">
              <div style="display:flex; gap:12px; flex-wrap:wrap">
                <label class="chip"><input id="sim-inAt" type="checkbox" style="accent-color: var(--accent)" /> isInAtList</label>
                <label class="chip"><input id="sim-requireMention" type="checkbox" style="accent-color: var(--accent)" /> requireMention</label>
                <label class="chip"><input id="sim-isolate" type="checkbox" style="accent-color: var(--accent)" /> isolateContextPerUserInGroup</label>
              </div>
              <div style="margin-top:12px">
                <div class="label"><span>requirePrefix</span><span class="muted mono">群聊前缀</span></div>
                <input id="sim-requirePrefix" type="text" value="${escapeHtml(app.sim.account.requirePrefix)}" placeholder="/bot" />
              </div>
              <div style="margin-top:12px">
                <div class="label"><span>allowFrom (逗号分隔)</span><span class="muted mono">allowlist</span></div>
                <input id="sim-allowFrom" type="text" value="" placeholder="staff001,staff002" />
              </div>
              <div style="margin-top:12px">
                <div class="label"><span>mentionBypassUsers (逗号分隔)</span><span class="muted mono">群聊 @ 绕过</span></div>
                <input id="sim-bypass" type="text" value="" placeholder="staffAdmin" />
              </div>
              <div style="margin-top:12px">
                <div class="label"><span>selfUserId (可选)</span><span class="muted mono">过滤自发消息</span></div>
                <input id="sim-self" type="text" value="" placeholder="robot_user_id" />
              </div>
            </div>
          `
        );
        container.appendChild(toggles);

        const bind = () => {
          const get = (id) => qs(`#${id}`, container);
          const setFromCsv = (raw) =>
            String(raw ?? "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);

          const chatType = get("sim-chatType");
          const agentId = get("sim-agentId");
          const conv = get("sim-conv");
          const sender = get("sim-sender");
          const text = get("sim-text");

          const isInAtList = get("sim-inAt");
          const requireMention = get("sim-requireMention");
          const isolate = get("sim-isolate");
          const requirePrefix = get("sim-requirePrefix");
          const allowFrom = get("sim-allowFrom");
          const bypass = get("sim-bypass");
          const self = get("sim-self");

          if (chatType) chatType.value = app.sim.chat.chatType;
          if (isInAtList) isInAtList.checked = Boolean(app.sim.chat.isInAtList);
          if (requireMention) requireMention.checked = Boolean(app.sim.account.requireMention);
          if (isolate) isolate.checked = Boolean(app.sim.account.isolateContextPerUserInGroup);

          const sync = () => {
            app.sim.chat.chatType = chatType?.value ?? app.sim.chat.chatType;
            app.sim.agentId = agentId?.value?.trim() || "main";
            app.sim.chat.conversationId = conv?.value?.trim() || "";
            app.sim.chat.senderId = sender?.value?.trim() || "";
            app.sim.chat.text = text?.value ?? "";
            app.sim.chat.isInAtList = Boolean(isInAtList?.checked);

            app.sim.account.requireMention = Boolean(requireMention?.checked);
            app.sim.account.isolateContextPerUserInGroup = Boolean(isolate?.checked);
            app.sim.account.requirePrefix = requirePrefix?.value ?? "";
            app.sim.account.allowFrom = setFromCsv(allowFrom?.value ?? "");
            app.sim.account.mentionBypassUsers = setFromCsv(bypass?.value ?? "");
            app.sim.account.selfUserId = self?.value?.trim() ?? "";
            render();
          };

          for (const el of [
            chatType,
            agentId,
            conv,
            sender,
            text,
            isInAtList,
            requireMention,
            isolate,
            requirePrefix,
            allowFrom,
            bypass,
            self,
          ]) {
            if (!el) continue;
            el.addEventListener("input", sync);
            el.addEventListener("change", sync);
          }
        };
        bind();

        renderPanel(
          left,
          "模拟器",
          "改动输入与配置，实时计算过滤结果与 SessionKey，并在图上高亮下一步路径。",
          container
        );
        return;
      }

      if (app.view === "index") {
        left.dataset.activeView = "index";
        const byLane = groupBy(model.nodes ?? [], (n) => n.lane ?? "unknown");
        const container = document.createElement("div");
        for (const lane of model.lanes ?? []) {
          const nodes = (byLane.get(lane.id) ?? []).slice().sort(sortByLabelZh);
          if (nodes.length === 0) continue;
          container.appendChild(
            createNode(
              "div",
              "card",
              `<div class="card__kicker">LANE</div><div class="card__title">${escapeHtml(
                lane.labelZh
              )}</div><div class="card__body muted">点击条目会在右侧显示 codeRef，并在图中选中。</div>`
            )
          );
          const list = document.createElement("div");
          list.className = "list";
          for (const node of nodes) {
            const item = document.createElement("div");
            item.className = "card";
            item.style.cursor = "pointer";
            item.innerHTML = `
              <div class="card__kicker">${escapeHtml(node.kind ?? "module")}</div>
              <div class="card__title">${escapeHtml(node.labelZh ?? node.id)}</div>
              <div class="card__body">${escapeHtml((node.summary ?? "").slice(0, 84))}${(node.summary ?? "").length > 84 ? "…" : ""}</div>
            `;
            item.addEventListener("click", () => {
              app.selection = { type: "node", id: node.id };
              render();
            });
            list.appendChild(item);
          }
          container.appendChild(list);
        }
        renderPanel(left, "代码索引", "按泳道浏览；点击可定位到源码提示。", container);
        return;
      }

      if (app.view === "glossary") {
        left.dataset.activeView = "glossary";
        const container = document.createElement("div");
        container.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">SESSION</div>
              <div class="card__title">SessionKey</div>
              <div class="card__body">
                DingTalk 插件用 <span class="mono">agent:${escapeHtml(app.sim.agentId)}:dingtalk:dm:&lt;sender&gt;</span> 或
                <span class="mono">agent:${escapeHtml(app.sim.agentId)}:dingtalk:group:&lt;cid&gt;</span> 作为会话键。
                当开启 <span class="mono">isolateContextPerUserInGroup</span> 时，会追加 <span class="mono">:user:&lt;sender&gt;</span>。
              </div>
            `
          )
        );
        container.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">DELIVERY</div>
              <div class="card__title">deliver(payload, { kind })</div>
              <div class="card__body">
                <span class="mono">kind=block</span> 代表流式“中间块”；<span class="mono">kind=final</span> 是最终回复。
                插件可选择把 block 直接发钉钉或缓冲后补一个 synthetic final（见 monitor.ts）。
              </div>
            `
          )
        );
        container.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">MEDIA</div>
              <div class="card__title">媒体协议 [DING:*]</div>
              <div class="card__body">
                Agent 可返回 <span class="mono">[DING:IMAGE path=\"/abs/a.png\"]</span> 等标签。
                插件会上传并在 markdown 中嵌入 <span class="mono">mediaId</span>，或把 file/video/audio 拆分后单独发送。
              </div>
            `
          )
        );
        container.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">AI CARD</div>
              <div class="card__title">AI Card streaming</div>
              <div class="card__body">
                当 <span class="mono">aiCard.enabled</span> 且满足 autoReply/templateId，插件将回复映射为卡片生命周期：
                create + deliver + stream(updateThrottleMs) + finalize(update finished)。
              </div>
            `
          )
        );
        container.appendChild(
          createNode(
            "div",
            "card",
            `
              <div class="card__kicker">MCP</div>
              <div class="card__title">availability-first</div>
              <div class="card__body">
                百炼 MCP 工具不可用（未开通/未启用/缺 key）时，插件必须明确说明并降级到有用的 fallback，
                不能“假装成功”（见 tools.ts 的执行契约）。
              </div>
            `
          )
        );
        renderPanel(left, "术语", "把最关键的抽象讲清楚，然后再回到图和源码。", container);
        return;
      }
    }

    function renderRight() {
      if (!right) return;
      const container = document.createElement("div");
      container.appendChild(renderSelectionDetails());
      container.appendChild(renderDataInspector());
      renderPanel(right, "白盒细节", "选中项 + 当前数据（导览 step state / 模拟器结果）", container);
    }

    function startPlay() {
      if (app.tour.playing) return;
      app.tour.playing = true;
      const tick = () => {
        if (!app.tour.playing) return;
        const scenario = getScenario();
        const lastIdx = Math.max(0, (scenario.steps?.length ?? 1) - 1);
        if (app.tour.stepIndex >= lastIdx) {
          stopPlay();
          render();
          return;
        }
        app.tour.stepIndex += 1;
        render();
        const delay = 900 / clamp(app.tour.speed ?? 1, 0.4, 2.5);
        app.tour.timer = window.setTimeout(tick, delay);
      };
      const delay = 900 / clamp(app.tour.speed ?? 1, 0.4, 2.5);
      app.tour.timer = window.setTimeout(tick, delay);
    }

    function stopPlay() {
      app.tour.playing = false;
      if (app.tour.timer) {
        window.clearTimeout(app.tour.timer);
        app.tour.timer = 0;
      }
    }

    function render() {
      // view tabs
      for (const t of qsa(".tab")) {
        const view = t.getAttribute("data-view");
        t.classList.toggle("is-active", view === app.view);
        t.onclick = () => {
          stopPlay();
          app.view = view;
          if (left) left.dataset.activeView = "";
          render();
        };
      }

      if (app.view === "tour") {
        const { step } = getStep();
        applyFocus(step?.focus ?? { nodes: [], edges: [] });
        applyTokens(step?.tokens ?? []);
      } else if (app.view !== "sim") {
        applyFocus({ nodes: [], edges: [] });
        applyTokens([]);
      }

      applySelection();
      renderLeft();
      renderRight();
    }

    render();
  };

  void boot();
}

mainView();
