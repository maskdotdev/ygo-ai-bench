import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const engineCode = "82556058";
const tokenCode = "82556059";
const hasEngineScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${engineCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typesToken = 0x4011;
const raceMachine = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasEngineScript)("Lua real script Fiendish Engine token End Phase destroy", () => {
  it("restores ATK boost flag into End Phase Engine Token summon and self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${engineCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,0)");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,TOKEN_ENGINE,0,TYPES_TOKEN,200,200,1,RACE_MACHINE,ATTRIBUTE_EARTH)");
    expect(script).toContain("local token=Duel.CreateToken(tp,TOKEN_ENGINE)");
    expect(script).toContain("Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP_ATTACK)");
    expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_OATH,1)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("function(e) return e:GetHandler():HasFlagEffect(id) end");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: engineCode, name: "Fiendish Engine Omega", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 8, attack: 2800, defense: 2000 },
      { code: tokenCode, name: "Engine Token", kind: "monster", typeFlags: typesToken, race: raceMachine, attribute: attributeEarth, level: 1, attack: 200, defense: 200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 82556058, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [engineCode] }, 1: { main: [] } });
    startDuel(session);

    const engine = requireCard(session, engineCode);
    const movedEngine = moveDuelCard(session.state, engine.uid, "monsterZone", 0);
    movedEngine.position = "faceUpAttack";
    movedEngine.faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(engineCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(engine, session.state)).toBe(2800);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const boost = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === engine.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, boost!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    const restoredBoosted = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoosted);
    expectRestoredLegalActions(restoredBoosted, 0);
    const boostedEngine = restoredBoosted.session.state.cards.find((card) => card.uid === engine.uid);
    expect(boostedEngine).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(currentAttack(boostedEngine, restoredBoosted.session.state)).toBe(3800);
    expect(restoredBoosted.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "card", ownerId: engine.uid, code: Number(engineCode), property: 0x80000, value: 0, reset: 0x41fe1200, resetCount: 1 }),
    ]);
    expect(restoredBoosted.session.state.effects.filter((effect) => effect.sourceUid === engine.uid && effect.triggerEvent === "phaseEnd")).toEqual([
      expect.objectContaining({ code: 0x1200, triggerEvent: "phaseEnd", category: 0x600 }),
      expect.objectContaining({ code: 0x1200, triggerEvent: "phaseEnd", category: 0x1 }),
    ]);

    const restoredMain2 = restoreDuelWithLuaScripts(serializeDuel(restoredBoosted.session), workspace, reader);
    expectCleanRestore(restoredMain2);
    expectRestoredLegalActions(restoredMain2, 0);
    restoredMain2.session.state.phase = "main2";
    restoredMain2.session.state.waitingFor = 0;
    const end = getLuaRestoreLegalActions(restoredMain2, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredMain2, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredMain2, end!);
    expect(restoredMain2.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: 0x1200 }]);
    expect(restoredMain2.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-1-4608",
        sourceUid: engine.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventTriggerTiming: "when",
      },
      {
        id: "trigger-5-2",
        effectId: "lua-3-4608",
        sourceUid: engine.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredMain2.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const tokenTrigger = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "activateTrigger" && action.uid === engine.uid && action.effectId === "lua-1-4608");
    expect(tokenTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEnd, tokenTrigger!);
    expect(restoredEnd.session.state.chain).toEqual([
      {
        id: "chain-5",
        chainIndex: 1,
        sourceUid: engine.uid,
        player: 0,
        effectId: "lua-1-4608",
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventTriggerTiming: "when",
        operationInfos: [
          { category: 0x400, targetUids: [], count: 1, player: 0, parameter: 0 },
          { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);
    const restoredTokenChain = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader);
    expectCleanRestore(restoredTokenChain);
    expectRestoredLegalActions(restoredTokenChain, 0);
    expect(getLuaRestoreLegalActions(restoredTokenChain, 0)).toEqual([
      expect.objectContaining({ type: "activateTrigger", uid: engine.uid, effectId: "lua-3-4608", triggerBucket: "turnMandatory" }),
    ]);
    const selfDestroyTrigger = getLuaRestoreLegalActions(restoredTokenChain, 0).find((action) => action.type === "activateTrigger" && action.uid === engine.uid && action.effectId === "lua-3-4608");
    expect(selfDestroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTokenChain, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTokenChain, selfDestroyTrigger!);
    expect(restoredTokenChain.session.state.chain).toEqual([]);
    const tokens = restoredTokenChain.session.state.cards.filter((card) => card.code === tokenCode);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      location: "monsterZone",
      controller: 0,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: engine.uid,
      reasonEffectId: 1,
    });

    const restoredSelfDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredTokenChain.session), workspace, reader);
    expectCleanRestore(restoredSelfDestroy);
    expectRestoredLegalActions(restoredSelfDestroy, 0);
    expect(restoredSelfDestroy.session.state.chain).toEqual([]);
    expect(restoredSelfDestroy.session.state.cards.find((card) => card.uid === engine.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: engine.uid,
      reasonEffectId: 3,
    });
    expect(restoredSelfDestroy.session.state.eventHistory.filter((event) => ["specialSummoned", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: engine.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: engine.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tokens[0]!.uid,
        eventUids: [tokens[0]!.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: engine.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
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
