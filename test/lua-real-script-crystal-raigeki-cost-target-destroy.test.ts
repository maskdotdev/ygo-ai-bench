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
const setCrystalBeast = 0x1034;
const typeMonster = 0x1;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Crystal Raigeki cost target destroy", () => {
  it("restores its selected Crystal Beast S/T cost and opponent target destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const crystalRaigekiCode = "96331676";
    const crystalCostCode = "963316760";
    const offSetFaceupSpellCode = "963316761";
    const opponentTargetCode = "963316762";
    const ownDecoyCode = "963316763";
    const responderCode = "963316764";
    const script = workspace.readScript(`c${crystalRaigekiCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("s.listed_series={SET_CRYSTAL_BEAST}");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_SZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === crystalRaigekiCode),
      { code: crystalCostCode, name: "Crystal Raigeki Crystal Beast Cost", kind: "spell", typeFlags: typeSpell, setcodes: [setCrystalBeast] },
      { code: offSetFaceupSpellCode, name: "Crystal Raigeki Off-Set Face-up Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [0x123] },
      { code: opponentTargetCode, name: "Crystal Raigeki Opponent Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: ownDecoyCode, name: "Crystal Raigeki Own Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Crystal Raigeki Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 96331676, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [crystalRaigekiCode, crystalCostCode, offSetFaceupSpellCode, ownDecoyCode] },
      1: { main: [opponentTargetCode, responderCode] },
    });
    startDuel(session);

    const crystalRaigeki = requireCard(session, crystalRaigekiCode);
    const crystalCost = requireCard(session, crystalCostCode);
    const offSetFaceupSpell = requireCard(session, offSetFaceupSpellCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    const responder = requireCard(session, responderCode);
    const movedTrap = moveDuelCard(session.state, crystalRaigeki.uid, "spellTrapZone", 0);
    movedTrap.position = "faceDown";
    movedTrap.faceUp = false;
    movedTrap.turnId = 0;
    const movedCost = moveDuelCard(session.state, crystalCost.uid, "spellTrapZone", 0);
    movedCost.sequence = 1;
    movedCost.position = "faceUpAttack";
    movedCost.faceUp = true;
    const movedOffSet = moveDuelCard(session.state, offSetFaceupSpell.uid, "spellTrapZone", 0);
    movedOffSet.sequence = 2;
    movedOffSet.position = "faceUpAttack";
    movedOffSet.faceUp = true;
    const movedTarget = moveDuelCard(session.state, opponentTarget.uid, "monsterZone", 1);
    movedTarget.position = "faceUpAttack";
    movedTarget.faceUp = true;
    const movedOwnDecoy = moveDuelCard(session.state, ownDecoy.uid, "monsterZone", 0);
    movedOwnDecoy.position = "faceUpAttack";
    movedOwnDecoy.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turn = 1;
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(crystalRaigekiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const action = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === crystalRaigeki.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, action!);
    expect(restoredOpenWindow.session.state.chain).toHaveLength(1);
    expect(restoredOpenWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: crystalRaigeki.uid,
        player: 0,
        effectId: "lua-1-1002",
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        operationInfos: [{ category: 0x1, targetUids: [opponentTarget.uid], count: 1, player: 0, parameter: 0 }],
        targetFieldIds: [10],
        targetUids: [opponentTarget.uid],
      },
    ]);
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === crystalCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: crystalRaigeki.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === offSetFaceupSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === crystalRaigeki.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === crystalCost.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === offSetFaceupSpell.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("crystal raigeki responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === crystalCost.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: crystalCost.uid,
        eventPreviousState: { location: "spellTrapZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: crystalRaigeki.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentTarget.uid,
        eventPreviousState: { location: "monsterZone", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 1, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: crystalRaigeki.uid,
        eventReasonEffectId: 1,
      },
    ]);
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
      e:SetOperation(function(e,tp) Debug.Message("crystal raigeki responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
