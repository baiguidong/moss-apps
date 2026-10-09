import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const resolveMossHome = () => process.env.MOSS_HOME || path.join(os.homedir(), '.moss');

const MAX_TEXT_LENGTH = 16_000;

export const AUDIT_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);

export const DEFAULT_LOCAL_AUDIT_RULES = Object.freeze([
  {
    id: 'destructive-command',
    version: 2,
    name: '高危命令',
    description: '检查删除、覆盖磁盘、管道执行脚本及破坏性 Git 命令。',
    severity: 'high',
    enabled: true,
    config: {
      patterns: [
        '\\brm\\s+-[^\\n]*r[^\\n]*f',
        '(?:^|[;&|]\\s*|\\n\\s*)(?:sudo\\s+)?(?:[^\\s;&|]+[/\\\\])?(?:mkfs(?:\\.[\\w-]+)?|fdisk|diskpart|format)(?=\\s|$)',
        '\\bdd\\s+[^\\n]*\\bof=',
        '\\b(?:curl|wget)\\b[^\\n|]*\\|\\s*(?:sh|bash|zsh|powershell)\\b',
        '\\bgit\\s+(?:reset\\s+--hard|clean\\s+-[^\\n]*f)',
        '\\b(?:shutdown|reboot)\\b',
      ],
    },
  },
  {
    id: 'sensitive-file-access',
    version: 2,
    name: '敏感文件访问',
    description: '检查工具输入中是否访问密钥、凭据、环境变量或 SSH 文件。',
    severity: 'high',
    enabled: true,
    config: {
      patterns: [
        '(^|[/\\\\])\\.env$',
        '(^|[/\\\\])\\.env\\.(?!(?:example|sample|template|dist)$)[^/\\\\]+$',
        '(^|[/\\\\])\\.ssh([/\\\\]|$)',
        '(^|[/\\\\])id_(?:rsa|ed25519)$',
        '(^|[/\\\\])credentials?(?:\\.json)?$',
        '(^|[/\\\\])service[_-]?account(?:\\.json)?$',
        '(^|[/\\\\])(?:login\\.)?keychain(?:-db)?$',
      ],
    },
  },
  {
    id: 'outside-workspace-write',
    version: 3,
    name: '工作区外写入',
    description: '检查写入、编辑或删除工具是否操作当前会话工作区和允许路径之外的绝对路径。',
    severity: 'high',
    enabled: true,
    config: { allowedPaths: ['${MOSS_HOME}/memory', '${MOSS_HOME}/plans'] },
  },
  {
    id: 'failed-tool-call',
    version: 2,
    name: '工具执行失败',
    description: '记录工具执行错误，便于发现失效连接器、权限和环境问题。',
    severity: 'medium',
    enabled: true,
    config: { minimumFailures: 3 },
  },
  {
    id: 'permission-denial',
    version: 2,
    name: '权限拒绝',
    description: '记录会话结果中保留的工具权限拒绝。',
    severity: 'medium',
    enabled: true,
    config: {},
  },
  {
    id: 'network-access',
    name: '网络访问',
    description: '检查浏览器、Web 工具及命令行网络访问。默认关闭，可按需启用。',
    severity: 'low',
    enabled: false,
    config: {},
  },
  {
    id: 'mcp-tool-call',
    name: 'MCP 工具调用',
    description: '记录 MCP 或连接器工具调用。默认关闭，可用于严格审计环境。',
    severity: 'low',
    enabled: false,
    config: {},
  },
]);

function toTimestamp(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function stringifyAuditValue(value) {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT_LENGTH);
  if (value == null) return '';
  try {
    return JSON.stringify(value).slice(0, MAX_TEXT_LENGTH);
  } catch {
    return String(value).slice(0, MAX_TEXT_LENGTH);
  }
}

function contentBlocks(entry) {
  const candidates = [entry?.message?.content, entry?.content];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function toolNameFromBlock(block) {
  return String(block?.name || block?.tool_name || block?.toolName || 'Tool').trim() || 'Tool';
}

function ensureTool(toolsById, orderedTools, session, block, index, timestamp) {
  const explicitId = String(block?.id || block?.tool_use_id || block?.toolUseId || '').trim();
  const toolUseId = explicitId || `generated-${index}`;
  const existing = toolsById.get(toolUseId);
  if (existing) {
    if (Object.prototype.hasOwnProperty.call(block || {}, 'input')) existing.input = block.input;
    return existing;
  }
  const tool = {
    id: `${session.id}:${toolUseId}`,
    sessionId: session.id,
    toolUseId,
    parentToolUseId: typeof block?.parent_tool_use_id === 'string' ? block.parent_tool_use_id : null,
    toolName: toolNameFromBlock(block),
    input: block?.input ?? {},
    result: '',
    isError: false,
    status: 'unknown',
    startedAt: timestamp,
    completedAt: null,
    orderIndex: index,
  };
  toolsById.set(toolUseId, tool);
  orderedTools.push(tool);
  return tool;
}

function permissionDenialsFromEntry(entry) {
  const candidates = [entry?.permission_denials, entry?.permissionDenials, entry?.result?.permission_denials];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function normalizeLocalAuditSession(session) {
  const history = Array.isArray(session?.history) ? session.history : [];
  const toolsById = new Map();
  const orderedTools = [];
  const inputFragments = new Map();
  const streamToolIds = new Map();
  const permissionDenials = [];
  const fallbackTimestamp = Number(session?.createdAt) || Date.now();

  history.forEach((entry, index) => {
    const timestamp = toTimestamp(entry?.timestamp, fallbackTimestamp + index);
    permissionDenials.push(...permissionDenialsFromEntry(entry));

    if ((entry?.type === 'bash' || entry?.type === 'bash_command') && typeof entry.command === 'string') {
      const block = {
        id: entry.id || `bash-${index}`,
        name: 'Bash',
        input: { command: entry.command },
      };
      const tool = ensureTool(toolsById, orderedTools, session, block, index, timestamp);
      tool.result = stringifyAuditValue(entry.output);
      tool.isError = Number(entry.exitCode) !== 0;
      tool.status = tool.isError ? 'error' : 'success';
      tool.completedAt = timestamp;
    }

    for (const block of contentBlocks(entry)) {
      if (block?.type === 'tool_use') {
        ensureTool(toolsById, orderedTools, session, block, index, timestamp);
      } else if (block?.type === 'tool_result') {
        const toolUseId = String(block?.tool_use_id || '').trim();
        const tool = toolUseId
          ? toolsById.get(toolUseId) || ensureTool(
              toolsById,
              orderedTools,
              session,
              { id: toolUseId, name: block?.tool_name || 'Tool' },
              index,
              timestamp,
            )
          : null;
        if (tool) {
          tool.result = stringifyAuditValue(entry?.tool_use_result ?? block?.content);
          tool.isError = Boolean(block?.is_error);
          tool.status = tool.isError ? 'error' : 'success';
          tool.completedAt = timestamp;
        }
      }
    }

    const streamEvent = entry?.type === 'stream_event' ? entry.event : null;
    if (streamEvent?.type === 'content_block_start' && streamEvent.content_block?.type === 'tool_use') {
      const tool = ensureTool(toolsById, orderedTools, session, streamEvent.content_block, index, timestamp);
      streamToolIds.set(String(streamEvent.index ?? ''), tool.toolUseId);
    }
    if (streamEvent?.type === 'content_block_delta' && streamEvent.delta?.type === 'input_json_delta') {
      const blockIndex = String(streamEvent.index ?? '');
      inputFragments.set(blockIndex, `${inputFragments.get(blockIndex) || ''}${streamEvent.delta.partial_json || ''}`);
    }
  });

  for (const [blockIndex, fragment] of inputFragments) {
    const tool = toolsById.get(streamToolIds.get(blockIndex));
    if (!tool || (tool.input && typeof tool.input === 'object' && Object.keys(tool.input).length > 0)) continue;
    try {
      tool.input = JSON.parse(fragment);
    } catch {
      tool.input = { raw: fragment };
    }
  }

  const incompleteToolCount = orderedTools.filter((tool) => tool.status === 'unknown').length;
  return {
    eventCount: history.length,
    tools: orderedTools.sort((left, right) => left.orderIndex - right.orderIndex),
    permissionDenials,
    completeness: incompleteToolCount > 0 ? 'partial' : 'complete',
    incompleteToolCount,
  };
}

function safePatterns(config) {
  const patterns = Array.isArray(config?.patterns) ? config.patterns : [];
  return patterns.flatMap((pattern) => {
    try {
      return [new RegExp(String(pattern), 'i')];
    } catch {
      return [];
    }
  });
}

function commandFromTool(tool) {
  const input = tool?.input;
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  return String(input.command || input.cmd || input.script || '');
}

function pathFromTool(tool) {
  const input = tool?.input;
  if (!input || typeof input !== 'object') return '';
  return String(input.file_path || input.filePath || input.path || input.target || '');
}

function isShellTool(toolName) {
  return /bash|shell|powershell|command/i.test(toolName);
}

function isWriteTool(toolName) {
  return /write|edit|patch|delete|remove|move|rename|notebookedit/i.test(toolName);
}

function isFileTool(toolName) {
  return /read|write|edit|patch|glob|grep|delete|remove|move|rename/i.test(toolName);
}

function isInsideWorkspace(workspace, candidate) {
  if (!workspace || !candidate || !path.isAbsolute(candidate)) return true;
  const root = path.resolve(workspace);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function expandAuditPath(value, mossHome = resolveMossHome()) {
  const expanded = String(value || '')
    .replace(/^\$\{MOSS_HOME\}(?=$|[/\\])/, mossHome)
    .replace(/^\$MOSS_HOME(?=$|[/\\])/, mossHome)
    .replace(/^~(?=$|[/\\])/, os.homedir());
  return path.isAbsolute(expanded) ? path.resolve(expanded) : '';
}

function isAllowedOutsideWrite(candidate, session, config) {
  if (!candidate || !path.isAbsolute(candidate)) return false;
  const resolved = path.resolve(candidate);
  const allowedPaths = [
    ...(Array.isArray(config?.allowedPaths) ? config.allowedPaths : []),
    ...(Array.isArray(session?.allowedWritePaths) ? session.allowedWritePaths : []),
  ];
  return allowedPaths.some((entry) => {
    const allowedRoot = expandAuditPath(entry, session.mossHome);
    return allowedRoot && (resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`));
  });
}

function findingFingerprint(ruleId, sessionId, toolCallId, discriminator) {
  return createHash('sha256')
    .update([ruleId, sessionId, toolCallId || '', discriminator || ''].join('\0'))
    .digest('hex');
}

function buildFinding(rule, session, tool, title, detail, evidence, discriminator = '') {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version || 1,
    sessionId: session.id,
    toolCallId: tool?.id || null,
    severity: rule.severity,
    title,
    detail,
    evidence,
    fingerprint: findingFingerprint(rule.id, session.id, tool?.id, discriminator || detail),
  };
}

export function evaluateLocalAuditSession(session, normalized, rules) {
  const findings = [];
  for (const rule of rules.filter((entry) => entry.enabled)) {
    if (rule.id === 'destructive-command') {
      const patterns = safePatterns(rule.config);
      for (const tool of normalized.tools.filter((entry) => isShellTool(entry.toolName))) {
        const command = commandFromTool(tool);
        const matched = patterns.find((pattern) => pattern.test(command));
        if (!matched) continue;
        findings.push(buildFinding(
          rule,
          session,
          tool,
          '检测到高危命令',
          command.slice(0, 1_000),
          { command, matchedPattern: matched.source },
          matched.source,
        ));
      }
    } else if (rule.id === 'sensitive-file-access') {
      const patterns = safePatterns(rule.config);
      for (const tool of normalized.tools.filter((entry) => isFileTool(entry.toolName))) {
        const targetPath = pathFromTool(tool);
        if (!targetPath) continue;
        const matched = patterns.find((pattern) => pattern.test(targetPath));
        if (!matched) continue;
        findings.push(buildFinding(
          rule,
          session,
          tool,
          '检测到敏感文件访问',
          targetPath,
          { input: tool.input, matchedPattern: matched.source },
          matched.source,
        ));
      }
    } else if (rule.id === 'outside-workspace-write') {
      for (const tool of normalized.tools.filter((entry) => isWriteTool(entry.toolName))) {
        const targetPath = pathFromTool(tool);
        if (
          !targetPath
          || isInsideWorkspace(session.workspace, targetPath)
          || isAllowedOutsideWrite(targetPath, session, rule.config)
        ) continue;
        findings.push(buildFinding(
          rule,
          session,
          tool,
          '检测到工作区外写入',
          targetPath,
          { workspace: session.workspace, targetPath },
          targetPath,
        ));
      }
    } else if (rule.id === 'failed-tool-call') {
      const deniedToolUseIds = new Set(normalized.permissionDenials.map((denial) => (
        String(denial?.tool_use_id || denial?.toolUseId || '').trim()
      )).filter(Boolean));
      const failedTools = normalized.tools.filter((entry) => (
        entry.isError
        && !deniedToolUseIds.has(entry.toolUseId)
        && !/(?:denied by user|interrupted by user|request interrupted|cancelled:)/i.test(entry.result || '')
      ));
      const minimumFailures = Math.max(1, Number(rule.config?.minimumFailures) || 1);
      if (failedTools.length < minimumFailures) continue;
      const failureSummary = failedTools.slice(0, 10).map((tool) => ({
        toolUseId: tool.toolUseId,
        toolName: tool.toolName,
        result: tool.result,
      }));
      findings.push(buildFinding(
        rule,
        session,
        failedTools[0],
        `本会话有 ${failedTools.length} 次工具执行失败`,
        failureSummary
          .slice(0, 5)
          .map((failure) => `${failure.toolName}: ${failure.result || '未返回错误详情'}`)
          .join('\n')
          .slice(0, 1_500),
        { failureCount: failedTools.length, failures: failureSummary },
        failedTools.map((tool) => tool.toolUseId).sort().join(':'),
      ));
    } else if (rule.id === 'permission-denial') {
      if (normalized.permissionDenials.length === 0) continue;
      const denials = normalized.permissionDenials.slice(0, 20);
      const firstDeniedToolUseId = String(denials[0]?.tool_use_id || denials[0]?.toolUseId || '').trim();
      const firstDeniedTool = normalized.tools.find((tool) => tool.toolUseId === firstDeniedToolUseId) || null;
      findings.push(buildFinding(
        rule,
        session,
        firstDeniedTool,
        `本会话有 ${normalized.permissionDenials.length} 次工具权限被拒绝`,
        denials
          .slice(0, 5)
          .map((denial) => String(denial?.message || denial?.reason || denial?.tool_name || '用户或策略拒绝了工具调用'))
          .join('\n'),
        { denialCount: normalized.permissionDenials.length, denials },
        denials
          .map((denial, index) => String(denial?.tool_use_id || denial?.toolUseId || index))
          .sort()
          .join(':'),
      ));
    } else if (rule.id === 'network-access') {
      for (const tool of normalized.tools) {
        const command = commandFromTool(tool);
        if (!/web|fetch|browser/i.test(tool.toolName) && !(isShellTool(tool.toolName) && /\b(?:curl|wget|ssh|scp)\b/i.test(command))) continue;
        findings.push(buildFinding(
          rule,
          session,
          tool,
          '检测到网络访问',
          command || stringifyAuditValue(tool.input).slice(0, 1_000),
          { toolName: tool.toolName, input: tool.input },
          tool.toolUseId,
        ));
      }
    } else if (rule.id === 'mcp-tool-call') {
      for (const tool of normalized.tools.filter((entry) => /(?:^|__)mcp(?:__|$)|mcp__/i.test(entry.toolName))) {
        findings.push(buildFinding(
          rule,
          session,
          tool,
          '检测到 MCP 工具调用',
          tool.toolName,
          { toolName: tool.toolName, input: tool.input },
          tool.toolUseId,
        ));
      }
    }
  }
  return findings;
}

export function validateAuditRuleConfig(ruleId, config) {
  const normalized = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  if (ruleId === 'destructive-command' || ruleId === 'sensitive-file-access') {
    const patterns = Array.isArray(normalized.patterns)
      ? normalized.patterns.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 100)
      : [];
    for (const pattern of patterns) new RegExp(pattern, 'i');
    return { patterns };
  }
  if (ruleId === 'failed-tool-call') {
    return { minimumFailures: Math.max(1, Math.min(100, Number(normalized.minimumFailures) || 1)) };
  }
  if (ruleId === 'outside-workspace-write') {
    const allowedPaths = Array.isArray(normalized.allowedPaths)
      ? normalized.allowedPaths.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 100)
      : [];
    return { allowedPaths };
  }
  return {};
}
