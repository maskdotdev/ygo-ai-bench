import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isDirectAttackPrevented } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const exchargeCode = "6247535";
const hasExchargeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${exchargeCode}.lua`));
const materialCode = "62475350";
const targetCode = "62475351";
const borrelReviveCode = "62475352";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const attributeDark = 0x20;
const setBorrel = 0x10f;

describe.skipIf(!hasUpstreamScripts || !hasExchargeScript)("Lua real script Borreload eXcharge detach revive lock", () => {
  it("restores Xyz detach target stat reduction, optional Borrel revive, End Phase banish watcher, and temporary summon/direct locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${exchargeCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
    expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,1))");
    expect(script).toContain("Duel.SpecialSummon(sc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("sc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD,0,1)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.RegisterEffect(e3,tp)");
    expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("ge1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("ge2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
    expect(script).toContain("aux.RegisterClientHint(e:GetHandler(),nil,tp,1,0,aux.Stringid(id,2),nil)");

    const cards: DuelCardData[] = [
      { code: exchargeCode, name: "Borreload eXcharge Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeDark, level: 4, attack: 3000, defense: 2500 },
      { code: materialCode, name: "Borreload eXcharge Material", kind: "monster", typeFlags: typeMonster, race: raceDragon, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
      { code: targetCode, name: "Borreload eXcharge Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 2000, defense: 1500 },
      { code: borrelReviveCode, name: "Borreload eXcharge Borrel Revive", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 4, attack: 1800, defense: 1200, setcodes: [setBorrel] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6247535, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, targetCode, borrelReviveCode], extra: [exchargeCode] }, 1: { main: [] } });
    startDuel(session);

    const excharge = requireCard(session, exchargeCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    const borrelRevive = requireCard(session, borrelReviveCode);
    moveFaceUpAttack(session, excharge, 0);
    excharge.summonType = "xyz";
    excharge.summonTypeCode = 0x49000000;
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    excharge.overlayUids.push(material.uid);
    moveFaceUpAttack(session, target, 0);
    moveDuelCard(session.state, borrelRevive.uid, "graveyard", 0);
    borrelRevive.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(exchargeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === excharge.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      property: effect.property,
    }))).toEqual([
      { code: 31, event: "continuous", range: ["monsterZone"], property: 0x40400 },
      { code: 71, event: "continuous", range: ["monsterZone"], property: 0x20000 },
      { code: undefined, event: "ignition", range: ["monsterZone"], property: 0x10 },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === excharge.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredAction(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === excharge.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: excharge.uid,
      reasonEffectId: 3,
    });

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, restoredResolved.session.state.waitingFor ?? restoredResolved.session.state.turnPlayer);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(1400);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === target.uid), restoredResolved.session.state)).toBe(900);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === borrelRevive.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: excharge.uid,
      reasonEffectId: 3,
    });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [100, 104].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 33427456 }, value: -600 },
      { code: 104, event: "continuous", reset: { flags: 33427456 }, value: -600 },
    ]);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.controller === 0 && [22, 73].includes(effect.code ?? 0)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: 22, event: "continuous", property: 0x80800, reset: { flags: 1073742336 }, targetRange: [1, 0] },
      { code: 73, event: "continuous", property: 0x80080, reset: { flags: 1073742336 }, targetRange: [4, 0] },
    ]);
    expect(isDirectAttackPrevented(restoredResolved.session.state, restoredResolved.session.state.cards.find((card) => card.uid === excharge.uid)!, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredResolved.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredResolved.session.state.effects.find((effect) => effect.event === "continuous" && effect.triggerEvent === "phaseEnd" && effect.sourceUid === excharge.uid)).toMatchObject({
      code: 0x1200,
      labelObjectUid: borrelRevive.uid,
    });
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["detachedMaterial", "becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: excharge.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: borrelRevive.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: excharge.uid,
        eventReasonEffectId: 3,
        eventUids: [borrelRevive.uid],
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
