import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack, currentDefense, currentRace } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const guardianCode = "67007102";
const goldenLordCode = "95440946";
const attackTargetCode = "670071020";
const eldixirSetCode = "670071021";
const offSetDecoyCode = "670071022";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasGuardianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${guardianCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeQuickPlay = 0x10000;
const raceWarrior = 0x1;
const raceZombie = 0x10;
const attributeLight = 0x10;
const setEldlixir = 0x143;
const effectSetAttackFinal = 102;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasGuardianScript)("Lua real script Guardian of the Golden Land trap monster zero End set stat", () => {
  it("restores trap-monster summon with optional ATK zero and End Phase graveyard Eldlixir Set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectGuardianScriptShape(workspace.readScript(`official/c${guardianCode}.lua`));
    const databaseCards = workspace.readDatabaseCards("cards.cdb");
    const guardianData = databaseCards.find((card) => card.code === guardianCode);
    const goldenLordData = databaseCards.find((card) => card.code === goldenLordCode);
    expect(guardianData).toBeDefined();
    expect(goldenLordData).toBeDefined();
    const reader = createCardReader([
      { ...guardianData!, setcodes: [setEldlixir] },
      goldenLordData!,
      ...fixtureCards(),
    ]);

    const restoredSummonOpen = createRestoredSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const guardian = requireCard(restoredSummonOpen.session, guardianCode);
    const goldenLord = requireCard(restoredSummonOpen.session, goldenLordCode);
    const attackTarget = requireCard(restoredSummonOpen.session, attackTargetCode, 1);
    const activate = getLuaRestoreLegalActions(restoredSummonOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === guardian.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredSummonOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonOpen, activate!);
    resolveRestoredChain(restoredSummonOpen);

    const summonedGuardian = restoredSummonOpen.session.state.cards.find((card) => card.uid === guardian.uid);
    expect(summonedGuardian).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: guardian.uid,
      reasonEffectId: 1,
      data: {
        typeFlags: typeMonster | typeTrap | typeNormal,
        attack: 800,
        defense: 2500,
      },
    });
    expect(cardTypeFlags(summonedGuardian, restoredSummonOpen.session.state)).toBe(typeMonster | typeTrap | typeNormal);
    expect(currentRace(summonedGuardian, restoredSummonOpen.session.state)).toBe(raceZombie);
    expect(currentAttack(summonedGuardian, restoredSummonOpen.session.state)).toBe(800);
    expect(currentDefense(summonedGuardian, restoredSummonOpen.session.state)).toBe(2500);
    expect(restoredSummonOpen.host.promptDecisions).toEqual([{ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 1072113634, returned: true }]);
    expect(currentAttack(restoredSummonOpen.session.state.cards.find((card) => card.uid === goldenLord.uid), restoredSummonOpen.session.state)).toBe(0);
    expect(currentAttack(restoredSummonOpen.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredSummonOpen.session.state)).toBe(1900);
    expect(restoredSummonOpen.session.state.effects.filter((effect) => effect.sourceUid === goldenLord.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: resetEventStandard }, sourceUid: goldenLord.uid, value: 0 },
    ]);
    expect(restoredSummonOpen.session.state.eventHistory.filter((event) => ["specialSummoned", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: guardian.uid,
        eventUids: [guardian.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: guardian.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      chainSolvedEvent(1, "chain-2"),
    ]);

    const restoredSetOpen = createRestoredEndSetWindow({ reader, workspace });
    expectCleanRestore(restoredSetOpen);
    expectRestoredLegalActions(restoredSetOpen, 0);
    const graveGuardian = requireCard(restoredSetOpen.session, guardianCode);
    const eldixirSet = requireCard(restoredSetOpen.session, eldixirSetCode);
    const offSetDecoy = requireCard(restoredSetOpen.session, offSetDecoyCode);
    const setAction = getLuaRestoreLegalActions(restoredSetOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveGuardian.uid && action.effectId === "lua-2-1002"
    );
    expect(setAction, JSON.stringify(getLuaRestoreLegalActions(restoredSetOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetOpen, setAction!);
    resolveRestoredChain(restoredSetOpen);

    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === graveGuardian.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveGuardian.uid,
      reasonEffectId: 2,
    });
    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === eldixirSet.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === offSetDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSetOpen.session.state.eventHistory.filter((event) => ["banished", "spellTrapSet", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveGuardian.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveGuardian.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: eldixirSet.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
      chainSolvedEvent(2, "chain-3"),
    ]);
    expect(restoredSetOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 67007102, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [guardianCode, goldenLordCode] }, 1: { main: [attackTargetCode] } });
  startDuel(session);
  moveFaceDownSpell(session, requireCard(session, guardianCode));
  moveFaceUpAttack(session, requireCard(session, goldenLordCode), 0);
  moveFaceUpAttack(session, requireCard(session, attackTargetCode, 1), 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerGuardian(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
    promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }],
  });
}

function createRestoredEndSetWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 67007103, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [guardianCode, eldixirSetCode, offSetDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, guardianCode).uid, "graveyard", 0);
  session.state.phase = "end";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerGuardian(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: attackTargetCode, name: "Guardian of the Golden Land ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1900, defense: 1000 },
    { code: eldixirSetCode, name: "Guardian of the Golden Land Eldlixir Set", kind: "spell", typeFlags: typeSpell | typeQuickPlay, setcodes: [setEldlixir] },
    { code: offSetDecoyCode, name: "Guardian of the Golden Land Off-Set Decoy", kind: "trap", typeFlags: typeTrap },
  ];
}

function registerGuardian(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(guardianCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectGuardianScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Guardian of the Golden Land");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id,SET_ELDLIXIR,TYPE_MONSTER|TYPE_NORMAL,800,2500,8,RACE_ZOMBIE,ATTRIBUTE_LIGHT)");
  expect(script).toContain("c:AddMonsterAttribute(TYPE_NORMAL+TYPE_TRAP)");
  expect(script).toContain("Duel.SpecialSummonStep(c,1,tp,tp,true,false,POS_FACEUP)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_GOLDEN_LORD),tp,LOCATION_ONFIELD,0,1,nil)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(Card.HasNonZeroAttack),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SET)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCondition(s.setcond)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return Duel.IsPhase(PHASE_END)");
  expect(script).toContain("return c:IsSetCard(SET_ELDLIXIR) and c:IsSSetable() and not c:IsForbidden()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.setfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,g)");
}

function moveFaceDownSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = false;
  moved.position = "faceDown";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
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

function chainSolvedEvent(effectId: number, chainLinkId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainLinkId,
  };
}
