// @vitest-environment node
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { runWorkerProcess, stopWorkerProcesses } from "../helpers/worker-process";

const script = fileURLToPath(new URL("../helpers/worker-process-fixture.mjs", import.meta.url));
afterEach(stopWorkerProcesses);

function start(mode = "stall", options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  let child: ChildProcess | undefined;
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const result = runWorkerProcess({
    script, env: { NODE_ENV: "test", WORKER_FIXTURE_MODE: mode }, ...options,
    onMessage: (_, process) => { child = process; process.send({ start: true }); ready(); },
  });
  return { result, started, get child() { return child!; } };
}
function expectReaped(child: ChildProcess) {
  expect(child.signalCode).toBe("SIGKILL");
  expect(child.connected).toBe(false);
  expect(() => process.kill(child.pid!, 0)).toThrow();
}
it("kills and reaps a stalled child before rejecting its deadline", async () => {
  const worker = start("stall", { timeoutMs: 1500 });
  await worker.started;
  await expect(worker.result).rejects.toThrow("WORKER_TIMEOUT");
  expectReaped(worker.child);
});
it("kills and reaps a running child on cancellation", async () => {
  const controller = new AbortController();
  const worker = start("stall", { signal: controller.signal });
  await worker.started;
  controller.abort();
  await expect(worker.result).rejects.toThrow("WORKER_ABORTED");
  expectReaped(worker.child);
});
it("test cleanup terminates pending workers and awaits every exit", async () => {
  const workers = [start(), start()];
  await Promise.all(workers.map(worker => worker.started));
  await stopWorkerProcesses();
  for (const worker of workers) {
    await expect(worker.result).rejects.toThrow("WORKER_CLEANUP");
    expectReaped(worker.child);
  }
});
it("does not swallow parent assertions into a simulated action failure", async () => {
  let child!: ChildProcess;
  const result = runWorkerProcess({ script, env: { NODE_ENV: "test" }, onMessage: (_, process) => {
    child = process;
    throw new Error("synthetic private diagnostic must not be forwarded");
  } });
  await expect(result).rejects.toThrow("WORKER_MESSAGE_FAILED");
  expectReaped(child);
});
it("drains allowed output and kills excessive stdout/stderr without exposing it", async () => {
  await expect(start("drain").result).resolves.toEqual({ code: 0, signal: null });
  const excessive = start("output");
  await expect(excessive.result).rejects.toThrow("WORKER_OUTPUT_LIMIT");
  expectReaped(excessive.child);
});
it("rejects abnormal exits and cancellation before launch", async () => {
  await expect(start("exit").result).rejects.toThrow("WORKER_EXITED_UNEXPECTEDLY");
  const controller = new AbortController(); controller.abort();
  await expect(start("stall", { signal: controller.signal }).result).rejects.toThrow("WORKER_ABORTED");
});
