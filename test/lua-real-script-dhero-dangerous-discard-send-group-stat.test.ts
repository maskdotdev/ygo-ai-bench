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
const dangerousCode = "30757127";
const discardCode = "307571270";
const sendCode = "307571271";
const decoyCode = "307571272";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDangerousScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dangerousCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setDestinyHero = 0xc008;
const raceWarrior = 0x1;
const raceBeast = 0x4000;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const categoryAtkChange = 0x200000;
const categoryToGrave = 0x20;
const effectFlagDamageStep = 0x4000;
const effectFlagSingleRange = 0x400;
const resetsStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDangerousScript)("Lua real script D-HERO Dangerous discard send group stat", () => {
  it("restores AddProcMix metadata and discard-cost quick send into Destiny HERO group ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dangerousCode}.lua`);
    expectDangerousScriptShape(script);
    const dangerousData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dangerousCode);
    expect(dangerousData).toBeDefined();
    const reader = createCardReader([{ ...dangerousData!, setcodes: [setDestinyHero] }, ...fixtureCards()]);
    const restored = createRestoredOpen({ reader, workspace });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const dangerous = requireCard(restored.session, dangerousCode);
    const discard = requireCard(restored.session, discardCode);
    const sent = requireCard(restored.session, sendCode);
    const decoy = requireCard(restored.session, decoyCode);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === dangerous.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toContainEqual({ category: categoryToGrave + categoryAtkChange, code: 1002, event: "quick", property: effectFlagDamageStep, range: ["monsterZone"], sourceUid: dangerous.uid });

    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === dangerous.uid && candidate.effectId === "lua-2-1002"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: dangerous.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === sent.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: dangerous.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === dangerous.uid), restored.session.state)).toBe(2400);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === dangerous.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: effectFlagSingleRange, reset: { flags: resetsStandardPhaseEnd }, sourceUid: dangerous.uid, targetRange: undefined, value: 400 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "chainSolved"].includes(event.eventName))).toEqual([
      sentToGraveEvent(discard.uid, dangerous.uid, duelReason.cost | duelReason.discard, 2, { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 }, 0),
      sentToGraveEvent(sent.uid, dangerous.uid, duelReason.effect, 2, { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 }, 1),
      chainSolvedEvent(2),
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 30757127, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [discardCode, sendCode, decoyCode], extra: [dangerousCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dangerousCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dangerousCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: discardCode, name: "D-HERO Dangerous Discard", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDestinyHero], race: raceWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: sendCode, name: "D-HERO Dangerous Send", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDestinyHero], race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: decoyCode, name: "D-HERO Dangerous Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeDark, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectDangerousScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Destiny HERO - Dangerous");
  expect(script).toContain("Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_DESTINY_HERO),s.ffilter)");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST|REASON_DISCARD,nil,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("local ct=Duel.GetMatchingGroupCount(s.ctfilter,tp,LOCATION_GRAVE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*200)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
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
  effectId: number,
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
    eventReasonEffectId: effectId,
    eventPreviousState: previousState,
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: currentSequence },
  };
}

function chainSolvedEvent(effectId: number): Record<string, unknown> {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventReasonPlayer: 0,
    eventValue: 1,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: "chain-3",
  };
}
