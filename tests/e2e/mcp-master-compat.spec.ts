import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { api } from "../../convex/_generated/api";
import { masterFixture } from "../helpers/master-fixtures";
import { MCP_SCOPES, MCP_TOOL_NAMES, toolResultSchema, toolDataSchemas, type McpToolName } from "../../lib/mcp/contracts";

test("a real stdio client operates a planner-created mission while human approval and paid release remain intact", async ({page}) => {
  test.skip(process.env.GUILDZERO_MCP_LIVE_E2E !== "1", "Requires isolated no-send combined backend and MCP build");
  test.setTimeout(90_000);
  const backendUrl=process.env.NEXT_PUBLIC_CONVEX_URL;
  if(!backendUrl) throw Error("Set isolated public backend URL explicitly.");
  const backend=new ConvexHttpClient(backendUrl,{logger:false});
  const email=`combined-${randomBytes(8).toString("hex")}@example.test`, password=randomBytes(24).toString("base64url");
  const session=await backend.mutation(api.auth.signIn,{flow:"signUp",email,password});
  if(session.status!=="complete") throw Error("Synthetic user sign-up failed.");
  backend.setAuth(session.tokens.accessToken);
  const {context,plan}=masterFixture();
  const runId=await backend.mutation(api.masterAgent.create,{requestId:randomBytes(16).toString("hex"),prompt:context.prompt,datasets:context.datasets,capYocto:context.capYocto,deadlineAt:context.deadlineAt,requiresHumanReview:false});
  const claim=await backend.mutation(api.masterAgent.beginPlanning,{runId,revision:1});
  await backend.mutation(api.masterAgent.finishPlanning,{runId,revision:1,token:claim.token,planJson:JSON.stringify(plan)});
  await page.goto("/sign-in");
  await page.getByLabel("Email",{exact:true}).fill(email); await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click(); await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/master-agent/${runId}`);
  const proposal=page.getByRole("region",{name:"Proposed execution plan",exact:true});
  await expect(proposal).toContainText("Offline gold proposal");
  await proposal.getByRole("checkbox",{name:/If settlement is unavailable/}).check();
  await proposal.getByRole("button",{name:"Accept plan and start marketplace",exact:true}).click();
  await expect(page.getByText("Main analysis · Work accepted",{exact:true})).toBeVisible({timeout:35_000});
  const run=await backend.query(api.masterAgent.get,{runId}), step=run.steps[0];
  const credential=await backend.action(api.mcpCredentials.create,{label:"Combined ephemeral client",scopes:MCP_SCOPES.filter(scope=>scope!=="missions:create"),missionIds:[step.missionId]});
  const directory=await mkdtemp(join(tmpdir(),"guildzero-combined-mcp-")), tokenFile=join(directory,"token");
  await writeFile(tokenFile,credential.token+"\n",{mode:0o600});
  const client=new Client({name:"guildzero-combined-e2e",version:"1.0.0"}); let connected=false;
  try{
    const transport=new StdioClientTransport({command:process.execPath,args:[resolve("dist/mcp/server.js")],cwd:process.cwd(),stderr:"pipe",env:{GUILDZERO_MCP_BACKEND_ORIGIN:process.env.GUILDZERO_MCP_BACKEND_ORIGIN??"http://127.0.0.1:3441",GUILDZERO_MCP_TOKEN_FILE:tokenFile}});
    transport.stderr?.on("data",()=>{});
    await client.connect(transport); connected=true;
    expect((await client.listTools()).tools.map(t=>t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    const call=async(name:McpToolName,args:Record<string,unknown>={})=>{
      const result=toolResultSchema(name).parse((await client.callTool({name,arguments:args})).structuredContent);
      if(!result.ok) throw Error(`Combined MCP failed with safe code ${result.code}`);
      return result.data;
    };
    const auction=toolDataSchemas.guildzero_get_auction.parse(await call("guildzero_get_auction",{jobId:step.jobId}));
    expect(auction.job.state).toBe("approved"); expect(auction.bids.length).toBeGreaterThanOrEqual(2);
    expect(toolDataSchemas.guildzero_get_verification.parse(await call("guildzero_get_verification",{jobId:step.jobId})).verdict).toBe("pass");
    expect(toolDataSchemas.guildzero_get_result.parse(await call("guildzero_get_result",{jobId:step.jobId}))).toMatchObject({locked:true,deliverable:null});
    const intent=toolDataSchemas.guildzero_prepare_payment.parse(await call("guildzero_prepare_payment",{jobId:step.jobId})).intent;
    expect(intent).toMatchObject({status:"READY",confirmed:false,txHash:null});
    const direct=await backend.mutation(api.payments.prepare,{jobId:step.jobId!}); expect(direct).toMatchObject({ok:true,intentId:intent!.id});
    const approval=toolDataSchemas.guildzero_request_payment_authorization.parse(await call("guildzero_request_payment_authorization",{jobId:step.jobId}));
    expect(approval).toMatchObject({approvalRequired:true,approvalUrl:`${new URL(page.url()).origin}/missions/${step.missionId}`});
    await page.reload(); await expect(page.getByRole("region",{name:"Locked deliverable preview",exact:true})).toBeVisible();
    await expect(page.getByRole("region",{name:"Mission spending authorization",exact:true})).toContainText("Automatic settlement is disabled");
    expect((await backend.query(api.payments.forJob,{jobId:step.jobId!}))!.authorizedAt).toBeUndefined();
    await expect(page.locator('a[href^="data:"]')).toHaveCount(0);
  }finally{
    if(connected) await client.close();
    await backend.mutation(api.mcpCredentials.revoke,{integrationId:credential.integrationId});
    await rm(directory,{recursive:true,force:true});
  }
});
