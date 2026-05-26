import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelResponse, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mordschlagCode = "12760674";
const normalTargetCode = "127606740";
const unsummonedDecoyCode = "127606741";
const specialOpponentCode = "127606742";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMordschlagScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mordschlagCode}.lua`));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMordschlagScript)("Lua real script Mordschlag equip immunity pre-calculation stat", () => {
  it("restores Normal Summoned equip filtering, equipped monster immunity, and pre-damage Special Summoned target stat loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mordschlagCode}.lua`);
    expect(script).toContain("aux.AddEquipProcedure(c,0,aux.FilterBoolFunction(Card.IsSummonType,SUMMON_TYPE_NORMAL))");
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("te:GetOwnerPlayer()~=e:GetHandlerPlayer() and te:IsMonsterEffect() and te:IsActivated() and te:GetHandler():IsSpecialSummoned()");
    expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("local c=e:GetHandler():GetEquipTarget()");
    expect(script).toContain("(bc:GetSummonType()&SUMMON_TYPE_SPECIAL)==SUMMON_TYPE_SPECIAL");
    expect(script).toContain("local value=ec:GetBaseAttack()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-value)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mordschlagCode),
      { code: normalTargetCode, name: "Mordschlag Normal Summoned Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: unsummonedDecoyCode, name: "Mordschlag Unsummoned Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1000 },
      { code: specialOpponentCode, name: "Mordschlag Special Summoned Destroyer", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${specialOpponentCode}.lua`) return specialDestroyerScript(normalTargetCode);
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 12760674, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mordschlagCode, normalTargetCode, unsummonedDecoyCode] }, 1: { main: [specialOpponentCode] } });
    startDuel(session);

    const mordschlag = requireCard(session, mordschlagCode);
    const normalTarget = requireCard(session, normalTargetCode);
    const unsummonedDecoy = requireCard(session, unsummonedDecoyCode);
    const specialOpponent = requireCard(session, specialOpponentCode);
    moveDuelCard(session.state, mordschlag.uid, "hand", 0);
    moveFaceUpAttack(session, normalTarget, 0);
    normalTarget.summonType = "normal";
    moveFaceUpAttack(session, unsummonedDecoy, 0);
    moveFaceUpAttack(session, specialOpponent, 1);
    specialOpponent.summonType = "special";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mordschlagCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(specialOpponentCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === mordschlag.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("mordschlag destroy resolved");

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, restoredEquipped.session.state.waitingFor ?? restoredEquipped.session.state.turnPlayer);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === mordschlag.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: normalTarget.uid,
      faceUp: true,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === unsummonedDecoy.uid)?.equippedToUid).toBeUndefined();
    expect(restoredEquipped.session.state.effects.find((effect) => effect.sourceUid === mordschlag.uid && effect.code === 1)).toMatchObject({
      code: 1,
      event: "continuous",
      range: ["spellTrapZone"],
    });
    expectLuaEquipProbe(restoredEquipped, normalTargetCode, mordschlagCode, "mordschlag probe 12760674/127606740/true");

    restoredEquipped.session.state.turnPlayer = 1;
    restoredEquipped.session.state.waitingFor = 1;
    const destroyAction = getLuaRestoreLegalActions(restoredEquipped, 1).find((action) => action.type === "activateEffect" && action.uid === specialOpponent.uid);
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipped, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipped, destroyAction!);
    resolveRestoredChain(restoredEquipped);
    expect(restoredEquipped.host.messages).toContain("mordschlag destroy result 0");
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === normalTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === normalTarget.uid)).toEqual([]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredEquipped.session), source, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === normalTarget.uid && action.targetUid === specialOpponent.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passRestoredBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: normalTarget.uid,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.battle,
        eventReasonCardUid: normalTarget.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === specialOpponent.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === normalTarget.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function specialDestroyerScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${targetCode}),tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
        Debug.Message("mordschlag destroy result " .. Duel.Destroy(tc,REASON_EFFECT))
        Debug.Message("mordschlag destroy resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("mordschlag probe " .. equip:GetCode() .. "/" .. equip:GetEquipTarget():GetCode() .. "/" .. tostring(target:IsHasEffect(EFFECT_IMMUNE_EFFECT)~=nil))
    `,
    "mordschlag-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyLuaRestoreAndAssert(restored, trigger);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
