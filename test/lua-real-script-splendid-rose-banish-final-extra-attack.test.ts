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
const roseCode = "4290468";
const plantCostCode = "42904680";
const targetCode = "42904681";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRoseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${roseCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeWind = 0x8;
const attributeEarth = 0x1;
const effectSetAttackFinal = 102;
const effectExtraAttack = 194;

describe.skipIf(!hasUpstreamScripts || !hasRoseScript)("Lua real script Splendid Rose banish final extra attack", () => {
  it("restores Plant banish cost into opponent final ATK halving", () => {
    const { workspace, reader, session, rose, plantCost, target } = setupRoseDuel();
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    registerRose(session, workspace);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rose.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: rose.uid },
      { category: 2097152, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], sourceUid: rose.uid },
      { category: undefined, code: 1002, event: "quick", property: undefined, range: ["monsterZone"], sourceUid: rose.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === rose.uid && candidate.effectId === "lua-3",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === plantCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rose.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1200 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === target.uid), restoredAfter.session.state)).toBe(1200);
  });

  it("restores post-attack Battle Phase quick effect into self ATK halving and extra attack", () => {
    const { workspace, reader, session, rose, plantCost, target } = setupRoseDuel();
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    session.state.attacksDeclared.push(rose.uid);
    session.state.attackedTargetUids.push(target.uid);
    session.state.battlePairs.push({ attackerUid: rose.uid, targetUid: target.uid });

    registerRose(session, workspace);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === rose.uid && candidate.effectId === "lua-4-1002",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === plantCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: rose.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === rose.uid), restored.session.state)).toBe(1100);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === rose.uid && (effect.code === effectSetAttackFinal || effect.code === effectExtraAttack)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, property: 1024, reset: { flags: 1107169792 }, sourceUid: rose.uid, value: 1100 },
      { code: effectExtraAttack, property: 67109888, reset: { flags: 1107169792 }, sourceUid: rose.uid, value: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === rose.uid), restoredAfter.session.state)).toBe(1100);
    expect(getLuaRestoreLegalActions(restoredAfter, 0)).toContainEqual(expect.objectContaining({
      type: "declareAttack",
      attackerUid: rose.uid,
      targetUid: target.uid,
    }));
  });
});

function setupRoseDuel(): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
  rose: DuelCardInstance;
  plantCost: DuelCardInstance;
  target: DuelCardInstance;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${roseCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed: 4290468, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [plantCostCode], extra: [roseCode] }, 1: { main: [targetCode] } });
  startDuel(session);
  const rose = requireCard(session, roseCode);
  const plantCost = requireCard(session, plantCostCode);
  const target = requireCard(session, targetCode);
  moveFaceUpAttack(session, rose, 0);
  moveDuelCard(session.state, plantCost.uid, "graveyard", 0);
  plantCost.faceUp = true;
  moveFaceUpAttack(session, target, 1);
  return { workspace, reader, session, rose, plantCost, target };
}

function registerRose(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(roseCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Splendid Rose");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("return c:IsRace(RACE_PLANT) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
  expect(script).toContain("return Duel.IsBattlePhase() and e:GetHandler():GetAttackedGroupCount()~=0");
  expect(script).toContain("and Duel.GetAttacker()==nil and Duel.GetCurrentChain()==0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())");
  expect(script).toContain("e2:SetCode(EFFECT_EXTRA_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
}

function cards(): DuelCardData[] {
  return [
    { code: roseCode, name: "Splendid Rose", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: racePlant, attribute: attributeWind, level: 6, attack: 2200, defense: 2000 },
    { code: plantCostCode, name: "Splendid Rose Plant Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 3, attack: 500, defense: 500 },
    { code: targetCode, name: "Splendid Rose Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
