import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Papa from "papaparse";
import { runService, verifyDeliverable } from "../../lib/economy";
import { validateBusinessInput } from "../../lib/economy/business-input";
import { readBusinessOutput } from "../../lib/business-output";
import { BusinessResult } from "../../components/business-result";
import { businessFixtures } from "../helpers/business-fixtures";
import type { BusinessRequest, BusinessOutput } from "../../lib/economy/types";

function result(request: BusinessRequest) {
  const r = runService(request);
  if (!r.ok) throw Error(r.message);
  return r.value as BusinessOutput;
}
it("quality findings preserve input and distinguish missing, duplicates and requested numeric checks", () => {
  const report = result(businessFixtures[0]);
  expect(report.serviceType).toBe("csv_validate");
  if (report.serviceType !== "csv_validate") throw Error("wrong template");
  expect(report.checks).toEqual([
    {name:"id",missing:0,duplicates:1,distinct:3,whitespace:0,invalidNumeric:null},
    {name:"units",missing:1,duplicates:0,distinct:3,whitespace:1,invalidNumeric:1},
  ]);
  expect(report.examples).toContainEqual({record:3,column:"units",rule:"non_numeric"});
  expect(verifyDeliverable({request:businessFixtures[0],deliverable:report})).toMatchObject({ok:true,value:{verdict:"pass"}});
});
it("reconciles reordered headers using exact keys with complete full-outer counts", () => {
  const report = result(businessFixtures[1]);
  expect(report).toMatchObject({counts:{unchanged:1,changed:1,leftOnly:1,rightOnly:1},comparisonRowCount:3,examples:[
    {key:"b",status:"changed",totalChangedColumns:1,changes:[{column:"amount",left:"20",right:"25",truncated:false}]},
    {key:"c",status:"left_only",changes:[]},{key:"d",status:"right_only",changes:[]},
  ]});
});
it("grouped report computes actual totals and explicitly missing values per group", () => {
  expect(result(businessFixtures[2])).toMatchObject({groups:[
    {key:"North",rowCount:2,statistics:[{name:"units",count:2,missing:0,min:2,max:3,sum:5,mean:2.5}]},
    {key:"South",rowCount:2,statistics:[{name:"units",count:1,missing:1,min:5,max:5,sum:5,mean:5}]},
  ]});
});
it.each(businessFixtures)("independently verifies $serviceType and rejects altered schemas/counts/examples", request => {
  const output = result(request);
  expect(readBusinessOutput(JSON.stringify(output))).toEqual(output);
  expect(verifyDeliverable({request,deliverable:output,acceptanceCriteria:"Review business meaning"})).toMatchObject({ok:true,value:{verdict:"needs_human"}});
  for (const tampered of [{...output,rowCount:499},{...output,extra:"injected"},{...output,columns:["wrong"]},null,[],{...output,format:"csv"}])
    expect(verifyDeliverable({request,deliverable:tampered})).toMatchObject({ok:true,value:{verdict:"fail"}});
  const altered = JSON.parse(JSON.stringify(output));
  if (altered.checks) altered.checks[0].missing++;
  if (altered.counts) altered.counts.changed++;
  if (altered.groups) altered.groups[0].statistics[0].sum++;
  expect(verifyDeliverable({request,deliverable:altered})).toMatchObject({ok:true,value:{verdict:"fail"}});
});
it.each(["id,amount\na,1\na,2", "id,amount\n,1", "id,amount\n" + "a".repeat(101) + ",1"])("rejects ambiguous keys before commitment", comparisonCsv => {
  expect(validateBusinessInput({...businessFixtures[1],serviceType:"csv_reconcile",options:{columns:["amount"],keyColumn:"id",comparisonCsv}}).ok).toBe(false);
});
it("never guesses equivalent numeric formatting or trims reconciliation keys", () => {
  expect(result({serviceType:"csv_reconcile",inputCsv:"id,n\na,1\n b,2",options:{keyColumn:"id",columns:["n"],comparisonCsv:"id,n\na,1.0\nb,2"}})).toMatchObject({counts:{unchanged:0,changed:1,leftOnly:1,rightOnly:1}});
});
it("preserves tiny grouped contributions through cancellation and handles prototype-like labels safely", () => {
  const request: BusinessRequest = {serviceType:"csv_report",inputCsv:"group,n\n__proto__,1000000000000\n__proto__,0.00001\n__proto__,-1000000000000\n,",options:{columns:["n"],groupBy:"group"}};
  const output = result(request);
  expect(output).toMatchObject({groups:[{key:"",statistics:[{sum:0,mean:null}]},{key:"__proto__",statistics:[{sum:0.00001}]}]});
  expect(verifyDeliverable({request,deliverable:output})).toMatchObject({ok:true,value:{verdict:"pass"}});
});
it.each(["$12", "1e-324", "1e13", "=SUM(A1)"])("blocks unsupported grouped numeric input %s", value => {
  expect(runService({serviceType:"csv_report",inputCsv:`g,n\na,${value}`,options:{columns:["n"],groupBy:"g"}})).toMatchObject({ok:false,code:"INVALID_NUMBER"});
});
it("bounds examples while retaining complete quality and reconciliation counts", () => {
  const inputCsv = "id,n\n" + Array.from({length:500},(_,i)=>`${i},1`).join("\n");
  const q = result({serviceType:"csv_validate",inputCsv,options:{columns:["n"],numericColumns:[]}});
  expect(q).toMatchObject({checks:[{duplicates:499}],examplesTruncated:true,examples:Array.from({length:100},(_,i)=>({record:i+3,column:"n",rule:"duplicate"}))});
  const r: BusinessRequest = {serviceType:"csv_reconcile",inputCsv,options:{columns:["n"],keyColumn:"id",comparisonCsv:inputCsv.replaceAll(",1",",2")}};
  const output = result(r);
  expect(output).toMatchObject({counts:{changed:500},examplesTruncated:true});
  if(output.serviceType!=="csv_reconcile")throw Error("wrong template");
  expect(output.examples).toHaveLength(25);
  expect(verifyDeliverable({request:r,deliverable:output})).toMatchObject({ok:true,value:{verdict:"pass"}});
});
it("bounds escaped Unicode examples by bytes and independently verifies the truncated prefix", () => {
  const columns = Array.from({length:5},(_,i)=>String(i)+"\u0001".repeat(99));
  const header = ["id",...columns];
  const inputCsv = Papa.unparse([header,...Array.from({length:25},(_,i)=>[String(i),...columns.map(()=>"\u0002".repeat(80))])]);
  const comparisonCsv = inputCsv.replaceAll("\u0002","\u0003");
  const request: BusinessRequest={serviceType:"csv_reconcile",inputCsv,options:{columns,keyColumn:"id",comparisonCsv}};
  const output=result(request);
  expect(new TextEncoder().encode(JSON.stringify(output)).length).toBeLessThanOrEqual(131072);
  expect(verifyDeliverable({request,deliverable:output})).toMatchObject({ok:true,value:{verdict:"pass"}});
});
it("rejects excessive groups, unknown options, missing shared columns and oversized comparison inputs", () => {
  expect(runService({serviceType:"csv_report",inputCsv:"g,n\n"+Array.from({length:51},(_,i)=>`${i},1`).join("\n"),options:{groupBy:"g",columns:["n"]}}).ok).toBe(false);
  const valid=businessFixtures[1];
  if(valid.serviceType!=="csv_reconcile")throw Error("fixture");
  for(const options of [{...valid.options,comparisonCsv:"id,other\na,1"},{...valid.options,comparisonCsv:"a".repeat(65537)},{...valid.options,groupBy:"id"}])
    expect(runService({...valid,options}).ok).toBe(false);
});
it.each(businessFixtures)("renders safe structured $serviceType output and rejects malformed display payloads", request => {
  const output=result(request), html=renderToStaticMarkup(createElement(BusinessResult,{report:output}));
  expect(html).toContain('aria-label="Business report result"');
  expect(readBusinessOutput(JSON.stringify({...output,examples:[null],groups:[null],checks:[null]}))).toBeNull();
});
