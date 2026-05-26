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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Attention level mismatch group destroy", () => {
  it("restores target level lookup and destroys the recomputed different-level monster group", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attentionCode = "85352446";
    const targetCode = "853524460";
    const ownDifferentLevelCode = "853524461";
    const ownSecondDifferentLevelCode = "853524462";
    const ownSameLevelCode = "853524463";
    const facedownDifferentLevelCode = "853524464";
    const responderCode = "853524465";
    const script = workspace.readScript(`c${attentionCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter2,0,LOCATION_MZONE,LOCATION_MZONE,1,c,lv)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local dg=Duel.GetMatchingGroup(s.filter2,0,LOCATION_MZONE,LOCATION_MZONE,nil,g:GetFirst():GetLevel())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,dg,#dg,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter2,0,LOCATION_MZONE,LOCATION_MZONE,tc,tc:GetLevel())");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === attentionCode),
      { code: targetCode, name: "Attention Opponent Level Three Target", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1300, defense: 1000 },
      { code: ownDifferentLevelCode, name: "Attention Own Level Four Destroyed", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000 },
      { code: ownSecondDifferentLevelCode, name: "Attention Own Level Five Destroyed", kind: "monster", typeFlags: typeMonster, level: 5, attack: 1600, defense: 1000 },
      { code: ownSameLevelCode, name: "Attention Own Same Level Decoy", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1200, defense: 1000 },
      { code: facedownDifferentLevelCode, name: "Attention Facedown Different Level Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: responderCode, name: "Attention Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 85352446, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [attentionCode, ownDifferentLevelCode, ownSecondDifferentLevelCode, ownSameLevelCode, facedownDifferentLevelCode] },
      1: { main: [targetCode, responderCode] },
    });
    startDuel(session);

    const attention = requireCard(session, attentionCode);
    const target = requireCard(session, targetCode);
    const ownDifferentLevel = requireCard(session, ownDifferentLevelCode);
    const ownSecondDifferentLevel = requireCard(session, ownSecondDifferentLevelCode);
    const ownSameLevel = requireCard(session, ownSameLevelCode);
    const facedownDifferentLevel = requireCard(session, facedownDifferentLevelCode);
    const responder = requireCard(session, responderCode);
    const movedAttention = moveDuelCard(session.state, attention.uid, "spellTrapZone", 0);
    movedAttention.position = "faceDown";
    movedAttention.faceUp = false;
    movedAttention.turnId = 0;
    const movedTarget = moveDuelCard(session.state, target.uid, "monsterZone", 1);
    movedTarget.position = "faceUpAttack";
    movedTarget.faceUp = true;
    const movedDifferentLevel = moveDuelCard(session.state, ownDifferentLevel.uid, "monsterZone", 0);
    movedDifferentLevel.sequence = 0;
    movedDifferentLevel.position = "faceUpAttack";
    movedDifferentLevel.faceUp = true;
    const movedSecondDifferentLevel = moveDuelCard(session.state, ownSecondDifferentLevel.uid, "monsterZone", 0);
    movedSecondDifferentLevel.sequence = 1;
    movedSecondDifferentLevel.position = "faceUpAttack";
    movedSecondDifferentLevel.faceUp = true;
    const movedSameLevel = moveDuelCard(session.state, ownSameLevel.uid, "monsterZone", 0);
    movedSameLevel.sequence = 2;
    movedSameLevel.position = "faceUpAttack";
    movedSameLevel.faceUp = true;
    const movedFacedown = moveDuelCard(session.state, facedownDifferentLevel.uid, "monsterZone", 0);
    movedFacedown.sequence = 3;
    movedFacedown.position = "faceDownDefense";
    movedFacedown.faceUp = false;
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
    expect(host.loadCardScript(Number(attentionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const action = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === attention.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, action!);
    const destroyedUids = [ownDifferentLevel.uid, ownSecondDifferentLevel.uid];
    expect(restoredOpenWindow.session.state.chain).toHaveLength(1);
    expect(restoredOpenWindow.session.state.chain[0]!.operationInfos).toEqual([
      expect.objectContaining({ category: 0x1, targetUids: destroyedUids, count: 2, player: 0, parameter: 0 }),
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(true);
    passRestoredChain(restoredChainWindow, 1);
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(false);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === attention.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownDifferentLevel.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownSecondDifferentLevel.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownSameLevel.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === facedownDifferentLevel.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: false });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("attention responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownDifferentLevel.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: attention.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownSecondDifferentLevel.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: attention.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownDifferentLevel.uid,
        eventUids: destroyedUids,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: attention.uid,
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
      e:SetOperation(function(e,tp) Debug.Message("attention responder resolved") end)
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
