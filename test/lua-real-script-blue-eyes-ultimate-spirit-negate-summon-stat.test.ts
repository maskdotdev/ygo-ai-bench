import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spiritCode = "89604813";
const lightDragonCode = "896048130";
const ownGraveCode = "896048131";
const opponentSpellCode = "896048132";
const defenderCode = "896048133";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpiritScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiritCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x08;
const setBlueEyes = 0xdd;

describe.skipIf(!hasUpstreamScripts || !hasSpiritScript)("Lua real script Blue-Eyes Ultimate Spirit negate summon stat", () => {
  it("restores GY banish lock, on-field chain negate ATK gain, and destroyed LIGHT Dragon summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spiritCode}.lua`));
    const reader = createCardReader(cards());
    const source = opponentSpellSource(workspace);

    const restoredOpen = createSpiritRestoredField(reader, source, workspace, { loadOpponentSpell: true });
    expectCleanRestore(restoredOpen);
    assertBanishLockProbe(restoredOpen, ["spirit opponent able remove false", "spirit opponent remove 0/0"]);

    const spirit = requireCard(restoredOpen.session, spiritCode);
    const opponentSpell = requireCard(restoredOpen.session, opponentSpellCode);
    expectRestoredLegalActions(restoredOpen, 1);
    const spell = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spell, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, spell!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === spirit.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    resolveRestoredChain(restoredResponse);
    expect(restoredResponse.host.messages).not.toContain("blue-eyes ultimate spirit opponent spell resolved");
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === spirit.uid), restoredResponse.session.state)).toBe(4500);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === spirit.uid && [67, 100, 21142671].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 67, property: 0x800, range: ["monsterZone"], reset: undefined, sourceUid: spirit.uid, targetRange: [0, 1], value: undefined },
      { code: 21142671, property: 0x40400, range: ["monsterZone"], reset: undefined, sourceUid: spirit.uid, targetRange: undefined, value: undefined },
      { code: 100, property: undefined, range: ["monsterZone"], reset: { flags: 1107235328 }, sourceUid: spirit.uid, targetRange: undefined, value: 1000 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 7,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 7,
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredBattle);
    const defender = requireCard(restoredBattle.session, defenderCode);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === spirit.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });

    const destroyedField = createSpiritRestoredField(reader, source, workspace, { loadOpponentSpell: false });
    expectCleanRestore(destroyedField);
    const destroyedSpirit = requireCard(destroyedField.session, spiritCode);
    const lightDragon = requireCard(destroyedField.session, lightDragonCode);
    const destroyed = destroyDuelCard(destroyedField.session.state, destroyedSpirit.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({ uid: destroyedSpirit.uid, location: "graveyard", controller: 0, reason: duelReason.effect | duelReason.destroy });

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(destroyedField.session), source, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const summonTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedSpirit.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, summonTrigger!);
    resolveRestoredChain(restoredDestroyed);
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === lightDragon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedSpirit.uid,
      reasonEffectId: 5,
    });
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedSpirit.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 2 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: lightDragon.uid,
        eventUids: [lightDragon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyedSpirit.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,nil,2,99,Synchro.NonTunerEx(Card.IsSetCard,SET_BLUE_EYES),1,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_REMOVE)");
  expect(script).toContain("e1:SetTargetRange(0,1)");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and c:IsControler(e:GetHandlerPlayer())");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)&LOCATION_ONFIELD>0");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_NEGATE,eg,1,tp,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,tp,1000)");
  expect(script).toContain("Duel.NegateActivation(ev)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.spfilter,tp,LOCATION_GRAVE,0,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e4:SetCode(EFFECT_MULTIPLE_TUNERS)");
}

function cards(): DuelCardData[] {
  return [
    { code: spiritCode, name: "Blue-Eyes Ultimate Spirit Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, setcodes: [setBlueEyes], race: raceDragon, attribute: attributeLight, level: 12, attack: 3500, defense: 4000 },
    { code: lightDragonCode, name: "Ultimate Spirit Light Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 3000, defense: 2500 },
    { code: ownGraveCode, name: "Ultimate Spirit Grave Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentSpellCode, name: "Ultimate Spirit Opponent Spell", kind: "spell", typeFlags: typeSpell },
    { code: defenderCode, name: "Ultimate Spirit Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 4000, defense: 2000 },
  ];
}

function opponentSpellSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
      return workspace.readScript(name);
    },
  };
}

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("blue-eyes ultimate spirit opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function createSpiritRestoredField(
  reader: ReturnType<typeof createCardReader>,
  source: { readScript(name: string): string | undefined },
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  options: { loadOpponentSpell: boolean },
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 89604813, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lightDragonCode, ownGraveCode], extra: [spiritCode] }, 1: { main: [opponentSpellCode, defenderCode] } });
  startDuel(session);
  const spirit = requireCard(session, spiritCode);
  const lightDragon = requireCard(session, lightDragonCode);
  const ownGrave = requireCard(session, ownGraveCode);
  const opponentSpell = requireCard(session, opponentSpellCode);
  const defender = requireCard(session, defenderCode);
  moveFaceUpAttack(session, spirit, 0);
  moveDuelCard(session.state, lightDragon.uid, "graveyard", 0);
  moveDuelCard(session.state, ownGrave.uid, "graveyard", 0);
  moveFaceDownSpell(session, opponentSpell, 1);
  moveFaceUpAttack(session, defender, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(spiritCode), source).ok).toBe(true);
  if (options.loadOpponentSpell) expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(options.loadOpponentSpell ? 2 : 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function assertBanishLockProbe(restored: LuaSnapshotRestoreResult, expected: string[]): void {
  const result = restored.host.loadScript(
    `
      local c=Duel.SelectMatchingCard(1,aux.FilterBoolFunction(Card.IsCode,${ownGraveCode}),1,0,LOCATION_GRAVE,1,1,nil):GetFirst()
      Debug.Message("spirit opponent able remove " .. tostring(c:IsAbleToRemove()))
      Debug.Message("spirit opponent remove " .. Duel.Remove(c,POS_FACEUP,REASON_EFFECT) .. "/" .. Duel.GetOperatedGroup():GetCount())
    `,
    "blue-eyes-ultimate-spirit-banish-lock-probe.lua",
  );
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages.slice(-expected.length)).toEqual(expected);
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

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const trigger = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "activateTrigger");
    if (trigger) {
      applyRestoredActionAndAssert(restored, trigger);
      resolveRestoredChain(restored);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
