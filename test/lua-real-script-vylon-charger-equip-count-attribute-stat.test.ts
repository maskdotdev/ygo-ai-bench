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
const chargerCode = "13220032";
const hasChargerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${chargerCode}.lua`));
const lightAttackerCode = "13220033";
const darkDecoyCode = "13220034";
const equipOneCode = "13220035";
const equipTwoCode = "13220036";
const opponentTargetCode = "13220037";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasChargerScript)("Lua real script Vylon Charger equip-count attribute stat", () => {
  it("restores LIGHT field ATK updates with GetEquipCount callback value into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${chargerCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD)");
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(aux.TargetBoolFunction(Card.IsAttribute,ATTRIBUTE_LIGHT))");
    expect(script).toContain("return e:GetHandler():GetEquipCount()*300");

    const cards: DuelCardData[] = [
      { code: chargerCode, name: "Vylon Charger", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeLight },
      { code: lightAttackerCode, name: "Vylon Charger LIGHT Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000, attribute: attributeLight },
      { code: darkDecoyCode, name: "Vylon Charger DARK Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000, attribute: attributeDark },
      { code: equipOneCode, name: "Vylon Charger Equip One", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: equipTwoCode, name: "Vylon Charger Equip Two", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: opponentTargetCode, name: "Vylon Charger Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1500, attribute: attributeDark },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 13220032, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chargerCode, lightAttackerCode, darkDecoyCode, equipOneCode, equipTwoCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const charger = requireCard(session, chargerCode);
    const lightAttacker = requireCard(session, lightAttackerCode);
    const darkDecoy = requireCard(session, darkDecoyCode);
    const equipOne = requireCard(session, equipOneCode);
    const equipTwo = requireCard(session, equipTwoCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, charger.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, lightAttacker.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, darkDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveFaceUpEquip(session, equipOne, charger.uid);
    moveFaceUpEquip(session, equipTwo, charger.uid);
    moveDuelCard(session.state, opponentTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chargerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === charger.uid && effect.code === 100).map((effect) => ({
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
        id: "lua-1-100",
        luaTargetDescriptor: "target:attribute:16",
        luaValueDescriptor: "stat:handler-equip-count:x300",
        range: ["monsterZone"],
        sourceUid: charger.uid,
        targetRange: [4, 0],
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredCharger = requireCard(restored.session, chargerCode);
    const restoredLightAttacker = requireCard(restored.session, lightAttackerCode);
    const restoredDarkDecoy = requireCard(restored.session, darkDecoyCode);
    const restoredOpponentTarget = requireCard(restored.session, opponentTargetCode);
    expect(restored.session.state.cards.filter((card) => card.equippedToUid === restoredCharger.uid).map((card) => card.code).sort()).toEqual([equipOneCode, equipTwoCode]);
    expect(currentAttack(restoredCharger, restored.session.state)).toBe(1600);
    expect(currentAttack(restoredLightAttacker, restored.session.state)).toBe(1800);
    expect(currentAttack(restoredDarkDecoy, restored.session.state)).toBe(1400);

    const attack = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === restoredLightAttacker.uid && action.targetUid === restoredOpponentTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyAndAssert(restored.session, attack!);
    passBattleResponses(restored.session);

    expect(restored.session.state.battleDamage[1]).toBe(300);
    expect(restored.session.state.players[1].lifePoints).toBe(7700);
    expect(restored.session.state.cards.find((card) => card.uid === restoredOpponentTarget.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === restoredLightAttacker.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function moveFaceUpEquip(session: DuelSession, card: DuelSession["state"]["cards"][number], equippedToUid: string): void {
  moveDuelCard(session.state, card.uid, "spellTrapZone", 0).position = "faceUpAttack";
  card.faceUp = true;
  card.equippedToUid = equippedToUid;
}

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

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
