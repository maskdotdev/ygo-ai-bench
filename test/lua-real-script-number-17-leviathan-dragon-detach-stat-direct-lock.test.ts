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
const leviathanCode = "69610924";
const materialACode = "696109240";
const materialBCode = "696109241";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLeviathanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leviathanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceDragon = 0x2000;
const attributeWater = 0x2;
const effectCannotDirectAttack = 73;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasLeviathanScript)("Lua real script Number 17 Leviathan Dragon detach stat direct lock", () => {
  it("restores detach cost into copy-inherit ATK gain and conditional direct-attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${leviathanCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 69610924, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [leviathanCode] }, 1: { main: [] } });
    startDuel(session);

    const leviathan = requireCard(session, leviathanCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    moveFaceUpAttack(session, leviathan, 0);
    moveDuelCard(session.state, materialA.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    moveDuelCard(session.state, materialB.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    leviathan.overlayUids.push(materialA.uid, materialB.uid);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leviathanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === leviathan.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: leviathan.uid },
      { category: 2097152, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], sourceUid: leviathan.uid },
      { category: undefined, code: effectCannotDirectAttack, event: "continuous", property: undefined, range: ["monsterZone"], sourceUid: leviathan.uid },
    ]);

    const action = getLuaRestoreLegalActions(restored, 0).find(
      (candidate) => candidate.type === "activateEffect" && candidate.uid === leviathan.uid && candidate.effectId === "lua-2",
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
    resolveRestoredChain(restored);

    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === leviathan.uid), restored.session.state)).toBe(2500);
    expect(restored.session.state.cards.find((card) => card.uid === leviathan.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: leviathan.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === leviathan.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 8192, reset: { flags: 33492992 }, sourceUid: leviathan.uid, value: 500 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: materialA.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: leviathan.uid, eventReasonEffectId: 2 },
    ]);

    moveDuelCard(restored.session.state, materialB.uid, "graveyard", 0, duelReason.cost, 0);
    restored.session.state.cards.find((card) => card.uid === leviathan.uid)!.overlayUids = [];
    const restoredEmpty = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredEmpty);
    expectRestoredLegalActions(restoredEmpty, 0);
    expect(restoredEmpty.session.state.effects.filter((effect) => effect.sourceUid === leviathan.uid && effect.code === effectCannotDirectAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotDirectAttack, event: "continuous", sourceUid: leviathan.uid, value: undefined },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number 17: Leviathan Dragon");
  expect(script).toContain("Xyz.AddProcedure(c,nil,3,2)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("s.xyz_number=17");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("return e:GetHandler():GetOverlayCount()==0");
}

function cards(): DuelCardData[] {
  return [
    { code: leviathanCode, name: "Number 17: Leviathan Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceDragon, attribute: attributeWater, level: 3, attack: 2000, defense: 0, xyzMaterialCount: 2 },
    { code: materialACode, name: "Leviathan Dragon Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWater, level: 3, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Leviathan Dragon Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeWater, level: 3, attack: 1000, defense: 1000 },
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
