// Deliberately supports a single simple invocation, not general shell syntax.
// Anything ambiguous keeps its permission prompt instead of guessing execution semantics.
export function simpleCommandTokens(command: string): string[] | undefined {
  if (/[;&|<>$\x60\\\r\n(){}#@,]/.test(command)) return;
  const tokens: string[] = [];
  const pattern = /\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"']+))/gy;
  let offset = 0;
  while (offset < command.length) {
    if (!command.slice(offset).trim()) break;
    pattern.lastIndex = offset;
    const match = pattern.exec(command);
    if (!match || (pattern.lastIndex < command.length && !/\s/.test(command[pattern.lastIndex])))
      return;
    tokens.push(match[1] ?? match[2] ?? match[3]);
    offset = pattern.lastIndex;
  }
  return tokens.length ? tokens : undefined;
}
export function normalizeCommandPrefix(prefix: string): string | undefined {
  const value = prefix.trim().replace(/\s+/g, ' ');
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*(?: [a-zA-Z0-9_][a-zA-Z0-9_.-]*)*$/.test(value)
    ? value
    : undefined;
}
export function matchesCommandPrefix(command: string, prefix: string): boolean {
  const normalized = normalizeCommandPrefix(prefix);
  const tokens = simpleCommandTokens(command);
  return !!normalized && !!tokens && normalized.split(' ').every((token, i) => tokens[i] === token);
}
