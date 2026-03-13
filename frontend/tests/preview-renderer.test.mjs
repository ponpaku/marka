import test from "node:test";
import assert from "node:assert/strict";
import { renderPreviewWithMap } from "../src/preview-renderer.js";

test("renderPreviewWithMap decorates headings, list items, and table rows", () => {
  const markdown = [
    "# Heading",
    "",
    "- [ ] task one",
    "- item two",
    "",
    "| A | B |",
    "| --- | --- |",
    "| c | d |",
    "| e | f |",
    "",
  ].join("\n");

  const { html, segments } = renderPreviewWithMap(markdown, null);

  assert.match(html, /<h1[^>]*data-sync-id=/);
  assert.match(html, /<li[^>]*data-sync-kind="list_item"/);
  assert.match(html, /<tr[^>]*data-sync-kind="table_row"/);
  assert.match(html, /<input type="checkbox" data-index="0">/);

  const kinds = segments.map((segment) => segment.kind);
  assert.ok(kinds.includes("heading"));
  assert.equal(kinds.filter((kind) => kind === "list_item").length, 2);
  assert.equal(kinds.filter((kind) => kind === "table_row").length, 3);
});

test("renderPreviewWithMap preserves source ordering in segments", () => {
  const markdown = "## H2\n\nParagraph\n\n---\n";
  const { segments } = renderPreviewWithMap(markdown, null);

  assert.deepEqual(
    segments.map(({ kind }) => kind),
    ["heading", "paragraph", "hr"],
  );
  assert.equal(segments[0].from, 0);
  assert.ok(segments[0].to <= segments[1].from);
  assert.ok(segments[1].to <= segments[2].from);
});
