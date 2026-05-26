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
const horseCode = "92447211";
const revealCode = "924472110";
const costCode = "924472111";
const decoyCode = "924472112";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasHorseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${horseCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const categoryAtkChange = 0x200000;
const categoryToGrave = 0x20;
const eventSummonSuccess = 1100;
const effectFlagDelay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasHorseScript)("Lua real script Long-Tailed Black Horse summon reveal send stat", () => {
  it("restores summon trigger Cost.AND reveal plus Deck send into hand Zombie send and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${horseCode}.lua`);
    expectHorseScriptShape(script);
    const horseData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === horseCode);
    expect(horseData).toBeDefined();
    const reader = createCardReader([horseData!, ...fixtureCards()]);
    const restoredOpen = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const horse = requireCard(restoredOpen.session, horseCode);
    const reveal = requireCard(restoredOpen.session, revealCode);
    const cost = requireCard(restoredOpen.session, costCode);
    const decoy = requireCard(restoredOpen.session, decoyCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === horse.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toContainEqual({ category: categoryToGrave + categoryAtkChange, code: eventSummonSuccess, event: "trigger", property: effectFlagDelay, sourceUid: horse.uid });

    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === horse.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1100", eventCardUid: horse.uid, eventCode: eventSummonSuccess, eventName: "normalSummoned", player: 0, sourceUid: horse.uid, triggerBucket: "turnOptional" },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === horse.uid && action.effectId === "lua-1-1100"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.messages).toContain(`confirmed 1: ${revealCode}`);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: horse.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === reveal.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: horse.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === horse.uid), restoredTrigger.session.state)).toBe((horseData!.attack ?? 0) + 500);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === horse.uid)).toMatchObject({ attackModifier: 500 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "confirmed", "sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: eventSummonSuccess,
        eventCardUid: horse.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: reveal.uid,
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        eventUids: [reveal.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      sentToGraveEvent(cost.uid, horse.uid, duelReason.cost, { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 }, 0),
      sentToGraveEvent(reveal.uid, horse.uid, duelReason.effect, { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 }, 1),
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventReasonPlayer: 0,
        eventValue: 1,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
      },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 92447211, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [horseCode, revealCode, costCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, horseCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, revealCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(horseCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: revealCode, name: "Long-Tailed Black Horse Reveal Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: costCode, name: "Long-Tailed Black Horse Earth Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeEarth, level: 3, attack: 900, defense: 1000 },
    { code: decoyCode, name: "Long-Tailed Black Horse Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectHorseScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Long-Tailed Black Horse");
  expect(script).toContain("e1a:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1a:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1a:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1a:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("local e1b=e1a:Clone()");
  expect(script).toContain("e1b:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Cost.AND(Cost.Reveal(s.revealfilter,false,1,1,s.revealcostop),s.tgcost)");
  expect(script).toContain("return c:IsRace(RACE_ZOMBIE) and c:IsAbleToGrave()");
  expect(script).toContain("e:SetLabelObject(rc)");
  expect(script).toContain("rc:CreateEffectRelation(e)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_EARTH) and c:IsRace(RACE_ZOMBIE) and c:IsAbleToGraveAsCost()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,e:GetLabelObject(),1,tp,0)");
  expect(script).toContain("Duel.SendtoGrave(rc,REASON_EFFECT)");
  expect(script).toContain("c:UpdateAttack(500,RESETS_STANDARD_DISABLE_PHASE_END)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function sentToGraveEvent(
  uid: string,
  sourceUid: string,
  reason: number,
  previousState: { controller: number; faceUp: boolean; location: string; position: string; sequence: number },
  currentSequence: number,
): Record<string, unknown> {
  return {
    eventName: "sentToGraveyard",
    eventCode: 1014,
    eventCardUid: uid,
    eventReason: reason,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: previousState,
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: currentSequence },
  };
}
