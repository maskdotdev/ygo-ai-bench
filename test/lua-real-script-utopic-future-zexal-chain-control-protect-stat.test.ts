import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const zexalCode = "41522092";
const materialCode = "415220921";
const allyXyzCode = "415220922";
const opponentGraveXyzCode = "415220923";
const opponentStarterCode = "415220924";
const controlTargetCode = "415220925";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasZexalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zexalCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasZexalScript)("Lua real script Number F0 Utopic Future Zexal chain control", () => {
  it("restores Rank-sum stats, field targeting protections, and EVENT_CHAINING detach control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zexalCode}.lua`);
    expect(script).toContain("--Number F0: Utopic Future Zexal");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsType,TYPE_XYZ),e:GetHandlerPlayer(),LOCATION_MZONE,LOCATION_GRAVE,nil):GetSum(Card.GetRank)*500");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
    expect(script).toContain("e4:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
    expect(script).toContain("e4:SetValue(aux.tgoval)");
    expect(script).toContain("e5:SetCode(EVENT_CHAINING)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TRIGGERING_LOCATION,CHAININFO_TRIGGERING_PLAYER)");
    expect(script).toContain("e5:SetCost(Cost.DetachFromSelf(1))");
    expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetControl(g,tp)");
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");

    const reader = createCardReader(cards());
    const source = {
      readScript(name: string) {
        if (name === `c${opponentStarterCode}.lua` || name === `official/c${opponentStarterCode}.lua`) return starterScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 41522092, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [materialCode, allyXyzCode], extra: [zexalCode] },
      1: { main: [opponentGraveXyzCode, opponentStarterCode, controlTargetCode] },
    });
    startDuel(session);

    const zexal = requireCard(session, zexalCode);
    const material = requireCard(session, materialCode);
    const allyXyz = requireCard(session, allyXyzCode);
    const opponentGraveXyz = requireCard(session, opponentGraveXyzCode);
    const opponentStarter = requireCard(session, opponentStarterCode);
    const controlTarget = requireCard(session, controlTargetCode);
    moveFaceUpAttack(session, zexal, 0, 0);
    zexal.summonType = "xyz";
    zexal.summonPlayer = 0;
    attachOverlay(session, zexal, material);
    moveFaceUpAttack(session, allyXyz, 0, 1);
    allyXyz.summonType = "xyz";
    moveDuelCard(session.state, opponentGraveXyz.uid, "graveyard", 1);
    opponentGraveXyz.faceUp = true;
    moveDuelCard(session.state, opponentStarter.uid, "spellTrapZone", 1);
    opponentStarter.faceUp = false;
    moveFaceUpAttack(session, controlTarget, 1, 0);
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zexalCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentStarterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const restoredZexal = requireCard(restoredOpen.session, zexalCode);
    expect(currentAttack(restoredZexal, restoredOpen.session.state)).toBe(4500);
    expect(currentDefense(restoredZexal, restoredOpen.session.state)).toBe(4500);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === zexal.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["monsterZone"], targetRange: undefined, value: undefined },
      { category: undefined, code: 100, event: "continuous", id: "lua-2-100", property: 0x20000, range: ["monsterZone"], targetRange: undefined, value: undefined },
      { category: undefined, code: 104, event: "continuous", id: "lua-3-104", property: 0x20000, range: ["monsterZone"], targetRange: undefined, value: undefined },
      { category: undefined, code: 332, event: "continuous", id: "lua-4-332", property: undefined, range: ["monsterZone"], targetRange: [0, 4], value: undefined },
      { category: undefined, code: 71, event: "continuous", id: "lua-5-71", property: 0x180, range: ["monsterZone"], targetRange: [12, 12], value: undefined },
      { category: categoryControl, code: 1027, event: "quick", id: "lua-6-1027", property: undefined, range: ["monsterZone"], targetRange: undefined, value: undefined },
    ]);

    const starter = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentStarter.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starter!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const zexalResponse = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === zexal.uid && action.effectId === "lua-6-1027");
    expect(zexalResponse, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, zexalResponse!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: zexal.uid,
      reasonEffectId: 6,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: zexal.uid,
      reasonEffectId: 6,
    });
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === zexal.uid && [42, 41].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 42, property: 0x4000400, reset: { flags: 1107169792 }, value: 1 },
      { code: 41, property: 0x4000400, reset: { flags: 1107169792 }, value: 1 },
    ]);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["detachedMaterial", "controlChanged"].includes(event.eventName))).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-415220921-0",
          "eventCode": 1202,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "detachedMaterial",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "overlay",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 128,
          "eventReasonCardUid": "p0-extraDeck-41522092-0",
          "eventReasonEffectId": 6,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-415220925-2",
          "eventCode": 1120,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 2,
          },
          "eventName": "controlChanged",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-41522092-0",
          "eventReasonEffectId": 6,
          "eventReasonPlayer": 0,
        },
      ]
    `);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: zexalCode, name: "Number F0: Utopic Future Zexal", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 0, attack: 0, defense: 0 },
    { code: materialCode, name: "Utopic Future Zexal Material", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 1000, defense: 1000 },
    { code: allyXyzCode, name: "Utopic Future Zexal Ally Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, level: 4, attack: 1400, defense: 1200 },
    { code: opponentGraveXyzCode, name: "Utopic Future Zexal Opponent Grave Xyz", kind: "extra", typeFlags: typeMonster | typeXyz, level: 5, attack: 2000, defense: 1500 },
    { code: opponentStarterCode, name: "Utopic Future Zexal Chain Starter", kind: "spell", typeFlags: typeSpell },
    { code: controlTargetCode, name: "Utopic Future Zexal Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
  ];
}

function starterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("utopic future zexal starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, ...materials: DuelCardInstance[]): void {
  for (const [sequence, material] of materials.entries()) {
    moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller).sequence = sequence;
    holder.overlayUids.push(material.uid);
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 || restored.session.state.waitingFor !== restored.session.state.turnPlayer) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
