import { createCore, ActionType, InteractionTarget } from './core_systems.js';

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
  },
  registerInteractionTargets(definitions = []) {
    for (const definition of definitions) {
      const bounds = typeof definition.bounds === 'function' ? definition.bounds() : definition.bounds;
      const target = new InteractionTarget({
        id: definition.id,
        label: definition.label,
        action: ActionType.INTERACT,
        x: bounds.x,
        y: bounds.y,
        width: bounds.w ?? bounds.width,
        height: bounds.h ?? bounds.height,
        priority: definition.priority ?? 0,
        once: Boolean(definition.once),
        condition: definition.enabled || definition.condition || (() => true),
        execute: definition.execute || (() => true)
      });
      core.interaction.register(target);
    }
    return true;
  },
  executeInteraction(context = {}) {
    core.interaction.update(context);
    return core.interaction.executeCurrent(context);
  }
});
