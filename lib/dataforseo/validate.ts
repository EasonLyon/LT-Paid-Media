export function ensureDataForSeoResponseOk(
  response: unknown,
  context: string,
  options: { requireResult?: boolean } = {},
) {
  const requireResult = options.requireResult ?? true;
  const tasksError = (response as { tasks_error?: unknown })?.tasks_error;
  if (Array.isArray(tasksError) && tasksError.length > 0) {
    const message = JSON.stringify(tasksError.slice(0, 1));
    throw new Error(`[DataForSEO ${context}] tasks_error: ${message}`);
  }

  const tasks = (response as { tasks?: unknown[] })?.tasks ?? [];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error(`[DataForSEO ${context}] missing tasks`);
  }

  tasks.forEach((task, idx) => {
    const statusCode = (task as { status_code?: number })?.status_code;
    const statusMessage = (task as { status_message?: string })?.status_message;
    if (statusCode !== 20000) {
      throw new Error(
        `[DataForSEO ${context}] task ${idx} failed: status_code=${statusCode} message=${statusMessage ?? "unknown"}`,
      );
    }
    const result = (task as { result?: unknown[] })?.result ?? [];
    if (requireResult && (!Array.isArray(result) || result.length === 0)) {
      throw new Error(
        `[DataForSEO ${context}] task ${idx} missing result: status_code=${statusCode} message=${statusMessage ?? "unknown"}`,
      );
    }
  });
}
