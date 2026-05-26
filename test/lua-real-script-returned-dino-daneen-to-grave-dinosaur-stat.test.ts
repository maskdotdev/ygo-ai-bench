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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const daneenCode = "29927283";
const hasDaneenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${daneenCode}.lua`));
const destroyerCode = "299272830";
const ownDinosaurCode = "299272831";
const ownWarriorCode = "299272832";
const opponentDinosaurCode = "299272833";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDinosaur = 0x10000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasDaneenScript)("Lua real script Returned Dino Daneen to-Grave Dinosaur stat", () => {
  it("restores EVENT_TO_GRAVE into current Dinosaur field ATK updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${daneenCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("re and re:IsMonsterEffect()");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
    expect(script).toContain("Fusion.SummonEffTG(fusion_params)");
    expect(script).toContain("Fusion.SummonEffOP(fusion_params)");
    expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_DINOSAUR),tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(400)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 29927283, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [daneenCode, ownDinosaurCode, ownWarriorCode] }, 1: { main: [destroyerCode, opponentDinosaurCode] } });
    startDuel(session);

    const daneen = requireCard(session, daneenCode);
    const ownDinosaur = requireCard(session, ownDinosaurCode);
    const ownWarrior = requireCard(session, ownWarriorCode);
    const destroyer = requireCard(session, destroyerCode);
    const opponentDinosaur = requireCard(session, opponentDinosaurCode);
    moveFaceUpAttack(session, daneen, 0, 0);
    moveFaceUpAttack(session, ownDinosaur, 0, 1);
    moveFaceUpAttack(session, ownWarrior, 0, 2);
    moveFaceUpAttack(session, destroyer, 1, 0);
    moveFaceUpAttack(session, opponentDinosaur, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = realDaneenWithLocalSupport(workspace);
    const host = createLuaScriptHost(session, workspace);
    for (const code of [daneenCode, destroyerCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === daneen.uid).map((effect) => effect.id)).toEqual(["lua-1-1102", "lua-2", "lua-3-1014"]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const destroy = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, destroy!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === daneen.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1014",
        eventCardUid: daneen.uid,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 4,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: daneen.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === daneen.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownDinosaur.uid), restoredTrigger.session.state)).toBe(1800);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownWarrior.uid), restoredTrigger.session.state)).toBe(1600);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentDinosaur.uid), restoredTrigger.session.state)).toBe(1900);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === ownDinosaur.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: ownDinosaur.uid, value: 400 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "destroyed", eventCardUid: daneen.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: destroyer.uid, eventReasonEffectId: 4 },
      { eventName: "sentToGraveyard", eventCardUid: daneen.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: destroyer.uid, eventReasonEffectId: 4 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === ownDinosaur.uid), restoredStat.session.state)).toBe(1800);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: daneenCode, name: "Returned Dino Daneen", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeWater, level: 1, attack: 400, defense: 1200 },
    { code: destroyerCode, name: "Returned Dino Daneen Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: ownDinosaurCode, name: "Returned Dino Daneen Own Dinosaur", kind: "monster", typeFlags: typeMonster, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: ownWarriorCode, name: "Returned Dino Daneen Own Warrior", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: opponentDinosaurCode, name: "Returned Dino Daneen Opponent Dinosaur", kind: "monster", typeFlags: typeMonster, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1900, defense: 1000 },
  ];
}

function realDaneenWithLocalSupport(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${destroyerCode}.lua`) return destroyerScript();
      return workspace.readScript(name);
    },
  };
}

function destroyerScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${daneenCode}),tp,0,LOCATION_MZONE,nil)
        Duel.Destroy(tc,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
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
  const waitingFor = restored.session.state.waitingFor;
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
