import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { MCP_SCOPES, MCP_TOOL_NAMES, toolDataSchemas, toolResultSchema, type McpToolName } from "../../lib/mcp/contracts";
import { acknowledgePreview } from "./helpers";

// Opt in only against the documented isolated, settlement-disabled local backend.
// Sender/recipient IDs are explicitly synthetic no-send configuration; no key exists.
test("actual stdio client and human UI use the local Convex economy without authorizing payment", async ({page,browser}) => {
  test.skip(process.env.GUILDZERO_MCP_LIVE_E2E !== "1", "Requires an isolated local Convex backend, built MCP executable and synthetic no-send payment configuration");
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "guildzero-mcp-e2e-"));
  const client = new Client({name:"guildzero-local-e2e",version:"1.0.0"});
  let connected = false;
  try {
    await page.goto("/sign-in");
    await page.getByRole("button", {name:"Need an account? Sign up"}).click();
    await page.getByLabel("Email",{exact:true}).fill(`mcp-${randomBytes(8).toString("hex")}@example.com`);
    const password = randomBytes(24).toString("base64url");
    await page.getByLabel("Password",{exact:true}).fill(password);
    await page.getByLabel("Confirm password",{exact:true}).fill(password);
    await page.getByRole("button",{name:"Create account",exact:true}).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link",{name:"Connections",exact:true}).click();
    await page.getByLabel("Connection name",{exact:true}).fill("Local no-send E2E");
    for (const scope of MCP_SCOPES) {
      // Each permission label has the same order as the shared scope tuple.
      await page.locator("fieldset input[type=checkbox]").nth(MCP_SCOPES.indexOf(scope)).check();
    }
    await page.getByRole("button",{name:"Create scoped credential",exact:true}).click();
    const secret = page.getByLabel("One-time credential",{exact:true});
    await expect(secret).toBeVisible({timeout:20_000});
    const token = await secret.inputValue();
    expect(/^gzmcp_[0-9a-f]{64}$/.test(token)).toBe(true);
    const tokenFile = join(directory,"token");
    await writeFile(tokenFile,token+"\n",{mode:0o600});
    await page.getByRole("button",{name:"I saved it — hide credential",exact:true}).click();
    await expect(secret).toHaveCount(0);
    const transport = new StdioClientTransport({
      command: process.execPath, args:[resolve("dist/mcp/server.js")], cwd:process.cwd(), stderr:"pipe",
      env:{GUILDZERO_MCP_BACKEND_ORIGIN:process.env.GUILDZERO_MCP_BACKEND_ORIGIN ?? "http://127.0.0.1:3211",GUILDZERO_MCP_TOKEN_FILE:tokenFile},
    });
    let diagnostics = "";
    transport.stderr?.on("data", chunk => { diagnostics += String(chunk); });
    await client.connect(transport); connected = true;
    expect((await client.listTools()).tools.map(tool=>tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const call = async (name:McpToolName,args:Record<string,unknown>={}) => {
      const raw = await client.callTool({name,arguments:args});
      return toolResultSchema(name).parse(raw.structuredContent);
    };
    const success = async (name:McpToolName,args:Record<string,unknown>={}) => {
      const result = await call(name,args);
      if (!result.ok) throw new Error(`Expected successful ${name}; sanitized code ${result.code}`);
      return result.data;
    };
    expect(toolDataSchemas.guildzero_list_services.parse(await success("guildzero_list_services")).services).toHaveLength(5);
    expect(toolDataSchemas.guildzero_list_agents.parse(await success("guildzero_list_agents")).agents).toHaveLength(7);
    const brief = {requestId:randomBytes(16).toString("hex"),title:"Synthetic MCP no-send summary",serviceType:"csv_summary",inputCsv:"item,units\n A ,2\n B ,3\n",options:{columns:["units"]},maxBudgetYocto:"1000000000000000000000000",deadlineAt:Date.now()+86_400_000,acceptanceCriteria:"Compute explicit units statistics from synthetic data.",cleanBeforeProcessing:true,requiresHumanReview:false};
    const created = toolDataSchemas.guildzero_create_mission.parse(await success("guildzero_create_mission",brief));
    const replay = toolDataSchemas.guildzero_create_mission.parse(await success("guildzero_create_mission",brief));
    expect(replay.missionId).toBe(created.missionId);
    const conflict = await call("guildzero_create_mission",{...brief,title:"Changed request payload"});
    expect(conflict.ok ? "unexpected-success" : conflict.code).toBe("REQUEST_ID_CONFLICT");
    expect(toolDataSchemas.guildzero_list_missions.parse(await success("guildzero_list_missions")).missions.some(mission=>mission.id===created.missionId)).toBe(true);
    await success("guildzero_get_mission",{missionId:created.missionId});
    const start = await call("guildzero_start_auction",{missionId:created.missionId});
    expect(start.ok ? "unexpected-success" : start.code).toBe("HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED");
    await page.goto(`/missions/${created.missionId}`);
    await acknowledgePreview(page);
    await page.getByRole("button",{name:"Open auction",exact:true}).click();
    await expect(page.getByText("Main analysis · Work accepted",{exact:true}).first()).toBeVisible({timeout:40_000});
    const started = toolDataSchemas.guildzero_start_auction.parse(await success("guildzero_start_auction",{missionId:created.missionId}));
    const jobId = started.jobId;
    const auction = toolDataSchemas.guildzero_get_auction.parse(await success("guildzero_get_auction",{jobId}));
    expect(auction.bids.length).toBeGreaterThanOrEqual(2);
    expect(auction.negotiations.some(round=>round.round===3)).toBe(true);
    expect(auction.children).toHaveLength(1);
    expect(toolDataSchemas.guildzero_get_activity.parse(await success("guildzero_get_activity",{jobId})).events.length).toBeGreaterThan(0);
    expect(toolDataSchemas.guildzero_get_verification.parse(await success("guildzero_get_verification",{jobId})).verdict).toBe("pass");
    const locked = toolDataSchemas.guildzero_get_result.parse(await success("guildzero_get_result",{jobId}));
    expect(locked.locked).toBe(true); expect(locked.deliverable).toBeNull(); expect(locked.confirmedPayments).toBe(0);
    expect(toolDataSchemas.guildzero_get_payment_status.parse(await success("guildzero_get_payment_status",{jobId})).intent).toBeNull();
    const prepared = toolDataSchemas.guildzero_prepare_payment.parse(await success("guildzero_prepare_payment",{jobId}));
    expect(prepared.intent?.status).toBe("READY"); expect(prepared.intent?.txHash).toBeNull();
    const approval = toolDataSchemas.guildzero_request_payment_authorization.parse(await success("guildzero_request_payment_authorization",{jobId}));
    expect(approval.approvalRequired).toBe(true); expect(approval.intent.id).toBe(prepared.intent?.id);
    expect(new URL(approval.approvalUrl).origin).toBe(new URL(page.url()).origin);
    // UI must still show a disabled human payment authorization, no confirmation.
    await expect(page.getByRole("button",{name:"Authorize testnet payment",exact:true}).first()).toBeDisabled();
    const after = toolDataSchemas.guildzero_get_payment_status.parse(await success("guildzero_get_payment_status",{jobId}));
    expect(after.intent?.status).toBe("READY"); expect(after.intent?.confirmed).toBe(false); expect(after.intent?.txHash).toBeNull();
    // A second real Auth2 user and separate issued credential cannot see the first user's job.
    const outsider = await browser.newContext({baseURL:new URL(page.url()).origin});
    const otherClient = new Client({name:"guildzero-other-user",version:"1.0.0"});
    let otherConnected = false;
    const otherPage = await outsider.newPage();
    try {
      await otherPage.goto("/sign-in");
      await otherPage.getByRole("button",{name:"Need an account? Sign up"}).click();
      await otherPage.getByLabel("Email",{exact:true}).fill(`mcp-other-${randomBytes(8).toString("hex")}@example.com`);
      const otherPassword = randomBytes(24).toString("base64url");
      await otherPage.getByLabel("Password",{exact:true}).fill(otherPassword);
      await otherPage.getByLabel("Confirm password",{exact:true}).fill(otherPassword);
      await otherPage.getByRole("button",{name:"Create account",exact:true}).click();
      await expect(otherPage).toHaveURL(/\/dashboard$/);
      await otherPage.getByRole("link",{name:"Connections",exact:true}).click();
      await otherPage.getByLabel("Connection name",{exact:true}).fill("Other local client");
      for (let index=0;index<MCP_SCOPES.length;index++) await otherPage.locator("fieldset input[type=checkbox]").nth(index).check();
      await otherPage.getByRole("button",{name:"Create scoped credential",exact:true}).click();
      const otherSecret = otherPage.getByLabel("One-time credential",{exact:true});
      await expect(otherSecret).toBeVisible({timeout:20_000});
      const otherFile = join(directory,"other-token");
      await writeFile(otherFile,(await otherSecret.inputValue())+"\n",{mode:0o600});
      await otherPage.getByRole("button",{name:"I saved it — hide credential",exact:true}).click();
      await otherClient.connect(new StdioClientTransport({command:process.execPath,args:[resolve("dist/mcp/server.js")],cwd:process.cwd(),stderr:"pipe",env:{GUILDZERO_MCP_BACKEND_ORIGIN:process.env.GUILDZERO_MCP_BACKEND_ORIGIN ?? "http://127.0.0.1:3211",GUILDZERO_MCP_TOKEN_FILE:otherFile}}));
      otherConnected = true;
      for (const name of ["guildzero_get_mission","guildzero_get_auction","guildzero_get_activity","guildzero_get_verification","guildzero_get_result","guildzero_get_payment_status","guildzero_prepare_payment","guildzero_request_payment_authorization"] as const) {
        const raw = await otherClient.callTool({name,arguments:name==="guildzero_get_mission"?{missionId:created.missionId}:{jobId}});
        const denied = toolResultSchema(name).parse(raw.structuredContent);
        expect(denied.ok ? "unexpected-success" : denied.code).toBe("NOT_FOUND");
      }
      const otherList = toolResultSchema("guildzero_list_missions").parse((await otherClient.callTool({name:"guildzero_list_missions",arguments:{}})).structuredContent);
      if (!otherList.ok) throw new Error("Other-user listing unavailable");
      expect(otherList.data.missions).toEqual([]);
      await otherPage.getByRole("button",{name:"Revoke all",exact:true}).click();
      await expect(otherPage.getByRole("status")).toContainText("All connection credentials revoked.");
    } finally {
      if (otherConnected) await otherClient.close();
      await outsider.close();
    }
    await client.close(); connected = false;
    // A fresh child reconnects to the same backend identity; it does not restart work.
    const reconnected = new Client({name:"guildzero-local-reconnect",version:"1.0.0"});
    try {
      await reconnected.connect(new StdioClientTransport({command:process.execPath,args:[resolve("dist/mcp/server.js")],cwd:process.cwd(),stderr:"pipe",env:{GUILDZERO_MCP_BACKEND_ORIGIN:process.env.GUILDZERO_MCP_BACKEND_ORIGIN ?? "http://127.0.0.1:3211",GUILDZERO_MCP_TOKEN_FILE:tokenFile}}));
      const reread = await reconnected.callTool({name:"guildzero_get_payment_status",arguments:{jobId}});
      const record = toolResultSchema("guildzero_get_payment_status").parse(reread.structuredContent);
      expect(record.ok).toBe(true);
      await page.goto("/integrations");
      await page.getByRole("button",{name:"Revoke all",exact:true}).click();
      await expect(page.getByRole("status")).toContainText("All connection credentials revoked.");
      const denied = await reconnected.callTool({name:"guildzero_list_services",arguments:{}});
      const result = toolResultSchema("guildzero_list_services").parse(denied.structuredContent);
      expect(result.ok ? "unexpected-success" : result.code).toBe("UNAUTHENTICATED");
    } finally { await reconnected.close(); }
    expect(diagnostics.includes(token)).toBe(false);
    await page.setViewportSize({width:390,height:844});
    await expect(page.getByRole("heading",{name:"Assistant connections",exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:"test-results/mcp-connections-mobile.png",fullPage:true});
  } finally {
    if (connected) await client.close();
    // Best-effort actual human-session cleanup, even if an assertion failed.
    await page.goto("/integrations").catch(() => undefined);
    const revokeAll = page.getByRole("button",{name:"Revoke all",exact:true});
    if (await revokeAll.isVisible().catch(() => false)) {
      await revokeAll.click().catch(() => undefined);
      await expect(page.getByRole("status")).toContainText("All connection credentials revoked.").catch(() => undefined);
    }
    await rm(directory,{recursive:true,force:true});
  }
});
