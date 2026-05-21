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
const sheenCode = "74439492";
const destroyScrapCode = "744394920";
const boostScrapCode = "744394921";
const secondBoostScrapCode = "744394922";
const nonScrapCode = "744394923";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSheenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sheenCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const setScrap = 0x24;
const raceMachine = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSheenScript)("Lua real script Scrap Sheen target destroy team stat", () => {
  it("restores targeted Scrap destruction into remaining Scrap ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sheenCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_SCRAP)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,LOCATION_MZONE,0,1,nil)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,2,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)~=0");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("for ac in aux.Next(g) do");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 74439492, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sheenCode, destroyScrapCode, boostScrapCode, secondBoostScrapCode, nonScrapCode] }, 1: { main: [] } });
    startDuel(session);
    const sheen = requireCard(session, sheenCode);
    const destroyScrap = requireCard(session, destroyScrapCode);
    const boostScrap = requireCard(session, boostScrapCode);
    const secondBoostScrap = requireCard(session, secondBoostScrapCode);
    const nonScrap = requireCard(session, nonScrapCode);
    moveDuelCard(session.state, sheen.uid, "hand", 0);
    moveFaceUpAttack(session, destroyScrap, 0, 0);
    moveFaceUpAttack(session, boostScrap, 0, 1);
    moveFaceUpAttack(session, secondBoostScrap, 0, 2);
    moveFaceUpAttack(session, nonScrap, 0, 3);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sheenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sheen.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(action)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restored, action!);
    passRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === sheen.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restored.session.state.cards.find((card) => card.uid === destroyScrap.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: sheen.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === nonScrap.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === boostScrap.uid), restored.session.state)).toBe(2500);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === secondBoostScrap.uid), restored.session.state)).toBe(2100);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === nonScrap.uid), restored.session.state)).toBe(1800);
    expect(restored.session.state.effects.filter((effect) => [boostScrap.uid, secondBoostScrap.uid].includes(effect.sourceUid ?? "") && effect.code === 100).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: boostScrap.uid, code: 100, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, value: 1000 },
      { sourceUid: secondBoostScrap.uid, code: 100, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, value: 1000 },
    ]);
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
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: destroyScrap.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyScrap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: sheen.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destroyScrap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: sheen.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: sheen.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: sheenCode, name: "Scrap Sheen", kind: "spell", typeFlags: typeSpell },
    { code: destroyScrapCode, name: "Scrap Sheen Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setScrap] },
    { code: boostScrapCode, name: "Scrap Sheen Boost Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000, setcodes: [setScrap] },
    { code: secondBoostScrapCode, name: "Scrap Sheen Boost Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1100, defense: 1000, setcodes: [setScrap] },
    { code: nonScrapCode, name: "Scrap Sheen Non-Scrap", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
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
