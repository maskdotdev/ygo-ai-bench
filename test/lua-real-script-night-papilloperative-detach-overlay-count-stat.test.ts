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
const papilloperativeCode = "2191144";
const firstMaterialCode = "21911440";
const secondMaterialCode = "21911441";
const thirdMaterialCode = "21911442";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPapilloperativeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${papilloperativeCode}.lua`));
const typeMonster = 0x1;
const typeXyz = 0x800000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const resetStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasPapilloperativeScript)("Lua real script Night Papilloperative detach overlay count stat", () => {
  it("restores detach cost into ATK gain based on remaining overlay count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${papilloperativeCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 2191144, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [firstMaterialCode, secondMaterialCode, thirdMaterialCode], extra: [papilloperativeCode] }, 1: { main: [] } });
    startDuel(session);

    const papilloperative = requireCard(session, papilloperativeCode);
    const firstMaterial = requireCard(session, firstMaterialCode);
    const secondMaterial = requireCard(session, secondMaterialCode);
    const thirdMaterial = requireCard(session, thirdMaterialCode);
    moveFaceUpAttack(session, papilloperative, 0, 0);
    moveDuelCard(session.state, firstMaterial.uid, "overlay", 0);
    moveDuelCard(session.state, secondMaterial.uid, "overlay", 0);
    moveDuelCard(session.state, thirdMaterial.uid, "overlay", 0);
    papilloperative.overlayUids.push(firstMaterial.uid, secondMaterial.uid, thirdMaterial.uid);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(papilloperativeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === papilloperative.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: papilloperative.uid },
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: papilloperative.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === papilloperative.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === firstMaterial.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: papilloperative.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === papilloperative.uid)?.overlayUids).toEqual([secondMaterial.uid, thirdMaterial.uid]);
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === papilloperative.uid), restored.session.state)).toBe(3200);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === papilloperative.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetStandardDisable }, sourceUid: papilloperative.uid, value: 600 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === papilloperative.uid), restoredAfter.session.state)).toBe(3200);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Night Papilloperative");
  expect(script).toContain("Xyz.AddProcedure(c,nil,4,3)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("if chk==0 then return Duel.GetOverlayCount(tp,1,1)>1 end");
  expect(script).toContain("local ct=Duel.GetOverlayCount(tp,1,1)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*300)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: papilloperativeCode, name: "Night Papilloperative", kind: "extra", typeFlags: typeMonster | typeXyz, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2600, defense: 2000 },
    { code: firstMaterialCode, name: "Papilloperative First Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: secondMaterialCode, name: "Papilloperative Second Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: thirdMaterialCode, name: "Papilloperative Third Material", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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
