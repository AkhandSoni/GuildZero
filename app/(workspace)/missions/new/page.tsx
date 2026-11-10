"use client";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { MissionForm } from "@/components/mission-form";
export default function NewMission() {
  const create = useMutation(api.missions.create);
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">Mission brief</p>
      <h1>Create a mission.</h1>
      <p className="muted mb-8 mt-3">
        Choose a bounded service and define what successful work looks like.
      </p>
      <MissionForm
        onSave={async (input) => {
          const id = await create(input);
          router.push(`/missions/${id}`);
        }}
      />
    </div>
  );
}
