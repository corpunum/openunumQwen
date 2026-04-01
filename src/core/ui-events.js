import { EventEmitter } from 'events';

export class UIEventBus extends EventEmitter {
  constructor(limit = 250) {
    super();
    this.limit = limit;
    this.events = [];
  }

  push(type, payload = {}) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
    this.emit('event', event);
    return event;
  }

  list(prefix = '', limit = this.limit) {
    const filtered = prefix
      ? this.events.filter((event) => event.type.startsWith(prefix))
      : this.events;
    return filtered.slice(-limit);
  }
}
