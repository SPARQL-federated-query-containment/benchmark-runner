import { SPECS_IMAGE } from "solver/lib/specs";
import type { Pair } from "./load";
import type { EngineName } from "./engines";

const OOM_SIGNATURES = ["Out of memory", "MemoryExhaustion"];

interface DecideMessage {
  requestId: number;
  engine: EngineName;
  pair: Pair;
  timeoutMs: number;
  z3TimeoutSeconds?: number;
  z3MemoryMb?: number;
}

self.onmessage = async (event: MessageEvent<DecideMessage>) => {
  const { requestId, engine, pair, timeoutMs, z3TimeoutSeconds, z3MemoryMb } = event.data;

  const args = [
    "bun",
    "solver/index.ts",
    "--engine",
    engine,
    "--file",
    pair.subQueryPath,
    pair.superQueryPath,
  ];
  if (z3TimeoutSeconds !== undefined) {
    args.push("--z3-timeout", String(z3TimeoutSeconds));
  }
  if (z3MemoryMb !== undefined) {
    args.push("--z3-memory", String(z3MemoryMb));
  }

  const spawnArgs =
    z3MemoryMb !== undefined
      ? [
          "bash",
          "-c",
          'ulimit -v "$1"; shift; exec "$@"',
          "_",
          String(z3MemoryMb * 1024),
          ...args,
        ]
      : args;

  const proc = Bun.spawn(spawnArgs, { stdout: "pipe", stderr: "pipe" });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    const cleanup = Bun.spawn(["docker", "rm", "-f", SPECS_IMAGE], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanup.exited;
    postMessage({ requestId, type: "result", value: "timeout" });
    return;
  }

  if (proc.exitCode !== 0) {
    if (OOM_SIGNATURES.some((signature) => stderr.includes(signature))) {
      postMessage({ requestId, type: "result", value: "out of memory" });
      return;
    }
    postMessage({
      requestId,
      type: "error",
      message: stderr.trim() || `solver exited with code ${proc.exitCode}`,
    });
    return;
  }

  postMessage({ requestId, type: "result", value: stdout.trim() });
};
