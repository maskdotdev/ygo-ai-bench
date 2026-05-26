import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const carnotCode = "13567610";
const starterCode = "135676100";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCarnotScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${carnotCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x800;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x8;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasCarnotScript)("Lua real script Carnot chain ATK to-grave to-Deck stat", () => {
  it("restores opponent monster chain trigger into ATK gain", () => {
    const { workspace, reader, source, session } = createCarnotSession(13567610);
    const carnot = requireCard(session, carnotCode);
    const starter = requireCard(session, starterCode);
    moveFaceUpAttack(session, carnot, 0, 0);
    moveDuelCard(session.state, starter.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(carnotCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const starterAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, starterAction!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const gain = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === carnot.uid && action.effectId === "lua-3-1027"
    );
    expect(gain, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, gain!);
    declineRestoredTriggers(restoredTrigger, 0);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.messages).toContain("carnot opponent hand monster resolved");
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === carnot.uid), restoredTrigger.session.state)).toBe(4000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 33492992 }, sourceUid: carnot.uid, value: 1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["chaining", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventChainDepth: event.eventChainDepth,
      eventChainLinkId: event.eventChainLinkId,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: starter.uid, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1027, eventName: "chaining", eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 6 },
      { eventCardUid: carnot.uid, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1027, eventName: "chaining", eventPlayer: 0, eventReasonPlayer: 0, eventValue: 2, relatedEffectId: 3 },
      { eventCardUid: undefined, eventChainDepth: 2, eventChainLinkId: "chain-3", eventCode: 1022, eventName: "chainSolved", eventPlayer: 0, eventReasonPlayer: 0, eventValue: 2, relatedEffectId: 3 },
      { eventCardUid: undefined, eventChainDepth: 1, eventChainLinkId: "chain-2", eventCode: 1022, eventName: "chainSolved", eventPlayer: 1, eventReasonPlayer: 1, eventValue: 1, relatedEffectId: 6 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores field-to-grave trigger into self shuffle", () => {
    const { workspace, reader, source, session } = createCarnotSession(13567611);
    const carnot = requireCard(session, carnotCode);
    moveFaceUpAttack(session, carnot, 0, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(carnotCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, carnot.uid, 0, duelReason.effect | duelReason.destroy, 1);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const shuffle = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === carnot.uid && action.effectId === "lua-4-1014"
    );
    expect(shuffle, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, shuffle!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === carnot.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: carnot.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "sentToDeck"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: carnot.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: carnot.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: carnot.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "deck" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createCarnotSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${carnotCode}.lua`));
  const reader = createCardReader(cards());
  const source = {
    readScript(name: string) {
      if (name === `c${starterCode}.lua`) return opponentHandMonsterScript();
      return workspace.readScript(name);
    },
  };
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [carnotCode] }, 1: { main: [starterCode] } });
  startDuel(session);
  return { workspace, reader, source, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Carnot the Eternal Machine");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("return ep==1-tp and re:IsMonsterEffect()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("aux.GlobalCheck");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)");
  expect(script).toContain("Duel.RegisterFlagEffect(rp,id,0,0,0)");
}

function cards(): DuelCardData[] {
  return [
    { code: carnotCode, name: "Carnot the Eternal Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 10, attack: 3000, defense: 2500 },
    { code: starterCode, name: "Carnot Fixture Opponent Hand Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function opponentHandMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function() Debug.Message("carnot opponent hand monster resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function declineRestoredTriggers(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  let guard = 0;
  while (true) {
    expect(++guard).toBeLessThan(10);
    const decline = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "declineTrigger");
    if (!decline) return;
    applyRestoredActionAndAssert(restored, decline);
  }
}
