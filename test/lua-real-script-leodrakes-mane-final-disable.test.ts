import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const maneCode = "57201737";
const hasManeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maneCode}.lua`));
const naturiaCode = "572017370";
const decoyCode = "572017371";
const targetCode = "572017372";
const responderCode = "572017373";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setNaturia = 0x2a;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasManeScript)("Lua real script Leodrake's Mane final disable", () => {
  it("restores own Naturia target final ATK and disable effects into battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${maneCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_NATURIA)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(3000)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === maneCode),
      { code: naturiaCode, name: "Leodrake's Mane Naturia Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setNaturia], level: 4, attack: 1000, defense: 1000 },
      { code: decoyCode, name: "Leodrake's Mane Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 2400, defense: 1200 },
      { code: targetCode, name: "Leodrake's Mane Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 1200 },
      { code: responderCode, name: "Leodrake's Mane Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 57201737, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maneCode, naturiaCode, decoyCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const mane = requireCard(session, maneCode);
    const naturia = requireCard(session, naturiaCode);
    const decoy = requireCard(session, decoyCode);
    const battleTarget = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, mane.uid, "hand", 0);
    moveDuelCard(session.state, naturia.uid, "monsterZone", 0);
    naturia.position = "faceUpAttack";
    naturia.faceUp = true;
    moveDuelCard(session.state, decoy.uid, "monsterZone", 0);
    decoy.position = "faceUpAttack";
    decoy.faceUp = true;
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1);
    battleTarget.position = "faceUpAttack";
    battleTarget.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maneCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === mane.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: mane.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [naturia.fieldId],
        targetUids: [naturia.uid],
        operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [naturia.uid] }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredChain, 1);
    expect(restoredChain.host.messages).not.toContain("leodrake mane responder resolved");

    const boosted = requireCard(restoredChain.session, naturiaCode);
    const unboosted = requireCard(restoredChain.session, decoyCode);
    expect(currentAttack(boosted, restoredChain.session.state)).toBe(3000);
    expect(currentAttack(unboosted, restoredChain.session.state)).toBe(2400);
    expect(isCardDisabled(restoredChain.session.state, boosted, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === boosted.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, event: "continuous", reset: { flags: 1107169792 }, value: 3000 },
      { code: 2, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
    ]);

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.waitingFor = 0;
    const attack = getLegalActions(restoredChain.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === boosted.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(restoredChain.session, 0), null, 2)).toBeDefined();
    const attackResponse = applyResponse(restoredChain.session, attack!);
    expect(attackResponse.ok, attackResponse.error).toBe(true);
    passBattleResponses(restoredChain.session);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredChain.session.state.cards.find((card) => card.uid === boosted.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({ location: "graveyard" });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("leodrake mane responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
