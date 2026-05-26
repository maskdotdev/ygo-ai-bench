import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const nurseCode = "31539614";
const summonedCode = "315396140";
const materialACode = "315396141";
const materialBCode = "315396142";
const materialCCode = "315396143";
const opponentSummonedCode = "315396144";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNurseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nurseCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasNurseScript)("Lua real script Antidote Nurse summon target stat", () => {
  it("restores EVENT_SPSUMMON_SUCCESS SetTargetCard into summoned monster ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nurseCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,nil,3,2,nil,nil,Xyz.InfiniteMats)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetCondition(function() return not (Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()) end)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("Duel.AdjustInstantly(tc)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return not eg:IsContains(e:GetHandler()) and eg:IsExists(aux.FaceupFilter(Card.IsControler,tp),1,nil)");
    expect(script).toContain("local g=eg:Filter(aux.FaceupFilter(Card.IsControler,tp),nil):Match(Card.IsLocation,nil,LOCATION_MZONE)");
    expect(script).toContain("return e:GetHandler():GetOverlayCount()>=3 and #g>0");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("local g=Duel.GetTargetCards(e):Match(Card.IsFaceup,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(900)");

    const cards: DuelCardData[] = [
      { code: nurseCode, name: "Antidote Nurse", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 3, attack: 1800, defense: 1200, xyzMaterialCount: 2, xyzMaterialMax: 5 },
      { code: summonedCode, name: "Antidote Nurse Summoned Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1300, defense: 1000 },
      { code: materialACode, name: "Antidote Nurse Material A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 900, defense: 900 },
      { code: materialBCode, name: "Antidote Nurse Material B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 900, defense: 900 },
      { code: materialCCode, name: "Antidote Nurse Material C", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 900, defense: 900 },
      { code: opponentSummonedCode, name: "Antidote Nurse Opponent Summoned", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 31539614, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, materialACode, materialBCode, materialCCode], extra: [nurseCode] }, 1: { main: [opponentSummonedCode] } });
    startDuel(session);

    const nurse = requireCard(session, nurseCode);
    const summoned = requireCard(session, summonedCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const materialC = requireCard(session, materialCCode);
    const opponentSummoned = requireCard(session, opponentSummonedCode);
    moveFaceUpAttack(session, nurse, 0);
    moveDuelCard(session.state, materialA.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    moveDuelCard(session.state, materialB.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    moveDuelCard(session.state, materialC.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    nurse.overlayUids.push(materialA.uid, materialB.uid, materialC.uid);
    moveDuelCard(session.state, summoned.uid, "hand", 0);
    moveDuelCard(session.state, opponentSummoned.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nurseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, summoned.uid, 0);
    specialSummonDuelCard(restoredOpen.session.state, opponentSummoned.uid, 1);
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === nurse.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1102",
        eventCardUid: summoned.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: nurse.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === nurse.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === summoned.uid), restoredResolved.session.state)).toBe(2200);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentSummoned.uid), restoredResolved.session.state)).toBe(1700);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === nurse.uid)?.overlayUids).toEqual([materialA.uid, materialB.uid, materialC.uid]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === summoned.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, value: 900 },
    ]);
  });
});

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
