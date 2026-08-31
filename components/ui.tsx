/**
 * The shared vocabulary. Reuse these; a one-off button is a bug.
 *
 * The world is a dispensing sleeve, so the primitives are the parts of one:
 * a Panel is label stock, a Badge is an adhesive auxiliary strip, a Button is
 * the printed action on the tab. Everything is square — a dispensing label has
 * no rounded corners — and every measure is a multiple of --cell.
 */

import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

import { ConsoleNav } from "@/components/ConsoleNav";
import { Logo } from "@/components/Logo";

/* Strip tones. Red is danger and is never used for anything else. */
export type Tone = "amber" | "danger" | "info" | "clear" | "plain";

const TONE: Record<Tone, { fill: string; ink: string; wash: string }> = {
  amber: { fill: "var(--amber)", ink: "var(--print)", wash: "var(--amber-wash)" },
  danger: { fill: "var(--danger)", ink: "#ffffff", wash: "var(--danger-wash)" },
  info: { fill: "var(--info)", ink: "#ffffff", wash: "var(--info-wash)" },
  clear: { fill: "var(--clear)", ink: "#ffffff", wash: "var(--clear-wash)" },
  plain: { fill: "var(--print)", ink: "var(--label)", wash: "var(--label-3)" },
};

/**
 * An adhesive auxiliary strip. Solid by default, because colour in this world
 * arrives as a printed band and not as a tint behind a card.
 */
export function Badge({
  tone = "plain",
  quiet = false,
  children,
  style,
}: {
  tone?: Tone;
  quiet?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const t = TONE[tone];
  return (
    <span
      className="caps"
      style={{
        display: "inline-block",
        padding: "3px 7px",
        background: quiet ? t.wash : t.fill,
        color: quiet ? "var(--print)" : t.ink,
        boxShadow: quiet ? `inset 0 0 0 1px ${t.fill}` : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Label stock. `title` prints a header band across the top of the sheet, the
 * way a dispensing label carries the pharmacy's name.
 */
export function Panel({
  title,
  aside,
  children,
  style,
  headingLevel = 2,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  /**
   * Panel titles are the page's real structure, so they are real headings.
   *
   * They used to render as a `<span class="caps">`, which meant every route was
   * one `h1` and nothing else — a screen reader got no outline of the page at
   * all. The visual treatment is unchanged; only the element is.
   */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className="sheet" style={{ ...style }}>
      {title !== undefined && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "calc(var(--cell) * 2)",
            padding: "calc(var(--cell) * 1.25) calc(var(--cell) * 2)",
            borderBottom: "1px solid var(--rule-ink)",
          }}
        >
          {/* `.caps` carries the type; only the heading's own margin is reset. */}
          <Heading className="caps" style={{ color: "var(--print)", margin: 0 }}>
            {title}
          </Heading>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * One patient's follow-up window on a fixed seven-cell axis.
 *
 * The point is the column, not the row: every patient's day 3 sits at the same
 * x, so a roster can be read down rather than one patient at a time. A single
 * missed attempt is amber — only the aggregate judgement (drift, a red flag)
 * earns red.
 */
const DAY_FILL: Record<string, CSSProperties> = {
  answered: { background: "var(--clear)" },
  flagged: { background: "var(--danger)" },
  missed: { background: "var(--amber)" },
  held: { background: "var(--amber-wash)", boxShadow: "inset 0 0 0 1px var(--amber)" },
  scheduled: { background: "var(--label-3)" },
  none: { background: "transparent", boxShadow: "inset 0 0 0 1px var(--rule)" },
};

const DAY_TITLE: Record<string, string> = {
  answered: "Answered",
  flagged: "Red flag",
  missed: "No answer",
  held: "Held",
  scheduled: "Scheduled",
  none: "Not scheduled yet",
};

export function WeekBand({ week }: { week: readonly string[] }) {
  return (
    <span
      role="img"
      aria-label={week.map((d, i) => `Day ${i + 1} ${DAY_TITLE[d]}`).join(", ")}
      style={{ display: "inline-flex", gap: 2 }}
    >
      {week.map((day, i) => (
        <span
          key={i}
          title={`Day ${i + 1} · ${DAY_TITLE[day]}`}
          style={{
            display: "block",
            width: "calc(var(--cell) * 1.75)",
            height: "calc(var(--cell) * 2.5)",
            ...DAY_FILL[day],
          }}
        />
      ))}
    </span>
  );
}

type ButtonProps = {
  variant?: "primary" | "ghost" | "onLabel";
  children: ReactNode;
  href?: string;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
};

/** The printed action. Primary is the amber tab; nothing else is amber-filled. */
export function Button({
  variant = "primary",
  children,
  href,
  type = "button",
  onClick,
  disabled,
  style,
}: ButtonProps) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "calc(var(--cell) * 1)",
    padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2.5)",
    border: "1px solid transparent",
    borderRadius: "var(--radius)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    textDecoration: "none",
    fontFamily: "var(--sans)",
    fontStretch: "88%",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.13em",
    textTransform: "uppercase",
    lineHeight: 1,
    transition: "background 140ms ease-out, color 140ms ease-out",
  };

  const variants: Record<string, CSSProperties> = {
    primary: { background: "var(--amber)", color: "var(--print)" },
    ghost: {
      background: "transparent",
      color: "var(--bench-ink)",
      /* The divider tone is invisible as a control edge on graphite. */
      borderColor: "var(--bench-line-strong)",
    },
    onLabel: {
      background: "transparent",
      color: "var(--print)",
      borderColor: "var(--rule-ink)",
    },
  };

  const merged = { ...base, ...variants[variant], ...style };

  if (href) {
    return (
      <Link href={href} style={merged}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={merged}>
      {children}
    </button>
  );
}

/**
 * The landing page's masthead.
 *
 * A dispensing sleeve prints the dispensing pharmacy's name across the top, so
 * the product's name rides the same band here. The console gets `TopBar`
 * instead — it carries state this surface has no business showing.
 */
export function Masthead() {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--bench-line)",
        position: "relative",
        zIndex: 10,
      }}
    >
      <div
        style={{
          maxWidth: "var(--maxw)",
          margin: "0 auto",
          padding: "calc(var(--cell) * 2) calc(var(--cell) * 3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "calc(var(--cell) * 2)",
        }}
      >
        <Link
          href="/"
          className="display"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "calc(var(--cell) * 1.25)",
            fontSize: 22,
            letterSpacing: "-0.02em",
            textDecoration: "none",
            color: "var(--bench-ink)",
          }}
        >
          {/* The link already says the name, so the mark is not read twice. */}
          <Logo size={26} title={null} />
          Care&nbsp;Loop
        </Link>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "calc(var(--cell) * 2)",
          }}
        >
          <span
            className="caps masthead-tag"
            style={{ color: "var(--bench-ink-3)", whiteSpace: "nowrap" }}
          >
            Clinical follow-up, run by an agent
          </span>
          <Link
            href="/patients"
            className="caps"
            style={{ color: "var(--bench-ink)", whiteSpace: "nowrap" }}
          >
            Console
          </Link>
        </span>
      </div>
    </header>
  );
}

/**
 * The console chrome. It states the two things the demo must never imply
 * otherwise: who is notionally signed in (nobody — there is no auth), and
 * whether this build can actually dial a telephone.
 */
export function TopBar({
  live,
  armed,
}: {
  live: boolean;
  armed: number;
}) {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--bench-line)",
        background: "var(--bench-2)",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <div
        className="topbar"
        style={{
          maxWidth: "var(--maxw)",
          margin: "0 auto",
          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 3)",
          display: "flex",
          alignItems: "center",
          gap: "calc(var(--cell) * 2) calc(var(--cell) * 4)",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          className="display"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "calc(var(--cell) * 1.25)",
            fontSize: 19,
            letterSpacing: "-0.02em",
            textDecoration: "none",
            color: "var(--bench-ink)",
          }}
        >
          <Logo size={22} title={null} />
          Care&nbsp;Loop
        </Link>

        <ConsoleNav />

        <div
          className="topbar-status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "calc(var(--cell) * 1.5)",
            flexWrap: "wrap",
          }}
        >
          {/* Never imply a login that does not exist. */}
          <span className="caps" style={{ color: "var(--bench-ink-3)", whiteSpace: "nowrap" }}>
            Dr Rao · demo, no auth
          </span>
          {live ? (
            <Badge tone="danger">
              Calls live · {armed} armed
            </Badge>
          ) : (
            <Badge tone="plain" quiet>
              Calls off · nothing can dial
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * A labelled control.
 *
 * The label is a field label, so it is tracked caps — that is what caps are for
 * in this system. `hint` explains the format *before* someone gets it wrong;
 * `error` replaces it afterwards and is wired to the input by `aria-describedby`
 * so a screen reader reads the reason, not just "invalid".
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: "calc(var(--cell) * 3)" }}>
      <label
        className="caps"
        htmlFor={htmlFor}
        style={{
          display: "block",
          color: "var(--print-3)",
          marginBottom: "calc(var(--cell) * 0.75)",
        }}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          style={{
            margin: "calc(var(--cell) * 0.75) 0 0",
            color: "var(--danger-deep)",
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={`${htmlFor}-hint`}
          style={{
            margin: "calc(var(--cell) * 0.75) 0 0",
            color: "var(--print-3)",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A ruled box on label stock. `mono` for anything compared by eye. */
/**
 * Which element describes this control.
 *
 * Explicit, because guessing was a real bug: the inputs used to derive
 * `${id}-hint` unconditionally while `Field` only renders that element when a
 * hint is actually passed — so every hint-less field shipped an
 * `aria-describedby` pointing at nothing, and a screen reader announced a
 * dangling reference instead of the label.
 */
export function describedBy(
  id: string,
  opts: { hint?: boolean; error?: boolean },
): string | undefined {
  if (opts.error) return `${id}-error`;
  if (opts.hint) return `${id}-hint`;
  return undefined;
}

export function TextInput({
  mono = false,
  invalid = false,
  ...props
}: ComponentProps<"input"> & { mono?: boolean; invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={mono ? "control mono" : "control"}
    />
  );
}

export function Textarea({
  invalid = false,
  ...props
}: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea {...props} aria-invalid={invalid || undefined} className="control" />
  );
}

export function Select({
  options,
  invalid = false,
  ...props
}: ComponentProps<"select"> & {
  options: { value: string; label: string }[];
  invalid?: boolean;
}) {
  return (
    <select {...props} aria-invalid={invalid || undefined} className="control">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
