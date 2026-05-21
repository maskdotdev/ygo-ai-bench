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
const asterismCode = "57970721";
const drytronCode = "579707210";
const opponentTargetCode = "579707211";
const opponentDecoyCode = "579707212";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAsterismScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${asterismCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;
const typeEffect = 0x20;
const setDrytron = 0x151;
const raceMachine = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasAsterismScript)("Lua real script Drytron Asterism two-target stat destroy", () => {
  it("restores dual targets into Drytron ATK loss and opponent monster destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${asterismCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("return Duel.IsMainPhase()");
    expect(script).toContain("return c:IsFaceup() and c:GetAttack()>=1000 and (c:IsSetCard(SET_DRYTRON) or c:IsRitualMonster())");
    expect(script).toContain("Duel.IsExistingTarget(s.atkfilter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("local g1=Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("local g2=Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e:SetLabelObject(g1:GetFirst())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g2,1,0,LOCATION_MZONE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g1,1,0,0)");
    expect(script).toContain("local tc=e:GetLabelObject()");
    expect(script).toContain("local g=Duel.GetTargetCards(e)");
    expect(script).toContain("if dc==tc then dc=g:GetNext() end");
    expect(script).toContain("tc:UpdateAttack(-1000,RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN,c)==-1000");
    expect(script).toContain("Duel.Destroy(dc,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 57970721, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asterismCode, drytronCode] }, 1: { main: [opponentTargetCode, opponentDecoyCode] } });
    startDuel(session);
    const asterism = requireCard(session, asterismCode);
    const drytron = requireCard(session, drytronCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const opponentDecoy = requireCard(session, opponentDecoyCode);
    moveDuelCard(session.state, asterism.uid, "hand", 0);
    moveFaceUpAttack(session, drytron, 0, 0);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    moveFaceUpAttack(session, opponentDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(asterismCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === asterism.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(action)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restored, action!);
    passRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === asterism.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: asterism.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDecoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === drytron.uid), restored.session.state)).toBe(1000);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
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
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: drytron.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: asterism.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: asterism.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: asterism.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: asterismCode, name: "Drytron Asterism", kind: "spell", typeFlags: typeSpell | typeQuickplay, setcodes: [setDrytron] },
    { code: drytronCode, name: "Drytron Asterism Drytron", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 1, attack: 2000, defense: 0, setcodes: [setDrytron] },
    { code: opponentTargetCode, name: "Drytron Asterism Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1800, defense: 1200 },
    { code: opponentDecoyCode, name: "Drytron Asterism Opponent Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
