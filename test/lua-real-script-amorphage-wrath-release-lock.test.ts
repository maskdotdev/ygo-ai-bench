import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Amorphage Wrath release lock", () => {
  it("restores official conditional EFFECT_CANNOT_RELEASE with its non-Amorphage target filter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wrathCode = "79794767";
    const amorphageMonsterCode = "34522216";
    const nonAmorphageCode = "900000272";
    const opponentNonAmorphageCode = "900000273";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [wrathCode, amorphageMonsterCode].includes(card.code)),
      { code: nonAmorphageCode, name: "Amorphage Release Locked Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentNonAmorphageCode, name: "Amorphage Opponent Release Locked Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 797, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wrathCode, amorphageMonsterCode, nonAmorphageCode] }, 1: { main: [opponentNonAmorphageCode] } });
    startDuel(session);

    const wrath = session.state.cards.find((card) => card.code === wrathCode);
    const amorphage = session.state.cards.find((card) => card.code === amorphageMonsterCode);
    const nonAmorphage = session.state.cards.find((card) => card.code === nonAmorphageCode);
    const opponentNonAmorphage = session.state.cards.find((card) => card.code === opponentNonAmorphageCode);
    expect(wrath).toBeDefined();
    expect(amorphage).toBeDefined();
    expect(nonAmorphage).toBeDefined();
    expect(opponentNonAmorphage).toBeDefined();
    moveDuelCard(session.state, wrath!.uid, "spellTrapZone", 0);
    wrath!.position = "faceUpAttack";
    wrath!.faceUp = true;
    moveDuelCard(session.state, amorphage!.uid, "monsterZone", 0);
    amorphage!.position = "faceUpAttack";
    amorphage!.faceUp = true;
    moveDuelCard(session.state, nonAmorphage!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentNonAmorphage!.uid, "monsterZone", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wrathCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 46,
          sourceUid: wrath!.uid,
          luaTargetDescriptor: expect.stringMatching(/^target:not-setcode:/),
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const probe = restored.host.loadScript(
      `
      local amorphage=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${amorphageMonsterCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local locked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${nonAmorphageCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local opp_locked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${opponentNonAmorphageCode}),0,0,LOCATION_MZONE,1,1,nil):GetFirst()
      Debug.Message("amorphage releasable " .. tostring(amorphage:IsReleasable()) .. "/" .. tostring(locked:IsReleasable()) .. "/" .. tostring(opp_locked:IsReleasable()))
      Debug.Message("amorphage release locked " .. Duel.Release(Group.FromCards(locked,opp_locked),REASON_COST))
      Debug.Message("amorphage release allowed " .. Duel.Release(amorphage,REASON_COST))
      `,
      "amorphage-wrath-release-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("amorphage releasable true/false/false");
    expect(restored.host.messages).toContain("amorphage release locked 0");
    expect(restored.host.messages).toContain("amorphage release allowed 1");
    expect(restored.session.state.cards.find((card) => card.uid === amorphage!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === nonAmorphage!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentNonAmorphage!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
