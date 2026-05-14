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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Prayers ritual material filter", () => {
  it("restores AddProcGreater matfilter constraints during Ritual material selection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const prayersCode = "52472775";
    const ritualTargetCode = "5242";
    const lightMaterialACode = "5243";
    const darkMaterialCode = "5244";
    const lightMaterialBCode = "5245";
    const responderCode = "5246";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === prayersCode),
      { code: ritualTargetCode, name: "Voiceless LIGHT Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 8, attribute: 0x10, attack: 2500, defense: 2200 },
      { code: lightMaterialACode, name: "Voiceless LIGHT Material A Fixture", kind: "monster", typeFlags: 0x1, level: 4, attribute: 0x10, attack: 1200, defense: 1000 },
      { code: darkMaterialCode, name: "Voiceless DARK Material Fixture", kind: "monster", typeFlags: 0x1, level: 4, attribute: 0x20, attack: 1300, defense: 1000 },
      { code: lightMaterialBCode, name: "Voiceless LIGHT Material B Fixture", kind: "monster", typeFlags: 0x1, level: 4, attribute: 0x10, attack: 1400, defense: 1000 },
      { code: responderCode, name: "Voiceless Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 524, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [prayersCode, ritualTargetCode, lightMaterialACode, darkMaterialCode, lightMaterialBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const prayers = session.state.cards.find((card) => card.code === prayersCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const lightMaterialA = session.state.cards.find((card) => card.code === lightMaterialACode);
    const darkMaterial = session.state.cards.find((card) => card.code === darkMaterialCode);
    const lightMaterialB = session.state.cards.find((card) => card.code === lightMaterialBCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(prayers).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(lightMaterialA).toBeDefined();
    expect(darkMaterial).toBeDefined();
    expect(lightMaterialB).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, prayers!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, lightMaterialA!.uid, "hand", 0);
    moveDuelCard(session.state, darkMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, lightMaterialB!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(prayersCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === prayers!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: prayers!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
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

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [lightMaterialA!.uid, lightMaterialB!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === lightMaterialA!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === darkMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === lightMaterialB!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === prayers!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("voiceless responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("voiceless responder resolved") end)
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
