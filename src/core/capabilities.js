export function getCapabilities(config) {
  return {
    contract_version: '2026-04-01.webui-capabilities.v1',
    app_id: 'openunum-qwen',
    app_name: 'OpenUnum Qwen',
    menu: ['chat', 'missions', 'trace', 'runtime', 'settings'],
    quick_prompts: [
      'Inspect the current repository and summarize the highest-risk code path.',
      'Create a small test that proves this bug is fixed.',
      'Plan and implement a mission to harden runtime health handling.',
      'Review recent changes and list the most likely regressions.',
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
      memory_inspection: false,
      research: false,
    },
    ui: {
      shell: 'shared-autonomy-v1',
      chat_style: 'imessage',
    },
    runtime: {
      host: config.host,
      port: config.port,
      home: config.home,
      workspace_root: config.workspaceRoot,
    },
  };
}
