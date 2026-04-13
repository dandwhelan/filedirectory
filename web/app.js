const exportSelect = document.getElementById("exportSelect");
const reloadBtn = document.getElementById("reloadBtn");
const searchInput = document.getElementById("searchInput");
const treeRoot = document.getElementById("treeRoot");
const importInput = document.getElementById("importInput");
const importBtn = document.getElementById("importBtn");
const importStatus = document.getElementById("importStatus");

const companyValue = document.getElementById("companyValue");
const folderValue = document.getElementById("folderValue");
const descriptionValue = document.getElementById("descriptionValue");

const statsGrid = document.getElementById("statsGrid");
const fileTypesList = document.getElementById("fileTypesList");
const largestFilesList = document.getElementById("largestFilesList");
const piiList = document.getElementById("piiList");
const piiCategoryList = document.getElementById("piiCategoryList");
const piiScoreCard = document.getElementById("piiScoreCard");
const exportPiiJsonBtn = document.getElementById("exportPiiJsonBtn");
const exportPiiCsvBtn = document.getElementById("exportPiiCsvBtn");

let currentExport = null;
let lastPiiSignals = [];

const piiPatterns = [
  { label: "Contract or agreement", category: "Legal agreements", severity: "high", score: 35, regex: /(contract|agreement|msa|sow|statement[_ -]?of[_ -]?work|order[_ -]?form)/i },
  { label: "NDA / confidentiality", category: "Legal agreements", severity: "high", score: 42, regex: /(nda|non[- _]?disclosure|confidentiality[_ -]?agreement|mutual[_ -]?nda)/i },
  { label: "Passport or travel identity", category: "Government ID", severity: "high", score: 40, regex: /(passport|travel[_ -]?document|resident[_ -]?permit|visa)/i },
  { label: "Driver license records", category: "Government ID", severity: "high", score: 38, regex: /(driver'?s?[_ -]?licen[sc]e|driving[_ -]?licen[sc]e|dmv|vehicle[_ -]?registration)/i },
  { label: "Tax forms and identifiers", category: "Tax & payroll", severity: "high", score: 36, regex: /(w[-_ ]?2|w[-_ ]?9|1099|tax[_ -]?return|irs|ein|tin|ssn|national[_ -]?id)/i },
  { label: "Banking / payment instructions", category: "Financial accounts", severity: "high", score: 34, regex: /(bank[_ -]?account|routing|iban|swift|wire[_ -]?transfer|payment[_ -]?instruction)/i },
  { label: "Payroll / compensation records", category: "Tax & payroll", severity: "medium", score: 24, regex: /(payroll|salary|bonus|compensation|payslip|direct[_ -]?deposit)/i },
  { label: "Medical / health records", category: "Health data", severity: "high", score: 32, regex: /(medical|health[_ -]?record|patient|diagnosis|prescription|phi|hipaa)/i },
  { label: "Background checks or screening", category: "Sensitive personnel", severity: "medium", score: 26, regex: /(background[_ -]?check|criminal[_ -]?record|fingerprint|screening)/i },
  { label: "Credentials / secret token", category: "Credentials / secrets", severity: "medium", score: 22, regex: /(api[_-]?key|secret|token|passwd|password|private[_ -]?key)/i },
];

const scoreBandByValue = (score) => {
  if (score >= 70) return { band: "High", className: "score-high" };
  if (score >= 35) return { band: "Medium", className: "score-medium" };
  return { band: "Low", className: "score-low" };
};

function setMeta(data) {
  companyValue.textContent = data.company || "-";
  folderValue.textContent = data.folder || "-";
  descriptionValue.textContent = data.description || "(empty)";
}

function formatSize(size = 0) {
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function getExtension(name = "") {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "(no extension)";
  return name.slice(idx + 1).toLowerCase();
}

function flattenNodes(nodes, sink = []) {
  nodes.forEach((node) => {
    sink.push(node);
    if (node.children?.length) flattenNodes(node.children, sink);
  });
  return sink;
}

function analyzeExport(data) {
  const nodes = flattenNodes(data.children || []);
  const files = nodes.filter((n) => !n.is_dir);
  const directories = nodes.filter((n) => n.is_dir);

  const extensions = {};
  let totalSize = 0;
  files.forEach((file) => {
    const ext = getExtension(file.name || "");
    const size = Number(file.size || 0);
    if (!extensions[ext]) extensions[ext] = { count: 0, bytes: 0 };
    extensions[ext].count += 1;
    extensions[ext].bytes += size;
    totalSize += size;
  });

  const piiSignals = [];
  nodes.forEach((node) => {
    const text = `${node.name || ""} ${node.path || ""}`;
    piiPatterns.forEach((pattern) => {
      if (pattern.regex.test(text)) {
        piiSignals.push({
          pattern: pattern.label,
          category: pattern.category,
          severity: pattern.severity,
          score: pattern.score,
          location: node.path || node.name || "(unknown)",
        });
      }
    });
  });

  const totalRawScore = piiSignals.reduce((sum, item) => sum + item.score, 0);
  const categoryBuckets = piiSignals.reduce((acc, item) => {
    const key = item.category || "Other";
    if (!acc[key]) acc[key] = { count: 0, weightedScore: 0 };
    acc[key].count += 1;
    acc[key].weightedScore += item.score;
    return acc;
  }, {});
  const categoryEntries = Object.entries(categoryBuckets)
    .sort((a, b) => b[1].weightedScore - a[1].weightedScore)
    .map(([category, value]) => ({ category, ...value }));
  const normalizedScore = Math.min(
    100,
    Math.round(totalRawScore / Math.max(1, files.length + directories.length) * 8 + categoryEntries.length * 4),
  );
  const scoreBand = scoreBandByValue(normalizedScore);

  const largestFiles = [...files]
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
    .slice(0, 10)
    .map((file) => ({ name: file.path || file.name || "(unknown)", size: Number(file.size || 0) }));

  return {
    filesCount: files.length,
    dirCount: directories.length,
    totalCount: nodes.length,
    totalSize,
    extensionEntries: Object.entries(extensions).sort((a, b) => b[1].bytes - a[1].bytes),
    piiSignals,
    piiScore: {
      totalRawScore,
      normalizedScore,
      scoreBand,
      categories: categoryEntries,
    },
    largestFiles,
  };
}

function renderStats(analysis) {
  statsGrid.innerHTML = "";
  const severityCounts = analysis.piiSignals.reduce(
    (acc, item) => {
      acc[item.severity] = (acc[item.severity] || 0) + 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 },
  );

  const stats = [
    ["Total nodes", analysis.totalCount],
    ["Directories", analysis.dirCount],
    ["Files", analysis.filesCount],
    ["Total file size", formatSize(analysis.totalSize)],
    ["PII high", severityCounts.high],
    ["PII medium", severityCounts.medium],
    ["PII low", severityCounts.low],
  ];

  stats.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<span class="label">${label}</span><span class="value">${value}</span>`;
    statsGrid.appendChild(card);
  });

  fileTypesList.innerHTML = "";
  if (!analysis.extensionEntries.length) {
    fileTypesList.innerHTML = '<li class="empty">No files found</li>';
  } else {
    analysis.extensionEntries.forEach(([ext, detail]) => {
      const li = document.createElement("li");
      li.textContent = `.${ext} — ${detail.count} files, ${formatSize(detail.bytes)}`;
      fileTypesList.appendChild(li);
    });
  }

  largestFilesList.innerHTML = "";
  if (!analysis.largestFiles.length) {
    largestFilesList.innerHTML = '<li class="empty">No files found</li>';
  } else {
    analysis.largestFiles.forEach((file) => {
      const li = document.createElement("li");
      li.textContent = `${file.name} — ${formatSize(file.size)}`;
      largestFilesList.appendChild(li);
    });
  }

  piiList.innerHTML = "";
  piiCategoryList.innerHTML = "";
  const score = analysis.piiScore;
  piiScoreCard.innerHTML = `
    <div class="pii-score-line">
      <span>PII Risk Score</span>
      <strong>${score.normalizedScore}/100</strong>
    </div>
    <div class="pii-score-line">
      <span>Classification</span>
      <span class="score-pill ${score.scoreBand.className}">${score.scoreBand.band}</span>
    </div>
    <div class="pii-score-line muted">
      <span>Raw signal score</span>
      <span>${score.totalRawScore}</span>
    </div>
  `;

  if (!score.categories.length) {
    piiCategoryList.innerHTML = '<li class="empty">No PII categories detected.</li>';
  } else {
    score.categories.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = `${item.category} — ${item.count} matches (weighted score ${item.weightedScore})`;
      piiCategoryList.appendChild(li);
    });
  }

  if (!analysis.piiSignals.length) {
    piiList.innerHTML = '<li class="empty">No obvious PII indicators in file names/paths</li>';
  } else {
    analysis.piiSignals.slice(0, 100).forEach((signal) => {
      const li = document.createElement("li");
      li.textContent = `[${signal.severity.toUpperCase()}] ${signal.pattern}: ${signal.location}`;
      piiList.appendChild(li);
    });
    if (analysis.piiSignals.length > 100) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = `...and ${analysis.piiSignals.length - 100} more`;
      piiList.appendChild(li);
    }
  }

  lastPiiSignals = analysis.piiSignals;
}

function nodeMatchesFilter(node, filter) {
  if (!filter) return true;
  const value = `${node.name || ""} ${node.path || ""}`.toLowerCase();
  return value.includes(filter.toLowerCase());
}

function hasMatchingDescendant(node, filter) {
  if (!node.children || !node.children.length) return false;
  return node.children.some((child) => nodeMatchesFilter(child, filter) || hasMatchingDescendant(child, filter));
}

function buildTree(nodes, filter = "") {
  const ul = document.createElement("ul");

  nodes.forEach((node) => {
    const includeNode = nodeMatchesFilter(node, filter) || hasMatchingDescendant(node, filter);
    if (!includeNode) return;

    const li = document.createElement("li");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const icon = node.is_dir ? "📁" : "📄";
    const sizeLabel = node.is_dir ? "" : ` · ${formatSize(node.size)}`;

    summary.innerHTML = `<span class="summary-label">${icon} ${node.name || "(unnamed)"}</span><span class="muted">${sizeLabel}</span>`;

    if (!node.children || node.children.length === 0) {
      details.append(summary);
    } else {
      details.open = Boolean(filter);
      details.append(summary, buildTree(node.children, filter));
    }

    li.appendChild(details);
    ul.appendChild(li);
  });

  if (!ul.children.length) return null;
  return ul;
}

function renderTree() {
  treeRoot.innerHTML = "";
  if (!currentExport || !currentExport.children) {
    treeRoot.innerHTML = '<p class="empty">No export loaded.</p>';
    return;
  }

  const filter = searchInput.value.trim();
  const tree = buildTree(currentExport.children, filter);
  if (!tree) {
    treeRoot.innerHTML = '<p class="empty">No matching files for this filter.</p>';
    return;
  }

  treeRoot.appendChild(tree);
}

function renderAll() {
  setMeta(currentExport || {});
  renderTree();
  renderStats(analyzeExport(currentExport || {}));
}

async function loadExportFile(filename) {
  if (!filename) return;
  const response = await fetch(`/api/export?file=${encodeURIComponent(filename)}`);
  if (!response.ok) throw new Error(`Unable to load file: ${filename}`);
  currentExport = await response.json();
  renderAll();
}

async function loadExportList(preferredName = "") {
  const response = await fetch("/api/exports");
  const data = await response.json();
  exportSelect.innerHTML = "";

  if (!data.exports || data.exports.length === 0) {
    const option = document.createElement("option");
    option.textContent = "No JSON files found in data/";
    option.value = "";
    exportSelect.appendChild(option);
    currentExport = null;
    renderAll();
    treeRoot.innerHTML = '<p class="empty">Put JSON files into data/ and click Reload files.</p>';
    return;
  }

  data.exports.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = `${item.name} (${formatSize(item.size)})`;
    if ((preferredName && item.name === preferredName) || (!preferredName && index === 0)) {
      option.selected = true;
    }
    exportSelect.appendChild(option);
  });

  await loadExportFile(exportSelect.value);
}

function saveBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportPiiJson() {
  const content = JSON.stringify(lastPiiSignals, null, 2);
  saveBlob("pii-signals.json", content, "application/json");
}

function exportPiiCsv() {
  const rows = [["severity", "category", "pattern", "score", "location"]];
  lastPiiSignals.forEach((item) => {
    rows.push([item.severity, item.category, item.pattern, item.score, item.location]);
  });

  const csv = rows
    .map((row) => row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  saveBlob("pii-signals.csv", csv, "text/csv");
}

async function sendImportPayload(file, overwrite = false) {
  const content = await file.text();
  const payload = { filename: file.name, content, overwrite };
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await response.json();
  return { response, result };
}

async function importSelectedJson() {
  const file = importInput.files?.[0];
  if (!file) {
    importStatus.textContent = "Please choose a .json file first.";
    return;
  }

  let { response, result } = await sendImportPayload(file, false);

  if (response.status === 409 && result.code === "file_exists") {
    const confirmed = window.confirm(`File '${result.name}' already exists. Overwrite it?`);
    if (!confirmed) {
      importStatus.textContent = "Import cancelled. Existing file kept.";
      return;
    }

    ({ response, result } = await sendImportPayload(file, true));
  }

  if (!response.ok) throw new Error(result.error || "Import failed");

  importStatus.textContent = result.overwritten
    ? `Imported ${result.name} (overwritten).`
    : `Imported ${result.name}.`;

  await loadExportList(result.name);
}

reloadBtn.addEventListener("click", () => {
  loadExportList(exportSelect.value).catch((error) => alert(error.message));
});

exportSelect.addEventListener("change", () => {
  loadExportFile(exportSelect.value).catch((error) => alert(error.message));
});

searchInput.addEventListener("input", renderTree);

importBtn.addEventListener("click", () => {
  importSelectedJson().catch((error) => {
    importStatus.textContent = error.message;
  });
});

exportPiiJsonBtn.addEventListener("click", exportPiiJson);
exportPiiCsvBtn.addEventListener("click", exportPiiCsv);

loadExportList().catch((error) => {
  treeRoot.innerHTML = `<p class="empty">${error.message}</p>`;
});
