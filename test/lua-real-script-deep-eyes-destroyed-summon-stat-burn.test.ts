import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const deepEyesCode = "22804410";
const hasDeepEyesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${deepEyesCode}.lua`));
const blueEyesCode = "228044100";
const graveDragonACode = "228044101";
const graveDragonBCode = "228044102";
const destroyerCode = "228044103";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const setBlueEyes = 0xdd;

describe.skipIf(!hasUpstreamScripts || !hasDeepEyesScript)("Lua real script Deep-Eyes destroyed summon stat burn", () => {
  it("restores destroyed Blue-Eyes trigger into hand Special Summon, grave class-count damage, and final ATK copy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${deepEyesCode}.lua`);
    expect(script).toBeDefined();
    const scriptText = script!;
    expect(scriptText).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_DAMAGE)");
    expect(scriptText).toContain("e1:SetCode(EVENT_DESTROYED)");
    expect(scriptText).toContain("c:IsPreviousSetCard(SET_BLUE_EYES)");
    expect(scriptText).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(scriptText).toContain("local dam=g:GetClassCount(Card.GetCode)*600");
    expect(scriptText).toContain("Duel.Damage(1-tp,dam,REASON_EFFECT)");
    expect(scriptText).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(scriptText).toContain("Duel.SelectTarget(tp,Card.IsRace,tp,LOCATION_GRAVE,0,1,1,nil,RACE_DRAGON)");
    expect(scriptText).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");

    const cards: DuelCardData[] = [
      { code: deepEyesCode, name: "Deep-Eyes White Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 10, attack: 0, defense: 0 },
      { code: blueEyesCode, name: "Destroyed Blue-Eyes Fixture", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 8, attack: 3000, defense: 2500, setcodes: [setBlueEyes] },
      { code: graveDragonACode, name: "Deep-Eyes Grave Dragon A", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 8, attack: 3000, defense: 2500 },
      { code: graveDragonBCode, name: "Deep-Eyes Grave Dragon B", kind: "monster", typeFlags: typeMonster, race: raceDragon, level: 7, attack: 2400, defense: 2000 },
      { code: destroyerCode, name: "Deep-Eyes Opponent Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 22804410, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deepEyesCode, blueEyesCode, graveDragonACode, graveDragonBCode] }, 1: { main: [destroyerCode] } });
    startDuel(session);

    const deepEyes = requireCard(session, deepEyesCode);
    const blueEyes = requireCard(session, blueEyesCode);
    const graveDragonA = requireCard(session, graveDragonACode);
    const graveDragonB = requireCard(session, graveDragonBCode);
    const destroyer = requireCard(session, destroyerCode);
    moveDuelCard(session.state, deepEyes.uid, "hand", 0);
    moveDuelCard(session.state, blueEyes.uid, "monsterZone", 0).position = "faceUpAttack";
    blueEyes.faceUp = true;
    moveDuelCard(session.state, graveDragonA.uid, "graveyard", 0);
    moveDuelCard(session.state, graveDragonB.uid, "graveyard", 0);
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 1).position = "faceUpAttack";
    destroyer.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(blueEyesCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(deepEyesCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const destroy = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, destroy!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === blueEyes.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === deepEyes.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos)).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === deepEyes.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: deepEyes.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(6200);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const atkTrigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === deepEyes.uid);
    expect(atkTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonTrigger, atkTrigger!);
    expect(restoredSummonTrigger.session.state.chain).toEqual([]);
    const restoredDeepEyes = restoredSummonTrigger.session.state.cards.find((card) => card.uid === deepEyes.uid);
    expect(restoredDeepEyes).toBeDefined();
    expect(currentAttack(restoredDeepEyes, restoredSummonTrigger.session.state)).toBe(3000);
    expect(restoredSummonTrigger.session.state.effects.filter((effect) => effect.sourceUid === deepEyes.uid && effect.code === 102)).toHaveLength(1);
    expect(restoredSummonTrigger.session.state.eventHistory.filter((event) => ["destroyed", "specialSummoned", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: blueEyes.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: deepEyes.uid,
        eventUids: [deepEyes.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: deepEyes.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: deepEyes.uid,
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

function destroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetMatchingGroup(Card.IsCode,tp,0,LOCATION_MZONE,nil,${targetCode}):GetFirst()
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveEngineChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
