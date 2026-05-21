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
const clausolasCode = "99185129";
const searchCode = "991851290";
const extraTargetCode = "991851291";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasClausolasScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${clausolasCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeRitual = 0x80;
const setNekroz = 0xb4;

describe.skipIf(!hasUpstreamScripts || !hasClausolasScript)("Lua real script Nekroz of Clausolas search final disable", () => {
  it("restores self-discard Nekroz search and Damage Step Extra Deck monster final ATK disable", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${clausolasCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const searchSession = createDuel({ seed: 99185129, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [clausolasCode, searchCode] }, 1: { main: [] } });
    startDuel(searchSession);

    const searchClausolas = requireCard(searchSession, clausolasCode);
    const searchTarget = requireCard(searchSession, searchCode);
    moveDuelCard(searchSession.state, searchClausolas.uid, "hand", 0);
    searchSession.state.phase = "main1";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;

    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(clausolasCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const search = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateEffect" && action.uid === searchClausolas.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, search!);
    passRestoredChain(restoredSearch);

    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchClausolas.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonCardUid: searchClausolas.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      controller: 0,
      location: "hand",
      reason: duelReason.effect,
      reasonCardUid: searchClausolas.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restoredSearch.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredSearch.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" || event.eventName === "sentToHandConfirmed").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: searchClausolas.uid, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: searchClausolas.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: searchTarget.uid, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: searchClausolas.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    const disableSession = createDuel({ seed: 99185130, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(disableSession, { 0: { main: [clausolasCode] }, 1: { main: [extraTargetCode] } });
    startDuel(disableSession);

    const fieldClausolas = requireCard(disableSession, clausolasCode);
    const extraTarget = requireCard(disableSession, extraTargetCode);
    moveFaceUpAttack(disableSession, fieldClausolas, 0);
    moveFaceUpAttack(disableSession, extraTarget, 1);
    extraTarget.summonType = "fusion";
    extraTarget.summonPlayer = 1;
    extraTarget.previousLocation = "extraDeck";
    disableSession.state.phase = "main1";
    disableSession.state.turnPlayer = 0;
    disableSession.state.waitingFor = 0;

    const disableHost = createLuaScriptHost(disableSession, workspace);
    expect(disableHost.loadCardScript(Number(clausolasCode), workspace).ok).toBe(true);
    expect(disableHost.registerInitialEffects()).toBe(1);

    const restoredDisable = restoreDuelWithLuaScripts(serializeDuel(disableSession), workspace, reader);
    expectCleanRestore(restoredDisable);
    expectRestoredLegalActions(restoredDisable, 0);
    const disable = getLuaRestoreLegalActions(restoredDisable, 0).find((action) => action.type === "activateEffect" && action.uid === fieldClausolas.uid);
    expect(disable, JSON.stringify(getLuaRestoreLegalActions(restoredDisable, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDisable, disable!);
    passRestoredChain(restoredDisable);

    expect(currentAttack(restoredDisable.session.state.cards.find((card) => card.uid === extraTarget.uid)!, restoredDisable.session.state)).toBe(0);
    expect(restoredDisable.session.state.effects.filter((effect) => effect.sourceUid === extraTarget.uid && [2, 8, 102].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169792 }, sourceUid: extraTarget.uid, value: 0 },
      { code: 2, reset: { flags: 1107169792 }, sourceUid: extraTarget.uid, value: undefined },
      { code: 8, reset: { flags: 1107169792 }, sourceUid: extraTarget.uid, value: 131072 },
    ]);
    expect(restoredDisable.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: extraTarget.uid, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredDisable.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e1:SetValue(aux.ritlimit)");
  expect(script).toContain("e2:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("return c:IsSetCard(SET_NEKROZ) and c:IsSpellTrap() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e3:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsSummonLocation(LOCATION_EXTRA) and not (c:GetAttack()==0 and c:IsDisabled())");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("Duel.NegateRelatedChain(tc,RESET_TURN_SET)");
  expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
  expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: clausolasCode, name: "Nekroz of Clausolas", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, level: 3, attack: 1200, defense: 2300, setcodes: [setNekroz] },
    { code: searchCode, name: "Nekroz Clausolas Search Spell", kind: "spell", typeFlags: typeSpell, setcodes: [setNekroz] },
    { code: extraTargetCode, name: "Nekroz Clausolas Extra Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 8, attack: 2800, defense: 2000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
