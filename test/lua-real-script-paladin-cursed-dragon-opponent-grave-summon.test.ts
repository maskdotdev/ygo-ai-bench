import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const paladinCode = "68670547";
const hasPaladinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${paladinCode}.lua`));
const battleZombieCode = "68670548";
const effectZombieCode = "68670549";
const levelFiveZombieCode = "68670550";
const ownZombieCode = "68670551";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceZombie = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasPaladinScript)("Lua real script Paladin of the Cursed Dragon opponent Graveyard summon", () => {
  it("restores opponent Graveyard battle-destroyed Zombie target into Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${paladinCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("return c:IsLevelBelow(4) and c:IsRace(RACE_ZOMBIE)");
    expect(script).toContain("and c:IsReason(REASON_BATTLE) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.IsExistingTarget(s.filter,tp,0,LOCATION_GRAVE,1,nil,e,tp)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_GRAVE,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("if tc:IsRelateToEffect(e) and tc:IsRace(RACE_ZOMBIE) then");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: paladinCode, name: "Paladin of the Cursed Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1900, defense: 1200 },
      { code: battleZombieCode, name: "Opponent Battle Zombie", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1600, defense: 0 },
      { code: effectZombieCode, name: "Opponent Effect Zombie Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1500, defense: 0 },
      { code: levelFiveZombieCode, name: "Opponent Level Five Zombie Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 5, attack: 1800, defense: 0 },
      { code: ownZombieCode, name: "Own Battle Zombie Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1400, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 68670547, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [paladinCode, ownZombieCode] }, 1: { main: [battleZombieCode, effectZombieCode, levelFiveZombieCode] } });
    startDuel(session);

    const paladin = requireCard(session, paladinCode);
    const battleZombie = requireCard(session, battleZombieCode);
    const effectZombie = requireCard(session, effectZombieCode);
    const levelFiveZombie = requireCard(session, levelFiveZombieCode);
    const ownZombie = requireCard(session, ownZombieCode);
    moveDuelCard(session.state, paladin.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleZombie.uid, "graveyard", 1).reason = duelReason.battle | duelReason.destroy;
    moveDuelCard(session.state, effectZombie.uid, "graveyard", 1).reason = duelReason.effect | duelReason.destroy;
    moveDuelCard(session.state, levelFiveZombie.uid, "graveyard", 1).reason = duelReason.battle | duelReason.destroy;
    moveDuelCard(session.state, ownZombie.uid, "graveyard", 0).reason = duelReason.battle | duelReason.destroy;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(paladinCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === paladin.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === battleZombie.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: paladin.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === effectZombie.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.effect | duelReason.destroy });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === levelFiveZombie.uid)).toMatchObject({ location: "graveyard", controller: 1, reason: duelReason.battle | duelReason.destroy });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === ownZombie.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.battle | duelReason.destroy });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === battleZombie.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: battleZombie.uid,
        eventUids: [battleZombie.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: paladin.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
