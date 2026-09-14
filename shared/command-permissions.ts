// A conservative shell lexer: understands literal words and command separators,
// but never evaluates expansions or tries to interpret scripts.
export type CommandAnalysis = { commands: string[][]; reason?: string };
export function analyzeCommand(command: string, tool = 'Bash'): CommandAnalysis {
  const commands: string[][] = [];
  let words: string[] = [],
    word = '',
    started = false,
    quote = '';
  const powershell = tool === 'PowerShell';
  const fail = (reason: string): CommandAnalysis => ({ commands: [], reason });
  const endWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i],
      next = command[i + 1];
    if (quote === "'") {
      if (c === "'") {
        if (powershell && next === "'") {
          word += "'";
          i++;
        } else quote = '';
      } else word += c;
      continue;
    }
    if (c === '$' || (!powershell && c === '`'))
      return fail('Shell expansion or command substitution needs an exact approval.');
    if (powershell && c === '`') {
      if (!next) return fail('Unfinished PowerShell escape.');
      if (next === '\r' || next === '\n') {
        if (next === '\r' && command[i + 2] === '\n') i++;
        i++;
        continue;
      }
      if ('abefnrtuv0'.includes(next))
        return fail('PowerShell control-character escapes need an exact approval.');
      word += next;
      started = true;
      i++;
      continue;
    }
    if (!powershell && c === '\\') {
      if (!next) return fail('Unfinished shell escape.');
      if (next === '\n' || next === '\r') {
        if (next === '\r' && command[i + 2] === '\n') i++;
        i++;
        continue;
      }
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) word += c;
      else {
        word += next;
        started = true;
        i++;
      }
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = '';
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      started = true;
      continue;
    }
    if (c === '#' && !started) {
      while (i + 1 < command.length && !/[\r\n]/.test(command[i + 1])) i++;
      continue;
    }
    if (/[(){}]/.test(c) || (powershell && (c === '@' || c === ',')))
      return fail('Shell expressions or script blocks need an exact approval.');
    // Descriptor duplication changes output routing, not what gets executed.
    const descriptor =
      !started && !powershell ? command.slice(i).match(/^[012]>&[012](?=\s|$|[;&|])/) : null;
    if (descriptor) {
      i += descriptor[0].length - 1;
      continue;
    }
    if (c === '<' || c === '>') return fail('File redirection needs an exact approval.');
    if (c === '&' && next !== '&')
      return fail('Background execution or invocation operators need an exact approval.');
    if (c === ';' || c === '\n' || c === '\r' || c === '|' || (c === '&' && next === '&')) {
      endCommand();
      if ((c === '&' || c === '|') && next === c) i++;
      if (c === '|' && next === '&') return fail('This pipeline syntax needs an exact approval.');
      continue;
    }
    if (/\s/.test(c)) {
      endWord();
      continue;
    }
    word += c;
    started = true;
  }
  if (quote) return fail('Unclosed quote: use a complete command or an exact approval.');
  endCommand();
  if (!commands.length) return fail('Enter a shell command.');
  for (const words of commands) {
    if (
      !words[0] ||
      /[=*?\[\]!]/.test(words[0]) ||
      [
        'if',
        'then',
        'else',
        'fi',
        'for',
        'while',
        'do',
        'done',
        'case',
        'esac',
        'function',
        '!',
        'try',
        'catch',
        'switch',
        'until',
        'select',
        'elif',
        'in',
        'coproc',
        'time',
        'trap',
      ].includes(words[0].toLowerCase())
    )
      return fail('Assignments, control flow or dynamic command names need an exact approval.');
  }
  return { commands };
}
export function simpleCommandTokens(command: string, tool = 'Bash'): string[] | undefined {
  const parsed = analyzeCommand(command, tool);
  return !parsed.reason && parsed.commands.length === 1 ? parsed.commands[0] : undefined;
}
export function formatCommandWords(words: string[], tool = 'Bash'): string {
  return words
    .map((word) =>
      /^[a-zA-Z0-9_.:/\\-]+$/.test(word) && !word.includes('\\')
        ? word
        : tool === 'PowerShell'
          ? "'" + word.replace(/'/g, "''") + "'"
          : "'" + word.replace(/'/g, "'\\''") + "'",
    )
    .join(' ');
}
export function normalizeCommandPrefix(prefix: string, tool = 'Bash'): string | undefined {
  const tokens = simpleCommandTokens(prefix, tool);
  return tokens ? formatCommandWords(tokens, tool) : undefined;
}
export function matchesCommandWords(words: string[], prefix: string, tool = 'Bash'): boolean {
  const tokens = simpleCommandTokens(prefix, tool);
  return (
    !!tokens &&
    tokens.every((token, i) =>
      tool === 'PowerShell' && i === 0
        ? words[i]?.toLowerCase() === token.toLowerCase()
        : words[i] === token,
    )
  );
}
export function matchesCommandPrefix(command: string, prefix: string, tool = 'Bash'): boolean {
  const tokens = simpleCommandTokens(command, tool);
  return !!tokens && matchesCommandWords(tokens, prefix, tool);
}
export function suggestedCommandPrefixes(command: string, tool = 'Bash'): string[] {
  const parsed = analyzeCommand(command, tool);
  return [
    ...new Set(
      parsed.commands.map((words) => {
        const executable = words[0].toLowerCase().replace(/\.exe$/, '');
        const count =
          ['git', 'gh', 'npm', 'pnpm', 'yarn', 'docker', 'dotnet'].includes(executable) &&
          words[1] &&
          !words[1].startsWith('-')
            ? executable === 'gh' && words[2] && !words[2].startsWith('-')
              ? 3
              : 2
            : 1;
        return formatCommandWords(words.slice(0, count), tool);
      }),
    ),
  ];
}
