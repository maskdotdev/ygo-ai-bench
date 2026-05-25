import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rikkaSheetCode = "68941332";
const rikkaCostCode = "689413320";
const targetCode = "689413321";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeWater = 0x10;
const attributeEarth = 0x1;
const categoryDisable = 0x2000;
const effectCannotTrigger = 7;
const effectChangeRace = 122;
const effectFlagCardTarget = 0x10;
const promptOverrides = [{ api: "SelectYesNo" as const, player: 0 as const, returned: true }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rikka Sheet release control race", () => {
  it("restores optional Rikka release cost into cannot-trigger, control, and Plant race change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rikkaSheetCode}.lua`);
    expect(script).toContain("--Rikka Sheet");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,nil,tp)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,nil,tp)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.AND(s.filter,Card.IsControlerCanBeChanged),tp,0,LOCATION_MZONE,1,1,nil,true)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_TRIGGER)");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
    expect(script).toContain("e2:SetCode(EFFECT_CHANGE_RACE)");
    expect(script).toContain("e2:SetValue(RACE_PLANT)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 68941332, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rikkaSheetCode, rikkaCostCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const rikkaSheet = requireCard(session, rikkaSheetCode);
    const rikkaCost = requireCard(session, rikkaCostCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, rikkaSheet.uid, "spellTrapZone", 0);
    rikkaSheet.faceUp = false;
    rikkaSheet.position = "faceDown";
    moveFaceUpAttack(session, rikkaCost, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(rikkaSheetCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === rikkaSheet.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      {
        category: categoryDisable,
        code: 1002,
        event: "quick",
        property: effectFlagCardTarget,
        range: ["spellTrapZone"],
      },
    ]);

    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === rikkaSheet.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    expect(restoredOpen.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1103061313, returned: true },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, { promptOverrides });
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? 0);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === rikkaSheet.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === rikkaCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rikkaSheet.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: rikkaSheet.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [effectCannotTrigger, effectChangeRace].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotTrigger, event: "continuous", property: 0x4000400, reset: { flags: 0x41fe1200 }, value: undefined },
      { code: effectChangeRace, event: "continuous", property: undefined, reset: { flags: 0x41fe1200 }, value: racePlant },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "released", eventCardUid: rikkaCost.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: rikkaSheet.uid, eventReasonEffectId: 1, previousController: 0, currentController: 0 },
      { eventName: "controlChanged", eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: rikkaSheet.uid, eventReasonEffectId: 1, previousController: 1, currentController: 0 },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === rikkaSheetCode),
    { code: rikkaCostCode, name: "Rikka Sheet Cost Plant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
    { code: targetCode, name: "Rikka Sheet Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1200 },
  ];
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
