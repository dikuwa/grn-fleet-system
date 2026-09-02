export type DatabaseErrorDetails = {
  code: string | null;
  message: string;
};

export function getDatabaseErrorDetails(error: unknown): DatabaseErrorDetails {
  const messages: string[] = [];
  let code: string | null = null;
  let current: unknown = error;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);

    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (!code && typeof record.code === 'string') code = record.code;
    if (typeof record.message === 'string' && record.message.trim()) messages.push(record.message);
    current = record.cause;
  }

  const rendered = String(error || '');
  if (rendered && !messages.includes(rendered)) messages.push(rendered);

  return { code, message: messages.filter(Boolean).join(' ') };
}
