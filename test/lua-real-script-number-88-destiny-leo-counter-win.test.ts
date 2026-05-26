import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const leoCode = "48995978";
const materialACode = "489959780";
const materialBCode = "489959781";
const materialCCode = "489959782";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLeoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leoCode}.lua`));
const counterDestiny = 0x2b;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const attributeDark = 0x10;
const effectXyzMaterial = 31;
const effectCounterPermit = 0x10000 + counterDestiny;
const categoryCounter = 0x800000;
const effectCannotBattlePhase = 185;
const eventChainSolving = 1020;

describe.skipIf(!hasUpstreamScripts || !hasLeoScript)("Lua real script Number 88 Destiny Leo counter win", () => {
  it("restores Destiny Counter ignition cost, Battle Phase lock, and chain-solving win metadata", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${leoCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 48995978, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, materialCCode], extra: [leoCode] }, 1: { main: [] } });
    startDuel(session);

    const leo = requireCard(session, leoCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const materialC = requireCard(session, materialCCode);
    moveFaceUpAttack(session, leo, 0);
    for (const [sequence, material] of [materialA, materialB, materialC].entries()) {
      moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0).sequence = sequence;
      leo.overlayUids.push(material.uid);
    }
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === leo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: effectXyzMaterial, event: "continuous", property: 0x40400, range: ["monsterZone"], sourceUid: leo.uid },
      { category: undefined, code: effectCounterPermit, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: leo.uid },
      { category: categoryCounter, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: leo.uid },
      { category: undefined, code: eventChainSolving, event: "continuous", property: 0x50400, range: ["monsterZone"], sourceUid: leo.uid },
    ]);

    const addCounter = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === leo.uid && candidate.effectId === "lua-3",
    );
    expect(addCounter, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, addCounter!);
    resolveRestoredChain(restored);

    expect(getDuelCardCounter(restored.session.state.cards.find((card) => card.uid === leo.uid), counterDestiny)).toBe(1);
    expect(restored.session.state.cards.find((card) => card.uid === leo.uid)?.overlayUids).toEqual([materialB.uid, materialC.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: leo.uid,
      reasonEffectId: 3,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === leo.uid && effect.code === effectCannotBattlePhase).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotBattlePhase, event: "continuous", property: 0x4080800, reset: { flags: 0x40000200 }, sourceUid: leo.uid, targetRange: [1, 0] },
    ]);
    expect(getLegalActions(restored.session, 0)).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));

    const restoredTwoCounters = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredTwoCounters);
    expectRestoredLegalActions(restoredTwoCounters, 0);
    expect(addDuelCardCounter(restoredTwoCounters.session.state.cards.find((card) => card.uid === leo.uid), counterDestiny, 2)).toBe(true);
    const restoredWinReady = restoreDuelWithLuaScripts(serializeDuel(restoredTwoCounters.session), workspace, reader);
    expectCleanRestore(restoredWinReady);
    expectRestoredLegalActions(restoredWinReady, 0);
    expect(getDuelCardCounter(restoredWinReady.session.state.cards.find((card) => card.uid === leo.uid), counterDestiny)).toBe(3);
    expect(restoredWinReady.session.state.effects.find((effect) =>
      effect.sourceUid === leo.uid && effect.code === eventChainSolving && effect.operation
    )).toMatchObject({ code: eventChainSolving, event: "continuous", property: 0x50400, range: ["monsterZone"] });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 88: Gimmick Puppet of Leo");
  expect(script).toContain("c:EnableCounterPermit(0x2b)");
  expect(script).toContain("Xyz.AddProcedure(c,nil,8,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("return Duel.GetFieldGroupCount(tp,LOCATION_STZONE,0)==0");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BP)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("c:RemoveOverlayCard(tp,1,1,REASON_EFFECT)>0");
  expect(script).toContain("c:AddCounter(0x2b,1)");
  expect(script).toContain("e2:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("if c:GetCounter(0x2b)==3 then");
  expect(script).toContain("Duel.Win(tp,WIN_REASON_PUPPET_LEO)");
}

function cards(): DuelCardData[] {
  return [
    { code: leoCode, name: "Number 88: Gimmick Puppet of Leo", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeDark, level: 8, attack: 3200, defense: 2300, xyzMaterialCount: 3 },
    { code: materialACode, name: "Destiny Leo Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 8, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Destiny Leo Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 8, attack: 1000, defense: 1000 },
    { code: materialCCode, name: "Destiny Leo Material C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 8, attack: 1000, defense: 1000 },
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
