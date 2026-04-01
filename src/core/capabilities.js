export function getCapabilities(config) {
  return {
    contract_version: '2026-04-01.webui-capabilities.v1',
    app_id: 'openunum-qwen',
    app_name: 'OpenUnum Qwen',
    menu: ['chat', 'missions', 'trace', 'runtime', 'settings'],
    quick_prompts: [
      'Run an autonomous repository audit and summarize top technical risks.',
      'Execute an auto-sync safety check and report drift from HEAD.',
      'Create and validate a focused patch with tests.',
      'Start a mission to harden provider fallback behavior.',
    ],
    features: {
      chat: true,
      sessions: true,
      missions: true,
      trace: true,
      model_catalog: true,
      provider_health: true,
      self_heal: true,
      browser_control: true,
      git_runtime: true,
      auto_sync: true,
      context_compaction: true,
      memory_inspection: false,
      research: false,
    },
    ui: {
      shell: 'shared-autonomy-v1',
      chat_style: 'imessage',
      skin: 'qwen-emerald',
    },
    runtime: {
      host: config.host,
      port: config.port,
      home: config.home,
      workspace_root: config.workspaceRoot,
    },
  };
}
