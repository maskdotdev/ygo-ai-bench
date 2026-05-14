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
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const setNekroz = 0xb4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nekroz Divinemirror Extra Deck Ritual materials", () => {
  it("restores a Ritual procedure that sends Nekroz Extra Deck monsters as materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const divinemirrorCode = "50596425";
    const ritualTargetCode = "5059";
    const nekrozExtraMaterialACode = "5060";
    const offSetExtraMaterialCode = "5061";
    const nekrozExtraMaterialBCode = "5062";
    const responderCode = "5063";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === divinemirrorCode),
      { code: ritualTargetCode, name: "Nekroz Divinemirror Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 2600, defense: 2200, setcodes: [setNekroz] },
      { code: nekrozExtraMaterialACode, name: "Nekroz Divinemirror Extra Material A Fixture", kind: "extra", typeFlags: 0x41, level: 4, attack: 1800, defense: 1200, setcodes: [setNekroz] },
      { code: offSetExtraMaterialCode, name: "Nekroz Divinemirror Off-Set Extra Fixture", kind: "extra", typeFlags: 0x41, level: 4, attack: 1900, defense: 1400, setcodes: [0x123] },
      { code: nekrozExtraMaterialBCode, name: "Nekroz Divinemirror Extra Material B Fixture", kind: "extra", typeFlags: 0x41, level: 4, attack: 1700, defense: 1300, setcodes: [setNekroz] },
      { code: responderCode, name: "Nekroz Divinemirror Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 506, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [divinemirrorCode, ritualTargetCode], extra: [nekrozExtraMaterialACode, offSetExtraMaterialCode, nekrozExtraMaterialBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const divinemirror = session.state.cards.find((card) => card.code === divinemirrorCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const nekrozExtraMaterialA = session.state.cards.find((card) => card.code === nekrozExtraMaterialACode);
    const offSetExtraMaterial = session.state.cards.find((card) => card.code === offSetExtraMaterialCode);
    const nekrozExtraMaterialB = session.state.cards.find((card) => card.code === nekrozExtraMaterialBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(divinemirror).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(nekrozExtraMaterialA).toBeDefined();
    expect(offSetExtraMaterial).toBeDefined();
    expect(nekrozExtraMaterialB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, divinemirror!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(divinemirrorCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === divinemirror!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: divinemirror!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x22 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    const summonedRitual = restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid);
    expect(summonedRitual).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "ritual" });
    expect(summonedRitual!.summonMaterialUids).toHaveLength(2);
    expect(summonedRitual!.summonMaterialUids).toEqual(expect.arrayContaining([nekrozExtraMaterialA!.uid, nekrozExtraMaterialB!.uid]));
    expect(restored.session.state.cards.find((card) => card.uid === nekrozExtraMaterialA!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === nekrozExtraMaterialB!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === offSetExtraMaterial!.uid)).toMatchObject({ location: "extraDeck" });
    expect(restored.session.state.cards.find((card) => card.uid === divinemirror!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("nekroz divinemirror responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("nekroz divinemirror responder resolved") end)
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
  return response;
}
