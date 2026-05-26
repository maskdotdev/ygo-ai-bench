import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const catSharkCode = "84224627";
const genericMaterialCode = "842246270";
const waterMaterialCode = "842246271";
const defenderCode = "842246272";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCatSharkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${catSharkCode}.lua`));
const typeMonster = 0x1;
const typeXyz = 0x800000;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasCatSharkScript)("Lua real script Cat Shark detach final stat indestructible", () => {
  it("restores detach-targeted final ATK/DEF doubling and WATER material battle indestructibility", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${catSharkCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,2,2)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("GetOverlayGroup():IsExists(Card.IsAttribute,1,nil,ATTRIBUTE_WATER)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("c:IsFaceup() and c:IsType(TYPE_XYZ) and c:IsRankBelow(4)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetBaseAttack()*2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(tc:GetBaseDefense()*2)");

    const cards: DuelCardData[] = [
      { code: catSharkCode, name: "Cat Shark", kind: "extra", typeFlags: typeMonster | typeXyz, level: 2, attack: 500, defense: 500 },
      { code: genericMaterialCode, name: "Cat Shark Generic Material", kind: "monster", typeFlags: typeMonster, level: 2, attack: 1000, defense: 1000 },
      { code: waterMaterialCode, name: "Cat Shark WATER Material", kind: "monster", typeFlags: typeMonster, attribute: attributeWater, level: 2, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Cat Shark Battle Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 84224627, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [genericMaterialCode, waterMaterialCode], extra: [catSharkCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const catShark = requireCard(session, catSharkCode);
    const genericMaterial = requireCard(session, genericMaterialCode);
    const waterMaterial = requireCard(session, waterMaterialCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, catShark, 0);
    moveDuelCard(session.state, genericMaterial.uid, "overlay", 0);
    moveDuelCard(session.state, waterMaterial.uid, "overlay", 0);
    catShark.overlayUids.push(genericMaterial.uid, waterMaterial.uid);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(catSharkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === catShark.uid && effect.code === 42)).toMatchObject({
      code: 42,
      event: "continuous",
      range: ["monsterZone"],
      luaConditionDescriptor: "condition:source-overlay-has-attribute:2",
      sourceUid: catShark.uid,
      value: 1,
    });

    const openingAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === catShark.uid && action.targetUid === defender.uid
    );
    expect(openingAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, openingAttack!);
    const opponentPass = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, opponentPass!);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === catShark.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === genericMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: catShark.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === catShark.uid)?.overlayUids).toEqual([waterMaterial.uid]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === catShark.uid)!, restoredOpen.session.state)).toBe(1000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === catShark.uid)!, restoredOpen.session.state)).toBe(1000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === catShark.uid && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169792 }, value: 1000 },
      { code: 106, reset: { flags: 1107169792 }, value: 1000 },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    finishBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 600, 1: 0 });
    expect(restoredBoost.session.state.players[0].lifePoints).toBe(7400);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: defender.uid,
        eventPlayer: 0,
        eventValue: 600,
        eventReason: duelReason.battle,
        eventReasonCardUid: defender.uid,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === catShark.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
