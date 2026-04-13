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
const exportPiiJsonBtn = document.getElementById("exportPiiJsonBtn");
const exportPiiCsvBtn = document.getElementById("exportPiiCsvBtn");

let currentExport = null;
let lastPiiSignals = [];

const piiPatterns = [
  { label: "Email-like path", severity: "high", regex: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/ },
  { label: "Phone-like path", severity: "medium", regex: /(\+?\d[\d\-\s().]{7,}\d)/ },
  { label: "SSN-like path", severity: "high", regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { label: "Credit-card-like path", severity: "high", regex: /\b(?:\d[ -]*?){13,16}\b/ },
  { label: "API key token", severity: "medium", regex: /(api[_-]?key|secret|token|passwd|password)/i },
  { label: "Personal identifier keyword", severity: "low", regex: /(dob|birth|passport|driver|license|tax_id|national_id)/i },
];

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
          severity: pattern.severity,
          location: node.path || node.name || "(unknown)",
        });
      }
    });
  });

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
  const rows = [["severity", "pattern", "location"]];
  lastPiiSignals.forEach((item) => {
    rows.push([item.severity, item.pattern, item.location]);
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
