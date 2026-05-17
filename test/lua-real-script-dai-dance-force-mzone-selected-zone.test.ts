import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dai Dance force mzone selected zone", () => {
  it("restores a temporary Duel.RegisterEffect FORCE_MZONE selected-zone lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const daiDanceCode = "50696588";
    const candidateCode = "50696589";
    const daiDanceCard = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === daiDanceCode);
    expect(daiDanceCard).toBeDefined();
    const cards: DuelCardData[] = [
      daiDanceCard!,
      { code: candidateCode, name: "Dai Dance Summon Candidate", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5069, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [daiDanceCode] }, 1: { main: [candidateCode] } });
    startDuel(session);

    const daiDance = requireCard(session, daiDanceCode);
    const candidate = requireCard(session, candidateCode);
    moveDuelCard(session.state, daiDance.uid, "spellTrapZone", 0);
    daiDance.faceUp = false;
    moveDuelCard(session.state, candidate.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(daiDanceCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);

    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === daiDance.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivation, activate!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restoredActivation.host.promptDecisions).toEqual([
      expect.objectContaining({
        api: "SelectDisableField",
        player: 0,
        options: expect.arrayContaining([1 << 16, 2 << 16, 4 << 16, 8 << 16, 16 << 16]),
        returned: 1 << 16,
      }),
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expectRestoredLegalActions(restoredChain, 0);
    expectRestoredLegalActions(restoredChain, 1);

    const forceZoneEffect = restoredChain.session.state.effects.find((effect) => effect.code === 265 && effect.sourceUid === daiDance.uid);
    expect(forceZoneEffect).toMatchObject({ code: 265, sourceUid: daiDance.uid, targetRange: [0, 1], value: 97 });
    expect(forceZoneEffect?.range).toEqual(expect.arrayContaining(["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"]));

    const probe = restoredChain.host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${candidateCode}),1,LOCATION_HAND,0,nil)
      Debug.Message("dai dance force mzone count " .. tostring(Duel.GetLocationCount(1,LOCATION_MZONE)))
      Debug.Message("dai dance force mzone check " .. tostring(Duel.CheckLocation(1,LOCATION_MZONE,0)) .. "/" .. tostring(Duel.CheckLocation(1,LOCATION_MZONE,1)))
      Debug.Message("dai dance force mzone candidate " .. tostring(c:IsSummonable()))
      `,
      "dai-dance-force-mzone-selected-zone-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restoredChain.host.messages).toContain("dai dance force mzone count 1");
    expect(restoredChain.host.messages).toContain("dai dance force mzone check true/false");
    expect(restoredChain.host.messages).toContain("dai dance force mzone candidate true");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
