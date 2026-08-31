"use client";

/**
 * Narrow a list down.
 *
 * Client-side on purpose. A practice list is hundreds of rows, not millions, so
 * filtering in the browser keeps it instant and keeps the URL out of it — a
 * clinician scanning for a name should not be pushing history entries.
 *
 * The caller passes the same items it rendered, so **what matches is computed
 * purely** and the count is derived rather than stored. The effect does one
 * thing: toggle `hidden` on rows the predicate already decided about. Deriving
 * the count from the DOM instead would mean setting state inside an effect,
 * which cascades renders on every keystroke.
 *
 * Rows are hidden with `hidden`, not `display: none`, so they leave the
 * accessibility tree too — a screen reader is never read rows a sighted user
 * cannot see. Hiding rather than re-rendering also keeps the shared x-axis of
 * the week band and parameter matrix aligned while you type.
 */

import { useEffect, useMemo, useState } from "react";

import { Button, TextInput } from "@/components/ui";

export interface FilterItem {
  /** Matches `data-row-id` on the rendered row. */
  id: string;
  /** Everything this row can be searched by. */
  text: string;
  urgent?: boolean;
}

export function ListFilter({
  targetId,
  items,
  placeholder,
  urgentLabel,
}: {
  /** The container whose `[data-row-id]` children get shown or hidden. */
  targetId: string;
  items: FilterItem[];
  placeholder: string;
  /** Omitted when the list has no urgency to filter by. */
  urgentLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return new Set(
      items
        .filter(
          (item) =>
            (!needle || item.text.toLowerCase().includes(needle)) &&
            (!urgentOnly || item.urgent === true),
        )
        .map((item) => item.id),
    );
  }, [items, query, urgentOnly]);

  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id]"));
    for (const row of rows) row.hidden = !visible.has(row.dataset.rowId ?? "");

    return () => {
      for (const row of rows) row.hidden = false;
    };
  }, [visible, targetId]);

  const filtered = visible.size !== items.length;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "calc(var(--cell) * 1.5)",
        alignItems: "center",
      }}
    >
      <TextInput
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 260 }}
      />

      {urgentLabel ? (
        <Button variant="ghost" onClick={() => setUrgentOnly((v) => !v)}>
          {urgentOnly ? `Showing ${urgentLabel}` : `Only ${urgentLabel}`}
        </Button>
      ) : null}

      {filtered ? (
        <span role="status" className="caps" style={{ color: "var(--bench-ink-3)" }}>
          {visible.size} of {items.length}
          {visible.size === 0 ? " — nothing matches" : ""}
        </span>
      ) : null}
    </div>
  );
}
