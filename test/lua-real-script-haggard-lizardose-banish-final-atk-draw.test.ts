import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lizardoseCode = "9763474";
const costCode = "97634740";
const targetCode = "97634741";
const drawCode = "97634742";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLizardoseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lizardoseCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceReptile = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasLizardoseScript)("Lua real script Haggard Lizardose banish final ATK draw", () => {
  it("restores banish cost labels into final ATK setting and Reptile draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lizardoseCode}.lua`);
    expect(script).toContain("Link.AddProcedure(c,nil,2,2,function(g) return g:GetClassCount(Card.GetCode)==#g end)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcostfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil,tp)");
    expect(script).toContain("e:SetLabel(tc:GetTextAttack(),tc:GetOriginalRace())");
    expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(aux.NOT(Card.IsAttack),atk),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(atk)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 9763474, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [costCode, targetCode, drawCode], extra: [lizardoseCode] }, 1: { main: [] } });
    startDuel(session);

    const lizardose = requireCard(session, lizardoseCode);
    const cost = requireCard(session, costCode);
    const target = requireCard(session, targetCode);
    const draw = requireCard(session, drawCode);
    moveDuelCard(session.state, lizardose.uid, "monsterZone", 0).position = "faceUpAttack";
    lizardose.faceUp = true;
    moveDuelCard(session.state, cost.uid, "graveyard", 0).position = "faceUpAttack";
    cost.faceUp = true;
    moveDuelCard(session.state, target.uid, "monsterZone", 0).position = "faceUpAttack";
    target.faceUp = true;
    draw.sequence = 0;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lizardoseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === lizardose.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.cost,
      reasonCardUid: lizardose.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1200);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: 102,
        event: "continuous",
        sourceUid: target.uid,
        value: 1200,
      },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["banished", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: lizardose.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [draw.uid],
        eventCardUid: draw.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: lizardose.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResult = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResult);
    expectRestoredLegalActions(restoredResult, 0);
    expect(currentAttack(restoredResult.session.state.cards.find((card) => card.uid === target.uid), restoredResult.session.state)).toBe(1200);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: lizardoseCode, name: "Haggard Lizardose", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceReptile, attack: 1200, defense: 0 },
    { code: costCode, name: "Haggard Lizardose Reptile Cost", kind: "monster", typeFlags: typeMonster, race: raceReptile, level: 4, attack: 1200, defense: 1000 },
    { code: targetCode, name: "Haggard Lizardose ATK Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    { code: drawCode, name: "Haggard Lizardose Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
