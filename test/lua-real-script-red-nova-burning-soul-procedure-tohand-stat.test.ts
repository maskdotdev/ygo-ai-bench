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
const burningSoulCode = "65541655";
const redDragonArchfiendCode = "70902743";
const tunerACode = "655416550";
const tunerBCode = "655416551";
const recoverCode = "655416552";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBurningSoulScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${burningSoulCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceDragon = 0x2000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const effectMultipleTuners = 21142671;

describe.skipIf(!hasUpstreamScripts || !hasBurningSoulScript)("Lua real script Red Nova Burning Soul procedure to hand stat", () => {
  it("restores Extra Deck SelectUnselectGroup banish procedure into GY recovery and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${burningSoulCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restored = createRestoredProcedureOpen(workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const burningSoul = requireCard(restored.session, burningSoulCode);
    const redDragon = requireCard(restored.session, redDragonArchfiendCode);
    const tunerA = requireCard(restored.session, tunerACode);
    const tunerB = requireCard(restored.session, tunerBCode);
    const recoverTarget = requireCard(restored.session, recoverCode);
    expect(burningSoul.data).toMatchObject({
      synchroTunerMin: 2,
      synchroTunerMax: 2,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 1,
    });
    expect(restored.session.state.flagEffects).toEqual([
      { ownerType: "player", ownerId: "0", code: Number(burningSoulCode), reset: 0, property: 0, value: 1, turn: 1 },
    ]);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === burningSoul.uid && effect.code === effectMultipleTuners
    ).map((effect) => ({
      code: effect.code,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: effectMultipleTuners, id: "lua-8-21142671", property: 263168, range: ["extraDeck"], value: undefined },
    ]);

    const procedure = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> =>
        action.type === "specialSummonProcedure" && action.uid === burningSoul.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);
    expect(restored.session.state.cards.find((card) => card.uid === burningSoul.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });
    for (const material of [redDragon, tunerA, tunerB]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "banished",
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: burningSoul.uid,
        reasonEffectId: 4,
      });
    }

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === burningSoul.uid && action.effectId === "lua-5-1102"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);
    expect(restored.session.state.chain).toEqual([]);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === recoverTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: burningSoul.uid,
      reasonEffectId: 5,
    });
    const boostedBurningSoul = restored.session.state.cards.find((card) => card.uid === burningSoul.uid);
    expect(boostedBurningSoul).toMatchObject({ attackModifier: 2000 });
    expect(currentAttack(boostedBurningSoul, restored.session.state)).toBe(5500);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["banished", "specialSummoned", "sentToHand"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: redDragon.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: burningSoul.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventCardUid: tunerA.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: burningSoul.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventCardUid: tunerB.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: burningSoul.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventCardUid: redDragon.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: burningSoul.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventUids: [redDragon.uid, tunerA.uid, tunerB.uid], previous: "graveyard", current: "banished" },
      { eventCardUid: burningSoul.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: recoverTarget.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: burningSoul.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard", current: "hand" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: burningSoulCode, name: "Red Nova Dragon - Burning Soul", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeDark, level: 12, attack: 3500, defense: 3000 },
    { code: redDragonArchfiendCode, name: "Red Dragon Archfiend", kind: "monster", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceDragon, attribute: attributeDark, level: 8, attack: 3000, defense: 2000 },
    { code: tunerACode, name: "Burning Soul Tuner A", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceFiend, attribute: attributeDark, level: 2, attack: 800, defense: 800 },
    { code: tunerBCode, name: "Burning Soul Tuner B", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceFiend, attribute: attributeDark, level: 2, attack: 900, defense: 700 },
    { code: recoverCode, name: "Burning Soul Recovery Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function createRestoredProcedureOpen(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65541655, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [redDragonArchfiendCode, tunerACode, tunerBCode, recoverCode], extra: [burningSoulCode] }, 1: { main: [] } });
  startDuel(session);
  for (const code of [redDragonArchfiendCode, tunerACode, tunerBCode, recoverCode]) {
    moveDuelCard(session.state, requireCard(session, code).uid, "graveyard", 0);
  }
  session.state.flagEffects.push({ ownerType: "player", ownerId: "0", code: Number(burningSoulCode), reset: 0, property: 0, value: 1, turn: session.state.turn });
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(burningSoulCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Red Nova Dragon - Burning Soul");
  expect(script).toContain("Synchro.AddProcedure(c,nil,2,2,Synchro.NonTuner(nil),1,1)");
  expect(script).toContain("c:AddMustBeSynchroSummoned()");
  expect(script).toContain("e0:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("return Duel.GetMZoneCount(tp,sg)>0 and sg:IsExists(Card.IsType,2,nil,TYPE_TUNER) and sg:IsExists(Card.IsCode,1,nil,CARD_RED_DRAGON_ARCHFIEND)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,3,3,s.rescon,1,tp,HINTMSG_REMOVE,nil,nil,true)");
  expect(script).toContain("Duel.Remove(sg,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_DUEL)");
  expect(script).toContain("Duel.HasFlagEffect(tp,id)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,2000)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToHand,tp,LOCATION_GRAVE,0,1,1,nil):GetFirst()");
  expect(script).toContain("c:UpdateAttack(2000)");
  expect(script).toContain("Duel.RegisterFlagEffect(sp,id,0,0,1)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("e3:SetCode(EFFECT_MULTIPLE_TUNERS)");
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
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
