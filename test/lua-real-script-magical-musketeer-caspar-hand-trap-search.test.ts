import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const casparCode = "32841045";
const musketTrapCode = "328410450";
const musketSearchCode = "328410451";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCasparScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${casparCode}.lua`));
const setMagicalMusket = 0x108;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCasparScript)("Lua real script Magical Musketeer Caspar hand trap search", () => {
  it("uses EFFECT_TRAP_ACT_IN_HAND to activate a Magical Musket Trap from hand and raise Caspar's custom search trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${casparCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_TRAP_ACT_IN_HAND)");
    expect(script).toContain("e3:SetCode(EVENT_CHAIN_SOLVING)");
    expect(script).toContain("e4:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,0,0,0,0)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === casparCode),
      { code: musketTrapCode, name: "Magical Musket Fixture Trap", kind: "trap", typeFlags: typeTrap, setcodes: [setMagicalMusket] },
      { code: musketSearchCode, name: "Magical Musket Fixture Search", kind: "trap", typeFlags: typeTrap, setcodes: [setMagicalMusket] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 32841045, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [casparCode, musketTrapCode, musketSearchCode] }, 1: { main: [] } });
    startDuel(session);

    const caspar = requireCard(session.state.cards, casparCode);
    const trap = requireCard(session.state.cards, musketTrapCode);
    const searchTarget = requireCard(session.state.cards, musketSearchCode);
    const faceupCaspar = moveDuelCard(session.state, caspar.uid, "monsterZone", 0);
    faceupCaspar.faceUp = true;
    faceupCaspar.position = "faceUpAttack";
    moveDuelCard(session.state, trap.uid, "hand", 0);
    expect(searchTarget.location).toBe("deck");
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${musketTrapCode}.lua`) return fixtureTrapScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(casparCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(musketTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const trapActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === trap.uid);
    expect(trapActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, trapActivation!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.host.messages).toContain("magical musket fixture trap resolved");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const casparTrigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === caspar.uid);
    expect(casparTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, casparTrigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === searchTarget.uid)?.location).toBe("hand");
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === searchTarget.uid)?.controller).toBe(0);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "moved" && event.eventCardUid === searchTarget.uid).at(-1)).toEqual({
      eventName: "moved",
      eventCode: 1030,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: caspar.uid,
      eventReasonEffectId: 5,
      eventPreviousState: {
        controller: 0,
        location: "deck",
        sequence: 0,
        position: "faceDown",
        faceUp: false,
      },
      eventCurrentState: {
        controller: 0,
        location: "hand",
        sequence: 0,
        position: "faceDown",
        faceUp: false,
      },
      eventCardUid: searchTarget.uid,
    });
  });
});

function fixtureTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("magical musket fixture trap resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(cards: DuelCardInstance[], code: string): DuelCardInstance {
  const card = cards.find((candidate) => candidate.code === code);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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
