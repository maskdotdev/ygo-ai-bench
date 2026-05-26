import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const apocalypseCode = "61529473";
const hasApocalypseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${apocalypseCode}.lua`));
const ownTargetCode = "615294730";
const opponentACode = "615294731";
const opponentBCode = "615294732";
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const setTrueDracoKing = 0xf9;

describe.skipIf(!hasUpstreamScripts || !hasApocalypseScript)("Lua real script True Draco Apocalypse flag final stat", () => {
  it("restores chain flag cost into own True Draco destruction and opponent final stat halving", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${apocalypseCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCost(s.opccost)");
    expect(script).toContain("Duel.GetFlagEffect(tp,id)==0");
    expect(script).toContain("Duel.RegisterFlagEffect(tp,id,RESET_CHAIN,0,1)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_TRUE_DRACO_KING),tp,LOCATION_ONFIELD,0,1,1,c)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)");
    expect(script).toContain("if tc:IsRelateToEffect(e) and Duel.Destroy(tc,REASON_EFFECT)>0 then");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(math.ceil(oc:GetAttack()/2))");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetValue(math.ceil(oc:GetDefense()/2))");

    const cards: DuelCardData[] = [
      { code: apocalypseCode, name: "True Draco Apocalypse", kind: "trap", typeFlags: typeTrap | typeContinuous, setcodes: [setTrueDracoKing] },
      { code: ownTargetCode, name: "Apocalypse Own True Draco", kind: "monster", typeFlags: typeMonster, setcodes: [setTrueDracoKing], level: 4, attack: 1600, defense: 1000 },
      { code: opponentACode, name: "Apocalypse Opponent A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1901, defense: 1701 },
      { code: opponentBCode, name: "Apocalypse Opponent B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 801 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 61529473, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [apocalypseCode, ownTargetCode] }, 1: { main: [opponentACode, opponentBCode] } });
    startDuel(session);

    const apocalypse = requireCard(session, apocalypseCode);
    const ownTarget = requireCard(session, ownTargetCode);
    const opponentA = requireCard(session, opponentACode);
    const opponentB = requireCard(session, opponentBCode);
    moveDuelCard(session.state, apocalypse.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    ownTarget.faceUp = true;
    moveDuelCard(session.state, opponentA.uid, "monsterZone", 1).position = "faceUpAttack";
    opponentA.faceUp = true;
    moveDuelCard(session.state, opponentB.uid, "monsterZone", 1).position = "faceUpDefense";
    opponentB.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(apocalypseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === apocalypse.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: apocalypse.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentA.uid), restoredOpen.session.state)).toBe(951);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === opponentA.uid), restoredOpen.session.state)).toBe(851);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponentB.uid), restoredOpen.session.state)).toBe(500);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === opponentB.uid), restoredOpen.session.state)).toBe(401);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "destroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: ownTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 2,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: ownTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: apocalypse.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: ownTarget.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: apocalypse.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
