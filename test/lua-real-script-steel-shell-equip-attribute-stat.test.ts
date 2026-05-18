import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Steel Shell equip attribute stat", () => {
  it("restores AddEquipProcedure Card.IsAttribute target filtering and equip ATK/DEF updates into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const steelShellCode = "2370081";
    const waterTargetCode = "2370082";
    const fireDecoyCode = "2370083";
    const opponentTargetCode = "2370084";
    const responderCode = "2370085";
    const script = workspace.readScript(`c${steelShellCode}.lua`);
    expect(script).toContain("aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsAttribute,ATTRIBUTE_WATER))");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_EQUIP)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetValue(400)");
    expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetValue(-200)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === steelShellCode),
      { code: waterTargetCode, name: "Steel Shell WATER Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeWater },
      { code: fireDecoyCode, name: "Steel Shell FIRE Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1200, attribute: attributeFire },
      { code: opponentTargetCode, name: "Steel Shell Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1300, attribute: attributeFire },
      { code: responderCode, name: "Steel Shell Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2370, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [steelShellCode, waterTargetCode, fireDecoyCode] }, 1: { main: [opponentTargetCode, responderCode] } });
    startDuel(session);

    const steelShell = session.state.cards.find((card) => card.code === steelShellCode);
    const waterTarget = session.state.cards.find((card) => card.code === waterTargetCode);
    const fireDecoy = session.state.cards.find((card) => card.code === fireDecoyCode);
    const opponentTarget = session.state.cards.find((card) => card.code === opponentTargetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(steelShell).toBeDefined();
    expect(waterTarget).toBeDefined();
    expect(fireDecoy).toBeDefined();
    expect(opponentTarget).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, steelShell!.uid, "hand", 0);
    moveDuelCard(session.state, waterTarget!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, fireDecoy!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(steelShellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === steelShell!.uid);
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
          targetUids: [steelShell!.uid],
        },
      ],
      player: 0,
      sourceUid: steelShell!.uid,
      targetUids: [waterTarget!.uid],
    });
    expect(JSON.stringify(restoredEquipWindow.session.state.chain[0], null, 2)).toContain('"category": 262144');
    expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(fireDecoy!.uid);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("steel shell responder resolved");

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === steelShell!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: waterTarget!.uid,
      faceUp: true,
    });
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === fireDecoy!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === fireDecoy!.uid)?.equippedToUid).toBeUndefined();

    const restoredAttackBoost = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === steelShell!.uid && effect.code === 100);
    const restoredDefenseLoss = restoredEquipState.session.state.effects.find((effect) => effect.sourceUid === steelShell!.uid && effect.code === 104);
    expect(restoredAttackBoost).toMatchObject({ event: "continuous", range: ["spellTrapZone"], value: 400 });
    expect(restoredDefenseLoss).toMatchObject({ event: "continuous", range: ["spellTrapZone"], value: -200 });
    const restoredWaterTarget = restoredEquipState.session.state.cards.find((card) => card.uid === waterTarget!.uid)!;
    const restoredFireDecoy = restoredEquipState.session.state.cards.find((card) => card.uid === fireDecoy!.uid)!;
    const restoredOpponentTarget = restoredEquipState.session.state.cards.find((card) => card.uid === opponentTarget!.uid)!;
    expect(currentAttack(restoredWaterTarget, restoredEquipState.session.state)).toBe(1400);
    expect(currentDefense(restoredWaterTarget, restoredEquipState.session.state)).toBe(800);
    expect(currentAttack(restoredFireDecoy, restoredEquipState.session.state)).toBe(1200);
    expect(currentDefense(restoredFireDecoy, restoredEquipState.session.state)).toBe(1200);
    expectLuaEquipStatProbe(restoredEquipState, waterTargetCode, steelShellCode, "steel shell probe 2370081/1400/800");

    restoredEquipState.session.state.phase = "battle";
    restoredEquipState.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredEquipState, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === restoredWaterTarget.uid && action.targetUid === restoredOpponentTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredEquipState, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredEquipState.session, attack!);
    passBattleResponses(restoredEquipState.session);

    expect(restoredEquipState.session.state.battleDamage[1]).toBe(100);
    expect(restoredEquipState.session.state.players[1].lifePoints).toBe(7900);
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === restoredOpponentTarget.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredEquipState.session.state.cards.find((card) => card.uid === restoredWaterTarget.uid)).toMatchObject({ location: "monsterZone" });
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
      e:SetOperation(function(e,tp) Debug.Message("steel shell responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
  }
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
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
      Debug.Message("steel shell probe " .. equip:GetCode() .. "/" .. target:GetAttack() .. "/" .. target:GetDefense())
    `,
    "steel-shell-equip-stat-probe.lua",
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
