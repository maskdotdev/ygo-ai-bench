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
const kuribehCode = "34419588";
const quickTargetCode = "344195880";
const kuribahCode = "44632120";
const kuribeeCode = "71036835";
const kuribooCode = "7021574";
const kuribohCode = "40640057";
const kuribabylonCode = "16404809";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKuribehScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${kuribehCode}.lua`));
const setKuriboh = 0xa4;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeDark = 0x20;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasKuribehScript)("Lua real script Kuribeh release search summon stat", () => {
  it("restores hand discard ATK boost and release-cost search into optional Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${kuribehCode}.lua`));
    const reader = createCardReader(cards());

    const restoredQuick = createRestoredQuickBoostField({ reader, workspace });
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quickKuribeh = requireCard(restoredQuick.session, kuribehCode);
    const quickTarget = requireCard(restoredQuick.session, quickTargetCode);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === quickKuribeh.uid && action.effectId === "lua-1-1002"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === quickKuribeh.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: quickKuribeh.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === quickTarget.uid), restoredQuick.session.state)).toBe(1800);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, sourceUid: quickTarget.uid, value: 1500 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: quickKuribeh.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.cost | duelReason.discard, eventReasonCardUid: quickKuribeh.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "hand", current: "graveyard", relatedEffectId: undefined },
      { eventCardUid: quickTarget.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone", relatedEffectId: 1 },
    ]);

    const restoredIgnition = createRestoredReleaseSearchField({ reader, workspace });
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const fieldKuribeh = requireCard(restoredIgnition.session, kuribehCode);
    const releaseCards = [kuribahCode, kuribeeCode, kuribooCode, kuribohCode].map((code) => requireCard(restoredIgnition.session, code));
    const kuribabylon = requireCard(restoredIgnition.session, kuribabylonCode);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldKuribeh.uid && action.effectId === "lua-2"
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);
    expect(restoredIgnition.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === kuribabylon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "normal",
      reason: duelReason.summon,
      reasonPlayer: 0,
      reasonCardUid: fieldKuribeh.uid,
      reasonEffectId: 2,
    });
    expect([fieldKuribeh, ...releaseCards].map((card) => restoredIgnition.session.state.cards.find((candidate) => candidate.uid === card.uid)).map((card) => ({
      location: card?.location,
      reason: card?.reason,
      reasonCardUid: card?.reasonCardUid,
      reasonEffectId: card?.reasonEffectId,
    }))).toEqual([
      { location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: fieldKuribeh.uid, reasonEffectId: 2 },
      { location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: fieldKuribeh.uid, reasonEffectId: 2 },
      { location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: fieldKuribeh.uid, reasonEffectId: 2 },
      { location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: fieldKuribeh.uid, reasonEffectId: 2 },
      { location: "graveyard", reason: duelReason.release | duelReason.cost, reasonCardUid: fieldKuribeh.uid, reasonEffectId: 2 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) =>
      ["released", "sentToHand", "confirmed", "sentToHandConfirmed", "breakEffect", "normalSummoned"].includes(event.eventName)
    ).map((event) => ({
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
      { eventCardUid: releaseCards[1]!.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: releaseCards[2]!.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: releaseCards[3]!.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: fieldKuribeh.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: releaseCards[0]!.uid, eventCode: 1017, eventName: "released", eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: kuribabylon.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: kuribabylon.uid, eventCode: 1211, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: kuribabylon.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: undefined, eventCode: 1050, eventName: "breakEffect", eventReason: duelReason.effect, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: undefined, current: undefined },
      { eventCardUid: kuribabylon.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: fieldKuribeh.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredQuickBoostField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createKuribehSession({ seed: 34419588, reader, workspace, main: [kuribehCode, quickTargetCode] });
  const kuribeh = requireCard(session, kuribehCode);
  const target = requireCard(session, quickTargetCode);
  moveDuelCard(session.state, kuribeh.uid, "hand", 0);
  const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 0);
  movedTarget.faceUp = true;
  movedTarget.position = "faceUpAttack";
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredReleaseSearchField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const releaseCodes = [kuribehCode, kuribahCode, kuribeeCode, kuribooCode, kuribohCode];
  const session = createKuribehSession({ seed: 34419589, reader, workspace, main: [...releaseCodes, kuribabylonCode] });
  releaseCodes.forEach((code, sequence) => {
    const card = requireCard(session, code);
    const moved = moveDuelCard(session.state, card.uid, "monsterZone", 0);
    moved.sequence = sequence;
    moved.faceUp = true;
    moved.position = "faceUpAttack";
  });
  session.state.players[0].normalSummonAvailable = false;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
    promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
  });
}

function createKuribehSession(
  {
    seed,
    reader,
    workspace,
    main,
  }: {
    seed: number;
    reader: ReturnType<typeof createCardReader>;
    workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
    main: string[];
  }): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(kuribehCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Kuribeh");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,1500)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e1:SetValue(1500)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_SUMMON)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.thcfilter,4,true,s.rescon,c,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.thcfilter,4,4,true,s.rescon,c,tp)+c");
  expect(script).toContain("Duel.Release(sg,REASON_COST)");
  expect(script).toContain("return c:IsCode(16404809) and c:IsAbleToHand()");
  expect(script).toContain("return c:IsRace(RACE_FIEND) and c:IsSummonable(true,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil):GetFirst()");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Summon(tp,sg,true,nil)");
}

function cards(): DuelCardData[] {
  return [
    { code: kuribehCode, name: "Kuribeh", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200, setcodes: [setKuriboh] },
    { code: quickTargetCode, name: "Kuribeh Quick Kuriboh Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200, setcodes: [setKuriboh] },
    { code: kuribahCode, name: "Kuribah", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: kuribeeCode, name: "Kuribee", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: kuribooCode, name: "Kuriboo", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: kuribohCode, name: "Kuriboh", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 1, attack: 300, defense: 200 },
    { code: kuribabylonCode, name: "Kuribabylon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
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
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
