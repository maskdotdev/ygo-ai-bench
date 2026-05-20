import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const swampMirrorerCode = "50277973";
const hasSwampMirrorerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${swampMirrorerCode}.lua`));
const responderCode = "50277974";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeNormal = 0x10;
const raceWarrior = 0x1;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasSwampMirrorerScript)("Lua real script Swamp Mirrorer announce trap monster", () => {
  it("restores announced race and attribute into a Trap Monster SpecialSummonStep", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${swampMirrorerCode}.lua`);
    expect(script).toContain("Duel.AnnounceRace(tp,1,e:GetLabel())");
    expect(script).toContain("Duel.AnnounceAttribute(tp,1,att)");
    expect(script).toContain("Duel.SetTargetParam(catt)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("c:AddMonsterAttribute(TYPE_NORMAL+TYPE_TRAP,att,rac,0,0,0)");
    expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,true,false,POS_FACEUP)");
    expect(script).toContain("c:AddMonsterAttributeComplete()");
    expect(script).toContain("Duel.SpecialSummonComplete()");

    const cards: DuelCardData[] = [
      { code: swampMirrorerCode, name: "Swamp Mirrorer", kind: "trap", typeFlags: typeTrap, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Swamp Mirrorer Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 50277973, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [swampMirrorerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const swampMirrorer = requireCard(session, swampMirrorerCode);
    const responder = requireCard(session, responderCode);
    const setCard = moveDuelCard(session.state, swampMirrorer.uid, "spellTrapZone", 0);
    setCard.position = "faceDown";
    setCard.faceUp = false;
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
    expect(host.loadCardScript(Number(swampMirrorerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === swampMirrorer.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);
    expect(host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceRace", player: 0, options: [raceWarrior, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000, 0x400000, 0x800000, 0x1000000, 0x2000000], descriptions: [raceWarrior, 0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000, 0x400000, 0x800000, 0x1000000, 0x2000000], returned: raceWarrior },
      { id: "lua-prompt-2", api: "AnnounceAttribute", player: 0, options: [0x1, 0x2, 0x4, 0x8, attributeLight, 0x20, 0x40], descriptions: [0x1, 0x2, 0x4, 0x8, attributeLight, 0x20, 0x40], returned: 0x1 },
    ]);
    expect(session.state.chain).toEqual([
      {
        activationLocation: "spellTrapZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1-1002",
        effectLabel: raceWarrior,
        id: "chain-2",
        operationInfos: [{ category: 0x200, targetUids: [swampMirrorer.uid], count: 1, player: 0, parameter: 0 }],
        player: 0,
        sourceUid: swampMirrorer.uid,
        targetParam: 0x1,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("swamp mirrorer responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === swampMirrorer.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: swampMirrorer.uid,
      reasonEffectId: 1,
      data: {
        typeFlags: typeMonster | typeTrap | typeNormal,
        race: raceWarrior,
        attribute: 0x1,
        level: 4,
        attack: 1800,
        defense: 1000,
      },
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === swampMirrorer.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: swampMirrorer.uid,
        eventUids: [swampMirrorer.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: swampMirrorer.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
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
      e:SetOperation(function(e,tp) Debug.Message("swamp mirrorer responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
