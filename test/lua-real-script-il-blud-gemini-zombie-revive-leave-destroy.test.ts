import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const ilBludCode = "70595331";
const zombieTargetCode = "70595332";
const offRaceTargetCode = "70595333";
const responderCode = "70595334";
const hasIlBludScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ilBludCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasIlBludScript)("Lua real script Il Blud Gemini Zombie revive leave destroy", () => {
  it("restores Gemini-gated Zombie summon and SetCardTarget leave-field destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${ilBludCode}.lua`);
    expect(script).toContain("Gemini.AddProcedure(c)");
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetCondition(Gemini.EffectStatusCondition)");
    expect(script).toContain("return c:IsRace(RACE_ZOMBIE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_GRAVE|LOCATION_HAND,LOCATION_GRAVE,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.filter),tp,LOCATION_GRAVE|LOCATION_HAND,LOCATION_GRAVE,1,1,nil,e,tp)");
    expect(script).toContain("c:SetCardTarget(g:GetFirst())");
    expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("e:GetHandler():GetCardTarget():Filter(aux.FaceupFilter(Card.IsRace,RACE_ZOMBIE),nil)");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ilBludCode),
      { code: zombieTargetCode, name: "Il Blud Zombie Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, level: 4, attack: 1700, defense: 1000 },
      { code: offRaceTargetCode, name: "Il Blud Off-Race Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Il Blud Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 70595331, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ilBludCode, zombieTargetCode, offRaceTargetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const ilBlud = requireCard(session, ilBludCode);
    const zombieTarget = requireCard(session, zombieTargetCode);
    const offRaceTarget = requireCard(session, offRaceTargetCode);
    const responder = requireCard(session, responderCode);
    moveMonster(session, ilBlud.uid, 0, 0);
    moveDuelCard(session.state, zombieTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, offRaceTarget.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(ilBludCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 0);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === ilBlud.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredInitial, geminiSummon!);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === ilBlud.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredIgnition, ignition!);
    expect(restoredIgnition.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-4",
        id: "chain-3",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }],
        player: 0,
        sourceUid: ilBlud.uid,
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("il blud responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === zombieTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: ilBlud.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offRaceTarget.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === ilBlud.uid)?.cardTargetUids).toEqual([zombieTarget.uid]);
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === zombieTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: zombieTarget.uid,
        eventUids: [zombieTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: ilBlud.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredWatcher = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredWatcher);
    expectRestoredLegalActions(restoredWatcher, 0);
    destroyDuelCard(restoredWatcher.session.state, ilBlud.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredWatcher.session.state.cards.find((card) => card.uid === ilBlud.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredWatcher.session.state.cards.find((card) => card.uid === zombieTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: ilBlud.uid,
    });
    expect(restoredWatcher.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === zombieTarget.uid)).toEqual([
      expect.objectContaining({
        eventCode: 1029,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ilBlud.uid,
      }),
    ]);
    expectRestoredLegalActions(restoredWatcher, 0);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, uid: string, player: 0 | 1, sequence: number): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("il blud responder resolved") end)
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
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
