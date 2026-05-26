import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const adrasteiaCode = "84054556";
const targetCode = "840545560";
const decoyCode = "840545561";
const responderCode = "840545562";
const hasAdrasteiaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${adrasteiaCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeEquip = 0x40000;
const effectIndestructibleCount = 47;

describe.skipIf(!hasUpstreamScripts || !hasAdrasteiaScript)("Lua real script DoomZ Command A.D.R.A.S.T.E.I.A. grave equip damage", () => {
  it("restores grave equip targeting, equip indestructible count, and level-scaled self damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${adrasteiaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 84054556, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [adrasteiaCode, targetCode, decoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const adrasteia = requireCard(session, adrasteiaCode);
    const target = requireCard(session, targetCode);
    const decoy = requireCard(session, decoyCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, adrasteia.uid, "graveyard", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveDuelCard(session.state, decoy.uid, "monsterZone", 0);
    decoy.sequence = 1;
    decoy.position = "faceDownDefense";
    decoy.faceUp = false;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(adrasteiaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const equip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === adrasteia.uid);
    expect(equip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, equip!);

    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-5",
        sourceUid: adrasteia.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        targetFieldIds: [target.fieldId],
        targetUids: [target.uid],
        operationInfos: [
          { category: 0x40000, targetUids: [adrasteia.uid], count: 1, player: 0, parameter: 0 },
          { category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 400 },
        ],
      },
    ]);
    expect(restoredOpen.session.state.chain[0]?.targetUids).not.toContain(decoy.uid);
    expect(getLuaRestoreLegalActions(restoredOpen, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("adrasteia responder resolved");

    const restoredEquipped = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipped);
    expectRestoredLegalActions(restoredEquipped, restoredEquipped.session.state.waitingFor ?? restoredEquipped.session.state.turnPlayer);
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === adrasteia.uid)).toMatchObject({
      controller: 0,
      location: "spellTrapZone",
      equippedToUid: target.uid,
      cardTargetUids: [target.uid],
      faceUp: true,
    });
    expect(restoredEquipped.session.state.cards.find((card) => card.uid === decoy.uid)?.equippedToUid).toBeUndefined();
    expect(restoredEquipped.session.state.players[0].lifePoints).toBe(7600);
    expect(restoredEquipped.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 400,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: adrasteia.uid,
        eventReasonEffectId: 5,
      },
    ]);
    expect(restoredEquipped.session.state.effects.filter((effect) => effect.sourceUid === adrasteia.uid && effect.code === effectIndestructibleCount).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([{ code: effectIndestructibleCount, event: "continuous", range: ["spellTrapZone"], value: undefined }]);
    expectLuaProbe(restoredEquipped, "adrasteia probe 84054556/840545560/true/4");
  });
});

function cards(): DuelCardData[] {
  return [
    { code: adrasteiaCode, name: "DoomZ Command A.D.R.A.S.T.E.I.A.", kind: "spell", typeFlags: typeSpell | typeEquip },
    { code: targetCode, name: "DoomZ Command Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    { code: decoyCode, name: "DoomZ Command Face-down Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 6, attack: 2000, defense: 2000 },
    { code: responderCode, name: "DoomZ Command Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain('--DoomZ Command "A.D.R.A.S.T.E.I.A."');
  expect(script).toContain("aux.AddEquipProcedure(c)");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
  expect(script).toContain("return (r&REASON_BATTLE)>0");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("Duel.GetMZoneCount(tp,ec)>0");
  expect(script).toContain("Duel.Destroy(ec,REASON_EFFECT)>0");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_EQUIP+CATEGORY_DAMAGE)");
  expect(script).toContain("e3:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,tp,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,lv_rnk*100)");
  expect(script).toContain("Duel.Equip(tp,c,tc)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Damage(tp,lv_rnk*100,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  return moved;
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("adrasteia responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectLuaProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, expected: string): void {
  const result = restored.host.loadScript(`
    local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${adrasteiaCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
    local target=equip and equip:GetEquipTarget()
    Debug.Message("adrasteia probe " .. tostring(equip and equip:GetCode()) .. "/" .. tostring(target and target:GetCode()) .. "/" .. tostring(equip and equip:IsHasEffect(EFFECT_INDESTRUCTABLE_COUNT)~=nil) .. "/" .. tostring(target and target:GetLevel()))
  `, "adrasteia-grave-equip-damage-probe.lua");
  expect(result.ok, result.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
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
  const waitingFor = restored.session.state.waitingFor;
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
