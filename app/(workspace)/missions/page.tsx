"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { MissionBrowser } from "@/components/mission-browser";
import { DemoControls } from "@/components/demo-controls";
import { Button } from "@/components/ui/button";
export default function MissionsPage(){
 const data=useQuery(api.marketViews.overview,{});
 return <><div className="dashboard-heading"><div><p className="eyebrow">Your private work</p><h1>Missions</h1><p className="muted text-sm mt-2">Find a brief, inspect its result or start a new dataset task.</p></div><Button asChild><Link href="/missions/new">+ New mission</Link></Button></div><MissionBrowser jobs={data?.jobs}/><section className="dashboard-samples"><p>Need a dataset to try?</p><DemoControls/></section></>;
}
