type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { value: String(error) };
}

function writeLog(level: LogLevel, event: string, context: LogContext = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "tide-grading-backend",
    event,
    ...context,
  };

  const destination = level === "error" ? process.stderr : process.stdout;
  destination.write(`${JSON.stringify(entry)}\n`);
}

export function logDebug(event: string, context?: LogContext) {
  writeLog("debug", event, context);
}

export function logInfo(event: string, context?: LogContext) {
  writeLog("info", event, context);
}

export function logWarn(event: string, context?: LogContext) {
  writeLog("warn", event, context);
}

export function logError(
  event: string,
  error: unknown,
  context: LogContext = {},
) {
  writeLog("error", event, {
    ...context,
    error: serializeError(error),
  });
}
