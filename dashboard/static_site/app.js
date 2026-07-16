// Child Safety Red Teaming — static read-only dashboard.
// Same rendering logic as the local dashboard's app.js, but fetches
// pre-baked JSON under data/ instead of a live Flask API, and has no
// Run tab / evaluate writes (this snapshot cannot execute local model
// runs or persist scores — it's rebuilt from the local dashboard).

const state = {
  meta: null,
  resultsIndex: [],
  currentResultsModel: null,
  currentResultsRecords: [],
  expandedPromptId: null,
};

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Request failed: ${resp.status}`);
  return resp.json();
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
  const x = evt.clientX ?? evt.target.getBoundingClientRect().right;
  const y = evt.clientY ?? evt.target.getBoundingClientRect().top;
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
  });
});

// ---------------------------------------------------------------- meta + snapshot status

async function loadMeta() {
  state.meta = await fetchJSON("data/meta.json");

  const catSelect = (id) => {
    const el = document.getElementById(id);
    state.meta.categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      el.appendChild(opt);
    });
  };
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

  document.getElementById("snapshotStatusText").textContent = state.meta.generated_at
    ? `Snapshot generated ${new Date(state.meta.generated_at).toLocaleString()}`
    : "Snapshot";
}

// ---------------------------------------------------------------- results index

async function loadResultsIndex() {
  state.resultsIndex = await fetchJSON("data/results-index.json");
  const fill = (selectId) => {
    const el = document.getElementById(selectId);
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
  };
  fill("r-model");
  fill("a-model");
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
  state.currentResultsRecords = await fetchJSON(`data/results/${encodeURIComponent(model)}.json`);
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

  if (record.evaluation_score !== null && record.evaluation_score !== undefined) {
    panel.appendChild(
      block(
        "Evaluation",
        `${["Safe/Refusal", "Partial/Hedged", "Unsafe/Compliant"][record.evaluation_score]}${
          record.evaluation_notes ? " — " + record.evaluation_notes : ""
        }`
      )
    );
  } else {
    const note = document.createElement("div");
    note.className = "card-sub";
    note.textContent = "Not yet evaluated. Scoring happens in the local dashboard, not here.";
    panel.appendChild(note);
  }

  return panel;
}

// ---------------------------------------------------------------- Analytics tab

document.getElementById("a-model").addEventListener("change", loadAnalytics);

async function loadAnalytics() {
  const model = document.getElementById("a-model").value;
  if (!model) return;
  const summary = await fetchJSON(`data/summary/${encodeURIComponent(model)}.json`);
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
    { label: "Mean latency", value: summary.latency ? `${summary.latency.mean} ms` : "—" },
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
  const rows = summary.by_category.filter((c) => c.mean_score !== null).sort((a, b) => b.mean_score - a.mean_score);

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
  await loadResultsIndex();

  if (state.resultsIndex.length > 0) {
    document.getElementById("a-model").value = state.resultsIndex[0].model;
    document.getElementById("r-model").value = state.resultsIndex[0].model;
    loadAnalytics();
    loadResultsDetail();
  }
})();
