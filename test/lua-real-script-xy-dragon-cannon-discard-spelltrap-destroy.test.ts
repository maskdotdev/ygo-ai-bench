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
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeFusion = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script XY-Dragon Cannon discard Spell/Trap destroy", () => {
  it("restores XY-Dragon Cannon's discard cost, opponent face-up Spell/Trap target, and destroy operation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const xyDragonCannonCode = "2111707";
    const discardCode = "2111708";
    const opponentFaceupSpellCode = "2111709";
    const opponentFacedownTrapCode = "2111710";
    const ownFaceupSpellCode = "2111711";
    const responderCode = "2111712";
    const script = workspace.readScript(`c${xyDragonCannonCode}.lua`);
    expect(script).toContain("Fusion.AddProcMix(c,true,true,62651957,65622692)");
    expect(script).toContain("Fusion.AddContactProc(c,s.contactfil,s.contactop,s.splimit)");
    expect(script).toContain("return Duel.GetMatchingGroup(Card.IsAbleToRemoveAsCost,tp,LOCATION_ONFIELD,0,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST|REASON_MATERIAL)");
    expect(script).toContain("e3:SetCategory(CATEGORY_DESTROY)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e3:SetRange(LOCATION_MZONE)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
    expect(script).toContain("return c:IsFaceup() and c:IsSpellTrap()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_ONFIELD,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e) and tc:IsFaceup()");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      {
        code: xyDragonCannonCode,
        name: "XY-Dragon Cannon",
        kind: "monster",
        typeFlags: typeMonster | typeEffect | typeFusion,
        level: 6,
        attack: 2200,
        defense: 1900,
      },
      { code: discardCode, name: "XY-Dragon Cannon Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: opponentFaceupSpellCode, name: "XY-Dragon Cannon Opponent Face-up Spell", kind: "spell", typeFlags: typeSpell },
      { code: opponentFacedownTrapCode, name: "XY-Dragon Cannon Opponent Facedown Trap", kind: "trap", typeFlags: typeTrap },
      { code: ownFaceupSpellCode, name: "XY-Dragon Cannon Own Face-up Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "XY-Dragon Cannon Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2111707, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [xyDragonCannonCode, discardCode, ownFaceupSpellCode] },
      1: { main: [opponentFaceupSpellCode, opponentFacedownTrapCode, responderCode] },
    });
    startDuel(session);

    const xyDragonCannon = requireCard(session, xyDragonCannonCode);
    const discard = requireCard(session, discardCode);
    const opponentFaceupSpell = requireCard(session, opponentFaceupSpellCode);
    const opponentFacedownTrap = requireCard(session, opponentFacedownTrapCode);
    const ownFaceupSpell = requireCard(session, ownFaceupSpellCode);
    const responder = requireCard(session, responderCode);
    const movedXyDragonCannon = moveDuelCard(session.state, xyDragonCannon.uid, "monsterZone", 0);
    movedXyDragonCannon.position = "faceUpAttack";
    movedXyDragonCannon.faceUp = true;
    moveDuelCard(session.state, discard.uid, "hand", 0);
    const movedOpponentSpell = moveDuelCard(session.state, opponentFaceupSpell.uid, "spellTrapZone", 1);
    movedOpponentSpell.sequence = 0;
    movedOpponentSpell.faceUp = true;
    movedOpponentSpell.position = "faceUpAttack";
    const movedOpponentTrap = moveDuelCard(session.state, opponentFacedownTrap.uid, "spellTrapZone", 1);
    movedOpponentTrap.sequence = 1;
    movedOpponentTrap.faceUp = false;
    movedOpponentTrap.position = "faceDown";
    const movedOwnSpell = moveDuelCard(session.state, ownFaceupSpell.uid, "spellTrapZone", 0);
    movedOwnSpell.sequence = 0;
    movedOwnSpell.faceUp = true;
    movedOwnSpell.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
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
    expect(host.loadCardScript(Number(xyDragonCannonCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const activation = getLuaRestoreLegalActions(restoredOpenWindow, 0).find(
      (action) => action.type === "activateEffect" && action.uid === xyDragonCannon.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpenWindow, activation!);

    expect(restoredOpenWindow.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredOpenWindow.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: xyDragonCannon.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredOpenWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: xyDragonCannon.uid,
        player: 0,
        effectId: "lua-3",
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [opponentFaceupSpell.uid],
        operationInfos: [{ category: 0x1, targetUids: [opponentFaceupSpell.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredChainWindow);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        sourceUid: xyDragonCannon.uid,
        player: 0,
        effectId: "lua-3",
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [opponentFaceupSpell.uid],
        operationInfos: [{ category: 0x1, targetUids: [opponentFaceupSpell.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);
    const responderAction = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.uid === responder.uid);
    expect(responderAction).toBeDefined();
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("chainResponse");
    applyLuaRestoreAndAssert(restoredChainWindow, pass!);

    expect(restoredChainWindow.session.state.chain).toEqual([]);
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === xyDragonCannon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentFaceupSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === opponentFacedownTrap.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 1,
      faceUp: false,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === ownFaceupSpell.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChainWindow.host.messages).not.toContain("xy dragon cannon responder resolved");
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentFaceupSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: xyDragonCannon.uid,
        eventReasonEffectId: 3,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
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
      e:SetOperation(function(e,tp) Debug.Message("xy dragon cannon responder resolved") end)
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
