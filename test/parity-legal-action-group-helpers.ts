type AttackChoice = { attackerUid: string; targetUid?: string; directAttack?: true };

export const directAttackGroup = (player: 0 | 1, attackerUid: string, count = 1) => ({
  player,
  label: "Attacks",
  windowKind: "open" as const,
  count,
  actions: [{ type: "declareAttack" as const, player, attackerUid, count }],
});

export const targetedAttackGroup = (player: 0 | 1, attackerUid: string, targetUid: string, count = 1) => ({
  player,
  label: "Attacks",
  windowKind: "open" as const,
  count,
  actions: [{ type: "declareAttack" as const, player, attackerUid, targetUid, count }],
});

export const attackGroup = (attacks: AttackChoice[], count = 1) => ({
  player: 0 as const,
  label: "Attacks",
  windowKind: "open" as const,
  count,
  actions: attacks.map(({ attackerUid, targetUid, directAttack }) => ({
    type: "declareAttack" as const,
    player: 0 as const,
    attackerUid,
    ...(targetUid === undefined ? {} : { targetUid }),
    ...(targetUid === undefined && directAttack ? { directAttack } : {}),
    count: 1,
  })),
});

export const absentOpenAttackGroup = (player: 0 | 1, attackerUid: string) => ({
  player,
  label: "Attacks",
  windowKind: "open" as const,
  actions: [{ type: "declareAttack" as const, player, attackerUid }],
});

export const absentAttackGroup = (attackerUid: string, targetUid?: string, directAttack?: true) => ({
  player: 0 as const,
  label: "Attacks",
  actions: [{ type: "declareAttack" as const, player: 0 as const, attackerUid, ...(targetUid === undefined ? {} : { targetUid }), ...(targetUid === undefined && directAttack ? { directAttack } : {}) }],
});

export const passBattleGroup = (player: 0 | 1, type: "passAttack" | "passDamage", count = 1) => ({
  player,
  label: "Pass",
  windowKind: "battle" as const,
  count,
  actions: [{ type, player, count }],
});

export const effectGroup = (player: 0 | 1, effectId: string, count = 1) => ({
  player,
  label: "Effects",
  windowKind: "battle" as const,
  count,
  actions: [{ type: "activateEffect" as const, player, effectId, count }],
});

export const absentEffectGroup = (player: 0 | 1, effectId: string) => ({
  player,
  label: "Effects",
  actions: [{ type: "activateEffect" as const, player, effectId }],
});

export const passDamageGroup = (player: 0 | 1, count = 1) => ({
  player,
  label: "Pass",
  windowKind: "battle" as const,
  count,
  actions: [{ type: "passDamage" as const, player, count }],
});

export const turnGroup = () => ({
  player: 0 as const,
  label: "Turn",
  windowKind: "open" as const,
  actions: [{ type: "changePhase" as const, player: 0 as const, count: 1 }, { type: "endTurn" as const, player: 0 as const, count: 1 }],
});

export const absentTurnGroup = (type: "changePhase" | "endTurn") => ({
  player: 0 as const,
  label: "Turn",
  actions: [{ type, player: 0 as const }],
});
