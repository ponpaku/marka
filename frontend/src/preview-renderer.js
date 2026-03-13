import { marked } from "marked";
import { resolvePreviewImages } from "./image-resolver.js";

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function injectAttrs(html, segment) {
  if (!segment) return html;
  const attrs =
    ` data-sync-id="${segment.id}"` +
    ` data-src-from="${segment.from}"` +
    ` data-src-to="${segment.to}"` +
    ` data-sync-kind="${segment.kind}"`;
  return html.replace(/^<([a-zA-Z0-9-]+)/, `<$1${attrs}`);
}

function createSegmentStore() {
  let nextId = 0;
  const segments = [];
  return {
    segments,
    create(kind, from, to) {
      const segment = {
        id: `seg-${nextId++}`,
        from,
        to: Math.max(from + 1, to),
        kind,
      };
      segments.push(segment);
      return segment;
    },
  };
}

function annotateTokens(tokens, segmentStore, baseOffset = 0) {
  let cursor = baseOffset;
  for (const token of tokens) {
    const from = cursor;
    const raw = token.raw || "";
    const to = from + raw.length;
    token.__syncRange = { from, to };

    switch (token.type) {
      case "heading":
        token.__syncSegment = segmentStore.create("heading", from, to);
        break;
      case "paragraph":
        token.__syncSegment = segmentStore.create("paragraph", from, to);
        break;
      case "code":
        token.__syncSegment = segmentStore.create("code", from, to);
        break;
      case "blockquote":
        token.__syncSegment = segmentStore.create("blockquote", from, to);
        break;
      case "html":
        if (token.block !== false) {
          token.__syncSegment = segmentStore.create("html_block", from, to);
        }
        break;
      case "hr":
        token.__syncSegment = segmentStore.create("hr", from, to);
        break;
      case "list":
        annotateListItems(token, segmentStore, from);
        break;
      case "table":
        annotateTableRows(token, segmentStore, from);
        break;
      default:
        break;
    }

    cursor = to;
  }
}

function annotateListItems(token, segmentStore, listFrom) {
  let localCursor = 0;
  token.__syncItems = [];
  for (const item of token.items || []) {
    const raw = item.raw || "";
    let localIndex = token.raw.indexOf(raw, localCursor);
    if (localIndex < 0) localIndex = localCursor;
    const from = listFrom + localIndex;
    const to = from + raw.length;
    localCursor = localIndex + raw.length;
    const segment = segmentStore.create("list_item", from, to);
    item.__syncSegment = segment;
    token.__syncItems.push(segment);
  }
}

function annotateTableRows(token, segmentStore, tableFrom) {
  const lines = token.raw.match(/[^\n]*\n?|[^\n]+$/g) || [];
  let cursor = tableFrom;
  token.__syncRows = [];

  if (lines.length > 0) {
    const headerLine = lines[0];
    token.__syncRows.push(segmentStore.create("table_row", cursor, cursor + headerLine.length));
    cursor += headerLine.length;
  }

  if (lines.length > 1) {
    cursor += lines[1].length;
  }

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    token.__syncRows.push(segmentStore.create("table_row", cursor, cursor + line.length));
    cursor += line.length;
  }
}

class SyncRenderer extends marked.Renderer {
  constructor(segmentStore) {
    super();
    this.segmentStore = segmentStore;
    this.checkboxIndex = 0;
  }

  heading(token) {
    return injectAttrs(super.heading(token), token.__syncSegment);
  }

  paragraph(token) {
    return injectAttrs(super.paragraph(token), token.__syncSegment);
  }

  code(token) {
    return injectAttrs(super.code(token), token.__syncSegment);
  }

  blockquote(token) {
    return injectAttrs(super.blockquote(token), token.__syncSegment);
  }

  html(token) {
    if (!token.__syncSegment) return super.html(token);
    return injectAttrs(`<div>${token.text}</div>`, token.__syncSegment);
  }

  hr(token) {
    return injectAttrs(super.hr(token), token.__syncSegment);
  }

  listitem(item) {
    return injectAttrs(super.listitem(item), item.__syncSegment);
  }

  checkbox({ checked }) {
    const idx = this.checkboxIndex++;
    return `<input type="checkbox" data-index="${idx}"${checked ? " checked" : ""}> `;
  }

  table(token) {
    const headerSegment = token.__syncRows?.[0];
    const bodySegments = token.__syncRows?.slice(1) || [];

    let header = "";
    for (let i = 0; i < token.header.length; i++) {
      header += this.tablecell(token.header[i]);
    }
    let body = "";
    for (let rowIndex = 0; rowIndex < token.rows.length; rowIndex++) {
      let rowText = "";
      for (let i = 0; i < token.rows[rowIndex].length; i++) {
        rowText += this.tablecell(token.rows[rowIndex][i]);
      }
      body += injectAttrs(`<tr>${rowText}</tr>\n`, bodySegments[rowIndex]);
    }

    const headerHtml = injectAttrs(`<tr>${header}</tr>\n`, headerSegment);
    return (
      "<table>\n<thead>\n" +
      headerHtml +
      "</thead>\n<tbody>\n" +
      body +
      "</tbody>\n</table>\n"
    );
  }

  tablecell(token) {
    const tag = token.header ? "th" : "td";
    const attrs = token.align ? ` align="${escapeAttr(token.align)}"` : "";
    return `<${tag}${attrs}>${this.parser.parseInline(token.tokens)}</${tag}>\n`;
  }
}

export function renderPreviewWithMap(markdown, currentPath) {
  const source = typeof markdown === "string" ? markdown : "";
  const tokens = marked.lexer(source, {
    gfm: true,
    breaks: false,
  });
  const segmentStore = createSegmentStore();
  annotateTokens(tokens, segmentStore);
  const renderer = new SyncRenderer(segmentStore);
  const html = resolvePreviewImages(
    marked.parser(tokens, {
      gfm: true,
      breaks: false,
      renderer,
    }),
    currentPath,
  );

  return {
    html,
    segments: segmentStore.segments.sort((a, b) => a.from - b.from || a.to - b.to),
  };
}
