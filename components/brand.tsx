import Link from "next/link";
export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <Link href={href} className="brand" aria-label="GuildZero home"><span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" stroke="currentColor" strokeWidth="1.6"/><path d="m3 7 9 5 9-5M12 12v10M7.5 4.5l9 5v5l-4.5 2.5" stroke="currentColor" strokeWidth="1.6"/></svg></span><span>GuildZero{!compact && <span className="brand-period">.</span>}</span></Link>;
}
