import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const mindOnAirCode = "66690411";
const hasMindOnAirScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mindOnAirCode}.lua`));
const ownHandCode = "66690412";
const opponentHandCode = "66690413";
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMindOnAirScript)("Lua real script Mind on Air public hand", () => {
  it("restores opponent-hand EFFECT_PUBLIC visibility into public duel state", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${mindOnAirCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e1:SetCode(EFFECT_PUBLIC)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetTargetRange(0,LOCATION_HAND)");

    const cards: DuelCardData[] = [
      { code: mindOnAirCode, name: "Mind on Air", kind: "monster", typeFlags: typeMonster, level: 6, attack: 1000, defense: 1600 },
      { code: ownHandCode, name: "Mind on Air Own Hidden Hand", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentHandCode, name: "Mind on Air Opponent Public Hand", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 66690411, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mindOnAirCode, ownHandCode] }, 1: { main: [opponentHandCode] } });
    startDuel(session);

    const mindOnAir = requireCard(session, mindOnAirCode);
    const ownHand = requireCard(session, ownHandCode);
    const opponentHand = requireCard(session, opponentHandCode);
    moveDuelCard(session.state, mindOnAir.uid, "monsterZone", 0).position = "faceUpAttack";
    mindOnAir.faceUp = true;
    moveDuelCard(session.state, ownHand.uid, "hand", 0);
    moveDuelCard(session.state, opponentHand.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mindOnAirCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0).flatMap((group) => group.actions));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === mindOnAir.uid && effect.code === 160).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      {
        code: 160,
        event: "continuous",
        range: ["monsterZone"],
        targetRange: [0, 2],
      },
    ]);
    expect(publicHandState(restored, ownHand.uid)).toEqual({ code: ownHandCode, revealedToPlayers: undefined });
    expect(publicHandState(restored, opponentHand.uid)).toEqual({ code: opponentHandCode, revealedToPlayers: [0, 1] });
  });
});

function publicHandState(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string) {
  const card = queryPublicState(restored.session).cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return { code: card!.code, revealedToPlayers: card!.revealedToPlayers };
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
