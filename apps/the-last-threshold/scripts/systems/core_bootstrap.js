import { createCore, ActionType } from './core_systems.js';

const core = createCore({
  game: 'the-last-threshold',
  schemaVersion: 1,
  playerHealth: 100,
  memoryShards: 0,
  checkpointActive: false
});

core.contextActions
  .register(ActionType.ATTACK, {
    label: 'УДАР',
    priority: 100,
    enabled: (context) => Boolean(context.enemyInRange && context.canAttack)
  })
  .register(ActionType.INTERACT, {
    label: 'ВЗАИМОДЕЙСТВИЕ',
    priority: 80,
    enabled: (context) => Boolean(context.interactionAvailable)
  })
  .register(ActionType.PICKUP, {
    label: 'ПОДОБРАТЬ',
    priority: 70,
    enabled: (context) => Boolean(context.pickupAvailable)
  });

window.ThresholdCore = core;
window.ThresholdCoreAPI = Object.freeze({
  ActionType,
  resolveContext(context) {
    return core.contextActions.resolve(context || {});
  },
  worldSnapshot() {
    return core.worldState.snapshot();
  }
});
