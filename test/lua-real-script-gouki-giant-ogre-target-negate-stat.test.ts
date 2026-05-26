import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const giantCode = "47946130";
const targetSpellCode = "479461300";
const weakMonsterCode = "479461301";
const battleDefenderCode = "479461302";
const strongAttackerCode = "479461303";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGiantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${giantCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const setGouki = 0xfc;

describe.skipIf(!hasUpstreamScripts || !hasGiantScript)("Lua real script Gouki The Giant Ogre target negate stat", () => {
  it("restores battle indestructibility, activated monster immunity, target negation ATK loss, and ATK recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${giantCode}.lua`));
    const reader = createCardReader(cards());
    const source = fixtureSource(workspace);

    const restoredBattle = createRestoredField({ reader, source, workspace });
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 1;
    restoredBattle.session.state.waitingFor = 1;
    const battleGiant = requireCard(restoredBattle.session, giantCode);
    const strongAttacker = requireCard(restoredBattle.session, strongAttackerCode);
    expectRestoredLegalActions(restoredBattle, 1);
    const strongAttack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === strongAttacker.uid && action.targetUid === battleGiant.uid);
    expect(strongAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, strongAttack!);
    finishRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === battleGiant.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const restoredImmuneOpen = createRestoredField({ reader, source, workspace });
    expectCleanRestore(restoredImmuneOpen);
    expectRestoredLegalActions(restoredImmuneOpen, 1);
    const immuneGiant = requireCard(restoredImmuneOpen.session, giantCode);
    const weakMonster = requireCard(restoredImmuneOpen.session, weakMonsterCode);
    const weakTarget = getLuaRestoreLegalActions(restoredImmuneOpen, 1).find((action) => action.type === "activateEffect" && action.uid === weakMonster.uid);
    expect(weakTarget, JSON.stringify(getLuaRestoreLegalActions(restoredImmuneOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredImmuneOpen, weakTarget!);
    expect(restoredImmuneOpen.host.messages).toContain("gouki giant weak monster resolved");
    expect(currentAttack(restoredImmuneOpen.session.state.cards.find((card) => card.uid === immuneGiant.uid), restoredImmuneOpen.session.state)).toBe(2000);

    const restoredOpen = createRestoredField({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const giant = requireCard(restoredOpen.session, giantCode);
    const targetSpell = requireCard(restoredOpen.session, targetSpellCode);
    const spellAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === targetSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    if (!spellAction || spellAction.type !== "activateEffect") throw new Error("Missing Gouki Giant target spell action");
    const targetSpellEffectId = Number(spellAction.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredOpen, spellAction);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === giant.uid && action.effectId.endsWith("-1027"));
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    if (!negate || negate.type !== "activateEffect") throw new Error("Missing Gouki Giant negate action");
    const negateEffectId = Number(negate.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredResponse, negate);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).not.toContain("gouki giant target spell resolved");
    expect(restoredResponse.session.state.cards.find((card) => card.uid === targetSpell.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: giant.uid,
      reasonEffectId: negateEffectId,
    });
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === giant.uid), restoredResponse.session.state)).toBe(2500);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === giant.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 100, property: 0x2000, reset: { flags: 33492992 }, value: -500 }]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["sentToGraveyard", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: targetSpell.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: giant.uid,
        eventReasonEffectId: negateEffectId,
        eventPreviousState: { controller: 1, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: targetSpellEffectId,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: targetSpellEffectId,
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredBoost);
    restoredBoost.session.state.phase = "main1";
    restoredBoost.session.state.turnPlayer = 0;
    restoredBoost.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBoost, 0);
    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "activateEffect" && action.uid === giant.uid && action.effectId.endsWith("-1002"));
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === giant.uid), restoredBoost.session.state)).toBe(3500);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === giant.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x2000, reset: { flags: 33492992 }, value: -500 },
      { code: 100, property: undefined, reset: { flags: 1107235328 }, value: 1000 },
    ]);

    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.turnPlayer = 0;
    restoredBoost.session.state.waitingFor = 0;
    const defender = requireCard(restoredBoost.session, battleDefenderCode);
    expectRestoredLegalActions(restoredBoost, 0);
    const attack = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "declareAttack" && action.attackerUid === giant.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, attack!);
    finishRestoredBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GOUKI),3)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("return te:GetOwner()~=e:GetHandler() and te:IsMonsterEffect()");
  expect(script).toContain("te:GetOwner():GetAttack()<=e:GetHandler():GetAttack() and te:IsActivated()");
  expect(script).toContain("re:IsHasProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("local lg=e:GetHandler():GetLinkedGroup()");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,0,0)");
  expect(script).toContain("Duel.GetCurrentChain()~=ev+1");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
  expect(script).toContain("not c:IsImmuneToEffect(e1) and not c:IsHasEffect(EFFECT_REVERSE_UPDATE)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("Duel.SendtoGrave(eg,REASON_EFFECT)");
  expect(script).toContain("return c:GetAttack()~=c:GetBaseAttack()");
  expect(script).toContain("e1:SetValue(1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: giantCode, name: "Gouki The Giant Ogre", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 0, linkMarkers: 45, setcodes: [setGouki] },
    { code: targetSpellCode, name: "Gouki Giant Target Spell", kind: "spell", typeFlags: typeSpell },
    { code: weakMonsterCode, name: "Gouki Giant Weak Monster Effect", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2500, defense: 1000 },
    { code: battleDefenderCode, name: "Gouki Giant Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 2000 },
    { code: strongAttackerCode, name: "Gouki Giant Strong Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3500, defense: 2000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${targetSpellCode}.lua`) return targetSpellScript();
      if (name === `c${weakMonsterCode}.lua`) return weakMonsterScript();
      return workspace.readScript(name);
    },
  };
}

function targetSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_ATKCHANGE)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) end
        Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("gouki giant target spell resolved")
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsFaceup() then tc:UpdateAttack(-1000) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function weakMonsterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp)
        Debug.Message("gouki giant weak monster resolved")
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${giantCode}),tp,0,LOCATION_MZONE,nil)
        if tc and tc:IsFaceup() then tc:UpdateAttack(-1000) end
      end)
      c:RegisterEffect(e)
    end
  `;
}

function createRestoredField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 47946130, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [giantCode] }, 1: { main: [targetSpellCode, weakMonsterCode, battleDefenderCode, strongAttackerCode] } });
  startDuel(session);
  const giant = requireCard(session, giantCode);
  const targetSpell = requireCard(session, targetSpellCode);
  const weakMonster = requireCard(session, weakMonsterCode);
  const battleDefender = requireCard(session, battleDefenderCode);
  const strongAttacker = requireCard(session, strongAttackerCode);
  moveFaceUpAttack(session, giant, 0, 0);
  moveFaceUpAttack(session, battleDefender, 1, 0);
  moveFaceUpAttack(session, strongAttacker, 1, 1);
  moveFaceUpAttack(session, weakMonster, 1, 2);
  const setSpell = moveDuelCard(session.state, targetSpell.uid, "spellTrapZone", 1);
  setSpell.faceUp = false;
  setSpell.position = "faceDown";
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(giantCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(targetSpellCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(weakMonsterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
