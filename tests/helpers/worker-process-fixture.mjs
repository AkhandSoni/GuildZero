// Synthetic process lifecycle fixtures only. No SDK, credentials or network.
// Wait for the parent's acknowledgment so output/exit cannot race readiness.
const keepAlive = setInterval(() => {}, 1000);
process.once("message", () => {
  switch (process.env.WORKER_FIXTURE_MODE) {
    case "exit": process.exit(2); break;
    case "output":
      process.stdout.write("x".repeat(40000));
      process.stderr.write("x".repeat(40000));
      break;
    case "drain":
      process.stdout.write("x".repeat(20000));
      process.stderr.write("x".repeat(20000));
      clearInterval(keepAlive);
      process.disconnect();
      break;
  }
});
process.send({ ready: true });
