import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-500">Access Denied</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">不正なアクセスです</h1>
        <p className="mt-4 text-sm text-gray-600">
          正しいURLからアクセスしてください。問題が解決しない場合は管理者にお問い合わせください。
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
        >
          トップページへ戻る
        </Link>
      </section>
    </main>
  );
}
