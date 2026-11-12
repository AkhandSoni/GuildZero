import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1>Page not found.</h1>
      <p className="muted mt-4">
        Return to{" "}
        <Link href="/dashboard" className="text-emerald-800 underline">
          your missions
        </Link>
        .
      </p>
    </main>
  );
}
