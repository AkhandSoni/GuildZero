import { redirect } from "next/navigation";
import { isServiceType } from "@/lib/services";
export default async function MasterAgentPage({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const service = (await searchParams).service;
  redirect(typeof service === "string" && isServiceType(service) ? `/missions/new?service=${service}` : "/missions/new");
}
