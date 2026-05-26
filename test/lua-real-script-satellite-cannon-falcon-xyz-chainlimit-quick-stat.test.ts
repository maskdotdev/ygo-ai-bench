import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const falconCode = "23603403";
const materialACode = "236034030";
const materialBCode = "236034031";
const graveRaidraptorACode = "236034032";
const graveRaidraptorBCode = "236034033";
const opponentSpellCode = "236034034";
const opponentTrapCode = "236034035";
const opponentMonsterCode = "236034036";
const opponentResponderCode = "236034037";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFalconScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${falconCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWingedBeast = 0x200;
const attributeDark = 0x20;
const attributeWind = 0x10;
const setRaidraptor = 0xba;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFalconScript)("Lua real script Satellite Cannon Falcon Xyz chain limit quick stat", () => {
  it("restores Raidraptor material-check summon wipe and detach-count quick ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const source = {
      readScript(name: string) {
        if (name === `c${opponentResponderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const script = workspace.readScript(`official/c${falconCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 23603403, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [materialACode, materialBCode, graveRaidraptorACode, graveRaidraptorBCode], extra: [falconCode] },
      1: { main: [opponentSpellCode, opponentTrapCode, opponentMonsterCode, opponentResponderCode] },
    });
    startDuel(session);

    const falcon = requireCard(session, falconCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const graveRaidraptorA = requireCard(session, graveRaidraptorACode);
    const graveRaidraptorB = requireCard(session, graveRaidraptorBCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTrap = requireCard(session, opponentTrapCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentResponder = requireCard(session, opponentResponderCode);
    moveFaceUpAttack(session, materialA, 0);
    moveFaceUpAttack(session, materialB, 0);
    moveFaceUpSpellTrap(session, opponentSpell, 1).sequence = 0;
    moveFaceUpSpellTrap(session, opponentTrap, 1).sequence = 1;
    moveFaceUpAttack(session, opponentMonster, 1);
    moveDuelCard(session.state, opponentResponder.uid, "hand", 1);
    moveDuelCard(session.state, graveRaidraptorA.uid, "graveyard", 0);
    moveDuelCard(session.state, graveRaidraptorB.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(falconCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const xyzSummon = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "xyzSummon" && action.uid === falcon.uid && action.materialUids.includes(materialA.uid) && action.materialUids.includes(materialB.uid),
    );
    expect(xyzSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, xyzSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === falcon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "xyz",
      summonMaterialUids: [materialA.uid, materialB.uid],
      overlayUids: [materialA.uid, materialB.uid],
    });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      { sourceUid: falcon.uid, player: 0, triggerBucket: "turnOptional", eventName: "specialSummoned", eventCode: 1102, eventCardUid: falcon.uid },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === falcon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([
      { category: 0x1, targetUids: [opponentSpell.uid, opponentTrap.uid], count: 2, player: 0, parameter: 0 },
    ]);
    expect(restoredTrigger.session.state.chainLimits).toHaveLength(1);
    expect(restoredTrigger.session.state.chainLimits[0]?.registryKey).toBe(
      "lua-chain-limit:23603403:0:link:known:closure:response-matches-chain-player",
    );
    passRestoredChain(restoredTrigger);
    expect(restoredTrigger.host.messages).not.toContain("satellite cannon falcon responder resolved");
    for (const backrow of [opponentSpell, opponentTrap]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === backrow.uid)).toMatchObject({
        location: "graveyard",
        controller: 1,
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: falcon.uid,
        reasonEffectId: 2,
      });
    }

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) => action.type === "activateEffect" && action.uid === falcon.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    expect(restoredQuick.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === falcon.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredQuick.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: falcon.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === opponentMonster.uid), restoredQuick.session.state)).toBe(0);
    expect(restoredQuick.session.state.effects.filter((effect) => effect.sourceUid === opponentMonster.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, sourceUid: opponentMonster.uid, value: -2400 },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["specialSummoned", "destroyed", "detachedMaterial"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: falcon.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.xyz, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "extraDeck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: 2, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTrap.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: 2, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: 2, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: falcon.uid, eventReasonEffectId: 4, previousLocation: "overlay", currentLocation: "graveyard" },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_WINGEDBEAST),8,2)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCondition(s.descon)");
  expect(script).toContain("e2:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("e2:SetValue(s.valcheck)");
  expect(script).toContain("e2:SetLabelObject(e1)");
  expect(script).toContain("g:IsExists(Card.IsSetCard,1,nil,SET_RAIDRAPTOR)");
  expect(script).toContain("Duel.SetChainLimit(s.chainlm)");
  expect(script).toContain("return tp==rp");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e3:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e3:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.atkfilter,tp,LOCATION_GRAVE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*-800)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === falconCode),
    { code: materialACode, name: "Satellite Cannon Raidraptor Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 8, attack: 1600, defense: 1000, setcodes: [setRaidraptor] },
    { code: materialBCode, name: "Satellite Cannon Winged Beast Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 8, attack: 1500, defense: 1000 },
    { code: graveRaidraptorACode, name: "Satellite Cannon Grave Raidraptor A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, setcodes: [setRaidraptor] },
    { code: graveRaidraptorBCode, name: "Satellite Cannon Grave Raidraptor B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeDark, level: 4, attack: 1000, defense: 1000, setcodes: [setRaidraptor] },
    { code: opponentSpellCode, name: "Satellite Cannon Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTrapCode, name: "Satellite Cannon Opponent Trap", kind: "trap", typeFlags: typeTrap },
    { code: opponentMonsterCode, name: "Satellite Cannon Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 2400, defense: 1000 },
    { code: opponentResponderCode, name: "Satellite Cannon Opponent Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_QUICK_O)
      e1:SetCode(EVENT_FREE_CHAIN)
      e1:SetRange(LOCATION_HAND)
      e1:SetOperation(function() Debug.Message("satellite cannon falcon responder resolved") end)
      c:RegisterEffect(e1)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
