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
const setCyberAngel = 0x2093;
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeRitual = 0x80;
const raceWarrior = 0x1;
const raceDragon = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Machine Angel Absolute grave Ritual materials", () => {
  it("restores mixed hand and Graveyard materials, shuffling the Graveyard material into the Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const machineAngelCode = "11398951";
    const ritualTargetCode = "1131";
    const handMaterialCode = "1132";
    const graveMaterialCode = "1133";
    const graveDecoyCode = "1134";
    const responderCode = "1135";
    const databaseSpell = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === machineAngelCode);
    const fallbackSpell: DuelCardData = { code: machineAngelCode, name: "Machine Angel Absolute Ritual", kind: "spell", typeFlags: typeSpell | typeRitual };
    const cards: DuelCardData[] = [
      ...(databaseSpell.length ? databaseSpell : [fallbackSpell]),
      { code: ritualTargetCode, name: "Machine Angel Absolute Ritual Fixture", kind: "monster", typeFlags: typeMonster | typeRitual, level: 8, attack: 2600, defense: 2100, setcodes: [setCyberAngel] },
      { code: handMaterialCode, name: "Machine Angel Absolute Hand Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1000, race: raceDragon },
      { code: graveMaterialCode, name: "Machine Angel Absolute Grave Material", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200, race: raceWarrior },
      { code: graveDecoyCode, name: "Machine Angel Absolute Grave Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 1200, race: raceDragon },
      { code: responderCode, name: "Machine Angel Absolute Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 113, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [machineAngelCode, ritualTargetCode, handMaterialCode, graveMaterialCode, graveDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const machineAngel = session.state.cards.find((card) => card.code === machineAngelCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const handMaterial = session.state.cards.find((card) => card.code === handMaterialCode);
    const graveMaterial = session.state.cards.find((card) => card.code === graveMaterialCode);
    const graveDecoy = session.state.cards.find((card) => card.code === graveDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(machineAngel).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(handMaterial).toBeDefined();
    expect(graveMaterial).toBeDefined();
    expect(graveDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, machineAngel!.uid, "hand", 0);
    moveDuelCard(session.state, ritualTarget!.uid, "hand", 0);
    moveDuelCard(session.state, handMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, graveMaterial!.uid, "graveyard", 0);
    moveDuelCard(session.state, graveDecoy!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(machineAngelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === machineAngel!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: machineAngel!.uid,
    });
    expect(session.state.chain[0]?.operationInfos).toEqual(expect.arrayContaining([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]));

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
      summonMaterialUids: expect.arrayContaining([handMaterial!.uid, graveMaterial!.uid]),
    });
    expect(restored.session.state.cards.find((card) => card.uid === handMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.release | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === graveMaterial!.uid)).toMatchObject({ location: "deck", reason: duelReason.effect | duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === graveDecoy!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === machineAngel!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.host.messages).not.toContain("machine angel absolute responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("machine angel absolute responder resolved") end)
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
