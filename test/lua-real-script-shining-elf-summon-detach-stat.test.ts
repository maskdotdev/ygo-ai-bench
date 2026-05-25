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
const elfCode = "97170107";
const materialACode = "971701070";
const materialBCode = "971701071";
const opponentSummonedCode = "971701072";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasElfScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${elfCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceSpellcaster = 0x80;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasElfScript)("Lua real script Shining Elf summon detach stat", () => {
  it("restores cloned summon-success triggers and detaches cost before lowering summoned opponent ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${elfCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 97170107, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [elfCode] }, 1: { main: [opponentSummonedCode] } });
    startDuel(session);

    const elf = requireCard(session, elfCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const opponentSummoned = requireCard(session, opponentSummonedCode);
    moveFaceUpAttack(session, elf, 0);
    moveDuelCard(session.state, materialA.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    moveDuelCard(session.state, materialB.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    elf.overlayUids.push(materialA.uid, materialB.uid);
    moveDuelCard(session.state, opponentSummoned.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(elfCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === elf.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], sourceUid: elf.uid, triggerEvent: undefined },
      { category: 2097152, code: 1102, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: elf.uid, triggerEvent: "specialSummoned" },
      { category: 2097152, code: 1100, event: "trigger", property: undefined, range: ["monsterZone"], sourceUid: elf.uid, triggerEvent: "normalSummoned" },
    ]);

    specialSummonDuelCard(restoredOpen.session.state, opponentSummoned.uid, 1);
    expect(restoredOpen.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === elf.uid)).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1102",
        eventCardUid: opponentSummoned.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "specialSummoned",
        eventPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: elf.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === elf.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentSummoned.uid), restoredResolved.session.state)).toBe(1300);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === elf.uid)?.overlayUids).toEqual([materialB.uid]);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: elf.uid,
      reasonEffectId: 2,
    });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === opponentSummoned.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, value: -500 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: elfCode, name: "Shining Elf", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSpellcaster, attribute: attributeLight, level: 2, attack: 1600, defense: 1000, xyzMaterialCount: 2 },
    { code: materialACode, name: "Shining Elf Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 2, attack: 600, defense: 600 },
    { code: materialBCode, name: "Shining Elf Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 2, attack: 600, defense: 600 },
    { code: opponentSummonedCode, name: "Shining Elf Opponent Summoned", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Shining Elf");
  expect(script).toContain("Xyz.AddProcedure(c,nil,2,2)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("e2=e1:Clone()");
  expect(script).toContain("e2:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
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
