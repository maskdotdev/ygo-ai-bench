import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const rulerCode = "3739500";
const demiseCode = "72426662";
const allyMonsterCode = "37395001";
const ownSpellCode = "37395002";
const opponentMonsterCode = "37395003";
const opponentSpellCode = "37395004";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRulerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rulerCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeRitual = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasRulerScript)("Lua real script End of the World Ruler code wipe stat", () => {
  it("restores Demise code replacement, LP-cost field wipe, and self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${rulerCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_CODE)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_MZONE)");
    expect(script).toContain("e1:SetValue(72426662)");
    expect(script).toContain("e2:SetCost(Cost.AND(Cost.SelfReveal,Cost.PayLP(2000),s.applycost))");
    expect(script).toContain("c:IsRitualSpell() and c:IsAbleToRemoveAsCost() and c:CheckActivateEffect(true,true,false)~=nil");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.ClearOperationInfo(0)");
    expect(script).toContain("e3:SetCost(Cost.PayLP(2000))");
    expect(script).toContain("Duel.GetMatchingGroup(nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,e:GetHandler())");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)>0");
    expect(script).toContain("c:UpdateAttack(2900)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 3739500, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rulerCode, allyMonsterCode, ownSpellCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode] } });
    startDuel(session);

    const ruler = requireCard(session, rulerCode);
    const ally = requireCard(session, allyMonsterCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const opponentMonster = requireCard(session, opponentMonsterCode, 1);
    const opponentSpell = requireCard(session, opponentSpellCode, 1);
    moveFaceUpAttack(session, ruler, 0);
    moveFaceUpAttack(session, ally, 0);
    moveFaceUpAttack(session, opponentMonster, 1);
    moveFaceUpSpell(session, ownSpell, 0);
    moveFaceUpSpell(session, opponentSpell, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rulerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const restoredRuler = restoredOpen.session.state.cards.find((card) => card.uid === ruler.uid)!;
    expect(currentCardMatchesCode(restoredRuler, restoredOpen.session.state, demiseCode)).toBe(true);
    expect(currentCardMatchesCode(restoredRuler, restoredOpen.session.state, rulerCode)).toBe(false);

    const action = getLuaRestoreLegalActions(restoredOpen, 0).find((candidate) =>
      candidate.type === "activateEffect" && candidate.uid === ruler.uid && candidate.effectId === "lua-4"
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, action!);

    expect(restoredOpen.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ruler.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    for (const card of [ally, ownSpell, opponentMonster, opponentSpell]) {
      expect(restoredOpen.session.state.cards.find((candidate) => candidate.uid === card.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: ruler.uid,
        reasonEffectId: 4,
      });
    }
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ruler.uid)!, restoredOpen.session.state)).toBe(5900);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.eventHistory.find((event) => event.eventName === "lifePointCostPaid")).toEqual({
      eventName: "lifePointCostPaid",
      eventCode: 1201,
      eventPlayer: 0,
      eventValue: 2000,
      eventReason: duelReason.cost,
      eventReasonPlayer: 0,
      eventReasonCardUid: ruler.uid,
      eventReasonEffectId: 4,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: ownSpell.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventCardUid: ally.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventCardUid: opponentMonster.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventCardUid: opponentSpell.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "destroyed").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventCardUid: ownSpell.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventCardUid: ally.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventCardUid: opponentMonster.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventCardUid: opponentSpell.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventCardUid: ownSpell.uid, eventReason: 65, eventReasonPlayer: 0, eventReasonCardUid: ruler.uid, eventReasonEffectId: 4, eventUids: [ownSpell.uid, ally.uid, opponentMonster.uid, opponentSpell.uid] },
    ]);
    expect(restoredOpen.session.state.eventHistory.find((event) => event.eventName === "chainSolved")).toEqual({
      eventName: "chainSolved",
      eventCode: 1022,
      eventValue: 1,
      eventReasonPlayer: 0,
      eventPlayer: 0,
      eventChainDepth: 1,
      eventChainLinkId: "chain-3",
      relatedEffectId: 4,
    });

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === ruler.uid)!, restoredResolved.session.state)).toBe(5900);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: rulerCode, name: "End of the World Ruler", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, level: 10, attack: 3000, defense: 3000 },
    { code: allyMonsterCode, name: "Ruler Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    { code: ownSpellCode, name: "Ruler Own Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentMonsterCode, name: "Ruler Opponent", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200 },
    { code: opponentSpellCode, name: "Ruler Opponent Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.owner === controller));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
