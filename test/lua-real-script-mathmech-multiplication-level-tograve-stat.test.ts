import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const multiplicationCode = "52354896";
const levelTargetCode = "523548960";
const extraCyberseCode = "523548961";
const decoyCode = "523548962";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMultiplicationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${multiplicationCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const effectSetAttackFinal = 102;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasMultiplicationScript)("Lua real script Mathmech Multiplication level to-Grave stat", () => {
  it("restores targeted level change and delayed to-Grave final ATK doubling", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${multiplicationCode}.lua`));
    const reader = createCardReader(cards());

    const restoredLevel = createRestoredMultiplicationSession({ reader, workspace });
    expectCleanRestore(restoredLevel);
    expectRestoredLegalActions(restoredLevel, 0);
    const multiplication = requireCard(restoredLevel.session, multiplicationCode);
    const levelAction = getLuaRestoreLegalActions(restoredLevel, 0).find(
      (action) => action.type === "activateEffect" && action.uid === multiplication.uid && action.effectId === "lua-1",
    );
    expect(levelAction, JSON.stringify(getLuaRestoreLegalActions(restoredLevel, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLevel, levelAction!);
    resolveRestoredChain(restoredLevel);

    expect(currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === multiplication.uid), restoredLevel.session.state)).toBe(8);
    expect(restoredLevel.session.state.effects.filter((effect) => effect.sourceUid === multiplication.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, controller: 0, event: "continuous", reset: { flags: 1107169792 }, sourceUid: multiplication.uid, value: 8 },
    ]);
    expect(restoredLevel.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: multiplication.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
    ]);

    const restoredGrave = createRestoredMultiplicationSession({ reader, workspace });
    expectCleanRestore(restoredGrave);
    const graveMultiplication = requireCard(restoredGrave.session, multiplicationCode);
    const extraCyberse = requireCard(restoredGrave.session, extraCyberseCode);
    sendDuelCardToGraveyard(restoredGrave.session.state, graveMultiplication.uid, 0, duelReason.effect, 0);
    expect(restoredGrave.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1014", eventCardUid: graveMultiplication.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, player: 0, sourceUid: graveMultiplication.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const statAction = getLuaRestoreLegalActions(restoredTrigger, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === graveMultiplication.uid && action.effectId === "lua-2-1014",
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, statAction!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === extraCyberse.uid), restoredTrigger.session.state)).toBe(4200);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === extraCyberse.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: extraCyberse.uid, value: 4200 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveMultiplication.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: extraCyberse.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 2 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
  expect(script).toContain("e1:SetCountLimit(1,id)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return c:IsFaceup() and c:GetLevel()==4 and c:IsRace(RACE_CYBERSE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e1:SetValue(8)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_CYBERSE) and c:GetSequence()>4");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
}

function cards(): DuelCardData[] {
  return [
    { code: multiplicationCode, name: "Mathmech Multiplication", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 500, defense: 2000 },
    { code: levelTargetCode, name: "Mathmech Multiplication Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: extraCyberseCode, name: "Mathmech Multiplication Extra Cyberse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 2100, defense: 1000 },
    { code: decoyCode, name: "Mathmech Multiplication Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1000 },
  ];
}

function createRestoredMultiplicationSession(
  { reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 52354896, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [multiplicationCode, levelTargetCode, extraCyberseCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, multiplicationCode), 0);
  moveFaceUpAttack(session, requireCard(session, levelTargetCode), 0);
  moveFaceUpAttack(session, requireCard(session, decoyCode), 0);
  moveFaceUpAttack(session, requireCard(session, extraCyberseCode), 0).sequence = 5;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(multiplicationCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
