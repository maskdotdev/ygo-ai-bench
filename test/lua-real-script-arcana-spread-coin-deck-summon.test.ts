import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const arcanaSpreadCode = "76302448";
const arcanaDeckCode = "763024480";
const graveCoinCode = "763024481";
const hasArcanaSpreadScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${arcanaSpreadCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setArcanaForce = 0x5;
const categoryCoinSpecialSummon = 0x1000200;
const categoryToHand = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasArcanaSpreadScript)("Lua real script Arcana Spread coin deck summon", () => {
  it("restores its Spell activation into a heads toss that Special Summons a low-level Arcana Force from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${arcanaSpreadCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [arcanaSpreadCode, arcanaDeckCode, graveCoinCode] }, 1: { main: [] } });
    startDuel(session);

    const spread = requireCard(session, arcanaSpreadCode);
    const arcanaDeck = requireCard(session, arcanaDeckCode);
    const graveCoin = requireCard(session, graveCoinCode);
    const setSpell = moveDuelCard(session.state, spread.uid, "spellTrapZone", 0);
    setSpell.sequence = 0;
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    moveDuelCard(session.state, graveCoin.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(arcanaSpreadCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(graveCoinCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === spread.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
    }))).toEqual([
      { category: categoryCoinSpecialSummon, code: 1002, countLimit: 1, event: "ignition", range: ["hand", "spellTrapZone"] },
      { category: categoryToHand, code: undefined, countLimit: 1, event: "ignition", range: ["graveyard"] },
    ]);

    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === spread.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.lastCoinResults).toEqual([1]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === arcanaDeck.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: spread.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === graveCoin.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === spread.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredOpen.host.promptDecisions).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["coinTossed", "specialSummoned", "moved"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: spread.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: arcanaDeck.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: spread.uid,
        eventReasonEffectId: 1,
        eventUids: [arcanaDeck.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "moved",
        eventCode: 1030,
        eventCardUid: spread.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Spread");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCountLimit(1,id)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK|LOCATION_GRAVE)");
  expect(script).toContain("coin=Duel.TossCoin(tp,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.headsspfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.tailsspfilter),tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function coinMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      s.toss_coin=true
    end
  `;
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${graveCoinCode}.lua`) return coinMonsterScript();
      return workspace.readScript(name);
    },
  };
}

function cards(): DuelCardData[] {
  return [
    { code: arcanaSpreadCode, name: "Arcana Spread", kind: "spell", typeFlags: typeSpell },
    { code: arcanaDeckCode, name: "Arcana Spread Deck Arcana Force", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setArcanaForce], level: 4, attack: 1000, defense: 1000 },
    { code: graveCoinCode, name: "Arcana Spread Grave Coin Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
