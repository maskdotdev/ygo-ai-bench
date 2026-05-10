import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const phaseEndEventCode = 0x1200;
const phaseEndReset = 0x40000200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Book of Eclipse delayed flip and draw", () => {
  it("restores grouped turn-set resolution and the End Phase opponent flip/draw watcher", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bookCode = "35480699";
    const ownMonsterCode = "614601";
    const opponentMonsterCode = "614602";
    const opponentDrawCode = "614603";
    const opponentSecondDrawCode = "614604";
    const responderCode = "614605";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bookCode),
      { code: ownMonsterCode, name: "Book of Eclipse Own Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: opponentMonsterCode, name: "Book of Eclipse Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
      { code: opponentDrawCode, name: "Book of Eclipse Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentSecondDrawCode, name: "Book of Eclipse Second Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Book of Eclipse Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3548, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bookCode, ownMonsterCode] }, 1: { main: [opponentMonsterCode, opponentDrawCode, opponentSecondDrawCode, responderCode] } });
    startDuel(session);

    const book = session.state.cards.find((card) => card.code === bookCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(book).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, book!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0);
    ownMonster!.position = "faceUpAttack";
    ownMonster!.faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1);
    opponentMonster!.position = "faceUpAttack";
    opponentMonster!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const expectedDraw = session.state.cards.filter((card) => card.controller === 1 && card.location === "deck").sort((a, b) => a.sequence - b.sequence)[0];
    expect(expectedDraw).toBeDefined();

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bookCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === book!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    expect(restoredActivation.session.state.chain[0]).toMatchObject({
      sourceUid: book!.uid,
      operationInfos: [
        expect.objectContaining({
          category: 0x1000,
          targetUids: expect.arrayContaining([ownMonster!.uid, opponentMonster!.uid]),
          count: 2,
          player: 0,
          parameter: 0x8,
        }),
      ],
    });
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1)).toEqual(getGroupedDuelLegalActions(restoredChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChain, 1));
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === book!.uid)).toMatchObject({ location: "graveyard", previousLocation: "spellTrapZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ position: "faceDownDefense", faceUp: false });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ position: "faceDownDefense", faceUp: false });
    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: book!.uid,
          code: phaseEndEventCode,
          countLimit: 1,
          reset: { flags: phaseEndReset },
        }),
      ]),
    );
    expect(restoredChain.host.messages).not.toContain("book of eclipse responder resolved");

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEnd.restoreComplete, restoredEnd.incompleteReasons.join("; ")).toBe(true);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEnd, endPhase!);

    expect(restoredEnd.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ position: "faceDownDefense", faceUp: false });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === expectedDraw!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredEnd.session.state.effects.some((effect) => effect.sourceUid === book!.uid && effect.code === phaseEndEventCode)).toBe(false);
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
      e:SetOperation(function(e,tp) Debug.Message("book of eclipse responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
