import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts)("Lua real script Dimensional Fissure to-grave redirect", () => {
  it("restores its non-Spell/Trap EFFECT_TO_GRAVE_REDIRECT target predicate", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fissureCode = "81674782";
    const monsterCode = "81674783";
    const spellCode = "81674784";
    const responderCode = "81674785";
    const cards: DuelCardData[] = [
      { code: fissureCode, name: "Dimensional Fissure", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: monsterCode, name: "Dimensional Fissure Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: spellCode, name: "Dimensional Fissure Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Dimensional Fissure Responder", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8167, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fissureCode, monsterCode, spellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const fissure = requireCard(session, fissureCode);
    const monster = requireCard(session, monsterCode);
    const spell = requireCard(session, spellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, fissure.uid, "spellTrapZone", 0);
    fissure.position = "faceDown";
    fissure.faceUp = false;
    moveDuelCard(session.state, monster.uid, "monsterZone", 0);
    monster.faceUp = true;
    monster.position = "faceUpAttack";
    moveDuelCard(session.state, spell.uid, "spellTrapZone", 1);
    spell.position = "faceDown";
    spell.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fissureCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === fissure.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(restoredPersistent.session.state.effects.find((effect) => effect.sourceUid === fissure.uid && effect.code === 63)).toMatchObject({
      event: "continuous",
      code: 63,
      luaTargetDescriptor: "target:not-location-not-spelltrap:128",
      targetRange: [0xff, 0xff],
      value: 0x20,
    });

    sendDuelCardToGraveyard(restoredPersistent.session.state, monster.uid, 0, duelReason.effect, 0);
    expect(restoredPersistent.session.state.cards.find((card) => card.uid === monster.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.redirect,
    });
    sendDuelCardToGraveyard(restoredPersistent.session.state, spell.uid, 1, duelReason.effect, 0);
    expect(restoredPersistent.session.state.cards.find((card) => card.uid === spell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
    });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: Parameters<typeof applyLuaRestoreResponse>[1]): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const player = restored.session.state.waitingFor;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
