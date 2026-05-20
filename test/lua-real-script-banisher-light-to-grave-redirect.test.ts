import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const banisherCode = "61528025";
const monsterCode = "615280250";
const spellCode = "615280251";
const trapCode = "615280252";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Banisher of the Light to-grave redirect", () => {
  it("restores global IsPlayerCanRemove EFFECT_TO_GRAVE_REDIRECT for monsters and set Spell/Trap cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${banisherCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SET_AVAILABLE+EFFECT_FLAG_IGNORE_RANGE+EFFECT_FLAG_IGNORE_IMMUNE)");
    expect(script).toContain("e1:SetCode(EFFECT_TO_GRAVE_REDIRECT)");
    expect(script).toContain("e1:SetTargetRange(0xff,0xff)");
    expect(script).toContain("return Duel.IsPlayerCanRemove(e:GetHandlerPlayer(),c)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === banisherCode),
      { code: monsterCode, name: "Banisher Fixture Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: spellCode, name: "Banisher Fixture Set Spell", kind: "spell", typeFlags: typeSpell },
      { code: trapCode, name: "Banisher Fixture Set Trap", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 61528025, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [banisherCode, monsterCode, spellCode] }, 1: { main: [trapCode] } });
    startDuel(session);

    const banisher = requireCard(session, banisherCode);
    const monster = requireCard(session, monsterCode);
    const spell = requireCard(session, spellCode);
    const trap = requireCard(session, trapCode);
    moveDuelCard(session.state, banisher.uid, "monsterZone", 0).position = "faceUpAttack";
    banisher.faceUp = true;
    moveDuelCard(session.state, monster.uid, "monsterZone", 1).position = "faceUpAttack";
    monster.faceUp = true;
    const setSpell = moveDuelCard(session.state, spell.uid, "spellTrapZone", 0);
    setSpell.faceUp = false;
    setSpell.position = "faceDown";
    const setTrap = moveDuelCard(session.state, trap.uid, "spellTrapZone", 1);
    setTrap.faceUp = false;
    setTrap.position = "faceDown";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(banisherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === banisher.uid && effect.code === 63)).toMatchObject({
      event: "continuous",
      code: 63,
      property: 0x1a0,
      targetRange: [0xff, 0xff],
      value: 0x20,
    });
    expect(restored.host.loadScript(redirectProbe(banisherCode, monsterCode, spellCode, trapCode), "banisher-light-redirect-probe.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("banisher can remove true/true/true");

    sendDuelCardToGraveyard(restored.session.state, monster.uid, 1, duelReason.effect, 0);
    expect(restored.session.state.cards.find((card) => card.uid === monster.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.redirect,
    });
    sendDuelCardToGraveyard(restored.session.state, spell.uid, 0, duelReason.effect, 0);
    expect(restored.session.state.cards.find((card) => card.uid === spell.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.redirect,
    });
    sendDuelCardToGraveyard(restored.session.state, trap.uid, 1, duelReason.effect, 0);
    expect(restored.session.state.cards.find((card) => card.uid === trap.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect | duelReason.redirect,
    });
  });
});

function redirectProbe(banisherCodeValue: string, monsterCodeValue: string, spellCodeValue: string, trapCodeValue: string): string {
  return `
    local banisher=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${banisherCodeValue}),0,LOCATION_MZONE,0,nil)
    local monster=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${monsterCodeValue}),0,0,LOCATION_MZONE,nil)
    local spell=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${spellCodeValue}),0,LOCATION_SZONE,0,nil)
    local trap=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${trapCodeValue}),0,0,LOCATION_SZONE,nil)
    Debug.Message("banisher can remove " .. tostring(Duel.IsPlayerCanRemove(banisher:GetControler(),monster)) .. "/" .. tostring(Duel.IsPlayerCanRemove(banisher:GetControler(),spell)) .. "/" .. tostring(Duel.IsPlayerCanRemove(banisher:GetControler(),trap)))
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
