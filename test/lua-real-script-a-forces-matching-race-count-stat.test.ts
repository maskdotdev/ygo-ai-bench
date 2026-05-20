import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceWarrior = 0x1;
const raceSpellcaster = 0x2;
const raceFiend = 0x8;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script The A. Forces matching race count stat", () => {
  it("restores Warrior-only ATK updates from a face-up Warrior or Spellcaster count callback into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const aForcesCode = "403847";
    const warriorAttackerCode = "40384701";
    const spellcasterAllyCode = "40384702";
    const faceDownWarriorCode = "40384703";
    const fiendTargetCode = "40384704";
    const script = workspace.readScript(`c${aForcesCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
    expect(script).toContain("e2:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("return c:IsRace(RACE_WARRIOR)");
    expect(script).toContain("return c:IsFaceup() and c:IsRace(RACE_WARRIOR|RACE_SPELLCASTER)");
    expect(script).toContain("Duel.GetMatchingGroupCount(s.filter,c:GetControler(),LOCATION_MZONE,0,nil)*200");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === aForcesCode),
      { code: warriorAttackerCode, name: "A. Forces Warrior Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceWarrior },
      { code: spellcasterAllyCode, name: "A. Forces Spellcaster Ally", kind: "monster", typeFlags: typeMonster, level: 4, attack: 900, defense: 900, race: raceSpellcaster },
      { code: faceDownWarriorCode, name: "A. Forces Face-Down Warrior", kind: "monster", typeFlags: typeMonster, level: 4, attack: 700, defense: 1200, race: raceWarrior },
      { code: fiendTargetCode, name: "A. Forces Fiend Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceFiend },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4038, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aForcesCode, warriorAttackerCode, spellcasterAllyCode, faceDownWarriorCode] }, 1: { main: [fiendTargetCode] } });
    startDuel(session);

    const aForces = session.state.cards.find((card) => card.code === aForcesCode);
    const warriorAttacker = session.state.cards.find((card) => card.code === warriorAttackerCode);
    const spellcasterAlly = session.state.cards.find((card) => card.code === spellcasterAllyCode);
    const faceDownWarrior = session.state.cards.find((card) => card.code === faceDownWarriorCode);
    const fiendTarget = session.state.cards.find((card) => card.code === fiendTargetCode);
    expect(aForces).toBeDefined();
    expect(warriorAttacker).toBeDefined();
    expect(spellcasterAlly).toBeDefined();
    expect(faceDownWarrior).toBeDefined();
    expect(fiendTarget).toBeDefined();
    moveDuelCard(session.state, aForces!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, warriorAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, spellcasterAlly!.uid, "monsterZone", 0).position = "faceUpAttack";
    const movedFaceDownWarrior = moveDuelCard(session.state, faceDownWarrior!.uid, "monsterZone", 0);
    movedFaceDownWarrior.position = "faceDownDefense";
    movedFaceDownWarrior.faceUp = false;
    moveDuelCard(session.state, fiendTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(aForcesCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === aForces!.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      id: effect.id,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      {
        code: 100,
        controller: 0,
        id: "lua-2-100",
        luaTargetDescriptor: "target:race:1",
        luaValueDescriptor: "stat:matching-faceup-race-count:controller:4:0:include-handler:3:x200",
        range: ["spellTrapZone"],
        sourceUid: aForces!.uid,
        targetRange: [4, 0],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredWarriorAttacker = restored.session.state.cards.find((card) => card.uid === warriorAttacker!.uid)!;
    const restoredSpellcasterAlly = restored.session.state.cards.find((card) => card.uid === spellcasterAlly!.uid)!;
    const restoredFaceDownWarrior = restored.session.state.cards.find((card) => card.uid === faceDownWarrior!.uid)!;
    expect(currentAttack(restoredWarriorAttacker, restored.session.state)).toBe(1400);
    expect(currentAttack(restoredSpellcasterAlly, restored.session.state)).toBe(900);
    expect(currentAttack(restoredFaceDownWarrior, restored.session.state)).toBe(1100);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === warriorAttacker!.uid && action.targetUid === fiendTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(400);
    expect(restored.session.state.players[1].lifePoints).toBe(7600);
    expect(restored.session.state.cards.find((card) => card.uid === fiendTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === warriorAttacker!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
