"use client";
import { useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { isServiceType } from "@/lib/services";
import { Suspense } from "react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { MissionForm } from "@/components/mission-form";
export default function NewMission() {
  return <Suspense fallback={<p role="status">Loading mission editor…</p>}><NewMissionEditor/></Suspense>;
}
function NewMissionEditor() {
  const create = useMutation(api.missions.create);
  const router = useRouter();
  const params = useSearchParams();
  const requestedService = params.get("service");
  const service = isServiceType(requestedService) ? requestedService : "csv_summary";
  return (
    <div className="detail-layout mission-editor">
      <div className="detail-heading"><p className="eyebrow">Advanced / Manual mission creation</p>
      <h1>Manual mission creation.</h1>
      <p className="muted mb-8 mt-3">
        Choose a bounded service and exact processing options yourself.
      </p></div>
      <Link href="/missions/new" className="mb-6 inline-block text-sm underline">Use the Personal Master Agent instead</Link>
      <MissionForm
        key={service}
        defaultService={service}
        onSave={async (input) => {
          const id = await create(input);
          return () => router.push(`/missions/${id}`);
        }}
      />
    </div>
  );
}
