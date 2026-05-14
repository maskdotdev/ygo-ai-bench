import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Simorgh set lock", () => {
  it("restores its opponent monster and Spell/Trap Set locks from a monster source", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const simorghCode = "11366199";
    const opponentMonsterCode = "11366200";
    const opponentSpellCode = "11366201";
    const opponentFieldCode = "11366202";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === simorghCode),
      { code: opponentMonsterCode, name: "Dark Simorgh Opponent Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1000 },
      { code: opponentSpellCode, name: "Dark Simorgh Opponent Spell", kind: "spell", typeFlags: 0x2 },
      { code: opponentFieldCode, name: "Dark Simorgh Opponent Field Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1136, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [simorghCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode, opponentFieldCode] } });
    startDuel(session);

    const simorgh = requireCard(session, simorghCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentField = requireCard(session, opponentFieldCode);
    moveDuelCard(session.state, simorgh.uid, "monsterZone", 0);
    simorgh.faceUp = true;
    simorgh.position = "faceUpAttack";
    moveDuelCard(session.state, opponentMonster.uid, "hand", 1);
    moveDuelCard(session.state, opponentSpell.uid, "hand", 1);
    moveDuelCard(session.state, opponentField.uid, "monsterZone", 1);
    opponentField.faceUp = true;
    opponentField.position = "faceUpAttack";
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(simorghCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    restored.session.state.turnPlayer = 1;
    restored.session.state.phase = "main1";
    restored.session.state.waitingFor = 1;
    const actions = getLuaRestoreLegalActions(restored, 1);
    expect(actions.some((action) => action.type === "normalSummon" && action.uid === opponentMonster.uid)).toBe(true);
    expect(actions.some((action) => action.type === "setMonster" && action.uid === opponentMonster.uid)).toBe(false);
    expect(actions.some((action) => action.type === "setSpellTrap" && action.uid === opponentSpell.uid)).toBe(false);

    const probe = restored.host.loadScript(turnSetProbeScript(opponentFieldCode), "dark-simorgh-turn-set-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("dark simorgh turn set false/false/true");
  });
});

function turnSetProbeScript(fieldMonsterCode: string): string {
  return `
    local monster=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${fieldMonsterCode}),0,0,LOCATION_MZONE,nil)
    Debug.Message(
      "dark simorgh turn set " ..
      tostring(monster:IsCanTurnSet()) .. "/" ..
      tostring(monster:IsCanChangePosition(POS_FACEDOWN_DEFENSE)) .. "/" ..
      tostring(monster:IsCanChangePosition(POS_FACEUP_DEFENSE))
    )
  `;
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
