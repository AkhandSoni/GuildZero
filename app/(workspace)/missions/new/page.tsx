import { MasterAgentHome } from "@/components/master-agent";
import { isServiceType } from "@/lib/services";
export default async function NewMission({ searchParams }: { searchParams: Promise<{ service?: string | string[] }> }) {
  const requested = (await searchParams).service;
  const service = typeof requested === "string" && isServiceType(requested) ? requested : undefined;
  return <MasterAgentHome key={service ?? "default"} initialService={service} />;
}
