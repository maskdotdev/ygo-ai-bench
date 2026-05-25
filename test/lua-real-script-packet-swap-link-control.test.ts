import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const packetSwapCode = "75153328";
const ownNonLinkCode = "751533280";
const opponentLinkCode = "751533281";
const ownLinkDecoyCode = "751533282";
const opponentNonLinkDecoyCode = "751533283";
const responderCode = "751533284";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Packet Swap link control exchange", () => {
  it("restores asymmetric non-Link and Link targets into SwapControl from chain target cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${packetSwapCode}.lua`);
    expect(script).toContain("--Packet Swap");
    expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("not c:IsLinkMonster()");
    expect(script).toContain("c:IsLinkMonster()");
    expect(script).toContain("Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter2,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
    expect(script).toContain("Duel.SwapControl(a,b)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 75153328, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [packetSwapCode, ownNonLinkCode], extra: [ownLinkDecoyCode] },
      1: { main: [opponentNonLinkDecoyCode, responderCode], extra: [opponentLinkCode] },
    });
    startDuel(session);

    const packetSwap = requireCard(session, packetSwapCode);
    const ownNonLink = requireCard(session, ownNonLinkCode);
    const opponentLink = requireCard(session, opponentLinkCode);
    const ownLinkDecoy = requireCard(session, ownLinkDecoyCode);
    const opponentNonLinkDecoy = requireCard(session, opponentNonLinkDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, packetSwap.uid, "hand", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveFaceUpAttack(session, ownNonLink, 0, 0);
    moveFaceUpAttack(session, opponentLink, 1, 0);
    moveFaceUpAttack(session, ownLinkDecoy, 0, 1);
    moveFaceUpAttack(session, opponentNonLinkDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(packetSwapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === packetSwap.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(session.state.chain).toEqual([
      expect.objectContaining({
        player: 0,
        sourceUid: packetSwap.uid,
        operationInfos: [{ category: categoryControl, targetUids: [ownNonLink.uid, opponentLink.uid], count: 2, player: 0, parameter: 0 }],
        targetUids: [ownNonLink.uid, opponentLink.uid],
      }),
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, pass!);

    expect(restoredChain.session.state.cards.find((card) => card.uid === ownNonLink.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: packetSwap.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentLink.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: packetSwap.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ownLinkDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponentNonLinkDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === packetSwap.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("packet swap responder resolved");

    const groupedEvents = restoredChain.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventUids?.includes(ownNonLink.uid));
    expect(groupedEvents).toEqual([
      expect.objectContaining({
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: packetSwap.uid,
        eventReasonEffectId: 1,
        eventUids: [ownNonLink.uid, opponentLink.uid],
      }),
    ]);

    const restoredAfterSwap = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredAfterSwap);
    expectRestoredLegalActions(restoredAfterSwap, 0);
    expect(restoredAfterSwap.session.state.cards.find((card) => card.uid === ownNonLink.uid)).toMatchObject({ controller: 1, previousController: 0 });
    expect(restoredAfterSwap.session.state.cards.find((card) => card.uid === opponentLink.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === packetSwapCode),
    { code: ownNonLinkCode, name: "Packet Swap Own Non-Link", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
    { code: opponentLinkCode, name: "Packet Swap Opponent Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1800, defense: 0, linkMarkers: 0x28 },
    { code: ownLinkDecoyCode, name: "Packet Swap Own Link Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1400, defense: 0, linkMarkers: 0x28 },
    { code: opponentNonLinkDecoyCode, name: "Packet Swap Opponent Non-Link Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
    { code: responderCode, name: "Packet Swap Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
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
      e:SetOperation(function(e,tp) Debug.Message("packet swap responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
