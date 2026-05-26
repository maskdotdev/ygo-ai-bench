import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const irisfielCode = "64626565";
const materialACode = "646265650";
const materialBCode = "646265651";
const allyXyzCode = "646265652";
const allyMaterialCode = "646265653";
const defenderCode = "646265654";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasIrisfielScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${irisfielCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFairy = 0x4;
const raceWarrior = 0x1;
const effectDestroyReplace = 50;
const effectUpdateAttack = 100;
const eventChainSolved = 1022;

describe.skipIf(!hasUpstreamScripts || !hasIrisfielScript)("Lua real script Cherubidamn Irisfiel Xyz battle stat replace", () => {
  it("restores Xyz Summon Battle Phase Rank ATK gain, chain-solved Xyz flagging, and detach destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${irisfielCode}.lua`);
    expect(script).toContain("Cherubidamn Irisfiel");
    expect(script).toContain("Xyz.AddProcedure(c,nil,8,2,s.ovfilter,aux.Stringid(id,0),2,s.xyzop)");
    expect(script).toContain("aux.GlobalCheck(s,function()");
    expect(script).toContain("ge1:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("rc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("return e:GetHandler():IsXyzSummoned()");
    expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,2))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTarget(function(e,c) return c:IsXyzMonster() end)");
    expect(script).toContain("e1:SetCondition(function() return Duel.IsBattlePhase() end)");
    expect(script).toContain("e1:SetValue(function(e,c) return c:GetRank()*100 end)");
    expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.CheckRemoveOverlayCard(tp,1,0,1,REASON_EFFECT)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("Duel.RemoveOverlayCard(tp,1,0,1,1,REASON_EFFECT)>0");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 64626565, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, allyMaterialCode], extra: [irisfielCode, allyXyzCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const irisfiel = requireCard(session, irisfielCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const allyXyz = requireCard(session, allyXyzCode);
    const allyMaterial = requireCard(session, allyMaterialCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, materialA, 0, 0);
    moveFaceUpAttack(session, materialB, 0, 1);
    moveFaceUpAttack(session, allyXyz, 0, 1);
    allyXyz.summonType = "xyz";
    attachOverlay(session, allyXyz, allyMaterial, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${allyXyzCode}.lua`) return allyXyzScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [irisfielCode, allyXyzCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(2);
    const xyzSummon = getLegalActions(session, 0).find((action) => action.type === "xyzSummon" && action.uid === irisfiel.uid);
    expect(xyzSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    const xyzResponse = applyResponse(session, xyzSummon!);
    expect(xyzResponse.ok, xyzResponse.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === irisfiel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "xyz",
    });
    expect(session.state.cards.find((card) => card.uid === irisfiel.uid)?.overlayUids).toEqual(expect.arrayContaining([materialA.uid, materialB.uid]));

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === irisfiel.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === irisfiel.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      luaValueDescriptor: effect.luaValueDescriptor,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, sourceUid: irisfiel.uid, targetRange: [4, 0], luaValueDescriptor: "stat:rank:x100" },
    ]);
    restoredTrigger.session.state.phase = "battle";
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === irisfiel.uid), restoredTrigger.session.state)).toBe(3600);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === allyXyz.uid), restoredTrigger.session.state)).toBe(2400);
    restoredTrigger.session.state.phase = "main2";
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === irisfiel.uid), restoredTrigger.session.state)).toBe(2800);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === allyXyz.uid), restoredTrigger.session.state)).toBe(2000);
    expect(restoredTrigger.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === irisfiel.uid).map((flag) => ({
      code: flag.code,
      ownerType: flag.ownerType,
      ownerId: flag.ownerId,
      reset: flag.reset,
    }))).toEqual([{ code: Number(irisfielCode), ownerType: "card", ownerId: irisfiel.uid, reset: 1107169792 }]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "chainSolved").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      relatedEffectId: event.relatedEffectId,
    }))).toContainEqual({ eventName: "chainSolved", eventCode: eventChainSolved, eventCardUid: undefined, relatedEffectId: 3 });

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, irisfiel.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredReplacement.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === irisfiel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      overlayUids: [materialB.uid],
    });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: irisfiel.uid,
      reasonEffectId: 4,
    });
    expect(restoredReplacement.session.state.effects.filter((effect) => effect.sourceUid === irisfiel.uid && effect.code === effectDestroyReplace).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
    }))).toEqual([{ code: effectDestroyReplace, countLimit: 1, event: "continuous", range: ["monsterZone"] }]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredReplacement.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    restoredStat.session.state.phase = "battle";
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === irisfiel.uid), restoredStat.session.state)).toBe(3600);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: irisfielCode, name: "Cherubidamn Irisfiel", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceFairy, level: 8, attack: 2800, defense: 2500 },
    { code: materialACode, name: "Irisfiel Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 8, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Irisfiel Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, level: 8, attack: 1000, defense: 1000 },
    { code: allyXyzCode, name: "Irisfiel Ally Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, level: 4, attack: 2000, defense: 1000 },
    { code: allyMaterialCode, name: "Irisfiel Ally Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Irisfiel Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1500, defense: 1000 },
  ];
}

function allyXyzScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("irisfiel ally xyz resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller).sequence = sequence;
  holder.overlayUids.push(material.uid);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
