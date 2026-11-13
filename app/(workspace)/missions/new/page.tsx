"use client";
import { useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { isServiceType } from "@/lib/services";
import { Suspense } from "react";
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
      <div className="detail-heading"><p className="eyebrow">Missions / New brief</p>
      <h1>Create a mission.</h1>
      <p className="muted mb-8 mt-3">
        Choose a bounded service and define what successful work looks like.
      </p></div>
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
