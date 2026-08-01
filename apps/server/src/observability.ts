type LogContext = Readonly<Record<string, unknown>>;

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

/** Emits one JSON object so Workers log processors can index every field reliably. */
export function logError(event: string, error: unknown, context: LogContext = {}): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event,
      context,
      error: serializeError(error),
    }),
  );
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: "UnknownError", message: String(error) };
}
