import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Howl battle damage prevention", () => {
  it("restores the announced Normal Monster battle damage prevention", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const primiteHowlCode = "41488249";
    const darkMagicianCode = "46986414";
    const attackerCode = "99141488";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [primiteHowlCode, darkMagicianCode].includes(card.code)),
      { code: attackerCode, name: "Howl Pressure Attacker", kind: "monster", typeFlags: 0x21, level: 4, attack: 3000, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 414, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [primiteHowlCode, darkMagicianCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const howl = session.state.cards.find((card) => card.code === primiteHowlCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    expect(howl).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, howl!.uid, "spellTrapZone", 0).position = "faceDown";
    howl!.faceUp = false;
    moveDuelCard(session.state, darkMagician!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(primiteHowlCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === howl!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    resolveOpenChain(session);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 201,
          luaTargetDescriptor: "target:setcode-or-code-type:432:46986414:16",
          targetRange: [4, 0],
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
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 201,
          luaTargetDescriptor: "target:setcode-or-code-type:432:46986414:16",
          targetRange: [4, 0],
        }),
      ]),
    );

    restored.session.state.turnPlayer = 1;
    restored.session.state.waitingFor = 1;
    restored.session.state.phase = "main1";
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 1),
    );
    const toBattle = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(toBattle).toBeDefined();
    expect(applyLuaRestoreResponse(restored, toBattle!).ok).toBe(true);
    const attack = getLuaRestoreLegalActions(restored, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === darkMagician!.uid,
    );
    expect(attack).toBeDefined();
    expect(applyLuaRestoreResponse(restored, attack!).ok).toBe(true);
    passBattleResponses(restored);

    expect(restored.session.state.battleDamage[0]).toBe(0);
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({ location: "graveyard" });
  });
});

function resolveOpenChain(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
  expect(session.state.chain).toHaveLength(0);
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.pendingBattle) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, pass!).ok).toBe(true);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}
