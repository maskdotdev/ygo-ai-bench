import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const knightCode = "98007437";
const highDragonCode = "980074370";
const banishedDragonCode = "980074371";
const targetDragonCode = "980074372";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasKnightScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${knightCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectChangeAttribute = 127;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasKnightScript)("Lua real script Knight Armed Dragon summon attribute level attack", () => {
  it("restores Level 5 Dragon summon hand trigger, banished Dragon Level/Attribute copy, and to-Grave Dragon ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${knightCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 98007437, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [knightCode, highDragonCode, banishedDragonCode, targetDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const knight = requireCard(session, knightCode);
    const highDragon = requireCard(session, highDragonCode);
    const banishedDragon = requireCard(session, banishedDragonCode);
    const targetDragon = requireCard(session, targetDragonCode);
    moveDuelCard(session.state, knight.uid, "hand", 0);
    moveDuelCard(session.state, banishedDragon.uid, "banished", 0, duelReason.effect, 0).faceUp = true;
    moveFaceUpAttack(session, targetDragon, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(knightCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    specialSummonDuelCard(session.state, highDragon.uid, 0);
    expect(session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === knight.uid).map((trigger) => ({
      effectId: trigger.effectId,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1102", eventName: "specialSummoned", eventCode: 1102, eventCardUid: highDragon.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === knight.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    passRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === knight.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: knight.uid,
      reasonEffectId: 1,
    });

    const restoredCopy = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCopy);
    expectRestoredLegalActions(restoredCopy, 0);
    const copy = getLuaRestoreLegalActions(restoredCopy, 0).find((action) => action.type === "activateTrigger" && action.uid === knight.uid && action.effectId === "lua-2-1102");
    expect(copy, JSON.stringify(getLuaRestoreLegalActions(restoredCopy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCopy, copy!);
    passRestoredChain(restoredCopy);

    expect(currentLevel(restoredCopy.session.state.cards.find((card) => card.uid === knight.uid), restoredCopy.session.state)).toBe(7);
    expectKnightProbe(restoredCopy, "knight armed copy probe 98007437/7/32");
    expect(restoredCopy.session.state.effects.filter((effect) => effect.sourceUid === knight.uid && [effectChangeAttribute, effectChangeLevel].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeAttribute, reset: { flags: 33492992 }, sourceUid: knight.uid, value: attributeDark },
      { code: effectChangeLevel, reset: { flags: 33492992 }, sourceUid: knight.uid, value: 7 },
    ]);

    sendDuelCardToGraveyard(restoredCopy.session.state, knight.uid, 0, duelReason.effect, 0);
    restoredCopy.session.state.waitingFor = 0;
    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(restoredCopy.session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attack = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateTrigger" && action.uid === knight.uid && action.effectId === "lua-3-1014");
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);
    passRestoredChain(restoredAttack);

    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === targetDragon.uid), restoredAttack.session.state)).toBe(2600);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === targetDragon.uid)).toMatchObject({ attackModifier: 1000 });
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: targetDragon.uid, eventReasonEffectId: undefined },
    ]);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Knight Armed Dragon, the Armored Knight Dragon");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSummonPlayer(tp) and c:IsLevelAbove(5) and c:IsRace(RACE_DRAGON) and c:IsFaceup()");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.lvattrfilter,tp,LOCATION_REMOVED,0,1,1,nil,attr,lv)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_ATTRIBUTE)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SetChainLimit(aux.FALSE)");
  expect(script).toContain("tc:UpdateAttack(1000,RESET_EVENT|RESETS_STANDARD,e:GetHandler())");
}

function cards(): DuelCardData[] {
  return [
    { code: knightCode, name: "Knight Armed Dragon, the Armored Knight Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 3, attack: 1400, defense: 1900 },
    { code: highDragonCode, name: "Knight Armed Dragon Trigger Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 5, attack: 2000, defense: 1600 },
    { code: banishedDragonCode, name: "Knight Armed Dragon Banished Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 7, attack: 2500, defense: 2000 },
    { code: targetDragonCode, name: "Knight Armed Dragon ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
  ];
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

function expectKnightProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${knightCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("knight armed copy probe " .. c:GetCode() .. "/" .. c:GetLevel() .. "/" .. c:GetAttribute())
    `,
    "knight-armed-copy-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
