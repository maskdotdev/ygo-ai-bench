import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const yellowStarCode = "29415459";
const mekkCostCode = "294154590";
const columnSpellCode = "294154591";
const columnMonsterCode = "294154592";
const responderCode = "294154593";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setMekkKnight = 0x10c;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mekk-Knight Yellow Star column procedure destroy", () => {
  it("restores its column-gated hand Special Summon procedure and grave banish-cost Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${yellowStarCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetValue(s.hspval)");
    expect(script).toContain("return c:GetColumnGroupCount()>0");
    expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)");
    expect(script).toContain("zone=(zone|tc:GetColumnZone(LOCATION_MZONE,0,0,tp))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil,cg)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yellowStarCode),
      { code: mekkCostCode, name: "Mekk-Knight Yellow Fixture Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMekkKnight], level: 4, attack: 1000, defense: 1000 },
      { code: columnSpellCode, name: "Mekk-Knight Yellow Fixture Spell", kind: "spell", typeFlags: typeSpell },
      { code: columnMonsterCode, name: "Mekk-Knight Yellow Fixture Column Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Mekk-Knight Yellow Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 29415459, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yellowStarCode, mekkCostCode, columnSpellCode] }, 1: { main: [columnMonsterCode, responderCode] } });
    startDuel(session);

    const yellowStar = requireCard(session, yellowStarCode);
    const cost = requireCard(session, mekkCostCode);
    const columnSpell = requireCard(session, columnSpellCode);
    const columnMonster = requireCard(session, columnMonsterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, yellowStar.uid, "hand", 0);
    moveDuelCard(session.state, cost.uid, "graveyard", 0);
    moveDuelCard(session.state, columnSpell.uid, "spellTrapZone", 0);
    columnSpell.sequence = 0;
    columnSpell.faceUp = true;
    moveDuelCard(session.state, columnMonster.uid, "monsterZone", 1);
    columnMonster.sequence = 0;
    columnMonster.faceUp = true;
    columnMonster.position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(yellowStarCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredProcedure = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === yellowStar.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === yellowStar.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: yellowStar.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find(
      (action): action is Extract<DuelAction, { type: "activateEffect" }> => action.type === "activateEffect" && action.uid === yellowStar.uid,
    );
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === cost.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: yellowStar.uid,
    });
    expect(restoredIgnition.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: yellowStar.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        targetUids: [columnSpell.uid],
        operationInfos: [{ category: 0x1, targetUids: [columnSpell.uid], count: 1, player: 0, parameter: 0 }],
        targetFieldIds: [8],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("mekk-knight yellow responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === columnSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: yellowStar.uid,
      reasonEffectId: 2,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === columnMonster.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === cost.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: cost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: yellowStar.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === columnSpell.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: columnSpell.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: yellowStar.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
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
      e:SetOperation(function(e,tp) Debug.Message("mekk-knight yellow responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
