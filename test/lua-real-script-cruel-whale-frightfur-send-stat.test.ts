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
const cruelWhaleCode = "78778375";
const frightfurSendCode = "787783750";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCruelWhaleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cruelWhaleCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setFrightfur = 0xad;

describe.skipIf(!hasUpstreamScripts || !hasCruelWhaleScript)("Lua real script Frightfur Cruel Whale send stat", () => {
  it("restores targeted Fusion ATK gain after sending a Frightfur card from Deck to GY", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cruelWhaleCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_EDGE_IMP),aux.FilterBoolFunctionEx(Card.IsSetCard,SET_FLUFFAL))");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCondition(function(e) return e:GetHandler():IsFusionSummoned() end)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,aux.dpcheck(Card.GetControler),1,tp,HINTMSG_DESTROY)");
    expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e2:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsType(TYPE_FUSION) and c:GetBaseAttack()>0 and c:IsFaceup()");
    expect(script).toContain("return c:IsSetCard(SET_FRIGHTFUR) and not c:IsCode(id) and c:IsAbleToGrave()");
    expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK|LOCATION_EXTRA)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.gyfilter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil):GetFirst()");
    expect(script).toContain("Duel.SendtoGrave(sc,REASON_EFFECT)>0");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(tc:GetBaseAttack()/2)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 78778375, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [frightfurSendCode], extra: [cruelWhaleCode] }, 1: { main: [] } });
    startDuel(session);
    const cruelWhale = requireCard(session, cruelWhaleCode);
    const sendTarget = requireCard(session, frightfurSendCode);
    moveFaceUpFusion(session, cruelWhale, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cruelWhaleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === cruelWhale.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === sendTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: cruelWhale.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === cruelWhale.uid), restoredOpen.session.state)).toBe(3900);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === cruelWhale.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 1107169792 }, value: 1300 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      eventChainLinkId: event.eventChainLinkId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: cruelWhale.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, eventChainLinkId: "chain-2", previousLocation: "extraDeck", currentLocation: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: sendTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: cruelWhale.uid, eventReasonEffectId: 3, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "deck", currentLocation: "graveyard" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, eventChainLinkId: "chain-2", previousLocation: undefined, currentLocation: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: cruelWhaleCode, name: "Frightfur Cruel Whale", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceFiend, attribute: attributeDark, level: 9, attack: 2600, defense: 2400, setcodes: [setFrightfur] },
    { code: frightfurSendCode, name: "Frightfur Send Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, setcodes: [setFrightfur] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpFusion(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.summonType = "fusion";
  moved.summonTypeCode = 0x43000000;
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
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
