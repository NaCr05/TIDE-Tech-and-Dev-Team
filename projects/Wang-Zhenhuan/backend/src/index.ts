import { app } from "./app";
import { logError, logInfo } from "./logger";
import { pool, prisma } from "./prisma";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  logInfo("server.started", {
    port,
    url: `http://localhost:${port}`,
    nodeVersion: process.version,
  });
});

async function shutdown() {
  logInfo("server.shutdown.started");

  server.close(async () => {
    try {
      await prisma.$disconnect();
      await pool.end();
      logInfo("server.shutdown.completed");
      process.exit(0);
    } catch (error) {
      logError("server.shutdown.failed", error);
      process.exit(1);
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
