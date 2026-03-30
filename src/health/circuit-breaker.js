/**
 * Circuit Breaker Implementation
 * Fixes: Real state tracking, proper open/half-open/closed states
 * Previous issue: "critical" state never set, auto-recovery unreachable
 */

const STATE = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 300000; // 5 min
    this.state = new Map(); // toolName -> { state, failures, lastFailure, lastSuccess }
  }

  getState(toolName) {
    if (!this.state.has(toolName)) {
      this.state.set(toolName, {
        state: STATE.CLOSED,
        failures: 0,
        lastFailure: null,
        lastSuccess: null
      });
    }
    return this.state.get(toolName);
  }

  canExecute(toolName) {
    const entry = this.getState(toolName);
    
    if (entry.state === STATE.CLOSED) {
      return true;
    }
    
    if (entry.state === STATE.OPEN) {
      const elapsed = Date.now() - entry.lastFailure;
      if (elapsed >= this.resetTimeout) {
        entry.state = STATE.HALF_OPEN;
        console.log(`[CircuitBreaker] ${toolName} entering half-open state`);
        return true;
      }
      return false;
    }
    
    if (entry.state === STATE.HALF_OPEN) {
      return true;
    }
    
    return false;
  }

  recordSuccess(toolName) {
    const entry = this.getState(toolName);
    entry.failures = 0;
    entry.lastSuccess = Date.now();
    entry.state = STATE.CLOSED;
  }

  recordFailure(toolName) {
    const entry = this.getState(toolName);
    entry.failures++;
    entry.lastFailure = Date.now();
    
    if (entry.failures >= this.failureThreshold) {
      const oldState = entry.state;
      entry.state = STATE.OPEN;
      console.warn(`[CircuitBreaker] ${toolName} circuit OPEN after ${entry.failures} failures (was ${oldState})`);
    }
  }

  getStatus() {
    const status = {};
    for (const [toolName, entry] of this.state.entries()) {
      status[toolName] = {
        state: entry.state,
        failures: entry.failures,
        lastFailure: entry.lastFailure ? new Date(entry.lastFailure).toISOString() : null,
        lastSuccess: entry.lastSuccess ? new Date(entry.lastSuccess).toISOString() : null
      };
    }
    return status;
  }

  reset(toolName) {
    if (this.state.has(toolName)) {
      const entry = this.state.get(toolName);
      entry.state = STATE.CLOSED;
      entry.failures = 0;
      console.log(`[CircuitBreaker] ${toolName} manually reset`);
    }
  }

  resetAll() {
    for (const toolName of this.state.keys()) {
      this.reset(toolName);
    }
  }
}
