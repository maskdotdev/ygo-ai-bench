import type { ScriptedLegalActionExpectation, ScriptedLegalActionGroupExpectation } from "#duel/types.js";

type AttackChoice = { attackerUid: string; targetUid?: string; directAttack?: true };
type TriggerBucket = "turnMandatory" | "turnOptional" | "opponentMandatory" | "opponentOptional";
type WindowKind = "open" | "battle" | "triggerBucket" | "chainResponse";

export const directAttackGroup = (player: 0 | 1, attackerUid: string, count = 1, windowId?: number) => ({
  player,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: [{ type: "declareAttack" as const, player, attackerUid, directAttack: true as const, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count }],
});

export const targetedAttackGroup = (player: 0 | 1, attackerUid: string, targetUid: string, count = 1, windowId?: number) => ({
  player,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: [{ type: "declareAttack" as const, player, attackerUid, targetUid, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count }],
});

export const attackGroup = (attacks: AttackChoice[], count = 1, windowId?: number) => ({
  player: 0 as const,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: attacks.map(({ attackerUid, targetUid, directAttack }) => ({
    type: "declareAttack" as const,
    player: 0 as const,
    attackerUid,
    ...(targetUid === undefined ? {} : { targetUid }),
    ...(targetUid === undefined && directAttack ? { directAttack } : {}),
    ...(windowId === undefined ? {} : { windowId }),
    windowKind: "open" as const,
    count: 1,
  })),
});

export const absentOpenAttackGroup = (player: 0 | 1, attackerUid: string, windowId?: number) => ({
  player,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [{ type: "declareAttack" as const, player, attackerUid, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const }],
});

export const absentAttackGroup = (attackerUid: string, targetUid?: string, directAttack?: true, windowId?: number) => ({
  player: 0 as const,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  actions: [
    {
      type: "declareAttack" as const,
      player: 0 as const,
      attackerUid,
      ...(targetUid === undefined ? {} : { targetUid }),
      ...(targetUid === undefined && directAttack ? { directAttack } : {}),
      ...(windowId === undefined ? {} : { windowId }),
      windowKind: "open" as const,
    },
  ],
});

type ReplayAttackChoice = { attackerUid: string; targetUid?: string; directAttack?: true; cancel?: true };
type OpenAction = Omit<ScriptedLegalActionExpectation, "windowId" | "windowKind" | "count"> & { windowId?: number; windowKind?: "open"; count?: number };

export const replayAttackGroup = (attacks: ReplayAttackChoice[], count = 1, windowId?: number) => ({
  player: 0 as const,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  count,
  actions: attacks.map(({ attackerUid, targetUid, directAttack, cancel }) => ({
    type: cancel ? ("cancelAttack" as const) : ("replayAttack" as const),
    player: 0 as const,
    attackerUid,
    ...(targetUid === undefined ? {} : { targetUid }),
    ...(targetUid === undefined && directAttack ? { directAttack } : {}),
    ...(windowId === undefined ? {} : { windowId }),
    windowKind: "battle" as const,
    count: 1,
  })),
});

export const passBattleGroup = (player: 0 | 1, type: "passAttack" | "passDamage", count = 1, windowId?: number) => ({
  player,
  label: "Pass",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  count,
  actions: [{ type, player, ...(windowId === undefined ? {} : { windowId }), windowKind: "battle" as const, count }],
});

export const absentPassBattleGroup = (player: 0 | 1, type: "passAttack" | "passDamage", windowId?: number) => ({
  player,
  label: "Pass",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  actions: [{ type, player, ...(windowId === undefined ? {} : { windowId }), windowKind: "battle" as const }],
});

export const effectGroup = (player: 0 | 1, effectId: string, count = 1, windowId?: number) => ({
  player,
  label: "Effects",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  count,
  actions: [{ type: "activateEffect" as const, player, effectId, ...(windowId === undefined ? {} : { windowId }), windowKind: "battle" as const, count }],
});

export const chainEffectGroup = (player: 0 | 1, effectId: string, count = 1, windowId?: number) => ({
  player,
  label: "Effects",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "chainResponse" as const,
  count,
  actions: [{ type: "activateEffect" as const, player, effectId, ...(windowId === undefined ? {} : { windowId }), windowKind: "chainResponse" as const, count }],
});

export const chainPassGroup = (player: 0 | 1, count = 1, windowId?: number) => ({
  player,
  label: "Pass",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "chainResponse" as const,
  count,
  actions: [{ type: "passChain" as const, player, ...(windowId === undefined ? {} : { windowId }), windowKind: "chainResponse" as const, count }],
});

export const openEffectGroup = (player: 0 | 1, effectId: string, count = 1, windowId?: number) => ({
  player,
  label: "Effects",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: [{ type: "activateEffect" as const, player, effectId, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count }],
});

export const normalSummonGroup = (player: 0 | 1, code: string, location: "hand", count = 1, windowId?: number) => ({
  player,
  label: "Summons",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [{ type: "normalSummon" as const, player, code, location, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count }],
});

export const absentNormalSummonGroup = (player: 0 | 1, code: string, location: "hand", windowId?: number) => ({
  player,
  label: "Summons",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [{ type: "normalSummon" as const, player, code, location, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const }],
});

export const summonGroup = (actions: OpenAction[], count = 1, windowId?: number): ScriptedLegalActionGroupExpectation => ({
  player: actions[0]?.player ?? (0 as const),
  label: "Summons",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: actions.map((action) => ({ ...action, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count })),
});

export const absentSummonGroup = (action: Omit<OpenAction, "count">, windowId?: number): ScriptedLegalActionGroupExpectation => ({
  player: action.player,
  label: "Summons",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [{ ...action, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const }],
});

export const spellTrapSetGroup = (uid: string, count = 1, windowId?: number): ScriptedLegalActionGroupExpectation => ({
  player: 0,
  label: "Set",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open",
  count,
  actions: [{ type: "setSpellTrap", player: 0, uid, ...(windowId === undefined ? {} : { windowId }), windowKind: "open", count }],
});

export const absentSpellTrapSetGroup = (uid: string, windowId?: number): ScriptedLegalActionGroupExpectation => ({
  player: 0,
  label: "Set",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open",
  actions: [{ type: "setSpellTrap", player: 0, uid, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" }],
});

export const triggerActivationGroup = (player: 0 | 1, effectId: string, triggerBucket: "turnMandatory" | "turnOptional" | "opponentMandatory" | "opponentOptional", count = 1, windowId?: number) => ({
  player,
  label: "Trigger Activations",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "triggerBucket" as const,
  triggerBucket: { player, triggerBucket },
  count,
  actions: [{ type: "activateTrigger" as const, player, effectId, triggerBucket, ...(windowId === undefined ? {} : { windowId }), windowKind: "triggerBucket" as const, count }],
});

export const triggerDeclineGroup = (player: 0 | 1, effectId: string, triggerBucket: TriggerBucket, count = 1, windowId?: number) => ({
  player,
  label: "Trigger Declines",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "triggerBucket" as const,
  triggerBucket: { player, triggerBucket },
  count,
  actions: [{ type: "declineTrigger" as const, player, effectId, triggerBucket, ...(windowId === undefined ? {} : { windowId }), windowKind: "triggerBucket" as const, count }],
});

export const absentTriggerActivationGroup = (player: 0 | 1, effectId: string, triggerBucket: TriggerBucket, windowId: number, windowKind: WindowKind) => ({
  player,
  label: "Trigger Activations",
  windowId,
  windowKind,
  triggerBucket: { player, triggerBucket },
  actions: [{ type: "activateTrigger" as const, player, windowId, windowKind, effectId, ...(windowKind === "triggerBucket" ? { triggerBucket } : {}) }],
});

export const absentWindowEffectGroup = (player: 0 | 1, effectId: string, windowId: number, windowKind: WindowKind) => ({
  player,
  label: "Effects",
  windowId,
  windowKind,
  actions: [{ type: "activateEffect" as const, player, windowId, windowKind, effectId }],
});

export const absentEffectGroup = (player: 0 | 1, effectId: string, windowId?: number) => ({
  player,
  label: "Effects",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  actions: [{ type: "activateEffect" as const, player, effectId, ...(windowId === undefined ? {} : { windowId }), windowKind: "battle" as const }],
});

export const absentChainEffectGroup = (player: 0 | 1, effectId: string, windowId?: number) => ({
  player,
  label: "Effects",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "chainResponse" as const,
  actions: [{ type: "activateEffect" as const, player, effectId, ...(windowId === undefined ? {} : { windowId }), windowKind: "chainResponse" as const }],
});

export const passDamageGroup = (player: 0 | 1, count = 1, windowId?: number) => ({
  player,
  label: "Pass",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  count,
  actions: [{ type: "passDamage" as const, player, ...(windowId === undefined ? {} : { windowId }), windowKind: "battle" as const, count }],
});

export const turnGroup = (windowId?: number) => ({
  player: 0 as const,
  label: "Turn",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [
    { type: "changePhase" as const, player: 0 as const, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count: 1 },
    { type: "endTurn" as const, player: 0 as const, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const, count: 1 },
  ],
});

export const absentTurnGroup = (type: "changePhase" | "endTurn", windowId?: number) => ({
  player: 0 as const,
  label: "Turn",
  ...(windowId === undefined ? {} : { windowId }),
  actions: [{ type, player: 0 as const, ...(windowId === undefined ? {} : { windowId }), windowKind: "open" as const }],
});
