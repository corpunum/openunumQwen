/**
 * Test Runner
 * Simple, no-framework test suite
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log('🧪 Running tests...\n');

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (e) {
      console.error(`❌ ${name}`);
      console.error(`   ${e.message}`);
      failed++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  process.exit(failed > 0 ? 1 : 0);
}

// Test: Config loading
test('Config loads without errors', async () => {
  const { loadConfig } = await import('../src/core/config.js');
  const config = loadConfig();
  if (!config.provider) throw new Error('Provider not set');
  if (!config.model) throw new Error('Model not set');
});

// Test: Config validation rejects invalid values
test('Config validation works', async () => {
  const { updateConfig } = await import('../src/core/config.js');
  try {
    updateConfig({ uiPort: 999999 }); // Invalid port
    throw new Error('Should have thrown');
  } catch (e) {
    if (!e.message.includes('Invalid')) throw e;
  }
});

// Test: Circuit breaker state transitions
test('Circuit breaker opens after failures', async () => {
  const { CircuitBreaker } = await import('../src/health/circuit-breaker.js');
  const cb = new CircuitBreaker({ failureThreshold: 3 });
  
  cb.recordFailure('test_tool');
  cb.recordFailure('test_tool');
  cb.recordFailure('test_tool');
  
  if (cb.canExecute('test_tool')) {
    throw new Error('Circuit should be open');
  }
});

// Test: Circuit breaker half-open after timeout
test('Circuit breaker enters half-open state', async () => {
  const { CircuitBreaker } = await import('../src/health/circuit-breaker.js');
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 100 });
  
  cb.recordFailure('test_tool2');
  
  // Wait for reset timeout
  await new Promise(r => setTimeout(r, 150));
  
  if (!cb.canExecute('test_tool2')) {
    throw new Error('Circuit should be half-open');
  }
});

// Test: BM25 indexing and search
test('BM25 indexes and searches correctly', async () => {
  const { MemoryManager } = await import('../src/memory/memory.js');
  const mem = new MemoryManager({ 
    dbPath: ':memory:',
    bm25IndexPath: '/tmp/test_bm25.json'
  });
  
  await mem.initialize();
  mem.store('test1', 'The quick brown fox jumps over the lazy dog');
  mem.store('test2', 'A quick brown dog runs in the park');
  
  const results = mem.search('quick fox');
  if (results.length === 0) throw new Error('No results found');
  if (results[0].id !== 'test1') throw new Error('Wrong result order');
  
  mem.close();
});

// Test: File tool safe path validation
test('File tool blocks paths outside workspace', async () => {
  const { FileTool } = await import('../src/tools/file.js');
  try {
    FileTool.read({ path: '/etc/passwd' }, {});
    throw new Error('Should have blocked');
  } catch (e) {
    if (!e.message.includes('outside workspace')) throw e;
  }
});

// Test: Shell tool blocks dangerous commands
test('Shell tool blocks dangerous commands', async () => {
  const { ShellTool } = await import('../src/tools/shell.js');
  try {
    await ShellTool.exec({ command: 'rm -rf //' }, {});
    throw new Error('Should have blocked');
  } catch (e) {
    if (!e.message.includes('Blocked')) throw e;
  }
});

// Test: Git status works
test('Git status returns valid output', async () => {
  const { GitTool } = await import('../src/tools/git.js');
  const status = await GitTool.status({}, {});
  if (status.success !== true) throw new Error('Git status failed');
  if (typeof status.branch !== 'string') throw new Error('Branch not returned');
});

// Test: Skills tool structure
test('Skills tool has required methods', async () => {
  const { SkillTool } = await import('../src/tools/skills.js');
  const required = ['install', 'list', 'approve', 'execute', 'uninstall', 'reviewCode'];
  for (const method of required) {
    if (typeof SkillTool[method] !== 'function') {
      throw new Error(`Missing method: ${method}`);
    }
  }
});

// Test: Email tool structure
test('Email tool has required methods', async () => {
  const { EmailTool } = await import('../src/tools/email.js');
  const required = ['send', 'sendHtml', 'list', 'read', 'checkStatus'];
  for (const method of required) {
    if (typeof EmailTool[method] !== 'function') {
      throw new Error(`Missing method: ${method}`);
    }
  }
});

// Run all tests
runTests();
