// Child Safety Red Teaming Dashboard — frontend logic (vanilla JS, no build step)

const state = {
  meta: null, // {categories: [{id,label}], severities, backends, system_prompt_modes}
  resultsIndex: [], // [{model,total,evaluated,errors}]
  currentResultsModel: null,
  currentResultsRecords: [],
  expandedPromptId: null,
  activeRunId: null,
  runPollTimer: null,
};

// ---------------------------------------------------------------- fetch helpers

async function fetchJSON(url, options) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `Request failed: ${resp.status}`);
  }
  return data;
}

function toast(message, isError) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------- tooltip

const tooltipEl = document.getElementById("tooltip");

function showTooltip(evt, lines) {
  tooltipEl.replaceChildren();
  lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = i === 0 ? "tt-value" : "tt-label";
    div.textContent = line;
    tooltipEl.appendChild(div);
  });
  tooltipEl.style.display = "block";
  positionTooltip(evt);
}

function positionTooltip(evt) {
  const x = evt.clientX ?? (evt.target.getBoundingClientRect().right);
  const y = evt.clientY ?? (evt.target.getBoundingClientRect().top);
  tooltipEl.style.left = Math.min(x + 14, window.innerWidth - 260) + "px";
  tooltipEl.style.top = Math.min(y + 14, window.innerHeight - 80) + "px";
}

function hideTooltip() {
  tooltipEl.style.display = "none";
}

function bindTooltip(el, lines) {
  el.addEventListener("mouseenter", (e) => showTooltip(e, lines));
  el.addEventListener("mousemove", positionTooltip);
  el.addEventListener("mouseleave", hideTooltip);
  el.tabIndex = 0;
  el.addEventListener("focus", (e) => showTooltip(e, lines));
  el.addEventListener("blur", hideTooltip);
}

// ---------------------------------------------------------------- color helpers

function catColor(categoryId) {
  const idx = state.meta.categories.findIndex((c) => c.id === categoryId);
  return `var(--cat-${(idx >= 0 ? idx : 0) + 1})`;
}

function statusColorForScale(value, warnAt, critAt) {
  if (value === null || value === undefined) return "var(--text-muted)";
  if (value > critAt) return "var(--status-critical)";
  if (value > warnAt) return "var(--status-warning)";
  return "var(--status-good)";
}

// ---------------------------------------------------------------- tabs

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");

    // Data can change in another tab (e.g. scoring in Results) — refresh on entry.
    if (btn.dataset.tab === "analytics" && document.getElementById("a-model").value) {
      loadAnalytics();
    }
    if (btn.dataset.tab === "results" && document.getElementById("r-model").value) {
      loadResultsDetail();
    }
  });
});

// ---------------------------------------------------------------- meta + ollama status

async function loadMeta() {
  state.meta = await fetchJSON("/api/meta");

  const catSelect = (id, includeAll) => {
    const el = document.getElementById(id);
    state.meta.categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      el.appendChild(opt);
    });
  };
  catSelect("f-category");
  catSelect("r-category");

  const sevSelect = (id) => {
    const el = document.getElementById(id);
    state.meta.severities.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s[0].toUpperCase() + s.slice(1);
      el.appendChild(opt);
    });
  };
  sevSelect("r-severity");

  const backendEl = document.getElementById("f-backend");
  state.meta.backends.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b;
    backendEl.appendChild(opt);
  });

  const spEl = document.getElementById("f-system-prompt");
  state.meta.system_prompt_modes.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    spEl.appendChild(opt);
  });
}

async function refreshOllamaStatus() {
  const dot = document.getElementById("ollamaDot");
  const text = document.getElementById("ollamaStatusText");
  try {
    const data = await fetchJSON("/api/ollama/models");
    const datalist = document.getElementById("ollamaModelOptions");
    datalist.replaceChildren();
    if (data.reachable) {
      dot.className = "dot good";
      text.textContent = `Ollama connected — ${data.models.length} model(s) pulled`;
      data.models.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.name;
        datalist.appendChild(opt);
      });
    } else {
      dot.className = "dot critical";
      text.textContent = "Ollama unreachable (run: brew services start ollama)";
    }
  } catch (e) {
    dot.className = "dot critical";
    text.textContent = "Ollama status check failed";
  }
}

// ---------------------------------------------------------------- results index (shared by Results + Analytics tabs)

async function loadResultsIndex() {
  state.resultsIndex = await fetchJSON("/api/results");
  const fill = (selectId) => {
    const el = document.getElementById(selectId);
    const prevValue = el.value;
    el.replaceChildren();
    if (state.resultsIndex.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No results yet";
      el.appendChild(opt);
      return;
    }
    state.resultsIndex.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.model;
      opt.textContent = `${r.model} (${r.evaluated}/${r.total} scored)`;
      el.appendChild(opt);
    });
    if (state.resultsIndex.some((r) => r.model === prevValue)) {
      el.value = prevValue;
    }
  };
  fill("r-model");
  fill("a-model");
}

// ---------------------------------------------------------------- Run tab

document.getElementById("startRunBtn").addEventListener("click", async () => {
  const btn = document.getElementById("startRunBtn");
  const body = {
    model: document.getElementById("f-model").value.trim(),
    backend: document.getElementById("f-backend").value,
    category: document.getElementById("f-category").value || null,
    system_prompt_mode: document.getElementById("f-system-prompt").value,
    delay: parseFloat(document.getElementById("f-delay").value || "1.0"),
    no_resume: document.getElementById("f-no-resume").checked,
  };
  if (!body.model) {
    toast("Model is required", true);
    return;
  }
  btn.disabled = true;
  try {
    const data = await fetchJSON("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.activeRunId = data.run_id;
    document.getElementById("activeRunCard").style.display = "block";
    document.getElementById("activeRunTitle").textContent = `Run ${data.run_id} — ${body.model} (${body.backend})`;
    pollActiveRun();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});

function pollActiveRun() {
  if (state.runPollTimer) clearInterval(state.runPollTimer);
  const tick = async () => {
    if (!state.activeRunId) return;
    try {
      const run = await fetchJSON(`/api/run/${state.activeRunId}`);
      const logBox = document.getElementById("activeRunLog");
      logBox.textContent = run.log_tail || "";
      logBox.scrollTop = logBox.scrollHeight;

      const meter = document.getElementById("activeRunMeter");
      const progressText = document.getElementById("activeRunProgressText");
      if (run.progress) {
        const pct = Math.min(100, (run.progress.current / run.progress.total) * 100);
        meter.style.width = pct.toFixed(0) + "%";
        progressText.textContent = `${run.progress.current} / ${run.progress.total} prompts`;
      }

      if (run.status !== "running") {
        clearInterval(state.runPollTimer);
        meter.style.width = run.status === "completed" ? "100%" : meter.style.width;
        progressText.textContent = run.status === "completed" ? "Completed" : `Failed (exit code ${run.returncode})`;
        toast(
          run.status === "completed" ? "Attack run completed" : "Attack run failed — check the log",
          run.status !== "completed"
        );
        loadResultsIndex();
        renderRunsList();
      }
    } catch (e) {
      clearInterval(state.runPollTimer);
    }
  };
  tick();
  state.runPollTimer = setInterval(tick, 1500);
}

async function renderRunsList() {
  const runs = await fetchJSON("/api/runs");
  const el = document.getElementById("runsList");
  if (runs.length === 0) {
    el.className = "empty-state";
    el.textContent = "No runs yet.";
    return;
  }
  el.className = "";
  el.replaceChildren();
  runs.forEach((r) => {
    const row = document.createElement("div");
    row.className = "run-row";

    const badge = document.createElement("span");
    badge.className = "status-badge " + r.status;
    badge.textContent = r.status;
    row.appendChild(badge);

    const label = document.createElement("span");
    label.textContent = `${r.args.model} · ${r.args.backend} · ${r.args.category || "all categories"} · ${r.args.system_prompt_mode}`;
    row.appendChild(label);

    const time = document.createElement("span");
    time.style.marginLeft = "auto";
    time.style.color = "var(--text-muted)";
    time.textContent = new Date(r.started_at).toLocaleTimeString();
    row.appendChild(time);

    el.appendChild(row);
  });
}

// ---------------------------------------------------------------- Results tab

document.getElementById("r-model").addEventListener("change", loadResultsDetail);
document.getElementById("r-category").addEventListener("change", renderResultsTable);
document.getElementById("r-severity").addEventListener("change", renderResultsTable);
document.getElementById("r-unevaluated").addEventListener("change", renderResultsTable);

async function loadResultsDetail() {
  const model = document.getElementById("r-model").value;
  state.currentResultsModel = model;
  state.expandedPromptId = null;
  if (!model) {
    state.currentResultsRecords = [];
    renderResultsTable();
    return;
  }
  state.currentResultsRecords = await fetchJSON(`/api/results/${encodeURIComponent(model)}`);
  renderResultsTable();
}

function renderResultsTable() {
  const wrap = document.getElementById("resultsTableWrap");
  let records = state.currentResultsRecords;

  const catFilter = document.getElementById("r-category").value;
  const sevFilter = document.getElementById("r-severity").value;
  const unevalOnly = document.getElementById("r-unevaluated").checked;

  records = records.filter((r) => {
    if (catFilter && r.category !== catFilter) return false;
    if (sevFilter && r.severity !== sevFilter) return false;
    if (unevalOnly && r.evaluation_score !== null && r.evaluation_score !== undefined) return false;
    return true;
  });

  if (records.length === 0) {
    wrap.className = "empty-state";
    wrap.textContent = state.currentResultsModel ? "No prompts match these filters." : "Select a model to view results.";
    return;
  }
  wrap.className = "";
  wrap.replaceChildren();

  const table = document.createElement("table");
  table.className = "results-table";
  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>ID</th><th>Category</th><th>Severity</th><th>Technique</th><th>Prompt</th><th>Response</th><th>Eval</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  records.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "result-row";

    const tdId = document.createElement("td");
    tdId.textContent = r.prompt_id;
    tr.appendChild(tdId);

    const tdCat = document.createElement("td");
    const swatch = document.createElement("span");
    swatch.className = "cat-swatch";
    swatch.style.background = catColor(r.category);
    tdCat.appendChild(swatch);
    tdCat.appendChild(document.createTextNode(r.category.replace(/_/g, " ")));
    tr.appendChild(tdCat);

    const tdSev = document.createElement("td");
    tdSev.textContent = r.severity;
    tr.appendChild(tdSev);

    const tdTech = document.createElement("td");
    tdTech.textContent = (r.attack_technique || "").replace(/_/g, " ");
    tr.appendChild(tdTech);

    const tdPrompt = document.createElement("td");
    tdPrompt.className = "truncate";
    tdPrompt.textContent = r.prompt;
    tr.appendChild(tdPrompt);

    const tdResp = document.createElement("td");
    tdResp.className = "truncate";
    tdResp.textContent = r.error ? `ERROR: ${r.error}` : r.model_response || "";
    tr.appendChild(tdResp);

    const tdEval = document.createElement("td");
    const pill = document.createElement("span");
    if (r.evaluation_score === null || r.evaluation_score === undefined) {
      pill.className = "eval-pill unscored";
      pill.textContent = "unscored";
    } else {
      pill.className = "eval-pill score-" + r.evaluation_score;
      pill.textContent = ["Safe", "Partial", "Unsafe"][r.evaluation_score];
    }
    tdEval.appendChild(pill);
    tr.appendChild(tdEval);

    tr.addEventListener("click", () => {
      state.expandedPromptId = state.expandedPromptId === r.prompt_id ? null : r.prompt_id;
      renderResultsTable();
    });
    tbody.appendChild(tr);

    if (state.expandedPromptId === r.prompt_id) {
      const detailTr = document.createElement("tr");
      const detailTd = document.createElement("td");
      detailTd.colSpan = 7;
      detailTd.appendChild(buildDetailPanel(r));
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);
    }
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
}

function buildDetailPanel(record) {
  const panel = document.createElement("div");
  panel.className = "detail-panel";

  const block = (label, text) => {
    const b = document.createElement("div");
    b.className = "block";
    const l = document.createElement("div");
    l.className = "block-label";
    l.textContent = label;
    const t = document.createElement("div");
    t.className = "block-text";
    t.textContent = text || "(none)";
    b.appendChild(l);
    b.appendChild(t);
    return b;
  };

  panel.appendChild(block("Prompt", record.prompt));
  panel.appendChild(block("Model response", record.error ? `ERROR: ${record.error}` : record.model_response));
  panel.appendChild(block("Expected safe response", record.expected_safe_response));

  const controls = document.createElement("div");
  controls.className = "eval-controls";

  let pendingScore = record.evaluation_score;

  ["Safe", "Partial", "Unsafe"].forEach((label, score) => {
    const btn = document.createElement("button");
    btn.className = "score-btn" + (pendingScore === score ? " selected" : "");
    btn.dataset.score = score;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      pendingScore = score;
      controls.querySelectorAll(".score-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    controls.appendChild(btn);
  });

  const notesInput = document.createElement("textarea");
  notesInput.placeholder = "Notes (optional)";
  notesInput.value = record.evaluation_notes || "";
  notesInput.style.flexBasis = "100%";

  const saveBtn = document.createElement("button");
  saveBtn.className = "primary";
  saveBtn.textContent = "Save evaluation";
  saveBtn.addEventListener("click", async () => {
    if (pendingScore === null || pendingScore === undefined) {
      toast("Pick Safe / Partial / Unsafe first", true);
      return;
    }
    try {
      const updated = await fetchJSON(`/api/results/${encodeURIComponent(state.currentResultsModel)}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: record.prompt_id, score: pendingScore, notes: notesInput.value }),
      });
      Object.assign(record, updated);
      toast(`Saved ${record.prompt_id}`);
      loadResultsIndex();
      renderResultsTable();
    } catch (e) {
      toast(e.message, true);
    }
  });

  panel.appendChild(controls);
  panel.appendChild(notesInput);
  panel.appendChild(saveBtn);
  return panel;
}

// ---------------------------------------------------------------- Analytics tab

document.getElementById("a-model").addEventListener("change", loadAnalytics);
document.getElementById("generateReportBtn").addEventListener("click", async () => {
  const model = document.getElementById("a-model").value;
  if (!model) return;
  const btn = document.getElementById("generateReportBtn");
  const msg = document.getElementById("reportMsg");
  btn.disabled = true;
  msg.textContent = "Generating…";
  try {
    const data = await fetchJSON(`/api/report/${encodeURIComponent(model)}`, { method: "POST" });
    msg.textContent = `Report + charts written to analysis/ (${data.report_path})`;
    toast("Report generated");
  } catch (e) {
    msg.textContent = "";
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});

async function loadAnalytics() {
  const model = document.getElementById("a-model").value;
  if (!model) return;
  const summary = await fetchJSON(`/api/summary/${encodeURIComponent(model)}`);
  renderStatTiles(summary);
  renderDistributionChart(summary);
  renderCategoryChart(summary);
  renderSeverityChart(summary);
  renderTechniqueChart(summary);
}

function renderStatTiles(summary) {
  const tiles = [
    { label: "Total prompts", value: summary.total },
    { label: "Evaluated", value: `${summary.evaluated} / ${summary.total}` },
    { label: "Errors", value: summary.errors },
    {
      label: "Mean latency",
      value: summary.latency ? `${summary.latency.mean} ms` : "—",
    },
  ];
  const el = document.getElementById("statTiles");
  el.replaceChildren();
  tiles.forEach((t) => {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = t.label;
    const v = document.createElement("div");
    v.className = "stat-value";
    v.textContent = t.value;
    tile.appendChild(l);
    tile.appendChild(v);
    el.appendChild(tile);
  });
}

function renderDistributionChart(summary) {
  const container = document.getElementById("chartDistribution");
  const dist = summary.score_distribution;
  const total = dist.safe + dist.partial + dist.unsafe;
  if (total === 0) {
    container.className = "empty-state";
    container.textContent = "No evaluated results yet.";
    return;
  }
  container.className = "";
  container.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "chart-col-wrap";
  const maxVal = Math.max(dist.safe, dist.partial, dist.unsafe, 1);

  const bars = [
    { key: "safe", label: "Safe / Refusal", color: "var(--status-good)", value: dist.safe },
    { key: "partial", label: "Partial / Hedged", color: "var(--status-warning)", value: dist.partial },
    { key: "unsafe", label: "Unsafe / Compliant", color: "var(--status-critical)", value: dist.unsafe },
  ];

  bars.forEach((b) => {
    const col = document.createElement("div");
    col.className = "chart-col";

    const cap = document.createElement("div");
    cap.className = "value-cap";
    cap.textContent = b.value;
    col.appendChild(cap);

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.background = b.color;
    bar.style.height = ((b.value / maxVal) * 170 || 0) + "px";
    bindTooltip(bar, [`${b.value} responses`, b.label]);
    col.appendChild(bar);

    const label = document.createElement("div");
    label.className = "col-label";
    label.textContent = b.label;
    col.appendChild(label);

    wrap.appendChild(col);
  });

  container.appendChild(wrap);
}

function renderCategoryChart(summary) {
  const container = document.getElementById("chartCategory");
  const rows = summary.by_category
    .filter((c) => c.mean_score !== null)
    .sort((a, b) => b.mean_score - a.mean_score);

  if (rows.length === 0) {
    container.className = "empty-state";
    container.textContent = "No evaluated results yet.";
    return;
  }
  container.className = "";
  renderHorizontalBars(
    container,
    rows.map((r) => ({
      label: r.label,
      value: r.mean_score,
      max: 2,
      color: statusColorForScale(r.mean_score, 0.5, 1.0),
      tooltip: [`${r.mean_score.toFixed(2)} mean score`, `${r.label} — ${r.evaluated} evaluated (safe ${r.safe} / partial ${r.partial} / unsafe ${r.unsafe})`],
      valueText: r.mean_score.toFixed(2),
    }))
  );
}

function renderSeverityChart(summary) {
  const container = document.getElementById("chartSeverity");
  const rows = summary.by_severity.filter((s) => s.success_rate !== null);
  if (rows.length === 0) {
    container.className = "empty-state";
    container.textContent = "No evaluated results yet.";
    return;
  }
  container.className = "";
  container.replaceChildren();

  const wrap = document.createElement("div");
  wrap.className = "chart-col-wrap";

  rows.forEach((r) => {
    const col = document.createElement("div");
    col.className = "chart-col";

    const cap = document.createElement("div");
    cap.className = "value-cap";
    cap.textContent = r.success_rate.toFixed(1) + "%";
    col.appendChild(cap);

    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.background = statusColorForScale(r.success_rate, 25, 60);
    bar.style.height = (r.success_rate / 100) * 170 + "px";
    bindTooltip(bar, [`${r.success_rate.toFixed(1)}% success rate`, `${r.severity} severity — ${r.total} evaluated`]);
    col.appendChild(bar);

    const label = document.createElement("div");
    label.className = "col-label";
    label.textContent = r.severity[0].toUpperCase() + r.severity.slice(1);
    col.appendChild(label);

    wrap.appendChild(col);
  });

  container.appendChild(wrap);
}

function renderTechniqueChart(summary) {
  const container = document.getElementById("chartTechnique");
  const rows = summary.by_technique;
  if (rows.length === 0) {
    container.className = "empty-state";
    container.textContent = "No evaluated results yet.";
    return;
  }
  container.className = "";
  renderHorizontalBars(
    container,
    rows.map((r) => ({
      label: r.label,
      value: r.mean_score,
      max: 2,
      color: statusColorForScale(r.mean_score, 0.5, 1.0),
      tooltip: [`${r.mean_score.toFixed(2)} mean score`, `${r.label} — ${r.count} evaluated`],
      valueText: r.mean_score.toFixed(2),
    }))
  );
}

function renderHorizontalBars(container, rows) {
  container.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "chart-row-wrap";

  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "chart-row";

    const label = document.createElement("div");
    label.className = "row-label";
    label.textContent = r.label;
    row.appendChild(label);

    const track = document.createElement("div");
    track.className = "row-track";
    const bar = document.createElement("div");
    bar.className = "row-bar";
    bar.style.background = r.color;
    bar.style.width = Math.min(100, (r.value / r.max) * 100) + "%";
    bindTooltip(bar, [r.valueText, r.label, ...r.tooltip.slice(1)]);
    track.appendChild(bar);
    row.appendChild(track);

    const value = document.createElement("div");
    value.className = "row-value";
    value.textContent = r.valueText;
    row.appendChild(value);

    wrap.appendChild(row);
  });

  container.appendChild(wrap);
}

// ---------------------------------------------------------------- boot

(async function init() {
  await loadMeta();
  await Promise.all([refreshOllamaStatus(), loadResultsIndex(), renderRunsList()]);
  setInterval(refreshOllamaStatus, 15000);

  // Auto-load analytics/results for the first available model
  if (state.resultsIndex.length > 0) {
    document.getElementById("a-model").value = state.resultsIndex[0].model;
    document.getElementById("r-model").value = state.resultsIndex[0].model;
    loadAnalytics();
    loadResultsDetail();
  }
})();
