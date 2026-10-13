// Independent, read-only checks of the data retained by real model demo cases.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

export async function verifyDemoEvidence(run) {
  const selected = ['workflow-demo', 'agent-team-demo'].filter(id => run.cases.some(test => test.id === id));
  if (!selected.length) return {};
  const files = (await Promise.all(['sessions', 'workspaces', 'apps-data'].map(directory => filesBelow(path.join(run.home, directory))))).flat();
  const verified = {};
  for (const id of selected) {
    if (run.results[id].status !== 'passed') { verified[id] = { verified: false, status: run.results[id].status }; continue; }
    const artifactName = id === 'workflow-demo' ? 'workflow-demo-report.md' : 'team-demo-report.md';
    const artifacts = [];
    for (const file of files.filter(file => path.basename(file) === artifactName)) {
      if ((await stat(file)).mtimeMs < run.startedAt) continue;
      const text = await readFile(file, 'utf8');
      if (/\b580\b/.test(text)) artifacts.push(file);
    }
    assert.ok(artifacts.length, `${id}: missing current-run report containing total 580`);
    if (id === 'workflow-demo') {
      const runs = [];
      for (const file of files.filter(file => /^run_[a-f0-9-]+\.json$/.test(path.basename(file)))) {
        const data = JSON.parse(await readFile(file, 'utf8'));
        if (data.startedAt < run.startedAt || data.status !== 'completed') continue;
        const agents = (data.events || []).filter(event => event.type === 'workflow_agent' && event.state === 'done' && !event.cached && !event.skipped && !event.error);
        if (new Set(agents.map(event => event.nodeId)).size < 2) continue;
        assert.ok(agents.every(event => event.agentId), 'Workflow nodes must have real execution context IDs');
        assert.ok(/\b580\b/.test(JSON.stringify(data.stateSnapshot?.values)), 'Expected total in actual workflow node output');
        runs.push({ file, runId: data.id, nodes: agents.map(({ nodeId, agentId, tokens }) => ({ nodeId, agentId, tokens })) });
      }
      assert.ok(runs.length, 'Missing completed workflow with two real Agent nodes');
      verified[id] = { verified: true, artifacts, runs };
    } else {
      const teams = [];
      for (const file of files.filter(file => file.includes(`${path.sep}agent-teams${path.sep}`) && file.endsWith('.json') && path.basename(file) !== 'index.json')) {
        const data = JSON.parse(await readFile(file, 'utf8'));
        if (data.createdAt < run.startedAt || !data.snapshots?.length) continue;
        const snapshots = data.snapshots;
        const members = new Map(snapshots.flatMap(snapshot => snapshot.team?.members || []).map(member => [member.name, member]));
        const tasks = new Map(snapshots.flatMap(snapshot => snapshot.tasks || []).map(task => [task.id, task]));
        const messages = snapshots.flatMap(snapshot => snapshot.messages || []);
        const owners = new Set([...tasks.values()].filter(task => task.status === 'completed').map(task => task.owner).filter(Boolean));
        const workers = [...owners].filter(owner => members.has(owner) && messages.some(message => message.from === owner && /\b580\b/.test(message.text)));
        if (workers.length < 2) continue;
        teams.push({ file, teamName: data.teamName, workers, completedTasks: [...tasks.values()].filter(task => task.status === 'completed').map(({ id, owner }) => ({ id, owner })) });
      }
      assert.ok(teams.length, 'Missing archived team with two completed member tasks and actual result messages');
      verified[id] = { verified: true, artifacts, teams };
    }
  }
  return verified;
}


export async function verifyRunEvidence(run) {
  const demos = await verifyDemoEvidence(run)
  const expectedReplies = []
  if (run.cases.some(test => test.id === 'session-switch')) expectedReplies.push('MOSS_SESSION_A_OK', 'MOSS_SESSION_B_OK')
  if (run.cases.some(test => test.id === 'chat-response')) expectedReplies.push('MOSS_SELF_TEST_OK')
  const conversations = []
  if (expectedReplies.length) {
    const sessions = await readdir(path.join(run.home, 'sessions'), { withFileTypes: true })
    for (const entry of sessions.filter(entry => entry.isDirectory())) {
      const directory = path.join(run.home, 'sessions', entry.name)
      const session = JSON.parse(await readFile(path.join(directory, 'session.json'), 'utf8'))
      if (!session.underlyingSessionId) continue
      const text = await readFile(path.join(directory, 'runtime/engine', `${session.underlyingSessionId}.jsonl`), 'utf8')
      const messages = text.trim().split('\n').map(line => JSON.parse(line)).filter(row => ['user', 'assistant'].includes(row.type))
        .map(row => ({ role: row.type, text: typeof row.message?.content === 'string' ? row.message.content :
          (row.message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n') }))
      conversations.push({ id: entry.name, messages })
    }
  }
  const replies = expectedReplies.map(token => {
    const conversation = conversations.find(item => item.messages.some(message => message.role === 'assistant' && message.text.includes(token)))
    assert.ok(conversation, `Missing actual persisted assistant reply: ${token}`)
    assert.ok(conversation.messages.some(message => message.role === 'user' && message.text.includes(token)))
    return { token, sessionId: conversation.id }
  })
  assert.equal(new Set(replies.map(reply => reply.sessionId)).size, expectedReplies.length, 'Replies must belong to separate conversations')
  return { demos, replies }
}
