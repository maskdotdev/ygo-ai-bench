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
const allEyesCode = "70335319";
const pendulumDragonCode = "703353190";
const releaseCode = "703353191";
const battleTargetCode = "703353192";
const followupTargetCode = "703353193";
const allyCode = "703353194";
const costSpellCode = "703353195";
const targetSpellCode = "703353196";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAllEyesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${allEyesCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasAllEyesScript)("Lua real script All-Eyes Phantom Dragon procedure chain stat negate", () => {
  it("restores release procedure, PZONE ChainAttack, pre-damage ATK final, and Spell/Trap negate cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${allEyesCode}.lua`));
    const reader = createCardReader(cards());
    const source = fixtureSource(workspace);

    const restoredProcedure = createRestoredProcedureField({ reader, source, workspace });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureAllEyes = requireCard(restoredProcedure.session, allEyesCode);
    const pendulumDragon = requireCard(restoredProcedure.session, pendulumDragonCode);
    const release = requireCard(restoredProcedure.session, releaseCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === procedureAllEyes.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureAllEyes.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === pendulumDragon.uid)).toMatchObject({
      location: "extraDeck",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: procedureAllEyes.uid,
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: procedureAllEyes.uid,
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => event.eventName)).toEqual([
      "released",
      "released",
      "released",
      "specialSummoned",
    ]);

    const restoredPzone = createRestoredPzoneBattleField({ reader, source, workspace });
    expectCleanRestore(restoredPzone);
    const scaleAllEyes = requireCard(restoredPzone.session, allEyesCode);
    const pzoneAttacker = requireCard(restoredPzone.session, pendulumDragonCode);
    const pzoneFirstTarget = requireCard(restoredPzone.session, battleTargetCode);
    const followupTarget = requireCard(restoredPzone.session, followupTargetCode);
    const ally = requireCard(restoredPzone.session, allyCode);
    expectRestoredLegalActions(restoredPzone, 0);
    const pzoneAttack = getLuaRestoreLegalActions(restoredPzone, 0).find((action) => action.type === "declareAttack" && action.attackerUid === pzoneAttacker.uid && action.targetUid === pzoneFirstTarget.uid);
    expect(pzoneAttack, JSON.stringify(getLuaRestoreLegalActions(restoredPzone, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzone, pzoneAttack!);
    passRestoredBattleUntilTrigger(restoredPzone);
    expect(restoredPzone.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        effectId: "lua-4-1141",
        sourceUid: scaleAllEyes.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: pzoneAttacker.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [pzoneAttacker.uid, pzoneFirstTarget.uid],
      },
    ]);

    const restoredPzoneTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredPzone.session), source, reader);
    expectCleanRestore(restoredPzoneTrigger);
    expectRestoredLegalActions(restoredPzoneTrigger, 0);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredPzoneTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === scaleAllEyes.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneTrigger, pzoneTrigger!);
    expect(restoredPzoneTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredPzoneTrigger.session.state.attacksDeclared).not.toContain(pzoneAttacker.uid);
    expect(restoredPzoneTrigger.session.state.effects.filter((effect) => effect.sourceUid === scaleAllEyes.uid && effect.code === 85).map((effect) => ({
      code: effect.code,
      property: effect.property,
      targetRange: effect.targetRange,
      reset: effect.reset,
    }))).toEqual([{ code: 85, property: 524416, targetRange: [0x4, 0], reset: { flags: 1073742336 } }]);
    expect(getLuaRestoreLegalActions(restoredPzoneTrigger, 0)).toContainEqual(expect.objectContaining({
      type: "declareAttack",
      attackerUid: pzoneAttacker.uid,
      targetUid: followupTarget.uid,
    }));
    expect(getLuaRestoreLegalActions(restoredPzoneTrigger, 0).some((action) => action.type === "declareAttack" && action.attackerUid === ally.uid)).toBe(false);

    const restoredBattle = createRestoredMonsterBattleField({ reader, source, workspace });
    expectCleanRestore(restoredBattle);
    const battleAllEyes = requireCard(restoredBattle.session, allEyesCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleAttack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleAllEyes.uid && action.targetUid === battleTarget.uid);
    expect(battleAttack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battleAttack!);
    passRestoredBattleUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const preDamage = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === battleAllEyes.uid);
    expect(preDamage, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, preDamage!);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === battleAllEyes.uid), restoredPreDamage.session.state)).toBe(6000);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.sourceUid === battleAllEyes.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([{ code: 102, reset: { flags: 1107235328 }, value: 6000 }]);
    finishRestoredBattle(restoredPreDamage);
    expect(restoredPreDamage.session.state.battleDamage).toEqual({ 0: 0, 1: 5000 });

    const restoredNegateOpen = createRestoredNegateField({ reader, source, workspace });
    expectCleanRestore(restoredNegateOpen);
    expectRestoredLegalActions(restoredNegateOpen, 1);
    const negateAllEyes = requireCard(restoredNegateOpen.session, allEyesCode);
    const costSpell = requireCard(restoredNegateOpen.session, costSpellCode);
    const targetSpell = requireCard(restoredNegateOpen.session, targetSpellCode);
    const spellAction = getLuaRestoreLegalActions(restoredNegateOpen, 1).find((action) => action.type === "activateEffect" && action.uid === targetSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredNegateOpen, 1), null, 2)).toBeDefined();
    if (!spellAction || spellAction.type !== "activateEffect") throw new Error("Missing All-Eyes target spell action");
    const targetSpellEffectId = Number(spellAction.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredNegateOpen, spellAction);
    const restoredNegateResponse = restoreDuelWithLuaScripts(serializeDuel(restoredNegateOpen.session), source, reader);
    expectCleanRestore(restoredNegateResponse);
    expectRestoredLegalActions(restoredNegateResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredNegateResponse, 0).find((action) => action.type === "activateEffect" && action.uid === negateAllEyes.uid && action.effectId.endsWith("-1027"));
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredNegateResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredNegateResponse, negate!);
    resolveRestoredChain(restoredNegateResponse);
    expect(restoredNegateResponse.host.messages).not.toContain("all eyes target spell resolved");
    expect(restoredNegateResponse.session.state.cards.find((card) => card.uid === costSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: negateAllEyes.uid,
    });
    expect(restoredNegateResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
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
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("at:CanChainAttack()");
  expect(script).toContain("Duel.ChainAttack()");
  expect(script).toContain("e3:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("e3:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.GetReleaseGroup(tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e5:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(c:GetAttack()*2)");
  expect(script).toContain("e6:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.disfilter,tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("aux.DoubleSnareValidity(c,LOCATION_MZONE)");
  expect(script).toContain("aux.AddValuesReset(function()");
}

function cards(): DuelCardData[] {
  return [
    { code: allEyesCode, name: "All-Eyes Phantom Dragon", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceDragon, attribute: attributeLight, level: 10, attack: 3000, defense: 2500, leftScale: 0, rightScale: 0 },
    { code: pendulumDragonCode, name: "All-Eyes Pendulum Dragon", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceDragon, attribute: attributeLight, level: 4, attack: 2500, defense: 1000, leftScale: 1, rightScale: 1 },
    { code: releaseCode, name: "All-Eyes Release Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: battleTargetCode, name: "All-Eyes Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: followupTargetCode, name: "All-Eyes Followup Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: allyCode, name: "All-Eyes Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: costSpellCode, name: "All-Eyes Cost Spell", kind: "spell", typeFlags: typeSpell },
    { code: targetSpellCode, name: "All-Eyes Target Spell", kind: "spell", typeFlags: typeSpell },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${targetSpellCode}.lua`) return targetSpellScript();
      return workspace.readScript(name) ?? workspace.readScript(`official/${name}`);
    },
  };
}

function targetSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp)
        Debug.Message("all eyes target spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function createRestoredProcedureField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 70335319, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [allEyesCode, pendulumDragonCode, releaseCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, allEyesCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, pendulumDragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, releaseCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(allEyesCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredPzoneBattleField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 70335320, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [allEyesCode, pendulumDragonCode, allyCode] }, 1: { main: [battleTargetCode, followupTargetCode] } });
  startDuel(session);
  const scale = moveDuelCard(session.state, requireCard(session, allEyesCode).uid, "spellTrapZone", 0);
  scale.sequence = 0;
  scale.faceUp = true;
  scale.position = "faceUpAttack";
  moveFaceUpAttack(session, requireCard(session, pendulumDragonCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, followupTargetCode), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(allEyesCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredMonsterBattleField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 70335321, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [allEyesCode] }, 1: { main: [battleTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, allEyesCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(allEyesCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredNegateField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 70335322, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [allEyesCode, costSpellCode] }, 1: { main: [targetSpellCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, allEyesCode), 0, 0);
  const cost = moveDuelCard(session.state, requireCard(session, costSpellCode).uid, "spellTrapZone", 0);
  cost.sequence = 0;
  cost.faceUp = true;
  cost.position = "faceUpAttack";
  moveDuelCard(session.state, requireCard(session, targetSpellCode).uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(allEyesCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(targetSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
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

function passRestoredBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    passRestoredBattleStep(restored);
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
    if (restored.session.state.pendingTriggers.length > 0) break;
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
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
