type AttackChoice = { attackerUid: string; targetUid?: string; directAttack?: true };

export const directAttackGroup = (player: 0 | 1, attackerUid: string, count = 1, windowId?: number) => ({
  player,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: [{ type: "declareAttack" as const, player, attackerUid, ...(windowId === undefined ? {} : { windowId }), count }],
});

export const targetedAttackGroup = (player: 0 | 1, attackerUid: string, targetUid: string, count = 1, windowId?: number) => ({
  player,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  count,
  actions: [{ type: "declareAttack" as const, player, attackerUid, targetUid, ...(windowId === undefined ? {} : { windowId }), count }],
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
    count: 1,
  })),
});

export const absentOpenAttackGroup = (player: 0 | 1, attackerUid: string, windowId?: number) => ({
  player,
  label: "Attacks",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [{ type: "declareAttack" as const, player, attackerUid, ...(windowId === undefined ? {} : { windowId }) }],
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
    },
  ],
});

export const passBattleGroup = (player: 0 | 1, type: "passAttack" | "passDamage", count = 1, windowId?: number) => ({
  player,
  label: "Pass",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "battle" as const,
  count,
  actions: [{ type, player, ...(windowId === undefined ? {} : { windowId }), count }],
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

export const turnGroup = (windowId?: number) => ({
  player: 0 as const,
  label: "Turn",
  ...(windowId === undefined ? {} : { windowId }),
  windowKind: "open" as const,
  actions: [
    { type: "changePhase" as const, player: 0 as const, ...(windowId === undefined ? {} : { windowId }), count: 1 },
    { type: "endTurn" as const, player: 0 as const, ...(windowId === undefined ? {} : { windowId }), count: 1 },
  ],
});

export const absentTurnGroup = (type: "changePhase" | "endTurn") => ({
  player: 0 as const,
  label: "Turn",
  actions: [{ type, player: 0 as const }],
});
