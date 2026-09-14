import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const root = resolve('.probe');
const plugin = join(root, 'plugin');
await mkdir(join(plugin, '.claude-plugin'), { recursive: true });
await mkdir(join(plugin, 'skills', 'probe'), { recursive: true });
await writeFile(
  join(plugin, '.claude-plugin', 'plugin.json'),
  JSON.stringify({ name: 'ai-native-probe', version: '1.0.0' }),
);
await writeFile(
  join(plugin, 'skills', 'probe', 'SKILL.md'),
  '---\nname: probe\ndescription: Verify the AI Native SDK integration.\n---\nThe verification marker is WORKFLOW_SKILL_OK. Use the fixture echo MCP tool, then AskUserQuestion with a yes/no question. Include the marker in the final response.',
);
const observations: Record<string, unknown> = {
  permission: false,
  question: false,
  mcp: false,
  skill: false,
  resume: false,
  interrupt: false,
};
const mcp = createSdkMcpServer({
  name: 'fixture',
  tools: [
    tool('echo', 'Echo a diagnostic value.', { value: z.string() }, async ({ value }) => {
      observations.mcp = true;
      return { content: [{ type: 'text', text: value }] };
    }),
  ],
});
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 120_000);
let sessionId = '';
const options = {
  cwd: root,
  pathToClaudeCodeExecutable:
    process.env.CLAUDE_EXECUTABLE ??
    join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
  settingSources: ['user', 'project', 'local'] as ('user' | 'project' | 'local')[],
  plugins: [{ type: 'local' as const, path: plugin }],
  mcpServers: { fixture: mcp },
  systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
  abortController: controller,
  hooks: {
    PreToolUse: [
      {
        matcher: 'mcp__fixture__echo',
        hooks: [
          async () => ({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'ask' as const,
              permissionDecisionReason: 'Diagnostic permission callback',
            },
          }),
        ],
      },
    ],
  },
  canUseTool: async (name: string, input: Record<string, unknown>) => {
    if (name === 'AskUserQuestion') {
      observations.question = true;
      const questions = input.questions as { question: string }[];
      return {
        behavior: 'allow' as const,
        updatedInput: {
          ...input,
          answers: Object.fromEntries(questions.map((q) => [q.question, 'Yes'])),
        },
      };
    }
    observations.permission = true;
    return { behavior: 'allow' as const, updatedInput: input };
  },
};
try {
  const first = query({
    prompt:
      'Use the ai-native-probe:probe skill explicitly with Skill, follow its instructions exactly. This is a diagnostic; make no file edits. Finish in one short sentence.',
    options,
  });
  for await (const message of first) {
    if ('session_id' in message && message.session_id) sessionId = message.session_id;
    if (message.type === 'system' && message.subtype === 'init')
      observations.loadedSkills = message.skills;
    if (message.type === 'assistant') {
      for (const block of message.message.content)
        if (block.type === 'tool_use' && block.name === 'Skill') observations.skill = true;
    }
    if (message.type === 'result') {
      observations.firstResult = message.subtype;
      if (message.subtype !== 'success') throw new Error(JSON.stringify(message));
      if (message.is_error) throw new Error(message.result);
    }
  }
  if (!sessionId) throw new Error('Claude did not return a session ID');
  const second = query({
    prompt: 'Read the current directory using a tool, then explain the verification marker.',
    options: { ...options, resume: sessionId },
  });
  let interrupted = false;
  for await (const message of second) {
    if (!interrupted && message.type === 'assistant') {
      interrupted = true;
      await second.interrupt();
      observations.interrupt = true;
    }
  }
  const third = query({
    prompt:
      'What verification marker did we use earlier? Reply with only that marker. Do not call tools.',
    options: { ...options, resume: sessionId },
  });
  for await (const message of third)
    if (message.type === 'result' && message.subtype === 'success')
      observations.resume = message.result.includes('WORKFLOW_SKILL_OK');
} catch (error) {
  observations.error = String(error);
} finally {
  clearTimeout(timer);
  await writeFile(join(root, 'result.json'), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify(observations, null, 2));
}
if (
  ['permission', 'question', 'mcp', 'skill', 'resume', 'interrupt'].some(
    (key) => !observations[key],
  )
)
  process.exitCode = 1;
