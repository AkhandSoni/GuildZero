export type GraphJob = {
  _id: string;
  missionId: string;
  parentId: string | null;
  state: string;
  title: string;
};
export type GraphBid = {
  _id: string;
  jobId: string;
  agentId: string;
  priceYocto: string;
};
export type GraphContract = { jobId: string; agentId: string; state: string };
export function graphData(
  jobs: readonly GraphJob[],
  bids: readonly GraphBid[],
  contracts: readonly GraphContract[],
) {
  const visible = jobs.slice(0, 50),
    jobIds = new Set(visible.map((j) => j._id));
  const actors = Array.from(
    new Set(bids.filter((b) => jobIds.has(b.jobId)).map((b) => b.agentId)),
  ).slice(0, 10);
  const nodes = [
    ...visible.map((j, i) => ({
      id: j._id,
      position: { x: 0, y: i * 120 },
      data: {
        label: `${j.title}\n${j.state}`,
        href: `/missions/${j.missionId}`,
      },
    })),
    ...actors.map((a, i) => ({
      id: `agent:${a}`,
      position: { x: 400, y: i * 120 },
      data: { label: a, href: `/agents/${a}` },
    })),
  ];
  const edges = bids
    .filter((b) => jobIds.has(b.jobId) && actors.includes(b.agentId))
    .map((b) => ({
      id: b._id,
      source: `agent:${b.agentId}`,
      target: b.jobId,
      label: contracts.some(
        (c) => c.jobId === b.jobId && c.agentId === b.agentId,
      )
        ? "awarded contract"
        : "recorded bid",
    }));
  for (const job of visible)
    if (job.parentId && jobIds.has(job.parentId))
      edges.push({
        id: `child:${job._id}`,
        source: job.parentId,
        target: job._id,
        label: "subcontract",
      });
  return {
    nodes,
    edges: edges.slice(0, 150),
    truncated: jobs.length > 50 || edges.length > 150,
  };
}
