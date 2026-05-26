import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const straddleCode = "41619242";
const hasStraddleScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${straddleCode}.lua`));
const scareclawCode = "416192420";
const opponentCode = "416192421";
const decoyCode = "416192422";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const setScareclaw = 0x17c;

describe.skipIf(!hasUpstreamScripts || !hasStraddleScript)("Lua real script Scareclaw Straddle SelectUnselect stat", () => {
  it("restores SelectUnselectGroup cross-controller targets into max ATK/DEF gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${straddleCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("local g=Duel.GetTargetGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil,1-tp)");
    expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,aux.dpcheck(Card.GetControler),0)");
    expect(script).toContain("Duel.SetTargetCard(tg)");
    expect(script).toContain("local g=Duel.GetTargetCards(e)");
    expect(script).toContain("local val=math.max(ac:GetAttack(),ac:GetDefense())");
    expect(script).toContain("tc:UpdateAttack(val,nil,c)");
    expect(script).toContain("tc:UpdateDefense(val,nil,c)");

    const cards: DuelCardData[] = [
      { code: straddleCode, name: "Scareclaw Straddle", kind: "spell", typeFlags: typeSpell, setcodes: [setScareclaw] },
      { code: scareclawCode, name: "Scareclaw Fixture", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setScareclaw], level: 4, attack: 1400, defense: 900 },
      { code: opponentCode, name: "Straddle Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 2500 },
      { code: decoyCode, name: "Straddle Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 41619242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [straddleCode, scareclawCode, decoyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const straddle = requireCard(session, straddleCode);
    const scareclaw = requireCard(session, scareclawCode);
    const opponent = requireCard(session, opponentCode);
    const decoy = requireCard(session, decoyCode);
    moveDuelCard(session.state, straddle.uid, "hand", 0);
    moveDuelCard(session.state, scareclaw.uid, "monsterZone", 0).position = "faceUpAttack";
    scareclaw.faceUp = true;
    moveDuelCard(session.state, decoy.uid, "monsterZone", 0).position = "faceUpAttack";
    decoy.faceUp = true;
    moveDuelCard(session.state, opponent.uid, "monsterZone", 1).position = "faceUpAttack";
    opponent.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(straddleCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === straddle.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    expect(activation).not.toHaveProperty("operationInfos");
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === scareclaw.uid), restoredOpen.session.state)).toBe(3900);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === scareclaw.uid), restoredOpen.session.state)).toBe(3400);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: scareclaw.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: opponent.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
    ]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === decoy.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
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
