import { notFound } from "next/navigation";

import { AccessState } from "@/components/AccessState";
import { getQuestionSet } from "@/lib/data/question-sets";
import { getSession } from "@/lib/data/session";

import { QuestionSetContent } from "./QuestionSetContent";

export const dynamic = "force-dynamic";

export default async function QuestionSetPage({
  params,
}: PageProps<"/question-sets/[slug]">) {
  const { slug } = await params;

  const session = await getSession();
  if (session.state !== "ok") {
    return (
      <AccessState
        state={session.state}
        email={session.state === "no_staff_record" ? session.email : undefined}
      />
    );
  }

  const set = await getQuestionSet(slug);
  if (!set) notFound();

  // Everyone reads the set; only an admin retunes ownership. The select is
  // rendered read-only rather than hidden, so a delivery lead can see who owns
  // a question without being able to change it.
  return <QuestionSetContent set={set} canEdit={session.staff.role === "admin"} />;
}
