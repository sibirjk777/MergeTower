'use strict';

export const ActionType = Object.freeze({
  NONE: 'none',
  ATTACK: 'attack',
  INTERACT: 'interact',
  PICKUP: 'pickup',
  TALK: 'talk',
  OPEN: 'open',
  CLIMB: 'climb',
  USE: 'use'
});

export const InteractionState = Object.freeze({
  IDLE: 'idle',
  AVAILABLE: 'available',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  LOCKED: 'locked'
});

export class EventBus {
  constructor() { this.listeners = new Map(); }

  on(eventName, listener) {
    if (typeof eventName !== 'string' || eventName.length === 0) throw new TypeError('eventName must be a non-empty string');
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const bucket = this.listeners.get(eventName) || new Set();
    bucket.add(listener);
    this.listeners.set(eventName, bucket);
    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    const bucket = this.listeners.get(eventName);
    if (!bucket) return false;
    const removed = bucket.delete(listener);
    if (bucket.size === 0) this.listeners.delete(eventName);
    return removed;
  }

  emit(eventName, payload = null) {
    const bucket = this.listeners.get(eventName);
    if (!bucket) return;
    for (const listener of [...bucket]) listener(payload);
  }

  clear() { this.listeners.clear(); }
}

export class WorldState {
  constructor(initialState = {}) {
    this.values = new Map(Object.entries(initialState));
    this.eventBus = new EventBus();
  }

  has(key) { return this.values.has(key); }

  get(key, fallback = null) {
    return this.values.has(key) ? this.values.get(key) : fallback;
  }

  set(key, value) {
    const previous = this.get(key);
    if (Object.is(previous, value)) return false;
    this.values.set(key, value);
    this.eventBus.emit('state:changed', { key, previous, value });
    this.eventBus.emit('state:' + key, { previous, value });
    return true;
  }

  update(patch) {
    if (!patch || typeof patch !== 'object') throw new TypeError('patch must be an object');
    for (const [key, value] of Object.entries(patch)) this.set(key, value);
  }

  snapshot() { return Object.fromEntries(this.values.entries()); }

  onChange(listener) { return this.eventBus.on('state:changed', listener); }
}

export class InteractionTarget {
  constructor({
    id, label, action = ActionType.INTERACT, x, y, width, height,
    priority = 0, state = InteractionState.IDLE, enabled = true,
    once = false, condition = () => true, execute = () => {}
  }) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('InteractionTarget.id is required');
    if (![x, y, width, height].every(Number.isFinite)) throw new TypeError('Invalid interaction bounds: ' + id);

    this.id = id;
    this.label = label || id;
    this.action = action;
    this.bounds = { x, y, width, height };
    this.priority = priority;
    this.state = state;
    this.enabled = enabled;
    this.once = once;
    this.condition = condition;
    this.execute = execute;
  }

  containsPoint(x, y) {
    return x >= this.bounds.x &&
      x <= this.bounds.x + this.bounds.width &&
      y >= this.bounds.y &&
      y <= this.bounds.y + this.bounds.height;
  }

  isAvailable(context) {
    if (!this.enabled) return false;
    if (this.state === InteractionState.LOCKED) return false;
    if (this.once && this.state === InteractionState.COMPLETED) return false;
    return Boolean(this.condition(context));
  }

  activate(context) {
    if (!this.isAvailable(context)) return false;
    this.state = InteractionState.ACTIVE;
    const result = this.execute(context);
    this.state = this.once ? InteractionState.COMPLETED : InteractionState.AVAILABLE;
    return result !== false;
  }
}

export class InteractionSystem {
  constructor(eventBus = new EventBus()) {
    this.eventBus = eventBus;
    this.targets = new Map();
    this.currentTarget = null;
  }

  register(target) {
    if (!(target instanceof InteractionTarget)) throw new TypeError('target must be an InteractionTarget');
    this.targets.set(target.id, target);
    return target;
  }

  unregister(id) { return this.targets.delete(id); }

  update(context) {
    const candidates = [];

    for (const target of this.targets.values()) {
      if (!target.isAvailable(context)) continue;
      if (!target.containsPoint(context.playerCenterX, context.playerCenterY)) continue;
      candidates.push(target);
    }

    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const ax = a.bounds.x + a.bounds.width * 0.5;
      const ay = a.bounds.y + a.bounds.height * 0.5;
      const bx = b.bounds.x + b.bounds.width * 0.5;
      const by = b.bounds.y + b.bounds.height * 0.5;
      const da = Math.hypot(context.playerCenterX - ax, context.playerCenterY - ay);
      const db = Math.hypot(context.playerCenterX - bx, context.playerCenterY - by);
      return da - db;
    });

    const next = candidates[0] || null;
    if (next?.id !== this.currentTarget?.id) {
      this.currentTarget = next;
      this.eventBus.emit('interaction:target-changed', next);
    }
    return next;
  }

  getCurrentTarget() { return this.currentTarget; }

  executeCurrent(context) {
    if (!this.currentTarget) return false;
    const target = this.currentTarget;
    const result = target.activate(context);
    this.eventBus.emit('interaction:executed', { target, result });
    return result;
  }

  clearCurrent() {
    if (!this.currentTarget) return;
    this.currentTarget = null;
    this.eventBus.emit('interaction:target-changed', null);
  }
}

export class ContextActionSystem {
  constructor() {
    this.actions = new Map();
    this.activeAction = ActionType.NONE;
  }

  register(action, { label, priority = 0, enabled = () => true }) {
    if (!Object.values(ActionType).includes(action)) throw new TypeError('Unknown action: ' + action);
    this.actions.set(action, { action, label: label || action, priority, enabled });
    return this;
  }

  resolve(context) {
    const available = [];
    for (const definition of this.actions.values()) {
      if (definition.enabled(context)) available.push(definition);
    }
    available.sort((a, b) => b.priority - a.priority);
    this.activeAction = available[0]?.action || ActionType.NONE;
    return {
      active: this.activeAction,
      available: available.map((entry) => ({
        action: entry.action,
        label: entry.label,
        priority: entry.priority
      }))
    };
  }

  isActive(action) { return this.activeAction === action; }
}

export class ArtifactSystem {
  constructor(worldState) {
    if (!(worldState instanceof WorldState)) throw new TypeError('ArtifactSystem requires WorldState');
    this.worldState = worldState;
    this.artifacts = new Map();
  }

  register({ id, name, description, persistent = true, effect = () => {} }) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('Artifact id is required');
    const artifact = {
      id, name: name || id, description: description || '', persistent,
      effect, acquired: Boolean(this.worldState.get('artifact:' + id, false))
    };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  acquire(id, context = {}) {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error('Unknown artifact: ' + id);
    if (artifact.acquired) return false;
    artifact.acquired = true;
    if (artifact.persistent) this.worldState.set('artifact:' + id, true);
    artifact.effect(context);
    this.worldState.eventBus.emit('artifact:acquired', artifact);
    return true;
  }

  has(id) { return Boolean(this.artifacts.get(id)?.acquired); }

  listAcquired() {
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.acquired)
      .map(({ id, name, description }) => ({ id, name, description }));
  }
}

export class MiniGameRegistry {
  constructor() { this.entries = new Map(); }

  register(id, factory) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('Mini-game id is required');
    if (typeof factory !== 'function') throw new TypeError('Mini-game factory must be a function');
    this.entries.set(id, factory);
  }

  create(id, context) {
    const factory = this.entries.get(id);
    if (!factory) throw new Error('Unknown mini-game: ' + id);
    return factory(context);
  }

  has(id) { return this.entries.has(id); }
}

export function createCore(initialState = {}) {
  const eventBus = new EventBus();
  const worldState = new WorldState(initialState);
  const interaction = new InteractionSystem(eventBus);
  const contextActions = new ContextActionSystem();
  const artifacts = new ArtifactSystem(worldState);
  const miniGames = new MiniGameRegistry();

  return Object.freeze({ eventBus, worldState, interaction, contextActions, artifacts, miniGames });
}
