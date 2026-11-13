import { Check, Circle, CircleAlert, LoaderCircle, X } from "lucide-react";
import { workflowSteps } from "@/lib/workflow-view";
export function WorkflowProgress({ state, eventTypes, paymentStatus }: { state: string; eventTypes: string[]; paymentStatus?: string }) {
  return <ol className="workflow-progress" aria-label="Workflow stages">{workflowSteps(state,eventTypes,paymentStatus).map((step) => {
    const Icon = step.tone === "done" ? Check : step.tone === "attention" ? CircleAlert : step.tone === "stopped" ? X : step.tone === "current" ? LoaderCircle : Circle;
    return <li key={step.label} className={`workflow-step ${step.tone}`} aria-current={step.tone === "current" ? "step" : undefined}><span className="step-icon"><Icon size={15} aria-hidden="true" /></span><div><p>{step.label}</p><span>{step.detail}</span></div></li>;
  })}</ol>;
}
