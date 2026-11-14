"use client";
import { use } from "react";
import { MasterAgentWorkspace } from "@/components/master-agent";
import type { Id } from "@/convex/_generated/dataModel";
export default function MasterAgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MasterAgentWorkspace runId={id as Id<"masterRuns">} />;
}
