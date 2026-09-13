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
 *
 * `quiet` is a washed chip carrying the tone as an index bar down its left
 * edge. It used to be boxed in a 1px outline of the tone, which made every
 * secondary badge read as a form control sitting in the page — the default
 * framework look this world is not. The bar puts the colour where it means
 * something and leaves the text as print, which holds 16.5:1 on every wash.
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
        padding: quiet ? "3px 7px 3px 10px" : "3px 7px",
        background: quiet ? t.wash : t.fill,
        color: quiet ? "var(--print)" : t.ink,
        /* An index bar, not a border. Inset so the chip's box never shifts. */
        boxShadow: quiet ? `inset 3px 0 0 ${t.fill}` : undefined,
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
  band,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  /**
   * A coloured band for the header, in the system's own vocabulary — colour
   * arrives as a full band with a printed word on it. `info` marks context
   * someone else supplied (the front desk's words).
   */
  band?: "info" | "danger";
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
            borderBottom: band ? "none" : "1px solid var(--rule-ink)",
            background: band ? `var(--${band})` : undefined,
          }}
        >
          {/* `.caps` carries the type; only the heading's own margin is reset. */}
          <Heading className="caps" style={{ color: band ? "#ffffff" : "var(--print)", margin: 0 }}>
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

export function WeekBand({
  week,
  animate,
}: {
  week: readonly string[];
  /**
   * Indices that just changed state, marked so the cell can announce itself.
   * Empty on a server render: a page load is not an event.
   */
  animate?: readonly number[];
}) {
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
            /* The cell is already in its final state; the strip is applied over
               the top of it, so a missed animation costs nothing. */
            ...(animate?.includes(i)
              ? { animation: "strip-in 420ms cubic-bezier(0.16,1,0.3,1) both" }
              : {}),
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
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
  /** For a control whose visible text needs its subject, e.g. "Write note" for whom. */
  ariaLabel?: string;
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
  className,
  ariaLabel,
}: ButtonProps) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "calc(var(--cell) * 1)",
    padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 2.5)",
    /* Longhands, not `border`: variants set `borderColor`, and React warns when
       a re-render swaps variants across a shorthand and its longhand. */
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
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
      <Link href={href} style={merged} className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={merged}
      className={className}
      aria-label={ariaLabel}
    >
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
 *
 * A printed letterhead: the name at the left, the door at the right.
 *
 * The wordmark is set in the slab — the apothecary's lettering, and the one
 * place this product uses it, so the brand speaks in a different voice from
 * the page beneath it. The console button is the band's counterweight and the
 * page's only door, which is why the amber lives up here now.
 *
 * An earlier version bridged the two with a `flex: 1` hairline "leader rule".
 * It spanned 597px — half the band — and a leader rule does not fill a void,
 * it *measures* one: it is the device a table of contents uses to join a label
 * to its value. Two elements with weight at either end need no bridge.
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
          padding: "calc(var(--cell) * 1.5) calc(var(--cell) * 3)",
          display: "flex",
          alignItems: "center",
          gap: "calc(var(--cell) * 2)",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "calc(var(--cell) * 1.5)",
            /* Comfortably past 44px with the padding — a real touch target. */
            padding: "calc(var(--cell) * 0.75) 0",
            fontFamily: "var(--brand)",
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: "-0.015em",
            lineHeight: 1,
            textDecoration: "none",
            color: "var(--bench-ink)",
          }}
        >
          {/* The link already says the name, so the mark is not read twice. */}
          <Logo size={36} title={null} />
          Care&nbsp;Loop
        </Link>

        {/* The page's only door, and its one amber-filled button. The wrapper
            carries the `auto` margin so it can be dropped once the band wraps:
            stacked, the button lands under the name rather than floating alone
            against the right edge.

            It lands on the overview, not the roster. `TickPoller` mounts only
            on `/dashboard`, so sending a first-time visitor to `/patients`
            meant the one thing that drives the scheduler in a browser never
            started — the console looked alive and nothing was moving. */}
        <span className="masthead-cta">
          <Button href="/dashboard" variant="primary">
            Open the console
          </Button>
        </span>
      </div>
    </header>
  );
}

/**
 * Where this page sits, as a trail of the places above it.
 *
 * It replaced a numbered five-step strip that printed the whole workflow on
 * every page. That was a set of instructions, not a location: a doctor on a
 * consult knows they are writing a note. What they need is the way back up,
 * and the patient's actual state — which the page carries as a badge.
 */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            {it.href ? (
              <Link href={it.href}>{it.label}</Link>
            ) : (
              <span aria-current="page">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A row of mutually exclusive views. Links when each view is its own URL, so
 * a filter survives a reload; buttons when the filtering is local.
 */
export function Segmented({
  label,
  options,
  current,
  onSelect,
  on = "bench",
}: {
  label: string;
  options: { key: string; label: string; count?: number; href?: string }[];
  current: string;
  onSelect?: (key: string) => void;
  /**
   * Which ground it sits on. On label stock the options are outlined, so they
   * read as controls rather than as a line of prose.
   */
  on?: "bench" | "label";
}) {
  return (
    <div role="group" aria-label={label} className={on === "label" ? "seg seg-label" : "seg"}>
      {options.map((o) => {
        const on = o.key === current;
        const inner = (
          <>
            {o.label}
            {o.count !== undefined ? <span className="mono seg-count">{o.count}</span> : null}
          </>
        );
        return o.href ? (
          <Link
            key={o.key}
            href={o.href}
            className="seg-opt"
            aria-current={on ? "page" : undefined}
          >
            {inner}
          </Link>
        ) : (
          <button
            key={o.key}
            type="button"
            className="seg-opt"
            aria-pressed={on}
            onClick={() => onSelect?.(o.key)}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** Initials on a square of stock. Square because nothing in this world is round. */
export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <span aria-hidden className="mono avatar">
      {initials}
    </span>
  );
}

/**
 * The confirmation after something was done. A strip with a printed word on
 * it, then the sentence — colour arrives as a band here, never a tint alone.
 */
export function Notice({
  tone = "clear",
  label,
  children,
}: {
  tone?: Tone;
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className="notice" style={{ background: TONE[tone].wash }}>
      <Badge tone={tone}>{label}</Badge>
      <span>{children}</span>
    </div>
  );
}

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
      {/* Sentence-case: tracked caps are kept for badges, buttons and panel
          heads, and a form made entirely of them had no hierarchy left. */}
      <label
        htmlFor={htmlFor}
        style={{
          display: "block",
          color: "var(--print-2)",
          fontSize: 14,
          fontWeight: 600,
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
            /* Hints ran to 100 characters a line at desktop width. */
            maxWidth: "75ch",
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
