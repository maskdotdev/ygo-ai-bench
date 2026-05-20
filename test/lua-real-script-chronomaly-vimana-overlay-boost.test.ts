import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const vimanaCode = "2609443";
const setChronomaly = 0x70;
const typeMonster = 0x1;
const typeXyz = 0x800000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Chronomaly Vimana overlay boost", () => {
  it("restores Vimana ATK boost followed by graveyard material overlay attachment", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "260944301";
    const materialCode = "260944302";
    const responderCode = "260944303";
    const script = workspace.readScript(`official/c${vimanaCode}.lua`);
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g1,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,g2,1,0,LOCATION_GRAVE)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Overlay(c,tc2)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vimanaCode),
      { code: targetCode, name: "Chronomaly Vimana Boost Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: materialCode, name: "Chronomaly Vimana Grave Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200, setcodes: [setChronomaly] },
      { code: responderCode, name: "Chronomaly Vimana Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2609443, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode, materialCode], extra: [vimanaCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const vimana = session.state.cards.find((card) => card.code === vimanaCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(vimana).toBeDefined();
    expect(target).toBeDefined();
    expect(material).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, vimana!.uid, "monsterZone", 0).position = "faceUpAttack";
    vimana!.data.typeFlags = typeMonster | typeXyz;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, material!.uid, "graveyard", 0);
    material!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(vimanaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === vimana!.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.targetUids).toEqual([vimana!.uid, material!.uid]);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 2097152, count: 1, parameter: 0, player: 0, targetUids: [vimana!.uid] },
      { category: 67108864, count: 1, parameter: 16, player: 0, targetUids: [material!.uid] },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain[0]?.targetUids).toEqual([vimana!.uid, material!.uid]);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 2097152, count: 1, parameter: 0, player: 0, targetUids: [vimana!.uid] },
      { category: 67108864, count: 1, parameter: 16, player: 0, targetUids: [material!.uid] },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === vimana!.uid)).toMatchObject({ location: "monsterZone", overlayUids: [material!.uid] });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: vimana!.uid,
      reasonEffectId: 2,
    });
    const restoredVimana = restored.session.state.cards.find((card) => card.uid === vimana!.uid);
    expect(currentAttack(restoredVimana!, restored.session.state)).toBe((vimana!.data.attack ?? 0) + 800);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === vimana!.uid && effect.code === 100)).toEqual([
      expect.objectContaining({ code: 100, event: "continuous", reset: { flags: 1107169792 }, sourceUid: vimana!.uid, value: 800 }),
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" || event.eventName === "detachedMaterial")).toEqual([]);
    expect(restored.host.messages).not.toContain("chronomaly vimana responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("chronomaly vimana responder resolved") end)
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
