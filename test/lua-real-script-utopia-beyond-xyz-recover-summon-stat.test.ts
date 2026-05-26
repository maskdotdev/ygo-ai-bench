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
const beyondCode = "21521304";
const materialACode = "215213040";
const materialBCode = "215213041";
const opponentACode = "215213042";
const opponentBCode = "215213043";
const graveUtopiaCode = "215213044";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBeyondScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${beyondCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const setUtopia = 0x107f;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasBeyondScript)("Lua real script Utopia Beyond Xyz recover summon stat", () => {
  it("restores Xyz Summon ATK-zero trigger and detach quick effect into banish, revive, and recover", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${beyondCode}.lua`);
    expectUtopiaBeyondScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 21521304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, graveUtopiaCode], extra: [beyondCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const beyond = requireCard(session, beyondCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    const graveUtopia = requireCard(session, graveUtopiaCode);
    moveFaceUpAttack(session, materialA, 0, 0);
    moveFaceUpAttack(session, materialB, 0, 1);
    moveFaceUpAttack(session, opponentA, 1, 0);
    moveFaceUpAttack(session, opponentB, 1, 1);
    moveDuelCard(session.state, graveUtopia.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(beyondCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === beyond.uid)?.data).toMatchObject({
      xyzMaterialCount: 2,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === beyond.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 334, event: "continuous", luaConditionDescriptor: undefined, property: 0x400, range: ["extraDeck"], triggerEvent: undefined, value: setUtopia },
      { category: undefined, code: 31, event: "continuous", luaConditionDescriptor: undefined, property: 263168, range: ["extraDeck"], triggerEvent: undefined, value: undefined },
      { category: 0x200000, code: 1102, event: "trigger", luaConditionDescriptor: "condition:source-summon-type:1224736768", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned", value: undefined },
      { category: 0x100204, code: 1002, event: "quick", luaConditionDescriptor: undefined, property: 0x10, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const xyz = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "xyzSummon" &&
      action.uid === beyond.uid &&
      action.materialUids.includes(materialA.uid) &&
      action.materialUids.includes(materialB.uid)
    );
    expect(xyz, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, xyz!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === beyond.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "xyz",
      summonMaterialUids: [materialA.uid, materialB.uid],
      overlayUids: [materialA.uid, materialB.uid],
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: beyond.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === beyond.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentA.uid), restoredTrigger.session.state)).toBe(0);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentB.uid), restoredTrigger.session.state)).toBe(0);
    expect(restoredTrigger.session.state.effects.filter((effect) => [opponentA.uid, opponentB.uid].includes(effect.sourceUid) && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: opponentA.uid, value: 0 },
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: opponentB.uid, value: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === beyond.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: beyond.uid,
      reasonEffectId: 4,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === beyond.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: beyond.uid,
      reasonEffectId: 4,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === graveUtopia.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: beyond.uid,
      reasonEffectId: 4,
    });
    expect(restoredQuick.session.state.players[0].lifePoints).toBe(9250);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === beyond.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["detachedMaterial", "banished", "specialSummoned", "breakEffect", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCardUid: beyond.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "detachedMaterial", eventCardUid: materialA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: beyond.uid, eventReasonEffectId: 4, previous: "overlay", current: "graveyard" },
      { eventName: "banished", eventCardUid: beyond.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: beyond.uid, eventReasonEffectId: 4, previous: "monsterZone", current: "banished" },
      { eventName: "specialSummoned", eventCardUid: graveUtopia.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: beyond.uid, eventReasonEffectId: 4, previous: "graveyard", current: "monsterZone" },
      { eventName: "breakEffect", eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: beyond.uid, eventReasonEffectId: 4, previous: undefined, current: undefined },
      { eventName: "recoveredLifePoints", eventCardUid: undefined, eventPlayer: 0, eventValue: 1250, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: beyond.uid, eventReasonEffectId: 4, previous: undefined, current: undefined },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectUtopiaBeyondScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:AddSetcodesRule(id,true,SET_UTOPIA)");
  expect(script).toContain("Xyz.AddProcedure(c,nil,6,2)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE+CATEGORY_SPECIAL_SUMMON+CATEGORY_RECOVER)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_XYZ) and c:IsAbleToRemove()");
  expect(script).toContain("return c:IsSetCard(SET_UTOPIA) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectTarget(tp,s.rmfilter,tp,LOCATION_MZONE,0,1,1,nil,ft)");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_RECOVER,0,0,tp,1250)");
  expect(script).toContain("Duel.Remove(tc1,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("Duel.SpecialSummon(tc2,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Recover(tp,1250,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: beyondCode, name: "Number 39: Utopia Beyond", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, level: 6, attack: 3000, defense: 2500 },
    { code: materialACode, name: "Utopia Beyond Xyz Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 6, attack: 1400, defense: 1000 },
    { code: materialBCode, name: "Utopia Beyond Xyz Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 6, attack: 1600, defense: 1000 },
    { code: opponentACode, name: "Utopia Beyond Opponent A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2600, defense: 1200 },
    { code: opponentBCode, name: "Utopia Beyond Opponent B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1500 },
    { code: graveUtopiaCode, name: "Number 39: Utopia", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeLight, setcodes: [setUtopia], level: 4, attack: 2500, defense: 2000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
