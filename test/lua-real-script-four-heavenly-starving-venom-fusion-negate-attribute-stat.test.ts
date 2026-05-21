import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const starvingCode = "27118421";
const darkMaterialACode = "271184210";
const darkMaterialBCode = "271184211";
const targetCode = "271184212";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStarvingScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${starvingCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const attributeLight = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasStarvingScript)("Lua real script Four Heavenly Starving Venom fusion negate attribute stat", () => {
  it("restores AddProcMixN dark-field fusion metadata into summon trigger negate, DARK change, and final ATK zero", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${starvingCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 27118421, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkMaterialACode, darkMaterialBCode], extra: [starvingCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const starving = requireCard(session, starvingCode);
    const darkA = requireCard(session, darkMaterialACode);
    const darkB = requireCard(session, darkMaterialBCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, starving, 0);
    starving.summonType = "fusion";
    starving.summonPlayer = 0;
    moveDuelCard(session.state, darkA.uid, "graveyard", 0);
    moveDuelCard(session.state, darkB.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(starvingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(starving.data.fusionMaterialMin).toBe(2);
    expect(starving.data.fusionMaterialMax).toBe(2);

    const raised = host.loadScript(
      `
        local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${starvingCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
        Duel.RaiseEvent(c,EVENT_SPSUMMON_SUCCESS,nil,REASON_SPSUMMON,0,0,0)
        Debug.Message("four heavenly starving summon success raised")
      `,
      "four-heavenly-starving-summon-success.lua",
    );
    expect(raised.ok, raised.error).toBe(true);
    expect(host.messages).toContain("four heavenly starving summon success raised");

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === starving.uid)?.data.fusionMaterialMin).toBe(2);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === starving.uid)?.data.fusionMaterialMax).toBe(2);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: starving.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: starving.uid,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === starving.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid), restoredTrigger.session.state)).toBe(0);
    expectLuaTargetProbe(restoredTrigger, targetCode, "four heavenly starving probe 271184212/0/true/32");
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [2, 8, 102, 127].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 2, reset: { count: 1, flags: 33427456 }, sourceUid: target.uid, value: undefined },
      { code: 8, reset: { count: 1, flags: 33427456 }, sourceUid: target.uid, value: 131072 },
      { code: 102, reset: { flags: 33427456 }, sourceUid: target.uid, value: 0 },
      { code: 127, reset: { flags: 33427456 }, sourceUid: target.uid, value: attributeDark },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventPlayer: event.eventPlayer,
    }))).toEqual([
      { eventCardUid: starving.uid, eventCode: 1102, eventPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Fusion.AddProcMixN(c,true,true,s.matfilter,2)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_DARK,fc,sumtype,tp) and c:IsOnField()");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE|CATEGORY_DISABLE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
  expect(script).toContain("tc:NegateEffects(c)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_ATTRIBUTE)");
  expect(script).toContain("e2:SetValue(ATTRIBUTE_DARK)");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Fusion.ForcedHandler");
  expect(script).toContain("e2:SetTarget(Fusion.SummonEffTG(fusion_params))");
  expect(script).toContain("e2:SetOperation(Fusion.SummonEffOP(fusion_params))");
  expect(script).toContain("return Duel.GetMatchingGroup(Fusion.IsMonsterFilter(Card.IsFaceup),tp,0,LOCATION_ONFIELD,nil)");
}

function cards(): DuelCardData[] {
  return [
    { code: starvingCode, name: "Starving Venom Fusion Dragon of the Four Heavenly Dragons", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 8, attribute: attributeDark, attack: 2800, defense: 2000 },
    { code: darkMaterialACode, name: "Four Heavenly Dark Material A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeDark, attack: 1600, defense: 1000 },
    { code: darkMaterialBCode, name: "Four Heavenly Dark Material B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeDark, attack: 1500, defense: 1200 },
    { code: targetCode, name: "Four Heavenly Light Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attribute: attributeLight, attack: 2400, defense: 1600 },
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

function expectLuaTargetProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local tc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("four heavenly starving probe " .. tc:GetCode() .. "/" .. tc:GetAttack() .. "/" .. tostring(tc:IsDisabled()) .. "/" .. tc:GetAttribute())
    `,
    "four-heavenly-starving-target-probe.lua",
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
