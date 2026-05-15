import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const effectExtraReleaseNonsum = 158;
const locationExtra = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Assault Zone Extra Deck release cost", () => {
  it("activates Assault Mode Activate by releasing a Synchro Monster from the Extra Deck after restore", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const assaultZoneCode = "91002901";
    const assaultModeCode = "80280737";
    const stardustCode = "44508094";
    const stardustAssaultCode = "61257789";
    const cards: DuelCardData[] = workspace
      .readDatabaseCards("cards.cdb")
      .filter((card) => [assaultZoneCode, assaultModeCode, stardustCode, stardustAssaultCode].includes(card.code))
      .map((card) => (card.code === stardustAssaultCode ? { ...card, kind: "monster" } : card));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9100, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [assaultZoneCode, assaultModeCode, stardustAssaultCode], extra: [stardustCode] }, 1: { main: [] } });
    startDuel(session);

    const assaultZone = session.state.cards.find((card) => card.code === assaultZoneCode);
    const assaultMode = session.state.cards.find((card) => card.code === assaultModeCode);
    const stardust = session.state.cards.find((card) => card.code === stardustCode);
    const stardustAssault = session.state.cards.find((card) => card.code === stardustAssaultCode);
    expect(assaultZone).toBeDefined();
    expect(assaultMode).toBeDefined();
    expect(stardust).toBeDefined();
    expect(stardustAssault).toBeDefined();
    moveDuelCard(session.state, assaultZone!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, assaultMode!.uid, "spellTrapZone", 0).sequence = 1;
    assaultZone!.faceUp = true;
    assaultZone!.position = "faceUpAttack";
    assaultMode!.faceUp = false;
    assaultMode!.position = "faceDown";
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        const script = workspace.readScript(name);
        return name === `c${stardustAssaultCode}.lua` && script ? `${script}\nc${stardustAssaultCode}.assault_mode=${stardustCode}` : script;
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [assaultZoneCode, assaultModeCode, stardustCode, stardustAssaultCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
    const registrations = host.registerInitialEffectsDetailed();
    expect(registrations.filter((result) => !result.skipped).every((result) => result.ok), JSON.stringify(registrations, null, 2)).toBe(true);

    const restoredZone = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredZone.restoreComplete, restoredZone.incompleteReasons.join("; ")).toBe(true);
    expect(restoredZone.missingRegistryKeys).toEqual([]);
    expect(restoredZone.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredZone, 0)).toEqual(getDuelLegalActions(restoredZone.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredZone, 0)).toEqual(getGroupedDuelLegalActions(restoredZone.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredZone, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredZone, 0));
    const zoneAction = getLuaRestoreLegalActions(restoredZone, 0).find(
      (action) => action.type === "activateEffect" && action.uid === assaultZone!.uid && action.effectId !== effectIdForActivation(restoredZone.session.state.effects, assaultZone!.uid),
    );
    expect(zoneAction, JSON.stringify(getLuaRestoreLegalActions(restoredZone, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredZone, zoneAction!);

    expect(restoredZone.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredZone.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: effectExtraReleaseNonsum, sourceUid: assaultZone!.uid, targetRange: [locationExtra, 0] }),
      ]),
    );

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(restoredZone.session), source, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredActivation.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: effectExtraReleaseNonsum, sourceUid: assaultZone!.uid, targetRange: [locationExtra, 0] }),
        expect.objectContaining({ code: 1017, sourceUid: assaultZone!.uid }),
      ]),
    );
    const assaultAction = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === assaultMode!.uid);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredActivation, 0));
    expect(assaultAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, assaultAction!);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === stardust!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "extraDeck",
      reason: duelReason.release | duelReason.cost,
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === stardustAssault!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === assaultMode!.uid)).toMatchObject({ location: "graveyard" });
  });
});

function effectIdForActivation(effects: ReadonlyArray<{ id: string; type?: string }>, sourceUid: string): string | undefined {
  return effects.find((effect) => effect.id.includes(sourceUid) && effect.type === "activation")?.id;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
