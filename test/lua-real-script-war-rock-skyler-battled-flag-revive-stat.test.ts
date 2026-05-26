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
const skylerCode = "72554862";
const allyCode = "725548620";
const defenderCode = "725548621";
const graveTargetCode = "725548622";
const opponentExtraCode = "725548623";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSkylerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${skylerCode}.lua`));
const setWarRock = 0x161;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const attributeDark = 0x20;
const effectCannotDirectAttack = 73;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSkylerScript)("Lua real script War Rock Skyler battled flag revive stat", () => {
  it("restores battled Earth Warrior flag into targeted revive, War Rock boosts, and direct-attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${skylerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const restoredBattle = createRestoredSkylerField({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const skyler = requireCard(restoredBattle.session, skylerCode);
    const ally = requireCard(restoredBattle.session, allyCode);
    const defender = requireCard(restoredBattle.session, defenderCode);
    const graveTarget = requireCard(restoredBattle.session, graveTargetCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === ally.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    passBattleUntilComplete(restoredBattle);
    expect(restoredBattle.session.state.flagEffects).toEqual([
      expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(skylerCode), value: 0 }),
    ]);

    const restoredQuick = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredQuick);
    expectRestoredLegalActions(restoredQuick, 0);
    const quick = getLuaRestoreLegalActions(restoredQuick, 0).find((action) =>
      action.type === "activateEffect" && action.uid === skyler.uid
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredQuick, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredQuick, quick!);
    resolveRestoredChain(restoredQuick);

    expect(restoredQuick.session.state.cards.find((card) => card.uid === graveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: skyler.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === skyler.uid), restoredQuick.session.state)).toBe(2000);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === ally.uid), restoredQuick.session.state)).toBe(1800);
    expect(currentAttack(restoredQuick.session.state.cards.find((card) => card.uid === graveTarget.uid), restoredQuick.session.state)).toBe(1700);
    expect(restoredQuick.session.state.effects.filter((effect) =>
      [skyler.uid, ally.uid, graveTarget.uid].includes(effect.sourceUid ?? "") && [effectCannotDirectAttack, effectUpdateAttack].includes(effect.code ?? 0)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: 0x20000, range: ["monsterZone"], reset: undefined, sourceUid: skyler.uid, targetRange: undefined, value: undefined },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: skyler.uid, targetRange: undefined, value: 200 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: ally.uid, targetRange: undefined, value: 200 },
      { code: effectUpdateAttack, event: "continuous", property: 0x400, range: ["monsterZone"], reset: { flags: 1644040704 }, sourceUid: graveTarget.uid, targetRange: undefined, value: 200 },
      {
        code: effectCannotDirectAttack,
        event: "continuous",
        property: 0x80,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        reset: { flags: 1073742336 },
        sourceUid: skyler.uid,
        targetRange: [4, 0],
        value: undefined,
      },
    ]);
    expect(restoredQuick.session.state.eventHistory.filter((event) => ["afterDamageCalculation", "battleDamageDealt", "battleDestroyed", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: ally.uid, eventPlayer: 1, eventValue: 400, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: ally.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "afterDamageCalculation", eventCode: 1138, eventCardUid: ally.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: defender.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: ally.uid, eventReasonEffectId: undefined, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveTarget.uid, eventPlayer: undefined, eventValue:  1, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: graveTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: skyler.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
    ]);
    expect(restoredQuick.session.state.battleDamage).toEqual({ 0: 0, 1: 400 });
  });
});

function createRestoredSkylerField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 72554862, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [skylerCode, allyCode, graveTargetCode] }, 1: { main: [defenderCode, opponentExtraCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, skylerCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentExtraCode), 1, 1);
  moveDuelCard(session.state, requireCard(session, graveTargetCode).uid, "graveyard", 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(skylerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("War Rock Skyler");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE)*100");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.IsDamageCalculated()");
  expect(script).toContain("Duel.RegisterFlagEffect(bc0:GetControler(),id,RESET_PHASE|PHASE_END,0,1)");
  expect(script).toContain("return Duel.IsBattlePhase() and Duel.GetFlagEffect(tp,id)>0");
  expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(sc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_WAR_ROCK),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
  expect(script).toContain("aux.TargetBoolFunction(Card.IsLevelBelow,5)");
  expect(script).toContain("aux.RegisterClientHint(c,0,tp,1,0,aux.Stringid(id,1),0)");
}

function cards(): DuelCardData[] {
  return [
    { code: skylerCode, name: "War Rock Skyler", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 6, attack: 1700, defense: 1700 },
    { code: allyCode, name: "War Rock Skyler Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: defenderCode, name: "War Rock Skyler Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: graveTargetCode, name: "War Rock Skyler Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWarRock], race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: opponentExtraCode, name: "War Rock Skyler Opponent Extra", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence = 0): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function passBattleUntilComplete(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
