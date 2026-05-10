import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions as getDuelLegalActionGroups, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Lordly Lode", () => {
  it("announces and Special Summons a Normal Monster, then locks that monster's effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lordlyLodeCode = "56506740";
    const etherBerylCode = "63198739";
    const darkMagicianCode = "46986414";
    const effectNormalCode = "10000010";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [lordlyLodeCode, etherBerylCode, darkMagicianCode, effectNormalCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 293, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lordlyLodeCode, etherBerylCode, darkMagicianCode, effectNormalCode] }, 1: { main: [] } });
    startDuel(session);

    const lordlyLode = session.state.cards.find((card) => card.code === lordlyLodeCode && card.location === "deck");
    const etherBeryl = session.state.cards.find((card) => card.code === etherBerylCode && card.location === "deck");
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode && card.location === "deck");
    const effectNormal = session.state.cards.find((card) => card.code === effectNormalCode && card.location === "deck");
    expect(lordlyLode).toBeDefined();
    expect(etherBeryl).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(effectNormal).toBeDefined();
    moveDuelCard(session.state, lordlyLode!.uid, "hand", 0);

    const source = {
      readScript(name: string) {
        return name === `c${effectNormalCode}.lua` ? effectNormalScript(effectNormalCode) : workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lordlyLodeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(effectNormalCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activateField = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lordlyLode!.uid);
    expect(activateField).toBeDefined();
    expect(applyResponse(session, activateField!).ok).toBe(true);
    resolveOpenChain(session);
    expect(session.state.cards.find((card) => card.uid === lordlyLode!.uid)).toMatchObject({ location: "spellTrapZone", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === etherBeryl!.uid)).toMatchObject({ location: "hand" });

    const summonNormal = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lordlyLode!.uid);
    expect(summonNormal).toBeDefined();
    const summoned = applyResponse(session, summonNormal!);
    expect(summoned.ok, summoned.error).toBe(true);
    resolveOpenChain(session);
    expect(session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpDefense" });

    moveDuelCard(session.state, effectNormal!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === effectNormal!.uid)).toBe(true);
    session.state.cards.find((card) => card.uid === effectNormal!.uid)!.summonType = "special";
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === effectNormal!.uid)).toBe(false);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 6,
          sourceUid: lordlyLode!.uid,
          luaValueDescriptor: "cannot-activate:special-summoned-monster-on-field",
          targetRange: [1, 0],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getDuelLegalActionGroups(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 6,
          sourceUid: lordlyLode!.uid,
          luaValueDescriptor: "cannot-activate:special-summoned-monster-on-field",
          targetRange: [1, 0],
        }),
      ]),
    );
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === effectNormal!.uid)).toBe(false);
  });
});

function resolveOpenChain(session: ReturnType<typeof createDuel>): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getDuelLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok, result.error).toBe(true);
  }
  expect(session.state.chain).toHaveLength(0);
}

function effectNormalScript(code: string): string {
  return `
  local s,id=GetID()
  function s.initial_effect(c)
    local e1=Effect.CreateEffect(c)
    e1:SetDescription(${Number(code)})
    e1:SetType(EFFECT_TYPE_IGNITION)
    e1:SetRange(LOCATION_MZONE)
    c:RegisterEffect(e1)
  end
  `;
}
