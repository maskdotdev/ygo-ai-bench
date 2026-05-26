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
const clovenCode = "99315585";
const triggerCode = "993155850";
const recoverCode = "993155851";
const offSetCode = "993155852";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasClovenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clovenCode}.lua`));
const setThePhantomKnights = 0x10db;
const setPhantomKnights = 0xdb;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const phaseEndEventCode = 4608;

describe.skipIf(!hasUpstreamScripts || !hasClovenScript)("Lua real script Phantom Knights Cloven Helm to-Grave End to-hand stat", () => {
  it("restores EVENT_TO_GRAVE ATK gain and grave SelfBanish End Phase Phantom Knights recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${clovenCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const attack = createRestoredAttackOpen(workspace, reader);
    expectCleanRestore(attack);
    expectRestoredLegalActions(attack, 0);
    const cloven = requireCard(attack.session, clovenCode);
    const trigger = requireCard(attack.session, triggerCode);
    const send = attack.host.loadScript(
      `
      local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${triggerCode}),0,LOCATION_MZONE,0,nil)
      Duel.SendtoGrave(tc,REASON_EFFECT)
      `,
      "cloven-helm-send-trigger.lua",
    );
    expect(send.ok, send.error).toBe(true);
    const boost = getLuaRestoreLegalActions(attack, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === cloven.uid && action.effectId === "lua-1-1014"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(attack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(attack, boost!);
    resolveRestoredChain(attack);
    expect(currentAttack(findCard(attack.session, cloven.uid), attack.session.state)).toBe(2000);
    expect(attack.session.state.effects.filter((effect) => effect.sourceUid === cloven.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x2000, reset: { flags: 33492992 }, sourceUid: cloven.uid, value: 500 },
    ]);
    expect(attack.session.state.eventHistory.filter((event) =>
      ["sentToGraveyard", "chainSolved"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: trigger.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: undefined, eventCode: 1022, eventName: "chainSolved", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const search = createRestoredGraveOpen(workspace, reader);
    expectCleanRestore(search);
    expectRestoredLegalActions(search, 0);
    const graveCloven = requireCard(search.session, clovenCode);
    const recover = requireCard(search.session, recoverCode);
    const offSet = requireCard(search.session, offSetCode);
    const register = getLuaRestoreLegalActions(search, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveCloven.uid && action.effectId === "lua-2"
    );
    expect(register, JSON.stringify(getLuaRestoreLegalActions(search, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search, register!);
    resolveRestoredChain(search);
    expect(findCard(search.session, graveCloven.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCloven.uid,
      reasonEffectId: 2,
    });
    expect(search.session.state.effects.filter((effect) => effect.sourceUid === graveCloven.uid && effect.code === phaseEndEventCode).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: phaseEndEventCode, controller: 0, reset: { flags: 0x40000200 }, sourceUid: graveCloven.uid },
    ]);
    const endTurn = getLuaRestoreLegalActions(search, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(search, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(search, endTurn!);
    expect(findCard(search.session, recover.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveCloven.uid,
      reasonEffectId: 3,
    });
    expect(findCard(search.session, offSet.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(search.host.messages).toContain(`confirmed 1: ${recoverCode}`);
    expect(search.session.state.eventHistory.filter((event) =>
      ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: graveCloven.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: graveCloven.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
      { eventCardUid: recover.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: graveCloven.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: recover.uid, eventCode: 1211, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: graveCloven.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: recover.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: graveCloven.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
    expect(search.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: clovenCode, name: "The Phantom Knights of Cloven Helm", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 500, setcodes: [setThePhantomKnights] },
    { code: triggerCode, name: "Cloven Helm Phantom Knights Trigger", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 3, attack: 900, defense: 800, setcodes: [setThePhantomKnights] },
    { code: recoverCode, name: "Cloven Helm Phantom Knights Recovery", kind: "spell", typeFlags: typeSpell, setcodes: [setPhantomKnights] },
    { code: offSetCode, name: "Cloven Helm Off-Set Grave Decoy", kind: "trap", typeFlags: typeTrap, setcodes: [0x123] },
  ];
}

function createRestoredAttackOpen(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 99315585, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clovenCode, triggerCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, clovenCode), 0);
  moveFaceUpAttack(session, requireCard(session, triggerCode), 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clovenCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveOpen(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 99315586, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [clovenCode, recoverCode, offSetCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, clovenCode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, recoverCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, offSetCode).uid, "graveyard", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(clovenCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("The Phantom Knights of Cloven Helm");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return eg:IsExists(s.tgfilter,1,nil,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
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
  while (restored.session.state.chain.length > 0 && guard < 10) {
    guard += 1;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
  expect(guard).toBeLessThan(10);
}
