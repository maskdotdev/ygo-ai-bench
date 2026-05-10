import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sakitama Spirit effect summon", () => {
  it("restores its hand ignition effect and resolves an immediate Spirit Normal Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sakitamaCode = "67972302";
    const spiritTargetCode = "94972302";
    const invalidMonsterCode = "94972303";
    const responderCode = "94972304";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sakitamaCode),
      { code: spiritTargetCode, name: "Sakitama Spirit Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4 },
      { code: invalidMonsterCode, name: "Sakitama Invalid Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Sakitama Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 679, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sakitamaCode, spiritTargetCode, invalidMonsterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const sakitama = session.state.cards.find((card) => card.code === sakitamaCode && card.location === "deck");
    const spiritTarget = session.state.cards.find((card) => card.code === spiritTargetCode);
    const invalidMonster = session.state.cards.find((card) => card.code === invalidMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(sakitama).toBeDefined();
    expect(spiritTarget).toBeDefined();
    expect(invalidMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, sakitama!.uid, "hand", 0);
    moveDuelCard(session.state, spiritTarget!.uid, "hand", 0);
    moveDuelCard(session.state, invalidMonster!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(sakitamaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredOpenWindow, 0)).toEqual(getDuelLegalActions(restoredOpenWindow.session, 0));
    const effect = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === sakitama!.uid);
    expect(effect, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, effect!);
    expect(restoredOpenWindow.session.state.chain).toHaveLength(1);
    expect(restoredOpenWindow.session.state.chain[0]).toMatchObject({
      sourceUid: sakitama!.uid,
      operationInfos: [{ category: 0x100, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
    });
    expect(restoredOpenWindow.host.messages).toContain(`confirmed 1: ${sakitamaCode}`);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1)).toEqual(getDuelLegalActions(restoredChainWindow.session, 1));
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === spiritTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "normal",
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === invalidMonster!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === sakitama!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.host.messages).not.toContain("sakitama responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("sakitama responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
