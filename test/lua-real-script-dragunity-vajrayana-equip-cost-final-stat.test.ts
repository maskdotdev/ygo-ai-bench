import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vajrayanaCode = "21249921";
const dragunityTunerCode = "212499210";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasVajrayanaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vajrayanaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceDragon = 0x2000;
const setDragunity = 0x29;
const summonTypeSynchro = 0x46000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasVajrayanaScript)("Lua real script Dragunity Knight - Vajrayana equip cost final stat", () => {
  it("restores Synchro Summon trigger equip from Graveyard into equip-to-Grave ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vajrayanaCode}.lua`);
    expectScriptShape(script);

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vajrayanaCode),
      { code: dragunityTunerCode, name: "Dragunity Vajrayana Graveyard Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceDragon, setcodes: [setDragunity], level: 2, attack: 1000, defense: 400 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 21249921, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dragunityTunerCode], extra: [vajrayanaCode] }, 1: { main: [] } });
    startDuel(session);

    const vajrayana = requireCard(session, vajrayanaCode);
    const tuner = requireCard(session, dragunityTunerCode);
    moveDuelCard(session.state, tuner.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vajrayanaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    vajrayana.summonType = "synchro";
    vajrayana.summonTypeCode = summonTypeSynchro;
    specialSummonDuelCard(session.state, vajrayana.uid, 0, 0, { eventReasonCardUid: vajrayana.uid, eventReasonEffectId: 99 }, summonTypeSynchro, true, true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === vajrayana.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      equippedToUid: vajrayana.uid,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: vajrayana.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === vajrayana.uid), restoredTrigger.session.state)).toBe(1900);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === vajrayana.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === tuner.uid)).toMatchObject({
      location: "graveyard",
      previousEquippedToUid: vajrayana.uid,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: vajrayana.uid,
      reasonEffectId: 6,
    });
    resolveRestoredChain(restoredIgnition);
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === vajrayana.uid), restoredIgnition.session.state)).toBe(3800);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === vajrayana.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107235328 }, value: 3800 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: vajrayana.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: vajrayana.uid,
        eventReasonEffectId: 99,
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: tuner.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: vajrayana.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON),1,1,Synchro.NonTunerEx(Card.IsRace,RACE_WINGEDBEAST),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_LEAVE_GRAVE+CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("c:EquipByEffectAndLimitRegister(e,tp,tc)");
  expect(script).toContain("aux.AddEREquipLimit(c,nil,s.eqval,Card.EquipByEffectAndLimitRegister,e1)");
  expect(script).toContain("c:GetEquipGroup():FilterSelect(tp,s.cfilter,1,1,nil,tp)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
