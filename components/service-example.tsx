"use client";
import { useState } from "react";
import { ArrowRight, Check, FileSpreadsheet } from "lucide-react";
import { parseBoundedCsv } from "@/lib/economy/csv-input";
import { runService } from "@/lib/economy/csv";
const csv = "product,units,revenue\n Canvas bag ,3,37.50\nNotebook,5,20.00\n Canvas bag ,2,25.00";
const source = parseBoundedCsv(csv);
export function ServiceExample() {
  const [mode,setMode] = useState<"csv_summary" | "csv_normalize">("csv_summary");
  const output = runService(mode === "csv_summary" ? {serviceType:mode,inputCsv:csv,options:{columns:["units","revenue"]}} : {serviceType:mode,inputCsv:csv,options:{columns:["product"],caseMode:"lowercase"}});
  return <section className="service-example" aria-label="Interactive service example">
    <div className="example-toolbar"><span><FileSpreadsheet size={15}/> sales_sample.csv</span><span className="example-label">LOCAL EXAMPLE</span></div>
    <div className="example-tabs" aria-label="Example service"><button type="button" aria-pressed={mode==="csv_summary"} onClick={()=>setMode("csv_summary")}>Statistics</button><button type="button" aria-pressed={mode==="csv_normalize"} onClick={()=>setMode("csv_normalize")}>Normalization</button></div>
    <div className="example-workflow">
    <div className="example-input"><span className="code-label">SAMPLE DATA / 3 ROWS</span>{source.ok && <table className="example-source-table"><thead><tr>{source.value.rawHeader.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{source.value.rawRows.map((row,i) => <tr key={i}>{row.map((cell,j) => <td className="whitespace-pre-wrap" key={j}>{cell}</td>)}</tr>)}</tbody></table>}</div>
    <div className="example-connector"><span/><ArrowRight size={15}/><span/></div>
    <div className="example-output" aria-live="polite"><div className="example-output-heading"><span className="code-label">COMPUTED OUTPUT</span><span><Check size={13}/> {mode==="csv_summary"?"Numeric summary":"Trimmed + lowercase"}</span></div>
      {output.ok && output.value.serviceType === "csv_summary" ? <table><thead><tr><th>Column</th><th>Count</th><th>Sum</th></tr></thead><tbody>{output.value.columns.map(column=><tr key={column.name}><td>{column.name}</td><td>{column.count}</td><td>{column.sum}</td></tr>)}</tbody></table> : output.ok && output.value.serviceType === "csv_normalize" ? <pre>{output.value.csv}</pre> : <p>Example unavailable.</p>}
    </div>
    </div>
    <p className="example-caption">Computed in your browser from this synthetic sample. No auction or payment is created.</p>
  </section>;
}
