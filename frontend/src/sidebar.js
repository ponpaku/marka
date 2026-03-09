import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { t } from "./i18n.js";

const RECENT_KEY = "sokki-recent-files";
const SIDEBAR_VISIBLE_KEY = "sokki-sidebar-visible";
const SIDEBAR_TAB_KEY = "sokki-sidebar-tab";
const WORKSPACE_KEY = "sokki-workspace-folder";
const RECENT_MAX = 20;

// Debounce timer for TOC updates
let tocDebounceTimer = null;

// Dependency references set by initSidebar
let deps = null;

// --- Public API ---

export function initSidebar(d) {
  deps = d;

  // Restore sidebar visibility
  const visible = localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== "false";
  setSidebarVisible(visible);

  // Restore active tab
  const savedTab = localStorage.getItem(SIDEBAR_TAB_KEY) || "files";
  switchTab(savedTab);

  // Restore workspace
  const savedWorkspace = localStorage.getItem(WORKSPACE_KEY);
  if (savedWorkspace) {
    setWorkspaceName(savedWorkspace);
    renderFileTree(savedWorkspace);
  }

  // Render recent files
  renderRecentFiles();

  // Wire up sidebar toggle button
  const btnToggle = document.getElementById("btn-sidebar-toggle");
  if (btnToggle) {
    btnToggle.addEventListener("click", toggleSidebar);
  }

  // Wire up tab buttons
  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Wire up Open Folder
  const btnOpenWorkspace = document.getElementById("btn-open-workspace");
  if (btnOpenWorkspace) {
    btnOpenWorkspace.addEventListener("click", handleOpenWorkspace);
  }

  // Wire up Close Workspace
  const btnCloseWorkspace = document.getElementById("btn-close-workspace");
  if (btnCloseWorkspace) {
    btnCloseWorkspace.addEventListener("click", handleCloseWorkspace);
  }
}

export function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const isHidden = sidebar.classList.contains("hidden");
  setSidebarVisible(isHidden);
}

export function updateTOC(markdownText) {
  clearTimeout(tocDebounceTimer);
  tocDebounceTimer = setTimeout(() => {
    renderTOC(markdownText);
  }, 200);
}

export function addToRecentFiles(filePath) {
  if (!filePath) return;
  let recents = loadRecentFiles();
  // Remove duplicates
  recents = recents.filter((p) => p !== filePath);
  // Prepend
  recents.unshift(filePath);
  // Limit
  if (recents.length > RECENT_MAX) recents = recents.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  renderRecentFiles();
}

export async function renderFileTree(folderPath) {
  const container = document.getElementById("file-tree");
  if (!container) return;
  container.innerHTML = "";
  if (!folderPath) return;

  try {
    const tree = await buildMdTree(folderPath);
    if (tree.length === 0) {
      return;
    }
    container.appendChild(renderTreeNodes(tree));
  } catch (err) {
    console.error("renderFileTree failed:", err);
    container.innerHTML = `<div class="sidebar-empty-msg">${err}</div>`;
  }
}

// --- Internal helpers ---

function setSidebarVisible(visible) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (visible) {
    sidebar.classList.remove("hidden");
  } else {
    sidebar.classList.add("hidden");
  }
  localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(visible));
}

function switchTab(tab) {
  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".sidebar-panel").forEach((panel) => {
    panel.classList.add("hidden");
  });
  const activePanel = document.getElementById(
    tab === "files" ? "sidebar-files" : "sidebar-toc"
  );
  if (activePanel) activePanel.classList.remove("hidden");
  localStorage.setItem(SIDEBAR_TAB_KEY, tab);
}

function loadRecentFiles() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function renderRecentFiles() {
  const container = document.getElementById("recent-files-list");
  if (!container) return;
  container.innerHTML = "";

  const recents = loadRecentFiles();
  if (recents.length === 0) {
    const msg = document.createElement("div");
    msg.className = "sidebar-empty-msg";
    msg.textContent = t("sidebar.noRecent");
    container.appendChild(msg);
    return;
  }

  for (const filePath of recents) {
    const btn = document.createElement("button");
    btn.className = "recent-file-item";
    const filename = filePath.split(/[\\/]/).pop();
    btn.textContent = filename;
    btn.title = filePath;
    // Highlight active file
    if (deps && deps.getState && deps.getState().currentPath === filePath) {
      btn.classList.add("active");
    }
    btn.addEventListener("click", () => {
      if (deps && deps.openFile) deps.openFile(filePath);
    });
    container.appendChild(btn);
  }
}

function renderTOC(markdownText) {
  const container = document.getElementById("toc-list");
  if (!container) return;
  container.innerHTML = "";

  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(markdownText)) !== null) {
    headings.push({ level: match[1].length, text: match[2].trim() });
  }

  if (headings.length === 0) {
    const msg = document.createElement("div");
    msg.className = "sidebar-empty-msg";
    msg.textContent = t("toc.empty");
    container.appendChild(msg);
    return;
  }

  for (const heading of headings) {
    const btn = document.createElement("button");
    btn.className = `toc-item toc-h${heading.level}`;
    btn.textContent = heading.text;
    btn.title = heading.text;
    btn.addEventListener("click", () => scrollToHeading(heading.text, heading.level));
    container.appendChild(btn);
  }
}

function scrollToHeading(headingText, level) {
  // Scroll editor to the heading line
  if (deps && deps.getEditor) {
    const editor = deps.getEditor();
    const value = editor.value;
    const hashes = "#".repeat(level);
    // Find the line that matches
    const lines = value.split("\n");
    let charPos = 0;
    for (const line of lines) {
      const trimmed = line.trimEnd();
      // Match heading with exact level (not more)
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] === hashes && headingMatch[2].trim() === headingText) {
        editor.focus();
        editor.setSelectionRange(charPos, charPos + line.length);
        // Scroll into view by dispatching a scroll on the textarea
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
        const lineIndex = value.substring(0, charPos).split("\n").length - 1;
        editor.scrollTop = lineIndex * lineHeight - editor.clientHeight / 3;
        break;
      }
      charPos += line.length + 1; // +1 for \n
    }
  }

  // Scroll preview to the heading
  const preview = document.getElementById("preview-pane");
  if (preview) {
    // marked.js generates IDs like: heading-text → lowercase, spaces → hyphens
    const headingId = headingText
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const el = preview.querySelector(`#${CSS.escape(headingId)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

// Build a tree from readDir entries, keeping only .md/.markdown files.
// Recursively calls readDir for subdirectories.
async function buildMdTree(dirPath) {
  const entries = await readDir(dirPath);
  const result = [];
  for (const entry of entries) {
    if (!entry.name) continue;
    const entryPath = await join(dirPath, entry.name);
    if (entry.isDirectory) {
      const children = await buildMdTree(entryPath);
      if (children.length > 0) {
        result.push({ name: entry.name, path: entryPath, children });
      }
    } else if (entry.isFile && /\.(md|markdown)$/i.test(entry.name)) {
      result.push({ name: entry.name, path: entryPath, children: null });
    }
  }
  return result;
}

function renderTreeNodes(nodes) {
  const ul = document.createElement("div");
  for (const node of nodes) {
    if (node.children !== null) {
      // Folder
      const folder = document.createElement("div");
      folder.className = "file-tree-folder";

      const label = document.createElement("div");
      label.className = "file-tree-folder-label";
      const icon = document.createElement("span");
      icon.className = "folder-icon";
      icon.textContent = "▾";
      label.appendChild(icon);
      const nameSpan = document.createElement("span");
      nameSpan.textContent = node.name;
      label.appendChild(nameSpan);
      folder.appendChild(label);

      const children = document.createElement("div");
      children.className = "file-tree-children";
      children.appendChild(renderTreeNodes(node.children));
      folder.appendChild(children);

      label.addEventListener("click", () => {
        const collapsed = children.classList.toggle("collapsed");
        icon.textContent = collapsed ? "▸" : "▾";
      });

      ul.appendChild(folder);
    } else {
      // File
      const btn = document.createElement("button");
      btn.className = "file-tree-item";
      btn.textContent = node.name;
      btn.title = node.path;
      if (deps && deps.getState && deps.getState().currentPath === node.path) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        if (deps && deps.openFile) deps.openFile(node.path);
      });
      ul.appendChild(btn);
    }
  }
  return ul;
}

async function handleOpenWorkspace() {
  try {
    const folder = await dialogOpen({ directory: true, multiple: false });
    if (!folder) return;
    localStorage.setItem(WORKSPACE_KEY, folder);
    setWorkspaceName(folder);
    await renderFileTree(folder);
  } catch (err) {
    console.error("Open workspace failed:", err);
  }
}

function handleCloseWorkspace() {
  localStorage.removeItem(WORKSPACE_KEY);
  setWorkspaceName(null);
  const container = document.getElementById("file-tree");
  if (container) container.innerHTML = "";
}

function setWorkspaceName(folderPath) {
  const nameEl = document.getElementById("workspace-name");
  const closeBtn = document.getElementById("btn-close-workspace");
  if (!nameEl) return;
  if (folderPath) {
    nameEl.textContent = folderPath.split(/[\\/]/).pop();
    if (closeBtn) closeBtn.hidden = false;
  } else {
    nameEl.textContent = "";
    if (closeBtn) closeBtn.hidden = true;
  }
}
