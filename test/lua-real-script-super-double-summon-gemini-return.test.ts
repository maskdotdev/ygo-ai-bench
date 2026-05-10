import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Super Double Summon", () => {
  it("restores temporary Gemini status and its End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const spellCode = "26120084";
    const geminiCode = "16146511";
    const responderCode = "932";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [spellCode, geminiCode].includes(card.code)),
      { code: responderCode, name: "Super Double Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 314, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spellCode, geminiCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === spellCode);
    const gemini = session.state.cards.find((card) => card.code === geminiCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(spell).toBeDefined();
    expect(gemini).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, spell!.uid, "hand", 0);
    moveDuelCard(session.state, gemini!.uid, "monsterZone", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    gemini!.faceUp = true;
    gemini!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === spell!.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activate!);
    expect(activated.ok, activated.error).toBe(true);

    const chainRestored = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(chainRestored.restoreComplete, chainRestored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(chainRestored, 1)).toEqual(getGroupedDuelLegalActions(chainRestored.session, 1));
    expect(getLuaRestoreLegalActionGroups(chainRestored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(chainRestored, 1));
    expect(getLuaRestoreLegalActions(chainRestored, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(chainRestored, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(chainRestored, 1), null, 2)).toBeDefined();
    expect(applyLuaRestoreResponse(chainRestored, pass!).ok).toBe(true);
    expect(chainRestored.session.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "graveyard" });
    assertGeminiStatus(chainRestored, geminiCode, true);

    for (const phase of ["battle", "main2"] as const) {
      const action = getLuaRestoreLegalActions(chainRestored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action, JSON.stringify(getLuaRestoreLegalActions(chainRestored, 0), null, 2)).toBeDefined();
      const changed = applyLuaRestoreResponse(chainRestored, action!);
      expect(changed.ok, changed.error).toBe(true);
    }

    const preEndRestored = restoreDuelWithLuaScripts(serializeDuel(chainRestored.session), source, reader);
    expect(preEndRestored.restoreComplete, preEndRestored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(preEndRestored, 0)).toEqual(getDuelLegalActions(preEndRestored.session, 0));
    assertGeminiStatus(preEndRestored, geminiCode, true);

    const endPhase = getLuaRestoreLegalActions(preEndRestored, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(preEndRestored, 0), null, 2)).toBeDefined();
    const changedToEnd = applyLuaRestoreResponse(preEndRestored, endPhase!);
    expect(changedToEnd.ok, changedToEnd.error).toBe(true);
    expect(preEndRestored.session.state.pendingTriggers).toEqual([]);
    expect(preEndRestored.session.state.cards.find((card) => card.uid === gemini!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(preEndRestored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "phaseEnd", eventCode: 0x1200 }),
        expect.objectContaining({ eventName: "sentToHand", eventCardUid: gemini!.uid }),
      ]),
    );

    const postEndRestored = restoreDuelWithLuaScripts(serializeDuel(preEndRestored.session), source, reader);
    expect(postEndRestored.restoreComplete, postEndRestored.incompleteReasons.join("; ")).toBe(true);
    expect(postEndRestored.session.state.cards.find((card) => card.uid === gemini!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(postEndRestored.host.messages).not.toContain("super double responder resolved");
  });
});

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("super double gemini status " .. tostring(target and target:IsGeminiStatus()))
    `,
    "super-double-gemini-status-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`super double gemini status ${expected ? "true" : "false"}`);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("super double responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
