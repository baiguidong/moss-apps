import { describe, expect, it } from 'bun:test';
import os from 'node:os';
import {
  DEFAULT_LOCAL_AUDIT_RULES,
  evaluateLocalAuditSession,
  normalizeLocalAuditSession,
  validateAuditRuleConfig,
} from '../src/backend/engine.mjs';

function rules() {
  return DEFAULT_LOCAL_AUDIT_RULES.map((rule) => ({ ...rule, version: 1 }));
}

describe('local audit engine', () => {
  it('normalizes canonical tool calls and detects built-in risks', () => {
    const session = {
      id: 'session-1',
      workspace: '/work/project',
      history: [
        {
          type: 'assistant',
          timestamp: 100,
          message: {
            content: [
              { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'rm -rf ./build' } },
              { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/work/project/.env' } },
              { type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: '/tmp/out.txt' } },
            ],
          },
        },
        {
          type: 'user',
          timestamp: 200,
          permission_denials: [{ tool_use_id: 'write-1', reason: 'not allowed' }],
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'bash-1', is_error: true, content: 'failed' },
              { type: 'tool_result', tool_use_id: 'read-1', content: 'SECRET=hidden' },
              { type: 'tool_result', tool_use_id: 'write-1', content: 'ok' },
            ],
          },
        },
      ],
    };

    const normalized = normalizeLocalAuditSession(session);
    const findings = evaluateLocalAuditSession(session, normalized, rules());

    expect(normalized.tools).toHaveLength(3);
    expect(normalized.tools.find((tool) => tool.toolUseId === 'bash-1')?.status).toBe('error');
    expect(normalized.completeness).toBe('complete');
    expect(new Set(findings.map((finding) => finding.ruleId))).toEqual(new Set([
      'destructive-command',
      'sensitive-file-access',
      'outside-workspace-write',
      'permission-denial',
    ]));
  });

  it('does not treat format options as disk formatting commands', () => {
    const session = { id: 'commands', workspace: '/work/project' };
    const destructiveRule = rules().find((rule) => rule.id === 'destructive-command')!;
    const normalized = {
      tools: [
        { id: 'commands:git', toolUseId: 'git', toolName: 'Bash', input: { command: "git log --pretty=format:'%h %s'" } },
        { id: 'commands:json', toolUseId: 'json', toolName: 'Bash', input: { command: 'tool status --format json' } },
        { id: 'commands:mkfs', toolUseId: 'mkfs', toolName: 'Bash', input: { command: 'sudo /sbin/mkfs.ext4 /dev/test' } },
      ],
      permissionDenials: [],
    };

    const findings = evaluateLocalAuditSession(session, normalized, [destructiveRule]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.toolCallId).toBe('commands:mkfs');
  });

  it('matches sensitive target paths without matching search text or templates', () => {
    const session = { id: 'sensitive-paths', workspace: '/work/project' };
    const sensitiveRule = rules().find((rule) => rule.id === 'sensitive-file-access')!;
    const normalized = {
      tools: [
        { id: 'safe-doc', toolUseId: 'safe-doc', toolName: 'Read', input: { file_path: '/docs/environment-and-credentials.md' } },
        { id: 'safe-grep', toolUseId: 'safe-grep', toolName: 'Grep', input: { path: '/work/project/code.ts', pattern: 'saveCredentials' } },
        { id: 'safe-template', toolUseId: 'safe-template', toolName: 'Write', input: { file_path: '/work/project/.env.example' } },
        { id: 'secret-env', toolUseId: 'secret-env', toolName: 'Read', input: { file_path: '/work/project/.env.local' } },
        { id: 'secret-creds', toolUseId: 'secret-creds', toolName: 'Read', input: { file_path: '/home/user/.aws/credentials' } },
      ],
      permissionDenials: [],
    };

    const findings = evaluateLocalAuditSession(session, normalized, [sensitiveRule]);
    expect(findings.map((finding) => finding.toolCallId)).toEqual(['secret-env', 'secret-creds']);
  });

  it('routes interleaved streaming input fragments by content block index', () => {
    const session = {
      id: 'stream-session',
      workspace: '/work/project',
      history: [
        { type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'a', name: 'Read', input: {} } } },
        { type: 'stream_event', event: { type: 'content_block_start', index: 4, content_block: { type: 'tool_use', id: 'b', name: 'Bash', input: {} } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 4, delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/work/project/a.txt"}' } } },
      ],
    };

    const normalized = normalizeLocalAuditSession(session);
    expect(normalized.tools.find((tool) => tool.toolUseId === 'a')?.input).toEqual({ file_path: '/work/project/a.txt' });
    expect(normalized.tools.find((tool) => tool.toolUseId === 'b')?.input).toEqual({ command: 'pwd' });
  });

  it('supports bash command history and failure thresholds', () => {
    const session = {
      id: 'bash-session',
      workspace: '/work/project',
      history: [{ type: 'bash_command', command: 'exit 1', output: 'no', exitCode: 1 }],
    };
    const normalized = normalizeLocalAuditSession(session);
    const failureRule = {
      ...rules().find((rule) => rule.id === 'failed-tool-call')!,
      config: { minimumFailures: 2 },
    };

    expect(normalized.tools[0]?.status).toBe('error');
    expect(evaluateLocalAuditSession(session, normalized, [failureRule])).toHaveLength(0);
  });

  it('aggregates repeated failures and excludes denials and cancellations', () => {
    const session = { id: 'failures', workspace: '/work/project' };
    const failedToolRule = rules().find((rule) => rule.id === 'failed-tool-call')!;
    const permissionRule = rules().find((rule) => rule.id === 'permission-denial')!;
    const normalized = {
      tools: [
        { id: 'failures:a', toolUseId: 'a', toolName: 'Read', result: 'missing', isError: true },
        { id: 'failures:b', toolUseId: 'b', toolName: 'Grep', result: 'bad input', isError: true },
        { id: 'failures:c', toolUseId: 'c', toolName: 'Bash', result: 'exit 1', isError: true },
        { id: 'failures:d', toolUseId: 'd', toolName: 'Write', result: 'Denied by user', isError: true },
        { id: 'failures:e', toolUseId: 'e', toolName: 'Bash', result: 'Cancelled: sibling failed', isError: true },
      ],
      permissionDenials: [{ tool_use_id: 'd', reason: 'not allowed' }],
    };

    const findings = evaluateLocalAuditSession(session, normalized, [failedToolRule, permissionRule]);
    expect(findings).toHaveLength(2);
    expect(findings.find((finding) => finding.ruleId === 'failed-tool-call')?.evidence.failureCount).toBe(3);
    expect(findings.find((finding) => finding.ruleId === 'permission-denial')?.evidence.denialCount).toBe(1);
  });

  it('allows managed global memory writes without trusting the rest of Moss home', () => {
    const previousMossHome = process.env.MOSS_HOME;
    process.env.MOSS_HOME = '/Users/test/.moss';
    try {
      const session = {
        id: 'memory-session',
        workspace: '/work/project',
        history: [{
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'memory-write', name: 'Write', input: { file_path: '/Users/test/.moss/memory/project_note.md' } },
              { type: 'tool_use', id: 'skill-write', name: 'Edit', input: { file_path: '/Users/test/.moss/skills/research-notes/scripts/index.py' } },
            ],
          },
        }],
      };
      const normalized = normalizeLocalAuditSession(session);
      const outsideWriteRule = rules().find((rule) => rule.id === 'outside-workspace-write')!;
      const findings = evaluateLocalAuditSession(session, normalized, [outsideWriteRule]);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.detail).toBe('/Users/test/.moss/skills/research-notes/scripts/index.py');
    } finally {
      if (previousMossHome === undefined) delete process.env.MOSS_HOME;
      else process.env.MOSS_HOME = previousMossHome;
    }
  });

  it('allows runtime and explicitly authorized write roots', () => {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
    const runtimeTempDir = `/private/tmp/claude-${uid}`;
    const session = {
      id: 'managed-writes',
      workspace: '/work/child',
      allowedWritePaths: ['/work/parent', runtimeTempDir],
    };
    const normalized = {
      tools: [
        { id: 'parent', toolUseId: 'parent', toolName: 'Write', input: { file_path: '/work/parent/outputs/report.md' } },
        { id: 'plan', toolUseId: 'plan', toolName: 'Write', input: { file_path: `${process.env.MOSS_HOME || `${os.homedir()}/.moss`}/plans/task.md` } },
        { id: 'temp', toolUseId: 'temp', toolName: 'Write', input: { file_path: `${runtimeTempDir}/artifact.md` } },
        { id: 'global', toolUseId: 'global', toolName: 'Write', input: { file_path: '/work/unrelated/file.md' } },
      ],
      permissionDenials: [],
    };
    const outsideWriteRule = rules().find((rule) => rule.id === 'outside-workspace-write')!;

    const findings = evaluateLocalAuditSession(session, normalized, [outsideWriteRule]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toBe('/work/unrelated/file.md');
  });

  it('allows current engine session auxiliaries but still catches a sibling session id', () => {
    const currentEngineSessionDir = '/moss/sessions/desktop-a/runtime/engine/engine-a';
    const session = {
      id: 'desktop-a',
      workspace: '/moss/sessions/desktop-a/workspace',
      allowedWritePaths: [
        `${currentEngineSessionDir}/session-memory`,
        `${currentEngineSessionDir}/plans`,
      ],
    };
    const normalized = {
      tools: [
        { id: 'memory', toolUseId: 'memory', toolName: 'Write', input: { file_path: `${currentEngineSessionDir}/session-memory/summary.md` } },
        { id: 'plan', toolUseId: 'plan', toolName: 'Write', input: { file_path: `${currentEngineSessionDir}/plans/task.md` } },
        { id: 'wrong-session', toolUseId: 'wrong-session', toolName: 'Write', input: { file_path: '/moss/sessions/desktop-b/runtime/engine/engine-a/session-memory/summary.md' } },
        { id: 'transcript', toolUseId: 'transcript', toolName: 'Write', input: { file_path: `${currentEngineSessionDir}.jsonl` } },
      ],
      permissionDenials: [],
    };
    const outsideWriteRule = rules().find((rule) => rule.id === 'outside-workspace-write')!;

    const findings = evaluateLocalAuditSession(session, normalized, [outsideWriteRule]);
    expect(findings.map((finding) => finding.toolCallId)).toEqual(['wrong-session', 'transcript']);
  });

  it('rejects invalid regular expressions', () => {
    expect(() => validateAuditRuleConfig('destructive-command', { patterns: ['['] })).toThrow();
  });

  it('normalizes allowed paths for the outside workspace write rule', () => {
    expect(validateAuditRuleConfig('outside-workspace-write', {
      allowedPaths: [' ${MOSS_HOME}/memory ', '', '/shared/audit-safe'],
    })).toEqual({ allowedPaths: ['${MOSS_HOME}/memory', '/shared/audit-safe'] });
  });
});
