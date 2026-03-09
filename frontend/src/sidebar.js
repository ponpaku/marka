import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { t } from "./i18n.js";

const RECENT_KEY = "sokki-recent-files";
const SIDEBAR_VISIBLE_KEY = "sokki-sidebar-visible";
const SIDEBAR_TAB_KEY = "sokki-sidebar-tab";
const WORKSPACE_KEY = "sokki-workspace-folder";
const WORKSPACE_COLLAPSED_KEY = "sokki-workspace-collapsed";
const RECENT_COLLAPSED_KEY = "sokki-recent-collapsed";
const RECENT_MAX = 20;

let tocDebounceTimer = null;
let deps = null;

// --- Public API ---

export function initSidebar(d) {
  deps = d;

  const visible = localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== "false";
  setSidebarVisible(visible);

  const savedTab = localStorage.getItem(SIDEBAR_TAB_KEY) || "files";
  switchTab(savedTab);

  renderFilesPanel();

  const btnToggle = document.getElementById("btn-sidebar-toggle");
  if (btnToggle) btnToggle.addEventListener("click", toggleSidebar);

  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const btnOpenWorkspace = document.getElementById("btn-open-workspace");
  if (btnOpenWorkspace) btnOpenWorkspace.addEventListener("click", handleOpenWorkspace);
}

export function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  setSidebarVisible(sidebar.classList.contains("hidden"));
}

export function updateTOC(markdownText) {
  clearTimeout(tocDebounceTimer);
  tocDebounceTimer = setTimeout(() => renderTOC(markdownText), 200);
}

export function addToRecentFiles(filePath) {
  if (!filePath) return;
  let recents = loadRecentFiles();
  recents = recents.filter((p) => p !== filePath);
  recents.unshift(filePath);
  if (recents.length > RECENT_MAX) recents = recents.slice(0, RECENT_MAX);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  // Only re-render the recent section, not the whole panel
  const recentBody = document.getElementById("recent-section-body");
  if (recentBody) renderRecentBody(recentBody);
}

export async function renderFileTree(folderPath) {
  const treeRoot = document.getElementById("workspace-tree-root");
  if (!treeRoot) return;
  await loadTreeInto(treeRoot, folderPath);
}

async function loadTreeInto(treeRoot, folderPath) {
  treeRoot.innerHTML = '<div class="sidebar-empty-msg">読み込み中...</div>';
  if (!folderPath) { treeRoot.innerHTML = ""; return; }
  try {
    const tree = await buildMdTree(folderPath);
    treeRoot.innerHTML = "";
    if (tree.length === 0) {
      treeRoot.innerHTML = '<div class="sidebar-empty-msg">.md ファイルなし</div>';
      return;
    }
    treeRoot.appendChild(renderTreeNodes(tree));
  } catch (err) {
    console.error("renderFileTree failed:", err);
    treeRoot.innerHTML = `<div class="sidebar-empty-msg">${String(err)}</div>`;
  }
}

// --- Internal: render whole Files panel ---

function renderFilesPanel() {
  const container = document.getElementById("sidebar-sections");
  if (!container) return;
  container.innerHTML = "";

  const workspacePath = localStorage.getItem(WORKSPACE_KEY);

  // --- Workspace section ---
  const workspaceCollapsed = localStorage.getItem(WORKSPACE_COLLAPSED_KEY) === "true";
  const wsSection = createSection({
    id: "workspace-section",
    title: workspacePath ? workspacePath.split(/[\\/]/).pop() : t("sidebar.openFolder"),
    collapsed: workspaceCollapsed,
    expandable: true,
    actions: workspacePath
      ? [{ label: "✕", title: "Close folder", onClick: handleCloseWorkspace }]
      : [],
    onToggle: (collapsed) => localStorage.setItem(WORKSPACE_COLLAPSED_KEY, String(collapsed)),
  });

  if (workspacePath) {
    const treeRoot = document.createElement("div");
    treeRoot.id = "workspace-tree-root";
    treeRoot.className = "file-tree-root";
    wsSection.body.appendChild(treeRoot);
    container.appendChild(wsSection.el);
    // Pass element reference directly — no getElementById needed
    loadTreeInto(treeRoot, workspacePath);
  } else {
    const hint = document.createElement("div");
    hint.className = "sidebar-empty-msg";
    hint.textContent = t("sidebar.noWorkspace");
    wsSection.body.appendChild(hint);
    container.appendChild(wsSection.el);
  }

  // --- Recent Files section ---
  const recentCollapsed = localStorage.getItem(RECENT_COLLAPSED_KEY) === "true";
  const recentSection = createSection({
    id: "recent-section",
    title: t("sidebar.recentFiles"),
    collapsed: recentCollapsed,
    expandable: true,
    onToggle: (collapsed) => localStorage.setItem(RECENT_COLLAPSED_KEY, String(collapsed)),
  });

  recentSection.body.id = "recent-section-body";
  renderRecentBody(recentSection.body);
  container.appendChild(recentSection.el);
}

/**
 * Create a VSCode-style collapsible section.
 * Returns { el, body } where el is the section root and body is the content container.
 */
function createSection({ id, title, collapsed, expandable, actions = [], onToggle }) {
  const section = document.createElement("div");
  section.className = "sidebar-section" + (expandable ? " expandable" : "") + (collapsed ? " collapsed" : "");
  if (id) section.id = id;

  // Header
  const header = document.createElement("div");
  header.className = "sidebar-section-header";

  const chevron = document.createElement("span");
  chevron.className = "sidebar-section-chevron";
  chevron.textContent = "▾";

  const titleEl = document.createElement("span");
  titleEl.className = "sidebar-section-title-text";
  titleEl.textContent = title;

  header.appendChild(chevron);
  header.appendChild(titleEl);

  // Action buttons (visible on hover)
  if (actions.length > 0) {
    const actionsEl = document.createElement("span");
    actionsEl.className = "sidebar-section-actions";
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.className = "sidebar-section-action-btn";
      btn.textContent = action.label;
      btn.title = action.title || "";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        action.onClick();
      });
      actionsEl.appendChild(btn);
    }
    header.appendChild(actionsEl);
  }

  // Body
  const body = document.createElement("div");
  body.className = "sidebar-section-body";

  // Toggle on header click
  header.addEventListener("click", () => {
    const isCollapsed = section.classList.toggle("collapsed");
    if (onToggle) onToggle(isCollapsed);
  });

  section.appendChild(header);
  section.appendChild(body);

  return { el: section, body };
}

function renderRecentBody(container) {
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
    if (deps && deps.getState && deps.getState().currentPath === filePath) {
      btn.classList.add("active");
    }

    const name = document.createElement("span");
    name.className = "recent-file-name";
    name.textContent = filePath.split(/[\\/]/).pop();

    const dir = document.createElement("span");
    dir.className = "recent-file-dir";
    const parts = filePath.split(/[\\/]/);
    dir.textContent = parts.length > 1 ? parts[parts.length - 2] : "";
    dir.title = filePath;

    btn.appendChild(name);
    btn.appendChild(dir);
    btn.title = filePath;
    btn.addEventListener("click", () => {
      if (deps && deps.openFile) deps.openFile(filePath);
    });
    container.appendChild(btn);
  }
}

// --- Internal: TOC ---

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
  if (deps && deps.getEditor) {
    const editor = deps.getEditor();
    const value = editor.value;
    const hashes = "#".repeat(level);
    const lines = value.split("\n");
    let charPos = 0;
    for (const line of lines) {
      const headingMatch = line.trimEnd().match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] === hashes && headingMatch[2].trim() === headingText) {
        editor.focus();
        editor.setSelectionRange(charPos, charPos + line.length);
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
        const lineIndex = value.substring(0, charPos).split("\n").length - 1;
        editor.scrollTop = lineIndex * lineHeight - editor.clientHeight / 3;
        break;
      }
      charPos += line.length + 1;
    }
  }

  const preview = document.getElementById("preview-pane");
  if (preview) {
    const headingId = headingText
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const el = preview.querySelector(`#${CSS.escape(headingId)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// --- Internal: file tree ---

async function buildMdTree(dirPath) {
  const entries = await readDir(dirPath);
  // Sort: folders first, then files, both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
  const result = [];
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".")) continue;
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

function renderTreeNodes(nodes, depth = 0) {
  const container = document.createElement("div");
  for (const node of nodes) {
    if (node.children !== null) {
      // Folder node
      const folder = document.createElement("div");
      folder.className = "file-tree-folder";

      const label = document.createElement("div");
      label.className = "file-tree-folder-label";
      label.style.paddingLeft = `${8 + depth * 12}px`;

      const icon = document.createElement("span");
      icon.className = "file-tree-folder-icon";
      icon.textContent = "▾";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = node.name;

      label.appendChild(icon);
      label.appendChild(nameSpan);
      folder.appendChild(label);

      const children = document.createElement("div");
      children.className = "file-tree-children";
      children.appendChild(renderTreeNodes(node.children, depth + 1));
      folder.appendChild(children);

      label.addEventListener("click", () => {
        const isCollapsed = folder.classList.toggle("collapsed");
        children.classList.toggle("collapsed", isCollapsed);
      });

      container.appendChild(folder);
    } else {
      // File node
      const btn = document.createElement("button");
      btn.className = "file-tree-item";
      btn.style.paddingLeft = `${8 + depth * 12}px`;
      btn.title = node.path;

      const fileIcon = document.createElement("span");
      fileIcon.className = "file-tree-file-icon";
      fileIcon.textContent = "○";

      const nameSpan = document.createElement("span");
      nameSpan.className = "file-tree-name";
      nameSpan.textContent = node.name;

      btn.appendChild(fileIcon);
      btn.appendChild(nameSpan);

      if (deps && deps.getState && deps.getState().currentPath === node.path) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        if (deps && deps.openFile) deps.openFile(node.path);
      });
      container.appendChild(btn);
    }
  }
  return container;
}

// --- Internal: misc ---

function setSidebarVisible(visible) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("hidden", !visible);
  localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(visible));
}

function switchTab(tab) {
  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".sidebar-panel").forEach((panel) => {
    panel.classList.add("hidden");
  });
  const activePanel = document.getElementById(tab === "files" ? "sidebar-files" : "sidebar-toc");
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

async function handleOpenWorkspace() {
  try {
    const folder = await dialogOpen({ directory: true, multiple: false });
    if (!folder) return;
    localStorage.setItem(WORKSPACE_KEY, folder);
    // Re-render panel from scratch (new folder name in section header)
    renderFilesPanel();
  } catch (err) {
    console.error("Open workspace failed:", err);
  }
}

function handleCloseWorkspace() {
  localStorage.removeItem(WORKSPACE_KEY);
  renderFilesPanel();
}
