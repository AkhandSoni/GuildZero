import { fork, type ChildProcess } from "node:child_process";

type Exit = { code: number | null; signal: NodeJS.Signals | null };
const active = new Map<ChildProcess, { stop: () => void; closed: Promise<void> }>();

/** Test-only process supervision. Never retain or print worker output/errors. */
export function runWorkerProcess(options: {
  script: string;
  env: NodeJS.ProcessEnv;
  onMessage: (message: unknown, child: ChildProcess) => Promise<void> | void;
  timeoutMs?: number;
  signal?: AbortSignal;
  expectedSignal?: NodeJS.Signals;
}) {
  if (options.signal?.aborted) return Promise.reject(new Error("WORKER_ABORTED"));
  const child = fork(options.script, [], {
    execArgv: [], env: options.env, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const result = new Promise<Exit>((resolve, reject) => {
    let failure: string | undefined;
    let outputBytes = 0;
    const stop = (reason: string) => {
      failure ??= reason;
      child.kill("SIGKILL");
    };
    const abort = () => stop("WORKER_ABORTED");
    const timer = setTimeout(() => stop("WORKER_TIMEOUT"), options.timeoutMs ?? 3000);
    const drain = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 65536) stop("WORKER_OUTPUT_LIMIT");
    };
    const message = (value: unknown) => {
      if (!failure) void Promise.resolve().then(() => options.onMessage(value, child))
        .catch(() => stop("WORKER_MESSAGE_FAILED"));
    };
    const error = () => stop("WORKER_PROCESS_FAILED");
    child.stdout!.on("data", drain);
    child.stderr!.on("data", drain);
    child.on("message", message);
    child.on("error", error);
    active.set(child, { stop: () => stop("WORKER_CLEANUP"), closed });
    options.signal?.addEventListener("abort", abort, { once: true });
    // Catch an abort that raced with registration.
    if (options.signal?.aborted) abort();
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      child.removeListener("message", message);
      child.removeListener("error", error);
      child.stdout!.removeListener("data", drain);
      child.stderr!.removeListener("data", drain);
      active.delete(child);
      resolveClosed();
      if (failure) reject(new Error(failure));
      else if (code !== 0 && (!options.expectedSignal || signal !== options.expectedSignal))
        reject(new Error("WORKER_EXITED_UNEXPECTEDLY"));
      else resolve({ code, signal });
    });
  });
  // A test cancellation may stop awaiting this promise before afterEach kills it.
  // Keep that rejection handled while preserving it for the original caller.
  void result.catch(() => {});
  return result;
}

export async function stopWorkerProcesses() {
  const workers = [...active.values()];
  for (const worker of workers) worker.stop();
  await Promise.all(workers.map(worker => worker.closed));
}
