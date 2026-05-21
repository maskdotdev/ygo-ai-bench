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
const hasNumeronDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c57314798.lua"));
const numeronDragonCode = "57314798";
const materialCode = "573147980";
const rank4AllyCode = "573147981";
const rank5OpponentCode = "573147982";
const defenderCode = "573147983";
const typeMonster = 0x1;
const typeXyz = 0x800000;
const typeXyzMonster = typeMonster | typeXyz;
const setNumber = 0x48;

describe.skipIf(!hasUpstreamScripts || !hasNumeronDragonScript)("Lua real script Number 100 Numeron Dragon rank-sum stat", () => {
  it("restores detach cost into GetMatchingGroup Rank sum ATK gain and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${numeronDragonCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,s.xyzfilter,nil,2,nil,nil,nil,nil,false,s.xyzcheck)");
    expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("local atk=g:GetSum(Card.GetRank)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(atk*1000)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END|RESET_OPPO_TURN)");

    const cards: DuelCardData[] = [
      { code: numeronDragonCode, name: "Number 100: Numeron Dragon", kind: "extra", typeFlags: typeXyzMonster, setcodes: [setNumber], level: 4, attack: 3000, defense: 2000 },
      { code: materialCode, name: "Numeron Dragon Overlay Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 800, defense: 800 },
      { code: rank4AllyCode, name: "Numeron Dragon Rank 4 Ally", kind: "extra", typeFlags: typeXyzMonster, setcodes: [setNumber], level: 4, attack: 2000, defense: 1000 },
      { code: rank5OpponentCode, name: "Numeron Dragon Rank 5 Opponent", kind: "extra", typeFlags: typeXyzMonster, setcodes: [setNumber], level: 5, attack: 2500, defense: 1000 },
      { code: defenderCode, name: "Numeron Dragon Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 15000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 57314798, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, defenderCode], extra: [numeronDragonCode, rank4AllyCode] }, 1: { main: [], extra: [rank5OpponentCode] } });
    startDuel(session);

    const numeronDragon = requireCard(session, numeronDragonCode);
    const material = requireCard(session, materialCode);
    const rank4Ally = requireCard(session, rank4AllyCode);
    const rank5Opponent = requireCard(session, rank5OpponentCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, numeronDragon, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    numeronDragon.overlayUids.push(material.uid);
    moveFaceUpAttack(session, rank4Ally, 0);
    moveFaceUpAttack(session, rank5Opponent, 1);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const loaded = host.loadCardScript(Number(numeronDragonCode), workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === numeronDragon.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: numeronDragon.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === numeronDragon.uid)?.overlayUids).toEqual([]);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === numeronDragon.uid), restoredOpen.session.state)).toBe(16000);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === numeronDragon.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      registryKey: effect.registryKey,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, registryKey: "lua:57314798:lua-5-100", reset: { flags: 1644106240 }, value: 13000 },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === material.uid)).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: numeronDragon.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === numeronDragon.uid), restoredBattle.session.state)).toBe(16000);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === numeronDragon.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: PlayerId): void {
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
