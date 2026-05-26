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
const ashuraCode = "80993256";
const materialACode = "809932560";
const materialBCode = "809932561";
const materialCCode = "809932562";
const firstTargetCode = "809932563";
const secondTargetCode = "809932564";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAshuraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ashuraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasAshuraScript)("Lua real script Ashura King battle extra stat", () => {
  it("restores overlay-count extra attacks and mandatory battle-start ATK stacking", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${ashuraCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,3,3,nil,nil,Xyz.InfiniteMats)");
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK)");
    expect(script).toContain("return math.max(0,oc-1)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(200)");
    expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
    expect(script).toContain("e3:SetCategory(CATEGORY_NEGATE+CATEGORY_DESTROY)");
    expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1,1,nil))");

    const cards: DuelCardData[] = [
      { code: ashuraCode, name: "Ashura King", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 3, attack: 2100, defense: 0 },
      { code: materialACode, name: "Ashura King Material A", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: materialBCode, name: "Ashura King Material B", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: materialCCode, name: "Ashura King Material C", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1000, defense: 1000 },
      { code: firstTargetCode, name: "Ashura King First Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "Ashura King Second Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 80993256, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, materialCCode], extra: [ashuraCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const ashura = requireCard(session, ashuraCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const materialC = requireCard(session, materialCCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const secondTarget = requireCard(session, secondTargetCode);
    moveFaceUpAttack(session, ashura, 0);
    for (const [index, material] of [materialA, materialB, materialC].entries()) {
      moveDuelCard(session.state, material.uid, "overlay", 0).sequence = index;
      ashura.overlayUids.push(material.uid);
    }
    moveFaceUpAttack(session, firstTarget, 1);
    moveFaceUpAttack(session, secondTarget, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ashuraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === ashura.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
      valueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: 31, event: "continuous", range: ["monsterZone"], value: undefined, valueDescriptor: undefined },
      { code: 194, event: "continuous", range: ["monsterZone"], value: undefined, valueDescriptor: undefined },
      { code: 1132, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], value: undefined, valueDescriptor: undefined },
      { code: 1027, event: "quick", range: ["monsterZone"], value: undefined, valueDescriptor: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const firstAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ashura.uid && action.targetUid === firstTarget.uid
    );
    expect(firstAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, firstAttack!);
    passUntilBattleStarted(restoredOpen);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-3-1132",
        eventCardUid: ashura.uid,
        eventCode: 1132,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleStarted",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [ashura.uid, firstTarget.uid],
        id: "trigger-3-1",
        player: 0,
        sourceUid: ashura.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const battleStart = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ashura.uid);
    expect(battleStart, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, battleStart!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ashura.uid), restoredTrigger.session.state)).toBe(2300);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === ashura.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33492992 }, sourceUid: ashura.uid, value: 200 },
    ]);

    finishBattle(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1300 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: ashura.uid,
        eventPlayer: 1,
        eventValue: 1300,
        eventReason: duelReason.battle,
        eventReasonCardUid: ashura.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    restoredSecondAttack.session.state.phase = "battle";
    restoredSecondAttack.session.state.waitingFor = 0;
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    const secondAttack = secondActions.find((action) =>
      action.type === "declareAttack" && action.attackerUid === ashura.uid && action.targetUid === secondTarget.uid
    );
    expect(secondAttack, JSON.stringify(secondActions, null, 2)).toBeDefined();
    expect(hasDirectAttack(secondActions, ashura.uid)).toBe(false);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true);
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.battleWindow?.kind !== "startDamageStep") {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passAttack" || action.type === "passDamage");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
