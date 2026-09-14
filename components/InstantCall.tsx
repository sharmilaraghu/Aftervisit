"use client";

/**
 * A judge's name, number, language and optional note — and one phone rings.
 *
 * Modelled on OpenLine's Try a call. The confirm names the person, the masked
 * number and the language before anything dials, and the server checks every
 * field again. While the call is live the page asks the server where it has got
 * to; the server re-fetches from CALL-E and trusts nothing the page holds but the
 * call's id. The result lives only in this component's state: leave the page and
 * it is gone, which is the promise the page makes.
 */

import { useEffect, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";

import { Badge, Button, Field, Panel, Select, TextInput, Textarea } from "@/components/ui";
import { checkInstantCall, startInstantCall, type InstantCheck } from "@/app/(console)/try/actions";
import type { TopicSpec } from "@/lib/plan/result-schema";

type Finished = Extract<InstantCheck, { done: true }>;

type Stage =
  | { kind: "form" }
  | { kind: "confirm" }
  | { kind: "dialing"; callId: string; masked: string; name: string; language: string; goal: string; status: string | null; gaveUp: boolean }
  | { kind: "done"; masked: string; name: string; goal: string; check: Finished };

/** A follow-up call runs a few minutes; past this the page stops asking, and says so. */
const GIVE_UP_AFTER_MS = 12 * 60_000;

/* Red for the act that reaches a real phone — the one red this page spends before a result. */
const DIAL_STYLE = { background: "var(--danger)", color: "#ffffff", borderColor: "var(--danger)" };

const PAD = "calc(var(--cell) * 3)";

function isAssistant(speaker: string): boolean {
  return ["agent", "assistant", "bot", "ai"].includes(speaker.toLowerCase());
}

export function InstantCall({
  languages,
  practiceName,
}: {
  languages: { value: string; label: string }[];
  practiceName: string;
}) {
  const [passcode, setPasscode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState(languages[0]?.value ?? "en-IN");
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  // Hidden by default: this page gets screen-shared and recorded, and a number on camera cannot be taken back.
  const [showNumber, setShowNumber] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The same name, number, language and note keep the same key, so a retry after a lost response is the same CALL-E call.
  const requestId = useRef("");
  const keyFor = useRef("");
  // What the watcher needs, captured when the call starts rather than read from render.
  const watch = useRef<{ callId: string; passcode: string; topics: TopicSpec[]; startedAt: number } | null>(null);

  const firstName = name.trim().split(/\s+/)[0] ?? "";
  const last4 = phone.replace(/\D/g, "").slice(-4);
  const languageName = languages.find((l) => l.value === language)?.label ?? language;
  const dialingId = stage.kind === "dialing" && !stage.gaveUp ? stage.callId : null;

  useEffect(() => {
    const w = watch.current;
    if (!dialingId || !w || w.callId !== dialingId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let check: InstantCheck;
      try {
        check = await checkInstantCall(w.passcode, w.callId, w.topics);
      } catch {
        check = { ok: true, done: false, status: "unreachable" };
      }
      if (cancelled) return;

      if (check.ok && check.done) {
        const finished = check;
        setStage((s) => (s.kind === "dialing" ? { kind: "done", masked: s.masked, name: s.name, goal: s.goal, check: finished } : s));
        return;
      }
      const gaveUp = Date.now() - w.startedAt > GIVE_UP_AFTER_MS;
      const status = check.ok ? check.status : null;
      setStage((s) => (s.kind === "dialing" && s.callId === w.callId ? { ...s, status: status ?? s.status, gaveUp } : s));
      if (!gaveUp) timer = setTimeout(poll, 4_000);
    };

    timer = setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [dialingId]);

  const review = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const signature = [name.trim(), phone.replace(/\D/g, ""), language, note.trim()].join("|");
    if (signature !== keyFor.current) {
      requestId.current = crypto.randomUUID();
      keyFor.current = signature;
    }
    setStage({ kind: "confirm" });
  };

  const dial = () => {
    setError(null);
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof startInstantCall>>;
      try {
        outcome = await startInstantCall({ passcode, name, phone, language, note, attested, requestId: requestId.current });
      } catch {
        // It may or may not have reached CALL-E. Stay on the confirm with the same key, so pressing again cannot ring twice.
        setError("The server did not answer. Press Call again — it will not ring twice.");
        return;
      }
      if (!outcome.ok) {
        setError(outcome.reason);
        setStage({ kind: "form" });
        return;
      }
      watch.current = { callId: outcome.callId, passcode, topics: outcome.topics, startedAt: Date.now() };
      setStage({
        kind: "dialing",
        callId: outcome.callId,
        masked: outcome.masked,
        name: name.trim(),
        language: outcome.language,
        goal: outcome.goal,
        status: null,
        gaveUp: false,
      });
    });
  };

  const startOver = () => {
    requestId.current = "";
    keyFor.current = "";
    watch.current = null;
    setAttested(false);
    setError(null);
    setStage({ kind: "form" });
  };

  if (stage.kind === "form" || stage.kind === "confirm") {
    const confirming = stage.kind === "confirm";
    const hasNote = note.trim().length > 0;
    return (
      <Panel title="Place a call">
        <form onSubmit={review} style={{ padding: PAD }}>
          <Field label="Passcode" htmlFor="try-passcode" hint="From the testing instructions. It keeps strangers from making this page ring numbers.">
            <TextInput
              id="try-passcode"
              type="password"
              autoComplete="off"
              value={passcode}
              disabled={confirming}
              onChange={(e) => setPasscode(e.target.value)}
              required
            />
          </Field>

          <div className="field-grid">
            <Field label="Your first name" htmlFor="try-name" hint="The assistant asks for you by it. One word.">
              <TextInput
                id="try-name"
                value={name}
                maxLength={30}
                autoComplete="off"
                placeholder="Priya"
                disabled={confirming}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Phone number" htmlFor="try-phone" hint="With the country code, starting with +. Hidden as you type, so it stays off a shared screen.">
              <div style={{ display: "flex", gap: "calc(var(--cell) * 1)" }}>
                <TextInput
                  id="try-phone"
                  mono
                  type="text"
                  inputMode="tel"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="+1 415 555 0100"
                  value={phone}
                  disabled={confirming}
                  onChange={(e) => setPhone(e.target.value)}
                  style={showNumber ? undefined : ({ WebkitTextSecurity: "disc" } as unknown as CSSProperties)}
                  required
                />
                <Button variant="onLabel" onClick={() => setShowNumber((v) => !v)} ariaLabel={showNumber ? "Hide the number" : "Show the number"}>
                  {showNumber ? "Hide" : "Show"}
                </Button>
              </div>
            </Field>
          </div>

          <Field label="Language" htmlFor="try-language" hint="What the assistant speaks on the call.">
            <Select id="try-language" value={language} options={languages} disabled={confirming} onChange={(e) => setLanguage(e.target.value)} />
          </Field>

          <Field
            label="Consultation note (optional)"
            htmlFor="try-note"
            hint="Write it the way a doctor would — for example “Started amlodipine 5 mg for high blood pressure. Check for dizziness and ankle swelling.” The call follows up on what it asks. Leave it empty for a general check-in."
          >
            <Textarea id="try-note" rows={4} maxLength={4000} value={note} disabled={confirming} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <label style={{ display: "flex", gap: "calc(var(--cell) * 1.25)", alignItems: "flex-start", margin: "0 0 calc(var(--cell) * 3)", fontSize: 14, lineHeight: 1.5, color: "var(--print-2)" }}>
            <input
              type="checkbox"
              checked={attested}
              disabled={confirming}
              onChange={(e) => setAttested(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--amber)" }}
            />
            <span>This is my number, or its owner has agreed to take an automated call from an AI assistant.</span>
          </label>

          {error ? (
            <p role="alert" style={{ margin: "0 0 calc(var(--cell) * 2)", fontSize: 14, color: "var(--danger-deep)" }}>
              {error}
            </p>
          ) : null}

          {confirming ? (
            <div style={{ display: "grid", gap: "calc(var(--cell) * 1.5)", padding: "calc(var(--cell) * 2)", background: "var(--label-2)", boxShadow: "inset 0 0 0 1px var(--rule)" }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
                Call {firstName} at <span className="mono">••• {last4}</span>, in {languageName}?
              </p>
              <p className="measure" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--print-2)" }}>
                The phone rings now, and it spends one CALL-E call. The assistant says it is {practiceName}&rsquo;s
                AI assistant before it asks anything{hasNote ? ", then follows up on your note" : ""}. If you describe
                anything urgent, it is told to stop the call.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "calc(var(--cell) * 1.5)" }}>
                <Button variant="primary" style={DIAL_STYLE} disabled={pending} onClick={dial}>
                  {pending ? (hasNote ? "Reading the note and dialling…" : "Dialling…") : `Call ${firstName}`}
                </Button>
                <Button variant="onLabel" disabled={pending} onClick={() => setStage({ kind: "form" })}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "calc(var(--cell) * 2)" }}>
              <Button type="submit" variant="primary" disabled={!passcode || !name.trim() || !phone.trim() || !attested}>
                Call
              </Button>
              <span style={{ fontSize: 13, color: "var(--print-3)" }}>Nothing is saved: no patient, no call record.</span>
            </div>
          )}
        </form>
      </Panel>
    );
  }

  if (stage.kind === "dialing") {
    return (
      <Panel title="Calling">
        <div style={{ display: "grid", gap: "calc(var(--cell) * 1.5)", padding: PAD }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "calc(var(--cell) * 1.5)" }}>
            <Badge tone="danger">On the line</Badge>
            {stage.status ? (
              <span className="mono" style={{ fontSize: 12, color: "var(--print-3)" }}>
                CALL-E: {stage.status.replace(/_/g, " ")}
              </span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--print)" }}>
            Calling {stage.name} at <span className="mono">{stage.masked}</span>, in {stage.language}
          </p>
          <p className="measure" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--print-2)" }}>
            {stage.gaveUp
              ? "CALL-E still has this call, but this page has stopped waiting. Nothing was saved, so its result cannot be shown here."
              : "Pick up. The assistant opens by saying it is an AI assistant. Stay on this page: the transcript and what came back appear here when the call ends, and nowhere else."}
          </p>
          <p className="measure" style={{ margin: 0, fontSize: 13, color: "var(--print-3)" }}>
            Finding out: {stage.goal}
          </p>
        </div>
      </Panel>
    );
  }

  const { check } = stage;
  const verdict = check.status !== "completed" ? "Call failed" : check.reached ? "Answered" : "No answer";

  return (
    <div style={{ display: "grid", gap: "calc(var(--cell) * 2)" }}>
      <Panel title="What came back">
        <div style={{ display: "grid", gap: "calc(var(--cell) * 2)", padding: PAD }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "calc(var(--cell) * 1.5)" }}>
            <Badge tone={verdict === "Answered" ? "clear" : "amber"}>{verdict}</Badge>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--print)" }}>
              {stage.name} · <span className="mono">{stage.masked}</span>
            </span>
            <Badge tone="plain" quiet>
              Not saved
            </Badge>
            <span style={{ flex: 1 }} />
            <Button variant="onLabel" onClick={startOver}>
              Call another number
            </Button>
          </div>

          {check.recap ? (
            <p className="measure" style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "var(--print)" }}>
              &ldquo;{check.recap}&rdquo;
            </p>
          ) : null}
          {check.summary ? (
            <p className="measure" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--print-2)" }}>
              {check.summary}
            </p>
          ) : null}

          {check.findings.length > 0 ? (
            <div>
              <h3 className="caps" style={{ margin: "0 0 calc(var(--cell) * 1)", color: "var(--print-3)" }}>
                What the call found out
              </h3>
              <ol style={{ margin: 0, paddingLeft: "calc(var(--cell) * 3)" }}>
                {check.findings.map((f) => (
                  <li key={f.topic} style={{ marginBottom: "calc(var(--cell) * 1.5)", fontSize: 15, color: "var(--print)" }}>
                    <span style={{ fontWeight: 600 }}>{f.topic}</span>
                    <span className="measure" style={{ display: "block", marginTop: 4, fontSize: 14, lineHeight: 1.5, color: f.answer || f.value !== null ? "var(--print)" : "var(--print-3)" }}>
                      {f.value !== null ? <span className="mono" style={{ fontWeight: 700, marginRight: 8 }}>{f.value}</span> : null}
                      {f.answer ?? (f.value === null ? "Not discussed" : "")}
                      {f.patientWords ? <> — &ldquo;{f.patientWords}&rdquo;</> : null}
                      {f.clarity === "unclear" ? " · unclear" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <p style={{ margin: 0, fontSize: 13, color: "var(--print-3)" }}>Finding out: {stage.goal}</p>
        </div>
      </Panel>

      {check.flags.length > 0 ? (
        <Panel title="For a person to read" band="danger">
          <ul style={{ margin: 0, padding: `calc(var(--cell) * 2.5) ${PAD} calc(var(--cell) * 2.5) calc(var(--cell) * 5.5)`, fontSize: 14, lineHeight: 1.55, color: "var(--print)" }}>
            {check.flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {check.transcript.length > 0 ? (
        <Panel title="Transcript">
          <ol style={{ listStyle: "none", margin: 0, padding: PAD, display: "grid", gap: "calc(var(--cell) * 1.5)" }}>
            {check.transcript.map((turn, i) => (
              <li key={i} style={{ display: "grid", gap: 2 }}>
                <span className="caps" style={{ color: isAssistant(turn.speaker) ? "var(--print-3)" : "var(--print)" }}>
                  {isAssistant(turn.speaker) ? "Assistant" : stage.name}
                </span>
                <span className="measure" style={{ fontSize: 15, lineHeight: 1.5, color: "var(--print)" }}>
                  {turn.text}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}
