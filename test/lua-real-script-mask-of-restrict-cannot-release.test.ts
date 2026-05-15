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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mask of Restrict cannot release", () => {
  it("restores official EFFECT_CANNOT_RELEASE and blocks release queries and movement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const maskCode = "29549364";
    const materialCode = "900000251";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === maskCode),
      { code: materialCode, name: "Mask Release Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maskCode, materialCode] }, 1: { main: [] } });
    startDuel(session);

    const mask = session.state.cards.find((card) => card.code === maskCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    expect(mask).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, mask!.uid, "spellTrapZone", 0);
    mask!.position = "faceUpAttack";
    mask!.faceUp = true;
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maskCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 46,
          sourceUid: mask!.uid,
          targetRange: [1, 1],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local material=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${materialCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("mask release predicates " .. tostring(Duel.IsPlayerCanRelease(0)) .. "/" .. tostring(Duel.IsPlayerCanRelease(0,material)) .. "/" .. tostring(material:IsReleasable()))
      Debug.Message("mask release result " .. Duel.Release(material,REASON_COST))
      `,
      "mask-of-restrict-release-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("mask release predicates false/false/false");
    expect(restored.host.messages).toContain("mask release result 0");
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
