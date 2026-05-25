import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const unleashCode = "73567374";
const hasUnleashScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${unleashCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeGemini = 0x800;

describe.skipIf(!hasUpstreamScripts || !hasUnleashScript)("Lua real script Unleash Your Power Gemini delayed set", () => {
  it("restores group-wide Gemini status and delayed End Phase position change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const slimeCode = "3918345";
    const soldierCode = "68366996";
    const opponentGeminiCode = "73567375";
    const responderCode = "73567376";
    const script = workspace.readScript(`c${unleashCode}.lua`);
    expect(script).toContain("g:ForEach(Card.EnableGeminiStatus)");
    expect(script).toContain("aux.DelayedOperation(g,PHASE_END,id,e,tp,function(ag) Duel.ChangePosition(ag,POS_FACEDOWN_DEFENSE) end)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_GEMINI) and not c:IsGeminiStatus()");
    const cards: DuelCardData[] = [
      { code: unleashCode, name: "Unleash Your Power!", kind: "spell", typeFlags: typeSpell },
      { code: slimeCode, name: "Magical Reflect Slime", kind: "monster", typeFlags: typeMonster | typeEffect | typeGemini, level: 3, attack: 700, defense: 1200 },
      { code: soldierCode, name: "Gemini Soldier", kind: "monster", typeFlags: typeMonster | typeEffect | typeGemini, level: 2, attack: 500, defense: 300 },
      { code: opponentGeminiCode, name: "Unleash Opponent Gemini", kind: "monster", typeFlags: typeMonster | typeEffect | typeGemini, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Unleash Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 735, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unleashCode, slimeCode, soldierCode] }, 1: { main: [opponentGeminiCode, responderCode] } });
    startDuel(session);

    const unleash = session.state.cards.find((card) => card.code === unleashCode);
    const slime = session.state.cards.find((card) => card.code === slimeCode);
    const soldier = session.state.cards.find((card) => card.code === soldierCode);
    const opponentGemini = session.state.cards.find((card) => card.code === opponentGeminiCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(unleash).toBeDefined();
    expect(slime).toBeDefined();
    expect(soldier).toBeDefined();
    expect(opponentGemini).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, unleash!.uid, "hand", 0);
    moveDuelCard(session.state, slime!.uid, "monsterZone", 0);
    slime!.faceUp = true;
    slime!.position = "faceUpAttack";
    slime!.sequence = 0;
    moveDuelCard(session.state, soldier!.uid, "monsterZone", 0);
    soldier!.faceUp = true;
    soldier!.position = "faceUpDefense";
    soldier!.sequence = 1;
    moveDuelCard(session.state, opponentGemini!.uid, "monsterZone", 1);
    opponentGemini!.faceUp = true;
    opponentGemini!.position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unleashCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    expectGeminiStatus(restoredActivation, slimeCode, false);
    expectGeminiStatus(restoredActivation, soldierCode, false);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === unleash!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);

    const targetUids = restoredActivation.session.state.chain[0]?.targetUids ?? [];
    expect(targetUids).toHaveLength(2);
    expect(targetUids).toEqual(expect.arrayContaining([slime!.uid, soldier!.uid]));
    expect(targetUids).not.toContain(opponentGemini!.uid);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("unleash responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === unleash!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === slime!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense" });

    const restoredStatus = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredStatus.restoreComplete, restoredStatus.incompleteReasons.join("; ")).toBe(true);
    expect(restoredStatus.missingRegistryKeys).toEqual([]);
    expect(restoredStatus.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredStatus, 0);
    expectGeminiStatus(restoredStatus, slimeCode, true);
    expectGeminiStatus(restoredStatus, soldierCode, true);
    expectGeminiStatus(restoredStatus, opponentGeminiCode, false, 1);
    expect(
      restoredStatus.session.state.effects.filter(
        (effect) => effect.sourceUid === unleash!.uid && effect.event === "continuous" && effect.code === 0x1200,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "code": 4608,
          "controller": 0,
          "countLimit": 1,
          "event": "continuous",
          "id": "lua-5-4608",
          "label": 1,
          "labelObjectUids": [
            "p0-deck-3918345-1",
            "p0-deck-68366996-2",
          ],
          "oncePerTurn": true,
          "operation": [Function],
          "ownerPlayer": 0,
          "property": 128,
          "range": [
            "deck",
            "hand",
            "monsterZone",
            "spellTrapZone",
            "graveyard",
            "banished",
            "extraDeck",
            "overlay",
          ],
          "registryKey": "lua:73567374:lua-5-4608",
          "reset": {
            "count": 1,
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-73567374-0",
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "if",
        },
      ]
    `);

    changeRestoredPhase(restoredStatus, 0, "battle");
    changeRestoredPhase(restoredStatus, 0, "main2");
    changeRestoredPhase(restoredStatus, 0, "end");

    expect(restoredStatus.session.state.cards.find((card) => card.uid === slime!.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: false,
      position: "faceDownDefense",
    });
    expect(restoredStatus.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: false,
      position: "faceDownDefense",
    });
    expect(restoredStatus.session.state.cards.find((card) => card.uid === opponentGemini!.uid)).toMatchObject({
      location: "monsterZone",
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(
      restoredStatus.session.state.effects.find(
        (effect) => effect.sourceUid === unleash!.uid && effect.event === "continuous" && effect.code === 0x1200,
      ),
    ).toBeUndefined();
    expect(restoredStatus.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: slime!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "monsterZone",
          position: "faceDownDefense",
          sequence: 0,
        },
      },
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: soldier!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "monsterZone",
          position: "faceDownDefense",
          sequence: 1,
        },
      },
    ]);

    const restoredAfterEnd = restoreDuelWithLuaScripts(serializeDuel(restoredStatus.session), source, reader);
    expect(restoredAfterEnd.restoreComplete, restoredAfterEnd.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterEnd.missingRegistryKeys).toEqual([]);
    expect(restoredAfterEnd.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterEnd, 1);
    expectGeminiStatus(restoredAfterEnd, slimeCode, false);
    expectGeminiStatus(restoredAfterEnd, soldierCode, false);
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("unleash responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean, controller = 0): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(${controller},aux.FilterBoolFunction(Card.IsCode,${code}),${controller},LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("unleash gemini status ${code} " .. tostring(target and target:IsGeminiStatus()))
    `,
    `unleash-gemini-status-${code}-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`unleash gemini status ${code} ${expected ? "true" : "false"}`);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function changeRestoredPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phase: "battle" | "main2" | "end"): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
