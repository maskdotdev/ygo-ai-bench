import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
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
const brownCode = "88232397";
const spellCode = "882323970";
const kuribohCode = "882323971";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const counterSpell = 0x1;
const setKuriboh = 0xa4;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Skilled Brown Magician counter SelectEffect stat search", () => {
  it("restores spell-chain counter placement into counter-cost Level/ATK SelectEffect branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${brownCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createBrownSession(reader, workspace);
    const brown = requireCard(session, brownCode);
    const spell = requireCard(session, spellCode);
    moveFaceUpAttack(session, brown, 0);
    moveFaceDownSpell(session, spell);

    const source = {
      readScript(name: string) {
        if (name === `c${spellCode}.lua`) return chainableSpellScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const spellActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === spell.uid);
    expect(spellActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, spellActivation!);

    const brownAfterSpell = restoredOpen.session.state.cards.find((card) => card.uid === brown.uid);
    expect(getDuelCardCounter(brownAfterSpell, counterSpell)).toBe(1);
    expect(restoredOpen.host.messages).toContain("skilled brown fixture spell resolved");
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "counterAdded" && event.eventCardUid === brown.uid)).toEqual([
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: brown.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: brown.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 1 }],
    });
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === brown.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    expect(getDuelCardCounter(restoredIgnition.session.state.cards.find((card) => card.uid === brown.uid), counterSpell)).toBe(0);
    expect(restoredIgnition.session.state.chain).toEqual([]);

    expect(restoredIgnition.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1411718353, 1411718354], returned: 1 }]);
    const brownAfterBoost = restoredIgnition.session.state.cards.find((card) => card.uid === brown.uid);
    expect(currentLevel(brownAfterBoost, restoredIgnition.session.state)).toBe(5);
    expect(currentAttack(brownAfterBoost, restoredIgnition.session.state)).toBe(1800);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === brown.uid && (effect.code === 100 || effect.code === 130))).toEqual([
      expect.objectContaining({ code: 130, range: ["monsterZone"], value: 1 }),
      expect.objectContaining({ code: 100, range: ["monsterZone"], value: 1500 }),
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores counter-cost SelectEffect search branch through the Kuriboh Deck/Grave filter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${brownCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createBrownSession(reader, workspace);
    const brown = requireCard(session, brownCode);
    const kuriboh = requireCard(session, kuribohCode);
    moveFaceUpAttack(session, brown, 0);
    brown.counters = { [counterSpell]: 1 };
    moveDuelCard(session.state, kuriboh.uid, "graveyard", 0);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ignition = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === brown.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, ignition!);
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === brown.uid), counterSpell)).toBe(0);
    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1411718353, 1411718354], returned: 2 }]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === kuriboh.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: brown.uid,
      reasonEffectId: 5,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === kuriboh.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: kuriboh.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: brown.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredAfterSearch = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredAfterSearch);
    expectRestoredLegalActions(restoredAfterSearch, 0);
    expect(restoredAfterSearch.session.state.eventHistory.filter((event) => event.eventName === "sentToHandConfirmed" && event.eventCardUid === kuriboh.uid)).toEqual([
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: kuriboh.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [kuriboh.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: brown.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("e0:SetCode(EVENT_CHAINING)");
  expect(script).toContain("e0:SetOperation(aux.chainreg)");
  expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVED)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_LEVEL)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.thfilter),tp,LOCATION_DECK|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === brownCode),
    { code: spellCode, name: "Skilled Brown Fixture Spell", kind: "spell", typeFlags: typeSpell },
    { code: kuribohCode, name: "Skilled Brown Kuriboh Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKuriboh], level: 1, attack: 300, defense: 200 },
  ];
}

function createBrownSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 88232397, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [brownCode, spellCode, kuribohCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(brownCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function chainableSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("skilled brown fixture spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
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
