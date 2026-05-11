import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const raceThunder = 0x1000;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Thunder Sea Horse Special Summon lock", () => {
  it("restores its discard cost, same-code search, and oath Special Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const seaHorseCode = "48049769";
    const searchCode = "48049770";
    const procedureCode = "48049771";
    const responderCode = "48049772";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === seaHorseCode),
      { code: searchCode, name: "Thunder Sea Horse Search Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1500, defense: 1000, race: raceThunder, attribute: attributeLight },
      { code: procedureCode, name: "Thunder Sea Horse Procedure", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Thunder Sea Horse Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 480, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [seaHorseCode, searchCode, searchCode, procedureCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const seaHorse = requireCard(session, seaHorseCode);
    const procedure = requireCard(session, procedureCode);
    const responder = requireCard(session, responderCode);
    const searchTargets = session.state.cards.filter((card) => card.code === searchCode).sort((a, b) => a.uid.localeCompare(b.uid));
    expect(searchTargets).toHaveLength(2);
    moveDuelCard(session.state, seaHorse.uid, "hand", 0);
    moveDuelCard(session.state, procedure.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${procedureCode}.lua`) return specialProcedureScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(seaHorseCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(procedureCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(getLegalActions(session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === procedure.uid)).toBe(true);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === seaHorse.uid);
    expect(activation).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.cards.find((card) => card.uid === seaHorse.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
    });
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: seaHorse.uid,
      operationInfos: [{ category: 0x8, targetUids: [], count: 2, player: 0, parameter: 0x1 }],
    });
    expect(session.state.effects.find((effect) => effect.sourceUid === seaHorse.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === seaHorse.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).not.toContain("thunder sea horse responder resolved");
    expect(searchTargets.map((card) => restored.session.state.cards.find((candidate) => candidate.uid === card.uid))).toEqual(
      expect.arrayContaining(searchTargets.map((card) => expect.objectContaining({ uid: card.uid, location: "hand", controller: 0 }))),
    );
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: seaHorse.uid }),
        expect.objectContaining({ eventName: "sentToHand", eventCardUid: searchTargets[0]!.uid }),
        expect.objectContaining({ eventName: "sentToHand", eventCardUid: searchTargets[1]!.uid }),
        expect.objectContaining({ eventName: "sentToHandConfirmed", eventPlayer: 1, eventUids: expect.arrayContaining(searchTargets.map((card) => card.uid)) }),
      ]),
    );

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredLock, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === procedure.uid)).toBe(false);
  });
});

function specialProcedureScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPSUMMON_PROC)
      e:SetRange(LOCATION_HAND)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("thunder sea horse responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
