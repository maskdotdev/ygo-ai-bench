import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ancient Gear Wyvern set locks", () => {
  it("restores its post-search monster and Spell/Trap Set locks while leaving Normal Summons legal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wyvernCode = "17663375";
    const searchTargetCode = "17663376";
    const normalCandidateCode = "17663377";
    const spellCandidateCode = "17663378";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wyvernCode),
      { code: searchTargetCode, name: "Ancient Gear Wyvern Search Target", kind: "monster", typeFlags: 0x1, level: 4, setcodes: [0x7] },
      { code: normalCandidateCode, name: "Ancient Gear Wyvern Normal Candidate", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1200 },
      { code: spellCandidateCode, name: "Ancient Gear Wyvern Set Candidate", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 176, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wyvernCode, searchTargetCode, normalCandidateCode, spellCandidateCode] }, 1: { main: [] } });
    startDuel(session);

    const wyvern = requireCard(session, wyvernCode);
    const searchTarget = requireCard(session, searchTargetCode);
    const normalCandidate = requireCard(session, normalCandidateCode);
    const spellCandidate = requireCard(session, spellCandidateCode);
    moveDuelCard(session.state, wyvern.uid, "monsterZone", 0);
    wyvern.faceUp = true;
    wyvern.position = "faceUpAttack";
    moveDuelCard(session.state, normalCandidate.uid, "hand", 0);
    moveDuelCard(session.state, spellCandidate.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    expect(getLegalActions(session, 0).some((action) => action.type === "normalSummon" && action.uid === normalCandidate.uid)).toBe(true);
    expect(getLegalActions(session, 0).some((action) => action.type === "setMonster" && action.uid === normalCandidate.uid)).toBe(true);
    expect(getLegalActions(session, 0).some((action) => action.type === "setSpellTrap" && action.uid === spellCandidate.uid)).toBe(true);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wyvernCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const operation = host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${wyvernCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
        local e=Effect.CreateEffect(c)
        c17663375.thop(e,0,Group.CreateGroup(),0,0,nil,0,0)
      `,
      "ancient-gear-wyvern-set-lock-operation-probe.lua",
    );
    expect(operation.ok, operation.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({ location: "hand", controller: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(lockCodes(restored.session.state, wyvern.uid)).toEqual([22, 23, 24, 69]);
    restored.session.state.phase = "main1";
    restored.session.state.waitingFor = 0;
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(actions.some((action) => action.type === "normalSummon" && action.uid === normalCandidate.uid)).toBe(true);
    expect(actions.some((action) => action.type === "setMonster" && action.uid === normalCandidate.uid)).toBe(false);
    expect(actions.some((action) => action.type === "setSpellTrap" && action.uid === spellCandidate.uid)).toBe(false);
  });
});

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function lockCodes(session: ReturnType<typeof createDuel>["state"], sourceUid: string): number[] {
  return session.effects
    .filter((effect) => effect.sourceUid === sourceUid && [22, 23, 24, 69].includes(effect.code ?? -1))
    .map((effect) => effect.code!)
    .sort((a, b) => a - b);
}
