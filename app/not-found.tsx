import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return <main className="status-page"><Brand/><section><p className="eyebrow">404 / Route unavailable</p><h1>Page not found.</h1><p className="muted mt-4">The address may have changed. Return to your workspace to find your missions.</p><div className="flex flex-wrap gap-3 mt-7"><Button asChild><Link href="/dashboard">Open workspace →</Link></Button><Button asChild variant="outline"><Link href="/">Product home</Link></Button></div></section></main>;
}
