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
const leoCode = "68679595";
const loadedUtopiaRayCode = "56840427";
const zwEquipCode = "686795950";
const targetCode = "686795951";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLeoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leoCode}.lua`));
const hasLoadedUtopiaRayScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${loadedUtopiaRayCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const setZw = 0x107e;

describe.skipIf(!hasUpstreamScripts || !hasLeoScript || !hasLoadedUtopiaRayScript)("Lua real script Ultimate Leo Utopia Ray load negate final stat", () => {
  it("restores LoadCardScript dependency, ZW equip-gated quick negate, and final ATK halve", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${leoCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 68679595, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zwEquipCode], extra: [leoCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const leo = requireCard(session, leoCode);
    const zwEquip = requireCard(session, zwEquipCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, leo, 0);
    moveFaceUpEquip(session, zwEquip, leo.uid);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === leo.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { code: 31, event: "continuous", property: 263168, range: ["monsterZone"] },
      { code: undefined, event: "ignition", property: 33555968, range: ["monsterZone"] },
      { code: 1002, event: "quick", property: 0x10, range: ["monsterZone"] },
    ]);
    const negate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === leo.uid && action.effectId === "lua-3-1002");
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, negate!);
    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    passRestoredChain(restoredOpen);

    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(1200);
    expectLuaNegateStatProbe(restoredOpen, targetCode, "ultimate leo probe 686795951/1200/true");
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard"].includes(event.eventName))).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === zwEquip.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
      equippedToUid: leo.uid,
    });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain('Duel.LoadCardScript("c56840427.lua")');
  expect(script).toContain("e1:SetCategory(CATEGORY_EQUIP)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,nil,1,tp,LOCATION_DECK|LOCATION_EXTRA)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil,c,tp)");
  expect(script).toContain("eff:GetOperation()(tc,eff:GetLabelObject(),tp,c)");
  expect(script).toContain("return e:GetHandler():GetEquipGroup():IsExists(s.discfilter,1,nil)");
  expect(script).toContain("return c:IsSetCard(SET_ZW) and c:GetOriginalType() & TYPE_MONSTER ~= 0");
  expect(script).toContain("e2:SetCategory(CATEGORY_DISABLE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.SelectTarget(tp,s.disfilter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.AdjustInstantly(tc)");
  expect(script).toContain("local atk=tc:GetAttack()/2");
  expect(script).toContain("e3:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e3:SetValue(atk)");
}

function cards(): DuelCardData[] {
  return [
    { code: leoCode, name: "Ultimate Leo Utopia Ray", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 5, attack: 2500, defense: 2000 },
    { code: zwEquipCode, name: "Ultimate Leo ZW Equip Probe", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, setcodes: [setZw] },
    { code: targetCode, name: "Ultimate Leo Negatable Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2400, defense: 1000 },
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

function moveFaceUpEquip(session: DuelSession, card: DuelCardInstance, equippedToUid: string): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.equippedToUid = equippedToUid;
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

function expectLuaNegateStatProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local tc=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("ultimate leo probe " .. tc:GetCode() .. "/" .. tc:GetAttack() .. "/" .. tostring(tc:IsDisabled()))
    `,
    "ultimate-leo-utopia-ray-negate-stat-probe.lua",
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
