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
const comicHandCode = "33453260";
const toonWorldCode = "15259703";
const targetCode = "334532600";
const responderCode = "334532601";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeField = 0x80000;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const categoryControl = 0x2000;
const categoryEquip = 0x40000;
const effectSetControl = 4;
const effectEquipLimit = 76;
const effectAddType = 115;
const effectDirectAttack = 74;
const effectSelfDestroy = 141;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Comic Hand Toon equip control", () => {
  it("restores Toon World-gated steal equip control and Toon equip effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${comicHandCode}.lua`);
    expect(script).toContain("--Comic Hand");
    expect(script).toContain("aux.AddEquipProcedure(c,1,aux.CheckStealEquip,s.eqlimit,nil,s.target,nil,s.condition)");
    expect(script).toContain("Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_ONFIELD,0,1,nil)");
    expect(script).toContain("e3:SetCode(EFFECT_SET_CONTROL)");
    expect(script).toContain("e4:SetCode(EFFECT_ADD_TYPE)");
    expect(script).toContain("e5:SetCode(EFFECT_DIRECT_ATTACK)");
    expect(script).toContain("e6:SetCode(EFFECT_SELF_DESTROY)");

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 33453260, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [comicHandCode, toonWorldCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const comicHand = requireCard(session, comicHandCode);
    const toonWorld = requireCard(session, toonWorldCode);
    const target = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, comicHand.uid, "hand", 0);
    const field = moveDuelCard(session.state, toonWorld.uid, "spellTrapZone", 0);
    field.faceUp = true;
    field.position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    moveFaceUpAttack(session, target, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(comicHandCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === comicHand.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain.map((link) => ({
      player: link.player,
      sourceUid: link.sourceUid,
      operationInfos: link.operationInfos,
      targetUids: link.targetUids,
    }))).toEqual([
      {
        player: 0,
        sourceUid: comicHand.uid,
        operationInfos: [
          { category: categoryControl, targetUids: [target.uid], count: 1, player: 0, parameter: 0 },
          { category: categoryEquip, targetUids: [comicHand.uid], count: 1, player: 0, parameter: 0 },
        ],
        targetUids: [target.uid],
      },
    ]);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === comicHand.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      equippedToUid: target.uid,
      faceUp: true,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: comicHand.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.host.messages).not.toContain("comic hand responder resolved");
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === comicHand.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 1002, event: "ignition", range: ["hand", "spellTrapZone"], value: undefined },
      { code: effectEquipLimit, event: "continuous", range: ["hand"], value: undefined },
      { code: effectSetControl, event: "continuous", range: ["spellTrapZone"], value: undefined },
      { code: effectAddType, event: "continuous", range: ["spellTrapZone"], value: 0x400000 },
      { code: effectDirectAttack, event: "continuous", range: ["spellTrapZone"], value: undefined },
      { code: effectSelfDestroy, event: "continuous", range: ["spellTrapZone"], value: undefined },
    ]);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    expect(restoredControl.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === comicHandCode),
    { code: toonWorldCode, name: "Toon World", kind: "spell", typeFlags: typeSpell | typeField },
    { code: targetCode, name: "Comic Hand Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1400 },
    { code: responderCode, name: "Comic Hand Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("comic hand responder resolved") end)
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
