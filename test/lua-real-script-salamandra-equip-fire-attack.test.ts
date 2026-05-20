import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const salamandraCode = "32268901";
const hasSalamandraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${salamandraCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEquip = 0x40000;
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasSalamandraScript)("Lua real script Salamandra equip FIRE attack", () => {
  it("restores AddEquipProcedure Card.IsAttribute FIRE target filtering and equip-only ATK update", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fireTargetCode = "322689010";
    const waterDecoyCode = "322689011";
    const opponentTargetCode = "322689012";
    const responderCode = "322689013";
    const script = workspace.readScript(`c${salamandraCode}.lua`) ?? "";
    expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsAttribute,ATTRIBUTE_FIRE))");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_EQUIP)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(700)");

    const cards: DuelCardData[] = [
      { code: salamandraCode, name: "Salamandra", kind: "spell", typeFlags: typeSpell | typeEquip },
      { code: fireTargetCode, name: "Salamandra FIRE Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeFire },
      { code: waterDecoyCode, name: "Salamandra WATER Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200, attribute: attributeWater },
      { code: opponentTargetCode, name: "Salamandra Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1500, attribute: attributeWater },
      { code: responderCode, name: "Salamandra Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 32268901, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [salamandraCode, fireTargetCode, waterDecoyCode] }, 1: { main: [opponentTargetCode, responderCode] } });
    startDuel(session);

    const salamandra = requireCard(session, salamandraCode);
    const fireTarget = requireCard(session, fireTargetCode);
    const waterDecoy = requireCard(session, waterDecoyCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, salamandra.uid, "hand", 0);
    moveDuelCard(session.state, fireTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, waterDecoy.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentTarget.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(salamandraCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === salamandra.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain).toHaveLength(1);
    expect(restoredEquipWindow.session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1002",
      id: "chain-2",
      operationInfos: [
        {
          category: 262144,
          count: 1,
          parameter: 0,
          player: 0,
          targetUids: [salamandra.uid],
        },
      ],
      player: 0,
      sourceUid: salamandra.uid,
      targetUids: [fireTarget.uid],
    });
    expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(waterDecoy.uid);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("salamandra responder resolved");

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === salamandra.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: fireTarget.uid,
      faceUp: true,
    });
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === waterDecoy.uid)?.equippedToUid).toBeUndefined();
    const restoredAttackBoost = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === salamandra.uid && effect.code === 100);
    expect(restoredAttackBoost).toMatchObject({ event: "continuous", range: ["spellTrapZone"], value: 700 });
    const restoredFireTarget = restoredEquipState.session.state.cards.find((card) => card.uid === fireTarget.uid)!;
    const restoredWaterDecoy = restoredEquipState.session.state.cards.find((card) => card.uid === waterDecoy.uid)!;
    const restoredOpponentTarget = restoredEquipState.session.state.cards.find((card) => card.uid === opponentTarget.uid)!;
    expect(currentAttack(restoredFireTarget, restoredEquipState.session.state)).toBe(1700);
    expect(currentAttack(restoredWaterDecoy, restoredEquipState.session.state)).toBe(1200);
    expectLuaEquipStatProbe(restoredEquipState, fireTargetCode, salamandraCode, "salamandra probe 32268901/322689010/1700");

    restoredEquipState.session.state.phase = "battle";
    restoredEquipState.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredEquipState, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === restoredFireTarget.uid && action.targetUid === restoredOpponentTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredEquipState, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredEquipState.session, attack!);
    passBattleResponses(restoredEquipState.session);

    expect(restoredEquipState.session.state.battleDamage[1]).toBe(200);
    expect(restoredEquipState.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === restoredOpponentTarget.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === restoredFireTarget.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("salamandra responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaEquipStatProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("salamandra probe " .. equip:GetCode() .. "/" .. equip:GetEquipTarget():GetCode() .. "/" .. target:GetAttack())
    `,
    "salamandra-equip-stat-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  if (response.state.waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
