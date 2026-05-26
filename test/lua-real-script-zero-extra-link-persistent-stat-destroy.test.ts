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
const zeroExtraLinkCode = "60162470";
const targetLinkCode = "601624701";
const extraLinkCode = "601624702";
const opponentLinkCode = "601624703";
const battleTargetCode = "601624704";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasZeroExtraLinkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zeroExtraLinkCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeLink = 0x4000000;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;

describe.skipIf(!hasUpstreamScripts || !hasZeroExtraLinkScript)("Lua real script Zero Extra Link persistent stat destroy", () => {
  it("restores persistent co-linked Link targeting into dynamic ATK and battled self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zeroExtraLinkCode}.lua`);
    expect(script).toContain("aux.AddPersistentProcedure(c,0,s.filter)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(aux.PersistentTargetFilter)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.cfilter,e:GetHandlerPlayer(),LOCATION_MZONE,LOCATION_MZONE,nil)*800");
    expect(script).toContain("e:SetLabel(val)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e2:SetLabelObject(e1)");
    expect(script).toContain("c:IsLinkMonster() and c:IsLinkSummoned() and c:HasFlagEffect(id)");
    expect(script).toContain("e1:SetValue(e:GetLabelObject():GetLabel())");
    expect(script).toContain("e3:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("ec:IsHasCardTarget(c) and c:IsReason(REASON_MATERIAL|REASON_LINK)");
    expect(script).toContain("GetReasonCard():RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD&~RESET_TOFIELD,0,1)");
    expect(script).toContain("e4:SetCode(EVENT_BATTLED)");
    expect(script).toContain("return e:GetHandler():IsHasCardTarget(Duel.GetAttacker())");
    expect(script).toContain("Duel.Destroy(e:GetHandler(),REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: zeroExtraLinkCode, name: "Zero Extra Link", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: targetLinkCode, name: "Zero Extra Link Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, level: 2, attack: 1000, defense: 0, linkMarkers: 0x20 },
      { code: extraLinkCode, name: "Zero Extra Link EMZ Fixture", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, level: 2, attack: 1200, defense: 0, linkMarkers: 0x8 },
      { code: opponentLinkCode, name: "Zero Extra Link Opponent Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, level: 2, attack: 1300, defense: 0, linkMarkers: 0x20 },
      { code: battleTargetCode, name: "Zero Extra Link Battle Target", kind: "monster", typeFlags: typeMonster, race: raceCyberse, level: 4, attack: 1500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 60162470, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zeroExtraLinkCode], extra: [targetLinkCode, extraLinkCode] }, 1: { main: [battleTargetCode], extra: [opponentLinkCode] } });
    startDuel(session);

    const zeroExtraLink = requireCard(session, zeroExtraLinkCode);
    const targetLink = requireCard(session, targetLinkCode);
    const extraLink = requireCard(session, extraLinkCode);
    const opponentLink = requireCard(session, opponentLinkCode);
    const battleTarget = requireCard(session, battleTargetCode);
    moveFaceDownSpell(session, zeroExtraLink, 0);
    moveFaceUpLink(session, targetLink, 0, 4);
    moveFaceUpLink(session, extraLink, 0, 5);
    moveFaceUpLink(session, opponentLink, 1, 2);
    moveFaceUpAttack(session, battleTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zeroExtraLinkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === zeroExtraLink.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["chaining", "becameTarget", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
    }))).toEqual([
      { eventName: "chaining", eventCode: 1027, eventCardUid: zeroExtraLink.uid, eventPlayer: 0, eventValue: 1, relatedEffectId: 1, eventChainDepth: 1, eventChainLinkId: "chain-2" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: targetLink.uid, eventPlayer: undefined, eventValue:  1, relatedEffectId: 1, eventChainDepth: 1, eventChainLinkId: "chain-2" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventPlayer: 0, eventValue: 1, relatedEffectId: 1, eventChainDepth: 1, eventChainLinkId: "chain-2" },
    ]);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === zeroExtraLink.uid)).toMatchObject({
      location: "spellTrapZone",
      cardTargetUids: [targetLink.uid],
      faceUp: true,
    });
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === targetLink.uid), restoredActivation.session.state)).toBe(3400);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === extraLink.uid), restoredActivation.session.state)).toBe(1200);
    const persistentProbe = restoredActivation.host.loadScript(persistentProbeScript(zeroExtraLinkCode, targetLinkCode), "zero-extra-link-persistent-probe.lua");
    expect(persistentProbe.ok, persistentProbe.error).toBe(true);
    expect(restoredActivation.host.messages).toContain("zero extra persistent true/true/1/3400");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === targetLink.uid && action.targetUid === battleTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-6-1138",
        eventCardUid: targetLink.uid,
        eventCode: 1138,
        eventName: "afterDamageCalculation",
        player: 0,
        sourceUid: zeroExtraLink.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredBattedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredBattedTrigger);
    expectRestoredLegalActions(restoredBattedTrigger, 0);
    const battledTrigger = getLuaRestoreLegalActions(restoredBattedTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === zeroExtraLink.uid);
    expect(battledTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattedTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(battledTrigger)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restoredBattedTrigger, battledTrigger!);
    passRestoredChain(restoredBattedTrigger);

    expect(restoredBattedTrigger.session.state.cards.find((card) => card.uid === zeroExtraLink.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: zeroExtraLink.uid,
      reasonEffectId: 6,
    });
    expect(restoredBattedTrigger.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "destroyed"].includes(event.eventName)).map((event) => ({
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
      { eventName: "afterDamageCalculation", eventCode: 1138, eventCardUid: targetLink.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "extraDeck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: zeroExtraLink.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: zeroExtraLink.uid, eventReasonEffectId: 6, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function persistentProbeScript(zeroExtraLinkCode: string, targetLinkCode: string): string {
  return `
    local spell=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${zeroExtraLinkCode}),0,LOCATION_SZONE,0,nil)
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetLinkCode}),0,LOCATION_MZONE,0,nil)
    local persistent=Effect.CreateEffect(spell)
    Debug.Message("zero extra persistent " .. tostring(spell:IsHasCardTarget(target)) .. "/" .. tostring(aux.PersistentTargetFilter(persistent,target)) .. "/" .. spell:GetCardTargetCount() .. "/" .. target:GetAttack())
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceUpLink(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  moveFaceUpAttack(session, card, player, sequence);
  card.summonType = "link";
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

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
