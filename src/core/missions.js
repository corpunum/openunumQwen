export class MissionRunner {
  constructor({ agent, eventBus }) {
    this.agent = agent;
    this.eventBus = eventBus;
    this.missions = new Map();
  }

  list() {
    return [...this.missions.values()].map((mission) => this.snapshot(mission));
  }

  get(id) {
    const mission = this.missions.get(id);
    return mission ? this.snapshot(mission) : null;
  }

  start({ goal, maxSteps = 1, continueUntilDone = true, intervalMs = 0 }) {
    const id = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mission = {
      id,
      goal,
      maxSteps,
      continueUntilDone,
      intervalMs,
      sessionId: `mission:${id}`,
      status: 'queued',
      step: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: '',
      error: '',
      actions: [],
      stopRequested: false,
    };

    this.missions.set(id, mission);
    this.eventBus.push('mission.updated', { mission: this.snapshot(mission) });
    void this.run(mission);
    return { ok: true, id, mission: this.snapshot(mission) };
  }

  stop(id) {
    const mission = this.missions.get(id);
    if (!mission) return { ok: false, error: 'mission_not_found' };
    mission.stopRequested = true;
    if (mission.status === 'queued') mission.status = 'stopped';
    mission.updatedAt = new Date().toISOString();
    this.eventBus.push('mission.updated', { mission: this.snapshot(mission) });
    return { ok: true, mission: this.snapshot(mission) };
  }

  async run(mission) {
    if (mission.stopRequested) return;
    mission.status = 'running';
    mission.step = 1;
    mission.updatedAt = new Date().toISOString();
    this.eventBus.push('mission.updated', { mission: this.snapshot(mission) });

    try {
      const prompt = `Mission goal: ${mission.goal}\nOperate autonomously. Complete the task, verify the outcome, and report concrete proof.`;
      const result = await this.agent.chat(prompt, mission.sessionId);
      if (mission.stopRequested) {
        mission.status = 'stopped';
      } else {
        mission.status = 'completed';
        mission.result = result.response;
        mission.actions = result.actions || [];
      }
    } catch (error) {
      mission.status = 'failed';
      mission.error = String(error.message || error);
    }

    mission.updatedAt = new Date().toISOString();
    this.eventBus.push('mission.updated', { mission: this.snapshot(mission) });
  }

  snapshot(mission) {
    return {
      id: mission.id,
      goal: mission.goal,
      status: mission.status,
      step: mission.step,
      sessionId: mission.sessionId,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      result: mission.result,
      error: mission.error,
      actions: mission.actions,
    };
  }
}
