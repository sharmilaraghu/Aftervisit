import type { Metadata } from "next";
import { Archivo, Martian_Mono, Zilla_Slab } from "next/font/google";
import "./globals.css";

/*
 * Archivo carries the sleeve's printed voice — a grotesque with a signage
 * character, and a width axis so the auxiliary strips can be set genuinely
 * condensed rather than squashed. Martian Mono is the thermal printer: every
 * count, date, id and phone number on this product is set in it.
 */
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

/*
 * The wordmark, and only the wordmark. A slab serif is the apothecary's
 * lettering — the face a dispensing label prints the pharmacy's own name in —
 * so the brand speaks in a different voice from the content it sits above.
 * Archivo is the page; this is who is publishing it.
 */
const zilla = Zilla_Slab({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-zilla",
  display: "swap",
});

const martian = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-martian",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Care Loop",
  description:
    "A clinical follow-up agent that owns the loop from a doctor's note to resolution.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${martian.variable} ${zilla.variable}`}
    >
      <body>
        {/*
          THESIS: A follow-up plan is a dispensing label — one instruction, issued
          once, governing seven dated days. Refuses the AI-SaaS hero: no floating
          dashboard screenshot, no feature-card triptych.
          OWN-WORLD: The dispensing bench. Graphite ground, brilliant white label
          stock, adhesive auxiliary strips — amber carries, red is danger and
          nothing else, blue informs, green clears. Rigid cell grid, hairline
          rules, perforations, barcode blocks. Archivo condensed caps; Martian
          Mono for every count, date and id. No cards, ever.
          STORY: A clinician sees their own note become a dated, countable plan
          in one viewport, believes they stay the author of it, and goes looking
          for the console.
          FIRST VIEWPORT: Full-bleed graphite bench. The doctor's note as raw
          text on a white sheet, left, at reading scale. A perforated pull-tab
          down its right edge carries the primary action; pulling it restructures
          the note in place into dated rows with the locked rules as strips.
          FORM: Dispensing Label; candidate 7 of my 7; seed 519021cb.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
