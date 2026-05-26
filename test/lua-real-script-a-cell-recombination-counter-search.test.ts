import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const deviceCode = "91231901";
const targetCode = "912319010";
const sendAlienCode = "912319011";
const searchAlienCode = "912319012";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDeviceScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${deviceCode}.lua`));
const counterA = 0x100e;
const setAlien = 0xc;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasDeviceScript)("Lua real script A Cell Recombination counter search", () => {
  it("restores targeted activation into Deck-to-Grave Alien send and level-count A-Counters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${deviceCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const device = requireCard(session, deviceCode);
    const target = requireCard(session, targetCode);
    const sentAlien = requireCard(session, searchAlienCode);

    moveDuelCard(session.state, device.uid, "hand", 0);
    moveFaceUp(session, target, 1);
    openMain(session);
    registerDevice(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    applyRestoredActionAndAssert(restored, requireAction(restored, device.uid, "activateEffect"));
    resolveRestoredChainIfOpen(restored);

    expect(findCard(restored.session, sentAlien.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: device.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restored.session, target.uid), counterA)).toBe(3);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventPlayer: undefined, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: sentAlien.uid, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: device.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 0x10000, eventName: "counterAdded", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: device.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: device.uid, eventCode: 1014, eventName: "sentToGraveyard", eventPlayer: undefined, eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
  });

  it("restores Graveyard SelfBanish into Alien monster Deck search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${deviceCode}.lua`));
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const device = requireCard(session, deviceCode);
    const searchAlien = requireCard(session, searchAlienCode);

    moveDuelCard(session.state, device.uid, "graveyard", 0).turnId = 0;
    openMain(session);
    registerDevice(session, workspace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    applyRestoredActionAndAssert(restored, requireAction(restored, device.uid, "activateEffect"));
    resolveRestoredChainIfOpen(restored);

    expect(findCard(restored.session, device.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonCardUid: device.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
    });
    expect(findCard(restored.session, searchAlien.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: device.uid,
      reasonEffectId: 2,
      reasonPlayer: 0,
    });
    expect(restored.host.messages).toContain(`confirmed 1: ${searchAlienCode}`);
    expect(restored.session.state.eventHistory.filter((event) => ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: device.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: device.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: searchAlien.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: device.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: searchAlien.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: device.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: searchAlien.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: device.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,g,1,COUNTER_A,1)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("tc:AddCounter(COUNTER_A,sg:GetLevel())");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(): DuelCardData[] {
  return [
    { code: deviceCode, name: '"A" Cell Recombination Device', kind: "spell", typeFlags: 0x10002 },
    { code: targetCode, name: "A-Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
    { code: sendAlienCode, name: "Sent Alien", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], level: 4, attack: 1200, defense: 1000 },
    { code: searchAlienCode, name: "Searched Alien", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setAlien], level: 3, attack: 1000, defense: 1000 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 91231901, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [deviceCode, sendAlienCode, searchAlienCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  return session;
}

function registerDevice(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(deviceCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}
function openMain(session: DuelSession): void {
  session.state.phase = "main1"; session.state.turnPlayer = 0; session.state.waitingFor = 0;
}

function moveFaceUp(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.faceUp = true; moved.position = "faceUpAttack";
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
}

function resolveRestoredChainIfOpen(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  if (restored.session.state.chain.length === 0) return;
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => (action as { type: string }).type === "pass");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function slimEvent(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventPlayer?: PlayerId; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return {
    eventCardUid: event.eventCardUid, eventCode: event.eventCode, eventName: event.eventName, eventPlayer: event.eventPlayer,
    eventReason: event.eventReason, eventReasonCardUid: event.eventReasonCardUid, eventReasonEffectId: event.eventReasonEffectId, eventReasonPlayer: event.eventReasonPlayer,
  };
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
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
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
}
