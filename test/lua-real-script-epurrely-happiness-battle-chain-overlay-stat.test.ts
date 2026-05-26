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
const happinessCode = "52645235";
const happyMemoryCode = "82105704";
const quickPlayCode = "526452350";
const searchPurrelyCode = "526452351";
const battleTargetCode = "526452352";
const opponentBackrowCode = "526452353";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasHappinessScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${happinessCode}.lua`));
const setPurrely = 0x18d;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeQuickPlay = 0x10000;
const typeXyz = 0x800000;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHappinessScript)("Lua real script Epurrely Happiness battle chain overlay stat", () => {
  it("restores battle search and Happy Memory ATK halve plus chained Quick-Play overlay bounce", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${happinessCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards(workspace));

    const battle = createRestoredBattleField({ reader, source, workspace });
    expectCleanRestore(battle);
    expectRestoredLegalActions(battle, 0);
    const battleHappiness = requireCard(battle.session, happinessCode);
    const battleTarget = requireCard(battle.session, battleTargetCode);
    const searchTarget = requireCard(battle.session, searchPurrelyCode);
    const attack = getLuaRestoreLegalActions(battle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleHappiness.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(battle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(battle, attack!);
    passRestoredBattleUntilTrigger(battle);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(battle.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battleHappiness.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    if (!trigger || trigger.type !== "activateTrigger") throw new Error("Missing Epurrely Happiness battle trigger");
    const battleEffectId = Number(trigger.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredTrigger, trigger);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: battleHappiness.uid,
      reasonEffectId: battleEffectId,
    });
    expect(restoredTrigger.host.messages).toContain(`confirmed 1: ${searchPurrelyCode}`);
    expect(restoredTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(currentAttack(findCard(restoredTrigger.session, battleHappiness.uid), restoredTrigger.session.state)).toBe(1000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === battleHappiness.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: battleHappiness.uid, value: 1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) =>
      ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: searchTarget.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: battleHappiness.uid, eventReasonEffectId: battleEffectId, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: battleHappiness.uid, eventReasonEffectId: battleEffectId, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: battleHappiness.uid, eventReasonEffectId: battleEffectId, eventReasonPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });

    const chain = createRestoredChainField({ reader, source, workspace });
    expectCleanRestore(chain);
    expectRestoredLegalActions(chain, 0);
    const chainHappiness = requireCard(chain.session, happinessCode);
    const quickPlay = requireCard(chain.session, quickPlayCode);
    const opponentBackrow = requireCard(chain.session, opponentBackrowCode);
    const quickPlayActivation = getLuaRestoreLegalActions(chain, 0).find((action) =>
      action.type === "activateEffect" && action.uid === quickPlay.uid
    );
    expect(quickPlayActivation, JSON.stringify(getLuaRestoreLegalActions(chain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(chain, quickPlayActivation!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(chain.session), source, reader);
    expectCleanRestore(restoredResponse);
    if (restoredResponse.session.state.waitingFor === 1) {
      expectRestoredLegalActions(restoredResponse, 1);
      const opponentPass = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "passChain");
      expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restoredResponse, opponentPass!);
    }
    expectRestoredLegalActions(restoredResponse, 0);
    const overlayResponse = getLuaRestoreLegalActions(restoredResponse, 0).find((action) =>
      action.type === "activateEffect" && action.uid === chainHappiness.uid && action.effectId.endsWith("-1027")
    );
    expect(overlayResponse, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    if (!overlayResponse || overlayResponse.type !== "activateEffect") throw new Error("Missing Epurrely Happiness chain response");
    const overlayEffectId = Number(overlayResponse.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredResponse, overlayResponse);
    resolveRestoredChain(restoredResponse);

    expect(findCard(restoredResponse.session, chainHappiness.uid).overlayUids).toEqual([quickPlay.uid]);
    expect(findCard(restoredResponse.session, quickPlay.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chainHappiness.uid,
      reasonEffectId: overlayEffectId,
    });
    expect(findCard(restoredResponse.session, opponentBackrow.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: chainHappiness.uid,
      reasonEffectId: overlayEffectId,
    });
    expect(restoredResponse.host.messages).toContain("epurrely quick-play resolved");
    expect(restoredResponse.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "sentToHand").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: opponentBackrow.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: chainHappiness.uid, eventReasonEffectId: overlayEffectId, eventReasonPlayer: 0 },
    ]);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

type ScriptSource = { readScript(name: string): string | undefined };

function createRestoredBattleField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 52645235, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [happyMemoryCode, searchPurrelyCode], extra: [happinessCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  const happiness = requireCard(session, happinessCode);
  const happyMemory = requireCard(session, happyMemoryCode);
  moveFaceUpAttack(session, happiness, 0, 0);
  attachOverlayMaterial(session, happiness, happyMemory, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(happinessCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredChainField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ScriptSource;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 52645236, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [quickPlayCode], extra: [happinessCode] }, 1: { main: [opponentBackrowCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, happinessCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, quickPlayCode).uid, "hand", 0);
  moveFaceUpBackrow(session, requireCard(session, opponentBackrowCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(happinessCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(quickPlayCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Epurrely Happiness");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("Xyz.AddProcedure(c,nil,2,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("c:HasFlagEffect(id) and (c:IsRelateToBattle() or c:IsReason(REASON_BATTLE))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("c:GetOverlayGroup():IsExists(Card.IsCode,1,nil,82105704)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()//2)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLED)");
  expect(script).toContain("e3:SetCode(EVENT_CHAINING)");
  expect(script).toContain("rc:IsSetCard(SET_PURRELY) and rc:IsQuickPlaySpell()");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,1-tp,LOCATION_ONFIELD)");
  expect(script).toContain("Duel.Overlay(c,rc)");
  expect(script).toContain("rc:CancelToGrave()");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const happiness = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === happinessCode);
  const happyMemory = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === happyMemoryCode);
  expect(happiness).toBeDefined();
  expect(happyMemory).toBeDefined();
  return [
    { ...happiness!, kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceFairy, attribute: attributeLight, setcodes: [setPurrely], level: 2, attack: 2000, defense: 100 },
    { ...happyMemory!, kind: "spell", typeFlags: typeSpell | typeQuickPlay, setcodes: [setPurrely] },
    { code: quickPlayCode, name: "Epurrely Fixture Quick-Play", kind: "spell", typeFlags: typeSpell | typeQuickPlay, setcodes: [setPurrely] },
    { code: searchPurrelyCode, name: "Epurrely Fixture Search Purrely", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 1, attack: 100, defense: 100, setcodes: [setPurrely] },
    { code: battleTargetCode, name: "Epurrely Fixture Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: opponentBackrowCode, name: "Epurrely Fixture Opponent Backrow", kind: "spell", typeFlags: typeSpell },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return {
    readScript(name: string) {
      if (name === `c${quickPlayCode}.lua`) return quickPlayScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function quickPlayScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp)
        Debug.Message("epurrely quick-play resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpBackrow(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function attachOverlayMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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

function passRestoredBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
