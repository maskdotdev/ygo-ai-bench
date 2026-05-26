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
const queenCode = "89516305";
const materialCode = "895163050";
const plantCode = "895163051";
const defenderCode = "895163052";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasQueenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${queenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const racePlant = 0x400;
const attributeLight = 0x10;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasQueenScript)("Lua real script Number 87 Queen of the Night SelectEffect position attack stat", () => {
  it("restores SelectEffect detach branches for Plant turn-set and targeted ATK gain through battle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${queenCode}.lua`));
    const reader = createCardReader(cards());

    const positionSession = createQueenSession(reader, workspace, 89516305);
    const positionQueen = requireCard(positionSession, queenCode);
    const positionMaterial = requireCard(positionSession, materialCode);
    const plant = requireCard(positionSession, plantCode);
    moveFaceUpAttack(positionSession, positionQueen, 0, 0);
    attachMaterial(positionSession, positionQueen, positionMaterial);
    moveFaceUpAttack(positionSession, plant, 1, 0);

    const restoredPositionOpen = restoreDuelWithLuaScripts(serializeDuel(positionSession), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredPositionOpen);
    expectRestoredLegalActions(restoredPositionOpen, 0);
    const positionBranch = getLuaRestoreLegalActions(restoredPositionOpen, 0).find((action) => action.type === "activateEffect" && action.uid === positionQueen.uid && action.effectId === "lua-2-1002");
    expect(positionBranch, JSON.stringify(getLuaRestoreLegalActions(restoredPositionOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPositionOpen, positionBranch!);
    expect(restoredPositionOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [2, 3], descriptions: [1432260882, 1432260883], returned: 2 },
    ]);
    resolveRestoredChain(restoredPositionOpen);
    expect(restoredPositionOpen.session.state.cards.find((card) => card.uid === positionMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: positionQueen.uid,
      reasonEffectId: 2,
    });
    expect(restoredPositionOpen.session.state.cards.find((card) => card.uid === positionQueen.uid)?.overlayUids).toEqual([]);
    expect(restoredPositionOpen.session.state.cards.find((card) => card.uid === plant.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restoredPositionOpen.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "positionChanged"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: positionMaterial.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: positionQueen.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: plant.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: plant.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: positionQueen.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);

    const statSession = createQueenSession(reader, workspace, 89516306);
    const statQueen = requireCard(statSession, queenCode);
    const statMaterial = requireCard(statSession, materialCode);
    const defender = requireCard(statSession, defenderCode);
    moveFaceUpAttack(statSession, statQueen, 0, 0);
    attachMaterial(statSession, statQueen, statMaterial);
    moveFaceUpAttack(statSession, defender, 1, 0);

    const restoredStatOpen = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 3 }],
    });
    expectCleanRestore(restoredStatOpen);
    expectRestoredLegalActions(restoredStatOpen, 0);
    const statBranch = getLuaRestoreLegalActions(restoredStatOpen, 0).find((action) => action.type === "activateEffect" && action.uid === statQueen.uid && action.effectId === "lua-2-1002");
    expect(statBranch, JSON.stringify(getLuaRestoreLegalActions(restoredStatOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStatOpen, statBranch!);
    expect(restoredStatOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [3], descriptions: [1432260883], returned: 3 },
    ]);
    resolveRestoredChain(restoredStatOpen);
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === statMaterial.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statQueen.uid,
      reasonEffectId: 2,
    });
    expect(restoredStatOpen.session.state.cards.find((card) => card.uid === statQueen.uid)).toMatchObject({ attackModifier: 300 });
    expect(currentAttack(restoredStatOpen.session.state.cards.find((card) => card.uid === statQueen.uid), restoredStatOpen.session.state)).toBe(3500);
    expect(restoredStatOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredStatOpen.session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 3 }],
    });
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === statQueen.uid), restoredBattle.session.state)).toBe(3500);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === statQueen.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,8,3)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SelectTarget(tp,s.setfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,g,1,tp,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("tc:UpdateAttack(300,nil,c)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_OWNER_RELATE)");
}

function cards(): DuelCardData[] {
  return [
    { code: queenCode, name: "Number 87: Queen of the Night", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 8, attack: 3200, defense: 2800 },
    { code: materialCode, name: "Queen of the Night Xyz Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 8, attack: 1000, defense: 1000 },
    { code: plantCode, name: "Queen of the Night Plant Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Queen of the Night Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 3000, defense: 1000 },
  ];
}

function createQueenSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  seed: number,
): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [queenCode] }, 1: { main: [plantCode, defenderCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(queenCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function attachMaterial(session: DuelSession, queen: DuelCardInstance, material: DuelCardInstance): void {
  moveDuelCard(session.state, material.uid, "overlay", queen.controller);
  queen.overlayUids.push(material.uid);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
