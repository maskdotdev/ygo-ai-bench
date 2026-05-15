import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Springans Ship SelectFieldZone", () => {
  it("restores Exblowrer's selected opponent field zone chain label", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const exblowrerCode = "62941499";
    const materialCode = "62941500";
    const targetCode = "62941501";
    const responderCode = "62941502";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === exblowrerCode),
      { code: materialCode, name: "Springans Ship Overlay Material", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: targetCode, name: "Springans Ship Adjacent Target", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Springans Ship Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 629, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [exblowrerCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const exblowrer = requireCard(session, exblowrerCode);
    const material = requireCard(session, materialCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, exblowrer.uid, "monsterZone", 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    moveDuelCard(session.state, target.uid, "monsterZone", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.cards.find((card) => card.uid === exblowrer.uid)!.overlayUids.push(material.uid);
    session.state.cards.find((card) => card.uid === target.uid)!.sequence = 3;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(exblowrerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const ignition = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === exblowrer.uid);
    expect(ignition, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, ignition!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: exblowrer.uid,
      effectLabel: 1 << 16,
      operationInfos: [
        expect.objectContaining({ category: 0x1, targetUids: [] }),
      ],
    });
    expect(session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectFieldZone",
        player: 0,
        returned: 1 << 16,
      }),
    ]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1, sequence: 3 });
    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === exblowrer.uid)).toMatchObject({ location: "monsterZone", overlayUids: [material.uid] });
    expect(restored.host.messages).not.toContain("springans ship responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("springans ship responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
