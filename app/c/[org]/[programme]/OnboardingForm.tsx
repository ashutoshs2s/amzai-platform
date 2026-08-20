"use client";

import { useState } from "react";

import { saveClientAnswer } from "@/lib/client/onboarding-actions";
import type { ClientQuestion, ClientView } from "@/lib/client/onboarding";

/**
 * The onboarding questions, as the client sees them.
 *
 * Saves on blur, one answer at a time, exactly as the internal screen does.
 * DESIGN.md section 8 bans a save button at the bottom of this form, and for a
 * good reason: it can run to fifty questions, and anybody who fills half of it
 * and closes the tab should not lose the half they did.
 *
 * Must work on a phone down to 360px, so it is one column throughout and the
 * type does not shrink.
 */
export function OnboardingForm({
  organisationSlug,
  programmeSlug,
  view,
}: {
  organisationSlug: string;
  programmeSlug: string;
  view: ClientView;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      view.sections.flatMap((s) => s.questions.map((q) => [q.id, q.response])),
    ),
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const answered = Object.values(answers).filter((a) => a.trim() !== "").length;

  async function save(question: ClientQuestion, value: string) {
    if (value === question.response && value === answers[question.id]) return;

    setError(null);
    const result = await saveClientAnswer(
      organisationSlug,
      programmeSlug,
      question.id,
      value,
    );

    if (!result.ok) {
      setError({ id: question.id, message: result.message });
      return;
    }

    setSaved(question.id);
    setTimeout(() => setSaved((c) => (c === question.id ? null : c)), 2000);
  }

  return (
    <main className="mx-auto w-full max-w-[760px] px-6 py-10">
      <span className="text-body font-semibold tracking-[0.04em] text-ink">AMZAI</span>

      <h1 className="mt-6 text-page-title font-semibold text-ink">{view.programmeName}</h1>
      <p className="mt-1 text-body text-slate">
        Onboarding for {view.organisationName}
      </p>

      <div className="mt-6 rounded-base border border-line bg-surface p-4">
        <p className="text-body text-ink">
          <span className="font-time text-time font-medium">{answered}</span>
          <span className="text-slate"> of </span>
          <span className="font-time text-time font-medium">{view.total}</span>
          <span className="text-slate"> answered</span>
        </p>
        <p className="mt-2 text-body text-slate">
          Your answers save as you go, so you can leave this page and come back. There is
          nothing to submit at the end.
        </p>
      </div>

      {view.sections.map((section) => (
        <section key={section.section} className="mt-8">
          <h2 className="border-b border-line pb-2 text-section font-semibold text-ink">
            {section.section}
          </h2>

          <div className="mt-4 flex flex-col gap-6">
            {section.questions.map((question) => (
              <div key={question.id}>
                <label
                  htmlFor={`q-${question.id}`}
                  className="block text-body font-medium text-ink"
                >
                  {question.question}
                </label>

                {question.guidance && (
                  <p className="mt-1 text-body text-slate">{question.guidance}</p>
                )}

                <textarea
                  id={`q-${question.id}`}
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  onBlur={(event) => save(question, event.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-base border border-line bg-surface px-3 py-2 text-answer text-ink focus:border-accent"
                />

                <span className="mt-1 block h-4 text-caption">
                  {saved === question.id && (
                    <span className="font-medium text-clear" role="status">
                      Saved
                    </span>
                  )}
                  {error?.id === question.id && (
                    <span className="text-critical" role="status">
                      {error.message}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="mt-10 text-body text-slate">
        Anything you are unsure about, leave blank and tell your Amzai contact.
      </p>
    </main>
  );
}
