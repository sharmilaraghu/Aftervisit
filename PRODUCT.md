# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Doctors at clinics and hospitals. After a consultation they write a free-form note; the
follow-up that note implies is the job Aftervisit takes off their hands. A clinician reviews
the patients the agent escalates.

## Product Purpose

Aftervisit turns a doctor's consultation note into an automated phone follow-up. It reads
the note into a goal, what the doctor wants found out, and a schedule, then owns the whole
workflow — scheduling, calling, asking in its own words, extracting typed answers, retrying,
escalating — until the patient recovers or a clinician takes over.

Success is catching the patient who quietly stops engaging before a week goes by unnoticed.

## Positioning

The agent owns the follow-up workflow, not just one conversation: dated calls, retries for
the unanswered, a model reading every call with four pure rules standing under it as a
floor, and a queue a clinician works from.

## Operating Context

Consultation note → *Save and start follow-up* → scheduled calls → transcript triage →
the clinician's Today queue. Built on CALL-E for the phone calls; OpenAI reads notes and
calls. Submitted to the *CALL-E: Your Code Is Calling* hackathon with a ~3 minute demo video.

## Capabilities and Constraints

- Never gives clinical advice and never diagnoses. Escalation is routing, never a verdict.
- Dials only consenting patients, and only when the deployment allowlist is opened.
- The AI disclosure, emergency stop and emergency handoff are never weakened.
- Hackathon prototype. Not for use with real patient data.

## Brand Commitments

Name: Aftervisit. Phone numbers are always masked in the UI, because it appears in a
published video. Red means danger only.

## Evidence on Hand

The working console and a live call pipeline. No customers, clinical outcomes, testimonials
or usage figures exist — none may be implied.

## Product Principles

1. The workflow is the visible artifact.
2. An uncertain call becomes a human's problem, never a guess.
3. Safety is the differentiator, not overhead.
