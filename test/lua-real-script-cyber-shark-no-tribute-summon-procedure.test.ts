import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Shark no-tribute summon procedure", () => {
  it("restores Cyber Shark's own face-up WATER no-tribute summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cyberSharkCode = "32393580";
    const waterAllyCode = "323935800";
    const fireAllyCode = "323935801";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cyberSharkCode),
      { code: waterAllyCode, name: "Cyber Shark WATER Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000, attribute: attributeWater },
      { code: fireAllyCode, name: "Cyber Shark FIRE Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000, attribute: attributeFire },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 323, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cyberSharkCode, waterAllyCode, fireAllyCode] }, 1: { main: [] } });
    startDuel(session);

    const cyberShark = requireCard(session, cyberSharkCode);
    const waterAlly = requireCard(session, waterAllyCode);
    const fireAlly = requireCard(session, fireAllyCode);
    moveDuelCard(session.state, cyberShark.uid, "hand", 0);
    moveDuelCard(session.state, fireAlly.uid, "monsterZone", 0).position = "faceUpAttack";
    const setWaterAlly = moveDuelCard(session.state, waterAlly.uid, "monsterZone", 0);
    setWaterAlly.faceUp = false;
    setWaterAlly.position = "faceDownDefense";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const script = fs.readFileSync(path.join(upstreamRoot, "script", "official", `c${cyberSharkCode}.lua`), "utf8");
    expect(script).toContain("e1:SetCode(EFFECT_SUMMON_PROC)");
    expect(script).toContain("return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_WATER)");
    expect(script).toContain("Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.ntfilter,c:GetControler(),LOCATION_MZONE,0,1,nil)");

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cyberSharkCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.code === 32 && effect.sourceUid === cyberShark.uid)).toMatchObject({
      luaConditionDescriptor: `condition:normal-summon-proc-own-faceup:attribute:${attributeWater}:source-level-above:4`,
    });

    const blocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectRestoredActionSurfaces(blocked);
    expect(cyberSharkNoTributeSummon(blocked.session, getLuaRestoreLegalActions(blocked, 0), cyberShark.uid)).toBeUndefined();

    waterAlly.faceUp = true;
    waterAlly.position = "faceUpDefense";
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectRestoredActionSurfaces(restored);

    const summon = cyberSharkNoTributeSummon(restored.session, getLuaRestoreLegalActions(restored, 0), cyberShark.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    const summoned = applyLuaRestoreResponse(restored, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === cyberShark.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "normal",
      summonMaterialUids: [],
    });
    expect(restored.session.state.players[0].normalSummonAvailable).toBe(false);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: cyberShark.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
        },
      },
    ]);
  });
});

function expectRestoredActionSurfaces(restored: ReturnType<typeof restoreDuelWithLuaScripts>) {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
}

function cyberSharkNoTributeSummon(session: DuelSession, actions: ReturnType<typeof getLuaRestoreLegalActions>, uid: string) {
  return actions.find((action) => {
    if (action.type !== "tributeSummon" || action.uid !== uid || !action.effectId?.startsWith("lua-")) return false;
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return card?.location === "hand" && action.tributeUids.length === 0;
  });
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
