/**
 * Configuration Management
 * Proper ESM imports, schema validation, memory-backed with persistence
 * Fixes: No require() in ESM, real validation, no state mutation
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_HOME = process.env.OPENUNUM_QWEN_HOME || join(os.homedir(), '.openunum-qwen');

const DEFAULTS = {
  appHome: APP_HOME,
  provider: 'ollama',
  model: 'qwen3.5:9b-64k',
  baseUrl: 'http://127.0.0.1:11434/v1',
  apiKey: '',
  fallbackModel: 'minimax-m2.5:cloud',
  fallbackBaseUrl: 'http://127.0.0.1:11434/v1',
  uiPort: 18881,
  uiHost: '127.0.0.1',
  browserMode: 'playwright',
  cdpPort: 9333,
  githubToken: '',
  githubRepo: '',
  githubBranch: 'main',
  healthInterval: 30000,
  cbFailureThreshold: 3,
  cbResetTimeout: 300000,
  memoryDbPath: join(APP_HOME, 'data', 'memory.db'),
  bm25IndexPath: join(APP_HOME, 'data', 'bm25_index.json'),
  sessionsDir: join(APP_HOME, 'data', 'sessions'),
  configFilePath: join(APP_HOME, 'config.json'),
  logLevel: 'info',
  logPath: join(APP_HOME, 'logs'),
  runtimeDataPath: join(APP_HOME, 'data'),
  cachePath: join(APP_HOME, 'cache')
};

const SCHEMA = {
  provider: { type: 'string', required: true, enum: ['ollama', 'openai', 'anthropic', 'nvidia', 'openrouter', 'ollama-cloud'] },
  model: { type: 'string', required: true },
  baseUrl: { type: 'string', required: true },
  apiKey: { type: 'string', required: false },
  fallbackModel: { type: 'string', required: false },
  fallbackBaseUrl: { type: 'string', required: false },
  uiPort: { type: 'number', required: false, min: 1024, max: 65535 },
  uiHost: { type: 'string', required: false },
  browserMode: { type: 'string', required: false, enum: ['playwright', 'cdp', 'curl'] },
  cdpPort: { type: 'number', required: false },
  githubToken: { type: 'string', required: false },
  githubRepo: { type: 'string', required: false },
  githubBranch: { type: 'string', required: false },
  healthInterval: { type: 'number', required: false, min: 5000 },
  cbFailureThreshold: { type: 'number', required: false, min: 1 },
  cbResetTimeout: { type: 'number', required: false, min: 1000 },
  memoryDbPath: { type: 'string', required: false },
  bm25IndexPath: { type: 'string', required: false },
  sessionsDir: { type: 'string', required: false },
  configFilePath: { type: 'string', required: false },
  logLevel: { type: 'string', required: false, enum: ['debug', 'info', 'warn', 'error'] },
  logPath: { type: 'string', required: false },
  appHome: { type: 'string', required: false },
  runtimeDataPath: { type: 'string', required: false },
  cachePath: { type: 'string', required: false }
};

let config = null;
let configPath = null;

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
  }
}

function validateConfig(cfg) {
  const errors = [];
  for (const [key, rules] of Object.entries(SCHEMA)) {
    const value = cfg[key];
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required config: ${key}`);
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push(`Config ${key} must be string, got ${typeof value}`);
    }
    if (rules.type === 'number' && typeof value !== 'number') {
      errors.push(`Config ${key} must be number, got ${typeof value}`);
    }
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`Config ${key} must be one of ${rules.enum.join(', ')}, got ${value}`);
    }
    if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
      errors.push(`Config ${key} must be >= ${rules.min}, got ${value}`);
    }
    if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
      errors.push(`Config ${key} must be <= ${rules.max}, got ${value}`);
    }
  }
  return errors;
}

export function loadConfig() {
  if (config) return config;
  
  loadEnv();
  configPath = process.env.CONFIG_FILE_PATH || join(APP_HOME, 'config.json');
  
  let saved = {};
  if (existsSync(configPath)) {
    try {
      saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.warn('Config file corrupted, using defaults');
    }
  }
  
  config = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const envKey = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()).toUpperCase();
    if (process.env[envKey] !== undefined) {
      const val = process.env[envKey];
      config[key] = typeof DEFAULTS[key] === 'number' ? parseFloat(val) : val;
    } else if (saved[key] !== undefined) {
      config[key] = saved[key];
    }
  }
  
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('Config validation errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  config.appHome = config.appHome || APP_HOME;
  config.runtimeDataPath = config.runtimeDataPath || join(config.appHome, 'data');
  config.cachePath = config.cachePath || join(config.appHome, 'cache');
  config.logPath = config.logPath || join(config.appHome, 'logs');
  config.memoryDbPath = resolve(config.memoryDbPath || join(config.appHome, 'data', 'memory.db'));
  config.bm25IndexPath = resolve(config.bm25IndexPath || join(config.appHome, 'data', 'bm25_index.json'));
  config.sessionsDir = resolve(config.sessionsDir || join(config.appHome, 'data', 'sessions'));
  config.configFilePath = resolve(config.configFilePath || configPath);
  configPath = config.configFilePath;
  
  return config;
}

export function saveConfig(cfg) {
  if (!configPath) {
    configPath = cfg?.configFilePath || join(APP_HOME, 'config.json');
  }
  const dataDir = dirname(configPath);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  config = cfg;
}

export function getConfig(key) {
  if (!config) loadConfig();
  return key ? config[key] : config;
}

export function updateConfig(updates) {
  if (!config) loadConfig();
  const merged = { ...config, ...updates };
  const errors = validateConfig(merged);
  if (errors.length > 0) {
    throw new Error(`Invalid config update: ${errors.join(', ')}`);
  }
  config = merged;
  saveConfig(config);
  return config;
}

export function ensureDirectories() {
  const dirs = [
    APP_HOME,
    join(APP_HOME, 'data'),
    join(APP_HOME, 'data', 'sessions'),
    join(APP_HOME, 'logs'),
    join(APP_HOME, 'cache'),
    join(APP_HOME, 'memory')
  ];
  dirs.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });
}
