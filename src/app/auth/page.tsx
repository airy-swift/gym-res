import { redirect } from "next/navigation";

import { GoogleLoginButton } from "@/components/auth/google-login-button";
import { ensureValidGroupAccess } from "@/lib/util/group-access";

type AuthPageSearchParams = {
  gp?: string;
  next?: string;
};

type AuthPageProps = {
  searchParams?: Promise<AuthPageSearchParams> | AuthPageSearchParams;
};

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const resolvedSearchParams = await searchParams;
  const groupId = resolvedSearchParams?.gp ?? null;
  const group = await ensureValidGroupAccess(groupId);

  const rawNext = typeof resolvedSearchParams?.next === "string" ? resolvedSearchParams.next : "";
  const nextPath = rawNext.startsWith("/") ? rawNext : `/?gp=${group.id}`;

  if (groupId) {
    const query = new URLSearchParams();
    query.set("gp", groupId);
    query.set("next", nextPath);
    if (rawNext && !rawNext.startsWith("/")) {
      redirect(`/auth?${query.toString()}`);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9f4ff] px-6 py-10 text-stone-900 sm:px-12 lg:px-20">
      <section className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white/80 p-8 shadow-sm">
        <GoogleLoginButton groupId={group.id} nextPath={nextPath} />
      </section>
    </main>
  );
}
