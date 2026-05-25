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
const dewlorenCode = "70583986";
const ownMonsterCode = "705839860";
const ownSpellCode = "705839861";
const ownFacedownCode = "705839862";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDewlorenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dewlorenCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceBeast = 0x4000;
const attributeWater = 0x2;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDewlorenScript)("Lua real script Dewloren target return operated stat", () => {
  it("restores targeted own-card return to hand into operated-count ATK gain after BreakEffect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dewlorenCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const restored = createRestoredOpen(reader, workspace);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const dewloren = requireCard(restored.session, dewlorenCode);
    const ownMonster = requireCard(restored.session, ownMonsterCode);
    const ownSpell = requireCard(restored.session, ownSpellCode);
    const ownFacedown = requireCard(restored.session, ownFacedownCode);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === dewloren.uid && action.effectId === "lua-3");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activation!);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownMonster.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dewloren.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dewloren.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownFacedown.uid)).toMatchObject({ location: "spellTrapZone", faceUp: false });
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === dewloren.uid), restoredChain.session.state)).toBe(3000);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === dewloren.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: dewloren.uid, value: 1000 },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["becameTarget", "sentToHand", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownSpell.uid, eventUids: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownMonster.uid, eventUids: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: ownSpell.uid, eventUids: undefined, eventReason: duelReason.effect, eventReasonCardUid: dewloren.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: ownMonster.uid, eventUids: undefined, eventReason: duelReason.effect, eventReasonCardUid: dewloren.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: ownSpell.uid, eventUids: [ownSpell.uid, ownMonster.uid], eventReason: duelReason.effect, eventReasonCardUid: dewloren.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonCardUid: dewloren.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 70583986, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [dewlorenCode, ownMonsterCode, ownSpellCode, ownFacedownCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dewlorenCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownMonsterCode), 0, 1);
  moveFaceUpSpell(session, requireCard(session, ownSpellCode), 0);
  const facedown = moveDuelCard(session.state, requireCard(session, ownFacedownCode).uid, "spellTrapZone", 0);
  facedown.faceUp = false;
  facedown.position = "faceDownDefense";
  facedown.sequence = 1;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dewlorenCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dewloren, Tiger King of the Ice Barrier");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsAttribute,ATTRIBUTE_WATER),1,99)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,0,1,12,e:GetHandler())");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,#g,0,0)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.SendtoHand(rg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.GetOperatedGroup()");
  expect(script).toContain("og:FilterCount(Card.IsLocation,nil,LOCATION_HAND)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*500)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const dewloren = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dewlorenCode);
  expect(dewloren).toBeDefined();
  return [
    dewloren!,
    { code: ownMonsterCode, name: "Dewloren Return Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
    { code: ownSpellCode, name: "Dewloren Return Spell", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: ownFacedownCode, name: "Dewloren Facedown Decoy", kind: "spell", typeFlags: typeSpell | typeContinuous },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
