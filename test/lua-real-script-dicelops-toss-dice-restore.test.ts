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
const categoryHandes = 0x80;
const categoryDice = 0x2000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dicelops TossDice restore", () => {
  it("restores Dicelops before its deterministic dice discard operation resolves", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dicelopsCode = "62893810";
    const ownDiscardCode = "62893811";
    const opponentDiscardCode = "62893812";
    const responderCode = "62893813";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dicelopsCode),
      { code: ownDiscardCode, name: "Dicelops Own Discard", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentDiscardCode, name: "Dicelops Opponent Discard", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Dicelops Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 628, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dicelopsCode, ownDiscardCode] }, 1: { main: [opponentDiscardCode, responderCode] } });
    startDuel(session);

    const dicelops = requireCard(session, dicelopsCode);
    const ownDiscard = requireCard(session, ownDiscardCode);
    const opponentDiscard = requireCard(session, opponentDiscardCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, dicelops.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, ownDiscard.uid, "hand", 0);
    moveDuelCard(session.state, opponentDiscard.uid, "hand", 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const { source, host } = loadDicelopsHost(session, workspace, dicelopsCode, responderCode);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === dicelops.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: dicelops.uid,
      operationInfos: [
        { category: categoryDice, count: 0, player: 0, parameter: 1 },
        { category: categoryHandes, count: 1, player: 0, parameter: 0 },
      ],
    });
    expect(session.state.lastDiceResults).toEqual([]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.lastDiceResults).toEqual([]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.lastDiceResults).toHaveLength(1);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "diceTossed")).toEqual([
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: dicelops.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === ownDiscard.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentDiscard.uid)).toMatchObject({ location: "hand" });
    expect(host.messages).not.toContain("dicelops responder resolved");
    expect(restored.host.messages).not.toContain("dicelops responder resolved");
  });
});

function loadDicelopsHost(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, dicelopsCode: string, responderCode: string) {
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dicelopsCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { source, host };
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
      e:SetOperation(function(e,tp) Debug.Message("dicelops responder resolved") end)
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
