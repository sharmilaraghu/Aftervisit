/**
 * What the patient said, day by day.
 *
 * The console could already say whether we reached someone and what the model
 * made of the last call. It could not say whether the dizziness was getting
 * worse — which is the question a course of follow-up exists to ask, and the one
 * a single call structurally cannot answer.
 *
 * Every cell is one typed answer. The signals beside a row are arithmetic and
 * nothing more: "2 → 7" is checkable against the cells next to it, whereas
 * "worsening" would be a verdict, and this product does not make those. That is
 * the same line `lib/rules/engine.ts` holds.
 */

import { allSignals, cellLabel, cellTitle, cellTone, signalsFor } from "@/lib/patients/parameters";
import type { ParameterRow } from "@/lib/patients/parameters";

/**
 * A prompt is a spoken sentence; a row header is not.
 *
 * Cut on a word boundary. Slicing at a fixed character produced "as prescribed
 * s…", which reads as a rendering bug rather than an abbreviation. The full
 * wording is the question the doctor approved and lives on the plan.
 */
function shortPrompt(prompt: string): string {
  const stripped = prompt.replace(/^(and\s+)?/i, "").replace(/\?+$/, "").trim();
  if (stripped.length <= 52) return stripped;

  const cut = stripped.slice(0, 52);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 24 ? cut.slice(0, lastSpace) : cut).replace(/[,;—-]$/, "").trimEnd()}…`;
}

export function ParameterGrid({ rows }: { rows: ParameterRow[] }) {
  if (rows.length === 0) return null;

  const days = rows[0].readings.map((r) => r.occurrence);

  /*
   * The column earns its place or it does not appear. A compiled question
   * carries no escalating values — only the universal set declares those — so
   * on most plans nothing flips, and a column of em-dashes down every row reads
   * as a feature that is broken rather than one with nothing to say.
   */
  const anySignal = allSignals(rows).length > 0;

  /*
   * The key. Cells are one or two letters, and "MI" is not a word anyone can
   * read cold — it was a working-memory tax at exactly the moment of reading a
   * trend. Built from the labels actually on screen, as label–word pairs, so it
   * never lists a letter that is not there and a letter two rows use for two
   * different answers is listed twice rather than explained wrongly.
   */
  const key = new Set<string>();
  for (const row of rows) {
    for (const reading of row.readings) {
      const label = cellLabel(row, reading);
      /* A cell already printed in full ("Yes") needs no entry. */
      const word = cellTitle(row, reading).split(": ").slice(1).join(": ");
      if (label.toLowerCase() === word.toLowerCase()) continue;
      if (!label || /^\d+$/.test(label)) continue;
      key.add(`${label} ${cellTitle(row, reading).replace(/^Day \d+: /, "")}`);
    }
  }

  return (
    <>
    <div className="table-scroll">
      <table className="param-grid">
        <thead>
          <tr>
            <th scope="col" className="caps param-head">
              What they said
            </th>
            {days.map((day) => (
              <th key={day} scope="col" className="mono param-day">
                {day}
              </th>
            ))}
            {/* Always present: it is also the column that takes the table's
                slack, so dropping it lets the prompt stretch and pushes the day
                columns to the far edge of the sheet. Empty is invisible. */}
            <th scope="col" className="caps param-head">
              {anySignal ? "Across the week" : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const signals = signalsFor(row);
            return (
              <tr key={row.questionId}>
                <th scope="row" className="param-prompt">
                  {shortPrompt(row.prompt)}
                </th>

                {row.readings.map((reading) => (
                  <td
                    key={reading.occurrence}
                    className="mono param-cell"
                    data-tone={cellTone(row, reading)}
                    /* The full value on hover and to a screen reader — the cell
                       itself is one character, which is legible and not enough. */
                    title={cellTitle(row, reading)}
                  >
                    <span className="sr-only">{cellTitle(row, reading)}</span>
                    <span aria-hidden>{cellLabel(row, reading)}</span>
                  </td>
                ))}

                <td className="param-signal">
                  {signals.map((s) => (
                    <span key={s.kind} className="mono" data-kind={s.kind}>
                      {s.detail}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {key.size > 0 ? (
      <p
        className="mono"
        style={{
          margin: 0,
          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2)",
          borderTop: "1px solid var(--rule-2)",
          color: "var(--print-3)",
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        {[...key].join("  ·  ")}
      </p>
    ) : null}
    </>
  );
}
