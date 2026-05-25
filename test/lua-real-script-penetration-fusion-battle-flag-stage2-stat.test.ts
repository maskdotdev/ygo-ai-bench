import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const penetrationCode = "8778267";
const materialACode = "87782670";
const materialBCode = "87782671";
const fusionCode = "87782672";
const allyCode = "87782673";
const attackerCode = "87782674";
const defenderCode = "87782675";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPenetrationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${penetrationCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeFusion = 0x40;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const effectAddType = 115;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasPenetrationScript)("Lua real script Penetration Fusion battle flag stage2 stat", () => {
  it("restores battle-destroyed flag into Fusion Summon and stage2 self-tribute ATK grant", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${penetrationCode}.lua`));
    const reader = createCardReader(cards());
    const restoredBattle = createRestoredBattleDestroyedFlag({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const penetration = requireCard(restoredBattle.session, penetrationCode);
    const materialA = requireCard(restoredBattle.session, materialACode);
    const materialB = requireCard(restoredBattle.session, materialBCode);
    const fusion = requireCard(restoredBattle.session, fusionCode);
    const ally = requireCard(restoredBattle.session, allyCode);
    expect(restoredBattle.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(penetrationCode), value: 0 }),
    ]);

    const activate = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateEffect" && action.uid === penetration.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, activate!);

    const restoredFusionChain = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredFusionChain);
    if (restoredFusionChain.session.state.chain.length > 0) {
      expectRestoredLegalActions(restoredFusionChain, 1);
      const pass = getLuaRestoreLegalActions(restoredFusionChain, 1).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredFusionChain, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredFusionChain, pass!);
    }
    expect(restoredFusionChain.session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [materialA.uid, materialB.uid],
    });
    expect(restoredFusionChain.session.state.cards.find((card) => card.uid === penetration.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    for (const material of [materialA, materialB]) {
      expect(restoredFusionChain.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.effect | duelReason.material | duelReason.fusion,
        reasonCardUid: penetration.uid,
        reasonEffectId: 1,
      });
    }

    const restoredGranted = restoreDuelWithLuaScripts(serializeDuel(restoredFusionChain.session), workspace, reader);
    expectCleanRestore(restoredGranted);
    expectRestoredLegalActions(restoredGranted, 0);
    const granted = getLuaRestoreLegalActions(restoredGranted, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fusion.uid
    );
    expect(granted, JSON.stringify(getLuaRestoreLegalActions(restoredGranted, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredGranted, granted!);
    expect(restoredGranted.session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: fusion.uid,
      reasonEffectId: 3,
    });
    resolveRestoredChain(restoredGranted);
    expect(currentAttack(restoredGranted.session.state.cards.find((card) => card.uid === ally.uid), restoredGranted.session.state)).toBe(2000);
    expect(restoredGranted.session.state.effects.filter((effect) =>
      [fusion.uid, ally.uid].includes(effect.sourceUid ?? "") && [effectAddType, effectUpdateAttack].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: ally.uid, value: 500 },
    ]);
    expect(restoredGranted.session.state.eventHistory.filter((event) => ["battleDestroyed", "usedAsMaterial", "specialSummoned", "released", "becameTarget", "chainSolved"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: defenderCodeUid(restoredGranted.session), eventCode: 1140, eventName: "battleDestroyed", eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: attackerCodeUid(restoredGranted.session), eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: materialA.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.effect | duelReason.material | duelReason.fusion, eventReasonCardUid: penetration.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: materialB.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.effect | duelReason.material | duelReason.fusion, eventReasonCardUid: penetration.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: fusion.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion, eventReasonCardUid: penetration.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "extraDeck", relatedEffectId: undefined },
      { current: undefined, eventCardUid: undefined, eventCode: 1022, eventName: "chainSolved", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: undefined, relatedEffectId: 1 },
      { current: "graveyard", eventCardUid: fusion.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.cost | duelReason.release, eventReasonCardUid: fusion.uid, eventReasonEffectId: 3, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: ally.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 3 },
      { current: undefined, eventCardUid: undefined, eventCode: 1022, eventName: "chainSolved", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: undefined, relatedEffectId: 3 },
    ]);
    expect(restoredGranted.session.state.battleDamage).toEqual({ 0: 0, 1: 400 });
  });
});

function createRestoredBattleDestroyedFlag({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 8778267, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [penetrationCode, materialACode, materialBCode, allyCode, attackerCode], extra: [fusionCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, penetrationCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, materialACode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, materialBCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(penetrationCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const attack = getLegalActions(session, 0).find((action) =>
    action.type === "declareAttack" && action.attackerUid === requireCard(session, attackerCode).uid && action.targetUid === requireCard(session, defenderCode).uid
  );
  expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert({ session, host, restoreComplete: true, incompleteReasons: [], missingRegistryKeys: [], missingChainLimitRegistryKeys: [] } as ReturnType<typeof restoreDuelWithLuaScripts>, attack!);
  passBattleUntilComplete({ session, host, restoreComplete: true, incompleteReasons: [], missingRegistryKeys: [], missingChainLimitRegistryKeys: [] } as ReturnType<typeof restoreDuelWithLuaScripts>);
  session.state.phase = "main2";
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Penetration Fusion");
  expect(script).toContain("Fusion.CreateSummonEff({handler=c,stage2=s.stage2})");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("e1:SetCondition(function() return Duel.HasFlagEffect(0,id) end)");
  expect(script).toContain("ge1:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("Duel.RegisterFlagEffect(0,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("fc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(id,1))");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e2:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("e2:SetValue(TYPE_EFFECT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
}

function cards(): DuelCardData[] {
  return [
    { code: penetrationCode, name: "Penetration Fusion", kind: "spell", typeFlags: typeSpell },
    { code: materialACode, name: "Penetration Material A", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Penetration Material B", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1100, defense: 1000 },
    { code: fusionCode, name: "Penetration Fusion Target", kind: "extra", typeFlags: typeMonster | typeFusion, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2200, defense: 1800, fusionMaterials: [materialACode, materialBCode] },
    { code: allyCode, name: "Penetration Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: attackerCode, name: "Penetration Battle Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: defenderCode, name: "Penetration Battle Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function attackerCodeUid(session: DuelSession): string {
  return requireCard(session, attackerCode).uid;
}

function defenderCodeUid(session: DuelSession): string {
  return requireCard(session, defenderCode).uid;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(restored.session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(restored.session, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
