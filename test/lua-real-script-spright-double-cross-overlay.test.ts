import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sprightDoubleCrossCode = "68250822";
const rankTwoXyzCode = "682508220";
const graveMaterialCode = "682508221";
const responderCode = "682508222";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSprightDoubleCrossScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sprightDoubleCrossCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSprightDoubleCrossScript)("Lua real script Spright Double Cross overlay", () => {
  it("restores SelectEffect attach branch into graveyard monster overlay material", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sprightDoubleCrossCode}.lua`);
    expect(script).toContain("local op=Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,g,1,0,0)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.xyzfilter,tp,LOCATION_MZONE,0,1,1,tc)");
    expect(script).toContain("Duel.Overlay(xc,tc,true)");

    const cards: DuelCardData[] = [
      { code: sprightDoubleCrossCode, name: "Spright Double Cross", kind: "spell", typeFlags: typeSpell },
      { code: rankTwoXyzCode, name: "Rank 2 Xyz Holder", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, level: 2, attack: 1600, defense: 1000 },
      { code: graveMaterialCode, name: "Spright Double Cross Grave Material", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 800, defense: 800 },
      { code: responderCode, name: "Spright Double Cross Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 500, defense: 500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 68250822, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sprightDoubleCrossCode, graveMaterialCode], extra: [rankTwoXyzCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const doubleCross = requireCard(session, sprightDoubleCrossCode);
    const xyz = requireCard(session, rankTwoXyzCode);
    const material = requireCard(session, graveMaterialCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, doubleCross.uid, "hand", 0);
    const fieldXyz = moveDuelCard(session.state, xyz.uid, "monsterZone", 0);
    fieldXyz.faceUp = true;
    fieldXyz.position = "faceUpAttack";
    moveDuelCard(session.state, material.uid, "graveyard", 1);
    material.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const promptOverrides = [{ api: "SelectEffect" as const, player: 0 as const, returned: 1 }];
    const host = createLuaScriptHost(session, workspace, { promptOverrides });
    expect(host.loadCardScript(Number(sprightDoubleCrossCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const doubleCrossAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === doubleCross.uid);
    expect(doubleCrossAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, doubleCrossAction!);
    expect(host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 3], descriptions: [1092013153, 1092013155], returned: 1 },
    ]);
    expect(session.state.chain[0]?.targetUids).toEqual([material.uid]);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x4000000, targetUids: [material.uid], count: 1, player: 0, parameter: 0 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === xyz.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      overlayUids: [material.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: doubleCross.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === doubleCross.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
    });
    expect(restored.session.state.eventHistory.filter((event) =>
      event.eventCardUid === material.uid && (event.eventName === "sentToGraveyard" || event.eventName === "detachedMaterial")
    )).toEqual([]);
    expect(restored.host.messages).not.toContain("spright double cross responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("spright double cross responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
