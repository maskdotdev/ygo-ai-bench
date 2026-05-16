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
const setChaos = 0xcf;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Chaos Form Graveyard Ritual material", () => {
  it("restores a Ritual procedure that banishes a Graveyard Blue-Eyes material", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const chaosFormCode = "21082832";
    const ritualTargetCode = "2108";
    const blueEyesCode = "89631139";
    const handDecoyCode = "2109";
    const responderCode = "2110";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === chaosFormCode),
      { code: ritualTargetCode, name: "Chaos Form Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attack: 3000, defense: 2500, setcodes: [setChaos] },
      { code: blueEyesCode, name: "Chaos Form Blue-Eyes Fixture", kind: "monster", typeFlags: 0x11, level: 8, attack: 3000, defense: 2500 },
      { code: handDecoyCode, name: "Chaos Form Hand Decoy", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 2000 },
      { code: responderCode, name: "Chaos Form Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2108, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chaosFormCode, ritualTargetCode, blueEyesCode, handDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const chaosForm = session.state.cards.find((card) => card.code === chaosFormCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const blueEyes = session.state.cards.find((card) => card.code === blueEyesCode);
    const handDecoy = session.state.cards.find((card) => card.code === handDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(chaosForm).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(blueEyes).toBeDefined();
    expect(handDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, chaosForm!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, blueEyes!.uid, "graveyard", 0);
    moveDuelCard(session.state, handDecoy!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(chaosFormCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === chaosForm!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x10 },
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    const summonedRitual = restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid);
    expect(summonedRitual).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack", faceUp: true, summonType: "ritual" });
    expect(summonedRitual!.summonMaterialUids).toEqual([blueEyes!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === blueEyes!.uid)).toMatchObject({ location: "banished", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === handDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === chaosForm!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("chaos form responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("chaos form responder resolved") end)
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
