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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const dracoCode = "26973555";
const materialCode = "269735550";
const starterCode = "269735551";
const drawCode = "269735552";
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const effectIndestructibleBattle = 42;
const effectIndestructibleEffect = 41;
const categoryNegate = 0x10000000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Number F0 Utopic Draco Future negate control", () => {
  it("restores detached monster-effect negation into suppressed operation and control steal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dracoCode}.lua`);
    expect(script).toContain("Xyz.AddProcedure(c,s.xyzfilter,nil,3,s.ovfilter");
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
    expect(script).toContain("return ep==1-tp and re:IsMonsterEffect() and Duel.IsChainNegatable(ev)");
    expect(script).toContain("e4:SetCost(Cost.DetachFromSelf(1,1,nil))");
    expect(script).toContain("Duel.NegateActivation(ev)");
    expect(script).toContain("Duel.GetControl(rc,tp)");

    const realDraco = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dracoCode);
    expect(realDraco).toBeDefined();
    const cards: DuelCardData[] = [
      realDraco!,
      { code: materialCode, name: "Utopic Draco Future Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
      { code: starterCode, name: "Utopic Draco Future Monster Effect Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
      { code: drawCode, name: "Utopic Draco Future Suppressed Draw", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 800, defense: 800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 26973555, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [dracoCode] }, 1: { main: [starterCode, drawCode] } });
    startDuel(session);

    const draco = requireCard(session, dracoCode);
    const material = requireCard(session, materialCode);
    const starter = requireCard(session, starterCode);
    const draw = requireCard(session, drawCode);
    moveFaceUpAttack(session, draco, 0);
    moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    draco.overlayUids.push(material.uid);
    moveFaceUpAttack(session, starter, 1);
    moveDuelCard(session.state, draw.uid, "deck", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return starterMonsterEffectScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dracoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) =>
      effect.sourceUid === draco.uid && [effectIndestructibleBattle, effectIndestructibleEffect].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructibleBattle, event: "continuous", range: ["monsterZone"], sourceUid: draco.uid, value: 1 },
      { code: effectIndestructibleEffect, event: "continuous", range: ["monsterZone"], sourceUid: draco.uid, value: 1 },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const starterAction = getLuaRestoreLegalActions(restoredOpen, 1).find((action) => action.type === "activateEffect" && action.uid === starter.uid);
    expect(starterAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, starterAction!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        activationLocation: "monsterZone",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-5-1002",
        id: "chain-2",
        operationInfos: [{ category: 0x10000, count: 0, parameter: 1, player: 1, targetUids: [] }],
        player: 1,
        sourceUid: starter.uid,
      },
    ]);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === draco.uid);
    expect(negate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negate!);
    expect(restoredResponse.session.state.chain).toEqual([
      expect.objectContaining({
        activationLocation: "monsterZone",
        chainIndex: 1,
        effectId: "lua-5-1002",
        player: 1,
        sourceUid: starter.uid,
      }),
      expect.objectContaining({
        activationLocation: "monsterZone",
        chainIndex: 2,
        effectId: "lua-4-1027",
        operationInfos: [
          { category: categoryNegate, count: 1, parameter: 0, player: 0, targetUids: [starter.uid] },
          { category: categoryControl, count: 1, parameter: 0, player: 0, targetUids: [starter.uid] },
        ],
        player: 0,
        sourceUid: draco.uid,
      }),
    ]);
    expect(restoredResponse.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: draco.uid,
      reasonEffectId: 4,
    });
    expect(restoredResponse.session.state.cards.find((card) => card.uid === draco.uid)?.overlayUids).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("utopic draco starter resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === starter.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: draco.uid,
      reasonEffectId: 4,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredChain.session.state.eventHistory.filter((event) =>
      ["detachedMaterial", "controlChanged", "chainNegated", "chainDisabled", "cardsDrawn"].includes(event.eventName)
    )).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: draco.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "overlay", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: starter.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: draco.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 5,
      },
    ]);
  });
});

function starterMonsterEffectScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Debug.Message("utopic draco starter resolved")
        Duel.Draw(tp,1,REASON_EFFECT)
      end)
      c:RegisterEffect(e)
    end
  `;
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
