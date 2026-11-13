import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkflowError } from "../../components/workflow-error";
const render = (state: string, retryCount = 0, code = "WORKFLOW_PAUSED_RETRY_AVAILABLE", engineManaged = true) => renderToStaticMarkup(createElement(WorkflowError, { state, retryCount, code, engineManaged, busy: false, onRetry: () => {} }));
it("offers stage retry only for active, unexhausted work", () => {
  for (const state of ["bidding","working","revision","verifying"]) expect(render(state)).toContain("Retry workflow stage");
  for (const state of ["unawarded","approved","rejected","cancelled","disputed"]) expect(render(state)).not.toContain("Retry workflow stage");
  expect(render("working",0,"WORKFLOW_PAUSED_RETRY_AVAILABLE",false)).not.toContain("Retry workflow stage");
  expect(render("working",3)).not.toContain("Retry workflow stage");
  expect(render("bidding",0,"DEMO_OWNER_NOT_ALLOWLISTED")).not.toContain("Retry workflow stage");
});
