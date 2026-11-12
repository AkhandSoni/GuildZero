import { expect, it } from "vitest";
import { graphData } from "../../lib/economy-view";
const job = {
  _id: "job-a",
  missionId: "mission-a",
  parentId: null,
  state: "bidding",
  title: "Real recorded job",
};
it("does not invent agent activity or links for jobs without bids", () => {
  const graph = graphData([job], [], []);
  expect(graph.nodes).toHaveLength(1);
  expect(graph.edges).toEqual([]);
});
it("renders only persisted bid and subcontract relationships", () => {
  const child = { ...job, _id: "child", parentId: job._id };
  const bid = {
    _id: "bid-a",
    jobId: job._id,
    agentId: "stats-core",
    priceYocto: "1",
  };
  const graph = graphData([job, child], [bid], []);
  expect(graph.nodes.map((n) => n.id)).toEqual([
    "job-a",
    "child",
    "agent:stats-core",
  ]);
  expect(graph.edges.map((e) => e.label)).toEqual([
    "recorded bid",
    "subcontract",
  ]);
  expect(graph.edges.some((e) => e.label.includes("paid"))).toBe(false);
});
it("bounds graph work and exposes truncation", () => {
  const jobs = Array.from({ length: 51 }, (_, i) => ({
    ...job,
    _id: `job-${i}`,
  }));
  const bids = Array.from({ length: 151 }, (_, i) => ({
    _id: `bid-${i}`,
    jobId: "job-0",
    agentId: "stats-core",
    priceYocto: "1",
  }));
  const graph = graphData(jobs, bids, []);
  expect(graph.edges).toHaveLength(150);
  expect(graph.nodes).toHaveLength(51);
  expect(graph.truncated).toBe(true);
});
