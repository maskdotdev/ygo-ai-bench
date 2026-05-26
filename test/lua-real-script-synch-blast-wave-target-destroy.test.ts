import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSynchro = 0x2000;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Synch Blast Wave target destroy", () => {
  it("restores Synch Blast Wave's face-up Synchro gate, opponent monster target, and destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const synchBlastWaveCode = "35537860";
    const synchroGateCode = "35537861";
    const targetCode = "35537862";
    const ownDecoyCode = "35537863";
    const responderCode = "35537864";
    const script = workspace.readScript(`c${synchBlastWaveCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsFaceup() and c:IsType(TYPE_SYNCHRO)");
    expect(script).toContain("Duel.IsExistingTarget(aux.TRUE,tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === synchBlastWaveCode),
      {
        code: synchroGateCode,
        name: "Synch Blast Wave Face-up Synchro Gate",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeSynchro,
        level: 7,
        attack: 2500,
        defense: 2000,
      },
      { code: targetCode, name: "Synch Blast Wave Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: ownDecoyCode, name: "Synch Blast Wave Own Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Synch Blast Wave Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 35537860, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [synchBlastWaveCode, synchroGateCode, ownDecoyCode, responderCode] },
      1: { main: [targetCode] },
    });
    startDuel(session);

    const synchBlastWave = requireCard(session, synchBlastWaveCode);
    const synchroGate = requireCard(session, synchroGateCode);
    const target = requireCard(session, targetCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, synchBlastWave.uid, "hand", 0);
    const movedGate = moveDuelCard(session.state, synchroGate.uid, "monsterZone", 0);
    movedGate.faceUp = true;
    movedGate.position = "faceUpAttack";
    const movedOwnDecoy = moveDuelCard(session.state, ownDecoy.uid, "monsterZone", 0);
    movedOwnDecoy.faceUp = true;
    movedOwnDecoy.position = "faceUpAttack";
    const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 1);
    movedTarget.faceUp = true;
    movedTarget.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(synchBlastWaveCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const action = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === synchBlastWave.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, action!);
    expect(restoredOpenWindow.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: synchBlastWave.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [9],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        sourceUid: synchBlastWave.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [9],
        targetUids: [target.uid],
        operationInfos: [{ category: 0x1, targetUids: [target.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const responderAction = getLuaRestoreLegalActions(restoredChainWindow, 1).find((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid);
    expect(responderAction).toBeDefined();
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === synchBlastWave.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === synchroGate.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("synch blast wave responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: synchBlastWave.uid,
        eventReasonEffectId: 1,
      },
    ]);
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
      e:SetOperation(function(e,tp) Debug.Message("synch blast wave responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
