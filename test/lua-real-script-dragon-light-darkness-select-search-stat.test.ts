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
const lightDarkCode = "63295720";
const handDragonCode = "632957200";
const deckDragonCode = "632957201";
const fieldDragonCode = "632957202";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLightDarkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lightDarkCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasLightDarkScript)("Lua real script Dragon's Light and Darkness SelectEffect search stat", () => {
  it("restores SelectEffect hand-to-deck search branch and Damage Step Dragon ATK branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lightDarkCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const searchSession = createDuel({ seed: 63295720, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [lightDarkCode, handDragonCode, deckDragonCode] }, 1: { main: [] } });
    startDuel(searchSession);
    const searchSpell = requireCard(searchSession, lightDarkCode);
    const handDragon = requireCard(searchSession, handDragonCode);
    const deckDragon = requireCard(searchSession, deckDragonCode);
    moveDuelCard(searchSession.state, searchSpell.uid, "hand", 0);
    moveDuelCard(searchSession.state, handDragon.uid, "hand", 0);
    searchSession.state.phase = "main1";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;

    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(lightDarkCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 1 }] });
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchAction = getLuaRestoreLegalActions(restoredSearch, 0).find((action) => action.type === "activateEffect" && action.uid === searchSpell.uid);
    expect(searchAction, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, searchAction!);
    passRestoredChain(restoredSearch);

    expect(restoredSearch.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1], descriptions: [1012731521], returned: 1 },
    ]);
    expect(restoredSearch.session.state.cards.find((card) => card.uid === handDragon.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonCardUid: searchSpell.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(restoredSearch.session.state.cards.find((card) => card.uid === deckDragon.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonCardUid: searchSpell.uid,
      reasonEffectId: 1,
      reasonPlayer: 0,
    });
    expect(restoredSearch.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredSearch.session.state.eventHistory.filter((event) => event.eventName === "confirmed" || event.eventName === "sentToDeck" || event.eventName === "sentToHandConfirmed").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: handDragon.uid, eventName: "confirmed", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: handDragon.uid, eventName: "sentToHandConfirmed", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: handDragon.uid, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: searchSpell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: deckDragon.uid, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: searchSpell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: deckDragon.uid, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: searchSpell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);

    const statSession = createDuel({ seed: 63295721, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [lightDarkCode, fieldDragonCode] }, 1: { main: [] } });
    startDuel(statSession);
    const statSpell = requireCard(statSession, lightDarkCode);
    const fieldDragon = requireCard(statSession, fieldDragonCode);
    moveDuelCard(statSession.state, statSpell.uid, "hand", 0);
    moveFaceUpAttack(statSession, fieldDragon, 0);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;

    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(lightDarkCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statAction = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statSpell.uid);
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statAction!);
    passRestoredChain(restoredStat);

    expect(restoredStat.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [2], descriptions: [1012731522], returned: 2 },
    ]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === fieldDragon.uid)!, restoredStat.session.state)).toBe(3300);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === fieldDragon.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: fieldDragon.uid, value: 1600 },
    ]);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: fieldDragon.uid, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Duel.CheckEvent(EVENT_CHAINING,true)");
  expect(script).toContain("Duel.GetChainInfo(te_ev,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.RegisterFlagEffect(tp,id+1,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,1,tp,LOCATION_HAND)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sc)");
  expect(script).toContain("Duel.SendtoDeck(sc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil,sc:GetAttribute())");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetLevel()*200)");
  expect(script).toContain("Duel.NegateEffect(te_ev)");
}

function cards(): DuelCardData[] {
  return [
    { code: lightDarkCode, name: "Dragon's Light and Darkness", kind: "spell", typeFlags: typeSpell },
    { code: handDragonCode, name: "Light and Darkness Hand Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: deckDragonCode, name: "Light and Darkness Deck Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 8, attack: 2400, defense: 2100 },
    { code: fieldDragonCode, name: "Light and Darkness Field Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 1700, defense: 1500 },
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
