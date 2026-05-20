import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { canSpecialSummonDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const secondSarcophagusCode = "4081094";
const hasSecondSarcophagusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${secondSarcophagusCode}.lua`));
const ordinarySpellCode = "4081095";
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const effectCannotSpecialSummon = 22;
const effectCannotSSet = 24;

describe.skipIf(!hasUpstreamScripts || !hasSecondSarcophagusScript)("Lua real script The Second Sarcophagus self set lock", () => {
  it("restores its static cannot-SSet and cannot-Special-Summon self restrictions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${secondSarcophagusCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SSET)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE)");
    expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");

    const cards: DuelCardData[] = [
      { code: secondSarcophagusCode, name: "The Second Sarcophagus", kind: "spell", typeFlags: typeSpell | typeContinuous },
      { code: ordinarySpellCode, name: "Second Sarcophagus Ordinary Spell", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4081094, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [secondSarcophagusCode, ordinarySpellCode] }, 1: { main: [] } });
    startDuel(session);

    const secondSarcophagus = requireCard(session, secondSarcophagusCode);
    const ordinarySpell = requireCard(session, ordinarySpellCode);
    moveDuelCard(session.state, secondSarcophagus.uid, "hand", 0);
    moveDuelCard(session.state, ordinarySpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    expect(getLegalActions(session, 0).some((action) => action.type === "setSpellTrap" && action.uid === secondSarcophagus.uid)).toBe(true);
    expect(getLegalActions(session, 0).some((action) => action.type === "setSpellTrap" && action.uid === ordinarySpell.uid)).toBe(true);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(secondSarcophagusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(lockCodes(session, secondSarcophagus.uid)).toEqual([effectCannotSpecialSummon, effectCannotSSet]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(lockCodes(restored.session, secondSarcophagus.uid)).toEqual([effectCannotSpecialSummon, effectCannotSSet]);
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(actions.some((action) => action.type === "setSpellTrap" && action.uid === secondSarcophagus.uid)).toBe(false);
    expect(actions.some((action) => action.type === "setSpellTrap" && action.uid === ordinarySpell.uid)).toBe(true);

    const probe = restored.host.loadScript(
      `
        local locked=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${secondSarcophagusCode}),0,LOCATION_HAND,0,nil)
        local ordinary=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ordinarySpellCode}),0,LOCATION_HAND,0,nil)
        Debug.Message("second sarcophagus ssetable " .. tostring(locked:IsSSetable()) .. "/" .. tostring(ordinary:IsSSetable()))
        Debug.Message("second sarcophagus sset result " .. Duel.SSet(0,locked))
        Debug.Message("second sarcophagus ordinary sset result " .. Duel.SSet(0,ordinary))
      `,
      "second-sarcophagus-self-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("second sarcophagus ssetable true/true");
    expect(restored.host.messages).toContain("second sarcophagus sset result 0");
    expect(restored.host.messages).toContain("second sarcophagus ordinary sset result 1");

    const monsterCards: DuelCardData[] = [
      { code: secondSarcophagusCode, name: "The Second Sarcophagus Monster Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: ordinarySpellCode, name: "Second Sarcophagus Ordinary Monster Probe", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const monsterReader = createCardReader(monsterCards);
    const monsterSession = createDuel({ seed: 4081096, startingHandSize: 0, drawPerTurn: 0, cardReader: monsterReader });
    loadDecks(monsterSession, { 0: { main: [secondSarcophagusCode, ordinarySpellCode] }, 1: { main: [] } });
    startDuel(monsterSession);
    const monsterSarcophagus = requireCard(monsterSession, secondSarcophagusCode);
    const ordinaryMonster = requireCard(monsterSession, ordinarySpellCode);
    moveDuelCard(monsterSession.state, monsterSarcophagus.uid, "hand", 0);
    moveDuelCard(monsterSession.state, ordinaryMonster.uid, "hand", 0);
    monsterSession.state.phase = "main1";
    monsterSession.state.turnPlayer = 0;
    monsterSession.state.waitingFor = 0;
    const monsterHost = createLuaScriptHost(monsterSession, workspace);
    expect(monsterHost.loadCardScript(Number(secondSarcophagusCode), workspace).ok).toBe(true);
    expect(monsterHost.registerInitialEffects()).toBe(1);
    expect(lockCodes(monsterSession, monsterSarcophagus.uid)).toEqual([effectCannotSpecialSummon, effectCannotSSet]);

    const restoredMonster = restoreDuelWithLuaScripts(serializeDuel(monsterSession), workspace, monsterReader);
    expectCleanRestore(restoredMonster);
    expectRestoredLegalActions(restoredMonster, 0);
    expect(lockCodes(restoredMonster.session, monsterSarcophagus.uid)).toEqual([effectCannotSpecialSummon, effectCannotSSet]);
    expect(canSpecialSummonDuelCard(restoredMonster.session.state, monsterSarcophagus.uid, 0, undefined, undefined, true)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredMonster, 0).some((action) => action.type === "normalSummon" && action.uid === ordinaryMonster.uid)).toBe(true);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function lockCodes(session: DuelSession, uid: string): number[] {
  return session.state.effects
    .filter((effect): effect is typeof effect & { code: number } => effect.sourceUid === uid && typeof effect.code === "number")
    .map((effect) => effect.code)
    .sort((a, b) => a - b);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
