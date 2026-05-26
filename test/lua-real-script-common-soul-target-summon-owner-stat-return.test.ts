import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const commonSoulCode = "14772491";
const neoSpacianCode = "147724910";
const targetCode = "147724911";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCommonSoulScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${commonSoulCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const raceAqua = 0x40;
const attributeLight = 0x10;
const attributeWater = 0x2;
const setNeoSpacian = 0x1f;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasCommonSoulScript)("Lua real script Common Soul target summon owner stat return", () => {
  it("restores target selection into opponent-field Neo-Spacian summon, owner-related ATK gain, and leave-field return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectCommonSoulScriptShape(workspace.readScript(`official/c${commonSoulCode}.lua`));
    const reader = createCardReader(cards());
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const commonSoul = requireCard(restoredOpen.session, commonSoulCode);
    const neoSpacian = requireCard(restoredOpen.session, neoSpacianCode);
    const target = requireCard(restoredOpen.session, targetCode, 1);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === commonSoul.uid && action.effectId === "lua-1-1002",
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === commonSoul.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      cardTargetUids: [target.uid, neoSpacian.uid],
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === neoSpacian.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: commonSoul.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(2600);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      labelObjectUid: effect.labelObjectUid,
      property: effect.property,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, labelObjectUid: neoSpacian.uid, property: 0x1020000, range: ["monsterZone"], registryKey: `lua:${commonSoulCode}:lua-3-100`, reset: { flags: 33427456 }, sourceUid: target.uid, value: 1000 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: neoSpacian.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: commonSoul.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === target.uid), restoredPersistent.session.state)).toBe(2600);

    const restoredLeave = restoreDuelWithLuaScripts(serializeDuel(restoredPersistent.session), workspace, reader);
    expectCleanRestore(restoredLeave);
    expectRestoredLegalActions(restoredLeave, 0);
    destroyDuelCard(restoredLeave.session.state, commonSoul.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredLeave.session.state.cards.find((card) => card.uid === commonSoul.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredLeave.session.state.cards.find((card) => card.uid === neoSpacian.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      owner: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: commonSoul.uid,
      reasonEffectId: 2,
    });
    expect(restoredLeave.session.state.cards.find((card) => card.uid === commonSoul.uid)?.cardTargetUids).toEqual([target.uid]);
    expect(currentAttack(restoredLeave.session.state.cards.find((card) => card.uid === target.uid), restoredLeave.session.state)).toBe(1600);
    expect(restoredLeave.session.state.eventHistory.filter((event) => ["leftField", "sentToHand"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "leftField", eventCode: 1015, eventCardUid: commonSoul.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "leftField", eventCode: 1015, eventCardUid: neoSpacian.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: commonSoul.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "hand" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: neoSpacian.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: commonSoul.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "hand" },
    ]);
    expect(restoredLeave.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 14772491, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [commonSoulCode, neoSpacianCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, commonSoulCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, neoSpacianCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, targetCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(commonSoulCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCommonSoulScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Common Soul");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_HAND,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(sc,0,tp,cp,false,false,POS_FACEUP)");
  expect(script).toContain("c:SetCardTarget(tc)");
  expect(script).toContain("c:SetCardTarget(sc)");
  expect(script).toContain("e:GetLabelObject():SetLabelObject(sc)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_OWNER_RELATE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(sc:GetAttack())");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("tc:RegisterEffect(e1,true)");
  expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
  expect(script).toContain("Duel.SendtoHand(e:GetLabelObject(),nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: commonSoulCode, name: "Common Soul", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: neoSpacianCode, name: "Common Soul Neo-Spacian", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNeoSpacian], race: raceAqua, attribute: attributeWater, level: 3, attack: 1000, defense: 800 },
    { code: targetCode, name: "Common Soul Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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
