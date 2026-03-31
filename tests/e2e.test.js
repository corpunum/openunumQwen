/**
 * E2E Test Suite
 * Tests all major features end-to-end
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const execAsync = promisify(exec);

const TEST_DIR = join(process.cwd(), 'test-e2e-temp');
const DOCS_DIR = join(process.cwd(), 'docs');

let testResults = [];
let currentTest = '';

function log(message) {
  console.log(`[E2E] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function cleanup() {
  try {
    if (existsSync(TEST_DIR)) {
      await execAsync(`rm -rf ${TEST_DIR}`);
    }
    const testFiles = ['e2e-test-file.md', 'e2e-skill-test.js'];
    for (const file of testFiles) {
      const path = join(DOCS_DIR, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}

async function runAgentTask(task, timeoutMs = 60000) {
  const { default: fetch } = await import('node-fetch');
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('http://127.0.0.1:18881/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function testFileOperations() {
  currentTest = 'File Operations';
  log(`Starting: ${currentTest}`);

  const testFile = join(DOCS_DIR, 'e2e-test-file.md');
  const testContent = `# E2E Test File\n\nCreated at ${new Date().toISOString()}\n\nThis file is for E2E testing.`;

  // Test file creation
  const createResult = await runAgentTask(`Create a file at docs/e2e-test-file.md with this exact content:\n\n${testContent}`);

  assert(createResult.completed === true, 'File creation task should complete');
  assert(existsSync(testFile), 'File should exist after creation');

  const fileContent = readFileSync(testFile, 'utf-8');
  assert(fileContent.includes('E2E Test File'), 'File content should match');

  // Test file reading
  const readResult = await runAgentTask('Read the file docs/e2e-test-file.md and tell me what it contains');

  assert(readResult.completed === true, 'File read task should complete');
  assert(readResult.results.some(r => r.tool === 'file_read'), 'Should use file_read tool');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

async function testGitOperations() {
  currentTest = 'Git Operations';
  log(`Starting: ${currentTest}`);

  // Create a test file
  const testFile = join(DOCS_DIR, 'git-test.md');
  writeFileSync(testFile, '# Git Test\n\nTesting git commit.');

  // Test git status
  const statusResult = await runAgentTask('Check git status and tell me what files are modified');

  assert(statusResult.completed === true, 'Git status task should complete');

  // Test git commit (auto-stage should happen)
  const commitResult = await runAgentTask('Commit the file docs/git-test.md with message "e2e: git test"');

  // Verify commit in log
  const { stdout } = await execAsync('git log -1 --oneline');
  assert(stdout.includes('e2e: git test') || stdout.includes('auto:'), 'Commit should appear in log');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

async function testMemoryOperations() {
  currentTest = 'Memory Operations';
  log(`Starting: ${currentTest}`);

  // Store a memory
  const storeResult = await runAgentTask('Remember this: "E2E test memory entry at ' + new Date().toISOString() + '"');

  assert(storeResult.completed === true, 'Memory store task should complete');

  // Search for the memory
  const searchResult = await runAgentTask('Search your memory for "E2E test memory"');

  assert(searchResult.completed === true, 'Memory search task should complete');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

async function testBrowserOperations() {
  currentTest = 'Browser Operations';
  log(`Starting: ${currentTest}`);

  // Navigate to a page
  const navResult = await runAgentTask('Navigate to https://example.com and tell me the page title');

  assert(navResult.completed === true, 'Browser navigation task should complete');
  assert(navResult.results.some(r => r.tool === 'browser_navigate'), 'Should use browser_navigate tool');

  // Take screenshot
  const screenshotResult = await runAgentTask('Take a screenshot of the current page');

  assert(screenshotResult.completed === true, 'Screenshot task should complete');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

async function testHealthCheck() {
  currentTest = 'Health Check';
  log(`Starting: ${currentTest}`);

  const healthResult = await runAgentTask('Run a health check and report the status of all systems');

  assert(healthResult.completed === true, 'Health check task should complete');
  assert(healthResult.results.some(r => r.tool === 'health_check'), 'Should use health_check tool');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

async function testSelfHealing() {
  currentTest = 'Self-Healing';
  log(`Starting: ${currentTest}`);

  // This test verifies that the agent recovers from failures
  // We'll ask it to do something that might fail and recover
  const recoveryResult = await runAgentTask('Try to read a file that does not exist, then handle the error gracefully');

  assert(recoveryResult.completed === true, 'Recovery task should complete despite error');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

async function testMultiStepWorkflow() {
  currentTest = 'Multi-Step Workflow';
  log(`Starting: ${currentTest}`);

  const workflowResult = await runAgentTask(`
    Complete this 5-step workflow:
    1. Create a file docs/workflow-step1.md with content "Step 1"
    2. Create a file docs/workflow-step2.md with content "Step 2"
    3. Run pnpm test
    4. Read both files and verify content
    5. Report completion with proof
  `);

  assert(workflowResult.completed === true, 'Multi-step workflow should complete');
  assert(workflowResult.results.length >= 4, 'Should have multiple results');

  log(`✓ ${currentTest} passed`);
  testResults.push({ test: currentTest, passed: true });
}

export async function runE2ETests() {
  log('═══════════════════════════════════════════════════════');
  log('OpenUnum Qwen E2E Test Suite');
  log('═══════════════════════════════════════════════════════');

  await cleanup();

  const tests = [
    testFileOperations,
    testGitOperations,
    testMemoryOperations,
    testBrowserOperations,
    testHealthCheck,
    testSelfHealing,
    testMultiStepWorkflow
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (e) {
      log(`✗ ${currentTest} FAILED: ${e.message}`);
      failed++;
      testResults.push({ test: currentTest, passed: false, error: e.message });
    }
  }

  await cleanup();

  log('═══════════════════════════════════════════════════════');
  log(`Results: ${passed} passed, ${failed} failed`);
  log('═══════════════════════════════════════════════════════');

  return {
    passed,
    failed,
    total: tests.length,
    results: testResults
  };
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  runE2ETests()
    .then(results => {
      console.log('\n=== E2E Test Results ===');
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(e => {
      console.error('[E2E] Fatal error:', e.message);
      process.exit(1);
    });
}
