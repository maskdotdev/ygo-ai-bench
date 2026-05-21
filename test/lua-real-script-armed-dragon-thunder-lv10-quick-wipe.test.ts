import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardCodes } from "#duel/card-code-state.js";
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
const lv10Code = "58153103";
const costCode = "581531030";
const firstTargetCode = "581531031";
const ownWipeCode = "581531032";
const opponentWipeCode = "581531033";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLv10Script = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lv10Code}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const setArmedDragon = 0x111;

describe.skipIf(!hasUpstreamScripts || !hasLv10Script)("Lua real script Armed Dragon Thunder LV10 quick wipe", () => {
  it("restores flagged threshold effects, opponent-turn discard destroy boost, and 10000 ATK field wipe", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lv10Code}.lua`);
    expect(script).toContain('Duel.LoadCardScript("c59464593.lua")');
    expect(script).toContain("Duel.IsChainSolving()");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetValue(59464593)");
    expect(script).toContain("e10:SetCode(EFFECT_CANNOT_CHANGE_CONTROL)");
    expect(script).toContain("e100:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e1000:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1000:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("return Duel.IsTurnPlayer(1-tp) and s.atkcon(1000)(e,tp,eg,ep,ev,re,r,rp)");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,nil)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsAbleToGraveAsCost,1,1,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT)>0");
    expect(script).toContain("c:UpdateAttack(1000)");
    expect(script).toContain("e10000:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("Duel.GetMatchingGroup(nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      {
        code: lv10Code,
        name: "Armed Dragon Thunder LV10",
        kind: "monster",
        typeFlags: typeMonster | typeEffect,
        race: raceDragon,
        attribute: attributeWind,
        level: 10,
        attack: 10000,
        defense: 3000,
        setcodes: [setArmedDragon],
      },
      { code: costCode, name: "Armed Dragon Thunder LV10 Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
      { code: firstTargetCode, name: "Armed Dragon Thunder LV10 First Target", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1500, defense: 1000 },
      { code: ownWipeCode, name: "Armed Dragon Thunder LV10 Own Wipe", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
      { code: opponentWipeCode, name: "Armed Dragon Thunder LV10 Opponent Wipe", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 58153103, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lv10Code, costCode, ownWipeCode] }, 1: { main: [firstTargetCode, opponentWipeCode] } });
    startDuel(session);

    const lv10 = requireCard(session, lv10Code);
    const cost = requireCard(session, costCode);
    const firstTarget = requireCard(session, firstTargetCode);
    const ownWipe = requireCard(session, ownWipeCode);
    const opponentWipe = requireCard(session, opponentWipeCode);
    moveFaceUpAttack(session, lv10, 0);
    moveDuelCard(session.state, cost.uid, "hand", 0);
    moveFaceUpAttack(session, firstTarget, 1);
    moveFaceUpAttack(session, ownWipe, 0);
    moveFaceUpAttack(session, opponentWipe, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lv10Code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const flagProbe = host.loadScript(`
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lv10Code}),0,LOCATION_MZONE,0,nil)
      c:RegisterFlagEffect(${lv10Code},RESET_EVENT|RESETS_STANDARD&~RESET_TEMP_REMOVE,EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(${lv10Code},2))
    `, "armed-dragon-thunder-lv10-flag-probe.lua");
    expect(flagProbe.ok, flagProbe.error).toBe(true);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    expect(currentCardCodes(restoredQuick.session.state.cards.find((card) => card.uid === lv10.uid)!, restoredQuick.session.state)).toEqual(["59464593"]);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === lv10.uid && [5, 42, 114].includes(effect.code ?? 0)).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { sourceUid: lv10.uid, code: 114, event: "continuous", range: ["monsterZone"], value: 59464593 },
      { sourceUid: lv10.uid, code: 5, event: "continuous", range: ["monsterZone"], value: undefined },
      { sourceUid: lv10.uid, code: 42, event: "continuous", range: ["monsterZone"], value: 1 },
    ]);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === lv10.uid && action.effectId === "lua-5-1002");
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(quick)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredQuick, quick!);
    passRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lv10.uid,
      reasonEffectId: 5,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === ownWipe.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: lv10.uid,
      reasonEffectId: 5,
    });
    expect(restoredQuick.session.state.cards.find((card) => card.uid === firstTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === lv10.uid), restoredQuick.session.state)).toBe(11000);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: cost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: lv10.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previousLocation: "hand", currentLocation: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownWipe.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 5, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: ownWipe.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: lv10.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: ownWipe.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: lv10.uid, eventReasonEffectId: 5, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    const restoredWipe = restoreDuelWithLuaScripts(serializeDuel(restoredQuick.session), workspace, reader);
    expectCleanRestore(restoredWipe);
    restoredWipe.session.state.phase = "main1";
    restoredWipe.session.state.turnPlayer = 0;
    restoredWipe.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredWipe, 0);
    const wipe = getLuaRestoreLegalActions(restoredWipe, 0).find((action) => action.type === "activateEffect" && action.uid === lv10.uid && action.effectId === "lua-6");
    expect(wipe, JSON.stringify(getLuaRestoreLegalActions(restoredWipe, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(wipe)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredWipe, wipe!);
    passRestoredChain(restoredWipe);

    expect(restoredWipe.session.state.cards.find((card) => card.uid === lv10.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect([firstTarget, opponentWipe].map((card) => restoredWipe.session.state.cards.find((candidate) => candidate.uid === card.uid)).map((card) => ({
      location: card?.location,
      controller: card?.controller,
      reason: card?.reason,
      reasonPlayer: card?.reasonPlayer,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: lv10.uid, reasonEffectId: 6 },
      { location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy, reasonPlayer: 0, reasonCardUid: lv10.uid, reasonEffectId: 6 },
    ]);
    expect(restoredWipe.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && [firstTarget.uid, opponentWipe.uid].includes(event.eventCardUid ?? "")).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: firstTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: lv10.uid, eventReasonEffectId: 6, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentWipe.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: lv10.uid, eventReasonEffectId: 6, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: firstTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: lv10.uid, eventReasonEffectId: 6, previousLocation: "monsterZone", currentLocation: "graveyard" },
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
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
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
