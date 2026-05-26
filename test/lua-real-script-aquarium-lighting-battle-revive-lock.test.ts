import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const lightingCode = "91831066";
const aquaactressCode = "918310660";
const defenderCode = "918310661";
const graveAquaCode = "918310662";
const nonAquaCode = "918310663";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const setAquaactress = 0x10cd;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Aquarium Lighting battle revive lock", () => {
  it("restores Aquaactress battle final stats and on-field-to-Grave Aqua revive lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lightingCode}.lua`);
    expect(script).toContain("c:SetUniqueOnField(1,0,id)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("local tc=Duel.GetAttacker()");
    expect(script).toContain("local bc=Duel.GetAttackTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(tc:GetAttack()*2)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("return c:IsRace(RACE_AQUA) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,1,0,0)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");

    const cards = lightingCards();
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === "aquarium-lighting-send-probe.lua") return sendLightingProbeScript(lightingCode);
        return workspace.readScript(name);
      },
    };

    const battleSession = createDuel({ seed: 91831066, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(battleSession, { 0: { main: [lightingCode, aquaactressCode] }, 1: { main: [defenderCode] } });
    startDuel(battleSession);
    const battleLighting = requireCard(battleSession, lightingCode);
    const aquaactress = requireCard(battleSession, aquaactressCode);
    const defender = requireCard(battleSession, defenderCode);
    moveDuelCard(battleSession.state, battleLighting.uid, "spellTrapZone", 0).position = "faceUpAttack";
    battleLighting.faceUp = true;
    moveDuelCard(battleSession.state, aquaactress.uid, "monsterZone", 0).position = "faceUpAttack";
    aquaactress.faceUp = true;
    moveDuelCard(battleSession.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    battleSession.state.phase = "battle";
    battleSession.state.turnPlayer = 0;
    battleSession.state.waitingFor = 0;

    const battleHost = createLuaScriptHost(battleSession, workspace);
    expect(battleHost.loadCardScript(Number(lightingCode), source).ok).toBe(true);
    expect(battleHost.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(battleSession, 0).find((action) => action.type === "declareAttack" && action.attackerUid === aquaactress.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(battleSession, 0), null, 2)).toBeDefined();
    applyAndAssert(battleSession, attack!);
    passUntilPendingTrigger(battleSession);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(battleSession), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === battleLighting.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, battleTrigger!);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === aquaactress.uid), restoredBattle.session.state)).toBe(2400);
    expect(currentDefense(restoredBattle.session.state.cards.find((card) => card.uid === aquaactress.uid), restoredBattle.session.state)).toBe(1600);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: aquaactress.uid,
        eventUids: [aquaactress.uid, defender.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const graveSession = createDuel({ seed: 91831067, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(graveSession, { 0: { main: [lightingCode, graveAquaCode, nonAquaCode] }, 1: { main: [] } });
    startDuel(graveSession);
    const graveLighting = requireCard(graveSession, lightingCode);
    const graveAqua = requireCard(graveSession, graveAquaCode);
    const nonAqua = requireCard(graveSession, nonAquaCode);
    moveDuelCard(graveSession.state, graveLighting.uid, "spellTrapZone", 0).position = "faceUpAttack";
    graveLighting.faceUp = true;
    moveDuelCard(graveSession.state, graveAqua.uid, "graveyard", 0).position = "faceUpAttack";
    graveAqua.faceUp = true;
    moveDuelCard(graveSession.state, nonAqua.uid, "hand", 0);
    graveSession.state.phase = "main1";
    graveSession.state.turnPlayer = 0;
    graveSession.state.waitingFor = 0;

    const graveHost = createLuaScriptHost(graveSession, workspace);
    expect(graveHost.loadCardScript(Number(lightingCode), source).ok).toBe(true);
    expect(graveHost.registerInitialEffects()).toBe(1);
    const previousLighting = cardEventState(graveLighting);
    const sendProbe = graveHost.loadScript(sendLightingProbeScript(lightingCode), "aquarium-lighting-send-probe.lua");
    expect(sendProbe.ok, sendProbe.error).toBe(true);
    expect(graveHost.messages).toContain("aquarium lighting sent 1");

    const restoredGraveTrigger = restoreDuelWithLuaScripts(serializeDuel(graveSession), source, reader);
    expectCleanRestore(restoredGraveTrigger);
    expectRestoredLegalActions(restoredGraveTrigger, 0);
    const pending = restoredGraveTrigger.session.state.pendingTriggers[0];
    expect(pending).toBeDefined();
    expect(restoredGraveTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: pending!.effectId,
        sourceUid: graveLighting.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventCode: 1014,
        eventCardUid: graveLighting.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: previousLighting,
        eventCurrentState: { ...previousLighting, location: "graveyard", sequence: 1 },
      },
    ]);
    const graveTrigger = getLuaRestoreLegalActions(restoredGraveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === graveLighting.uid);
    expect(graveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredGraveTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredGraveTrigger, graveTrigger!);
    expect(restoredGraveTrigger.session.state.chain).toEqual([]);
    expect(restoredGraveTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === graveAqua.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: graveLighting.uid,
      reasonEffectId: 3,
    });
    expect(restoredGraveTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveLighting.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: previousLighting,
        eventCurrentState: { ...previousLighting, location: "graveyard", sequence: 1 },
      },
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: graveAqua.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveAqua.uid,
        eventUids: [graveAqua.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveLighting.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const lockProbe = restoredGraveTrigger.host.loadScript(
      `
      local non_aqua=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${nonAquaCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("aquarium lighting non-aqua special " .. Duel.SpecialSummon(non_aqua,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "aquarium-lighting-lock-probe.lua",
    );
    expect(lockProbe.ok, lockProbe.error).toBe(true);
    expect(restoredGraveTrigger.host.messages).toContain("aquarium lighting non-aqua special 0");
  });
});

function lightingCards(): DuelCardData[] {
  return [
    { code: lightingCode, name: "Aquarium Lighting", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: aquaactressCode, name: "Lighting Aquaactress Battler", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, setcodes: [setAquaactress], level: 4, attack: 1200, defense: 800 },
    { code: defenderCode, name: "Lighting Battle Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 2100, defense: 1000 },
    { code: graveAquaCode, name: "Lighting Grave Aqua", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, level: 4, attack: 1400, defense: 1000 },
    { code: nonAquaCode, name: "Lighting Non-Aqua Probe", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
  };
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
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

function passUntilPendingTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function sendLightingProbeScript(code: string): string {
  return `
    local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${code}), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
    Debug.Message("aquarium lighting sent " .. Duel.SendtoGrave(c, REASON_EFFECT))
  `;
}
