import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const beastRace = 0x4000;
const wingedBeastRace = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script destroyed race ATK gain", () => {
  it("restores mandatory destroyed-race field triggers that grant copied ATK updates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pandaCode = "60102563";
    const firebirdCode = "87473172";
    const beastVictimCode = "6010";
    const wingedVictimCode = "8747";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pandaCode || card.code === firebirdCode),
      { code: beastVictimCode, name: "Destroyed Beast", kind: "monster", typeFlags: 0x1, level: 4, race: beastRace, attack: 1200, defense: 1000 },
      { code: wingedVictimCode, name: "Destroyed Winged Beast", kind: "monster", typeFlags: 0x1, level: 4, race: wingedBeastRace, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6010, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pandaCode, firebirdCode, beastVictimCode, wingedVictimCode] }, 1: { main: [] } });
    startDuel(session);

    const panda = findCard(session, pandaCode);
    const firebird = findCard(session, firebirdCode);
    const beastVictim = findCard(session, beastVictimCode);
    const wingedVictim = findCard(session, wingedVictimCode);
    for (const card of [panda, firebird, beastVictim, wingedVictim]) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0).position = "faceUpAttack";
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const pandaScript = workspace.readScript(`c${pandaCode}.lua`);
    const firebirdScript = workspace.readScript(`c${firebirdCode}.lua`);
    for (const script of [pandaScript, firebirdScript]) {
      expect(script).toContain("e1:SetCode(EVENT_DESTROYED)");
      expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
      expect(script).toContain("e1:SetType(EFFECT_TYPE_TRIGGER_F+EFFECT_TYPE_FIELD)");
      expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
      expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
      expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
      expect(script).toContain("e1:SetValue(500)");
    }
    expect(pandaScript).toContain("c:GetPreviousRaceOnField()&RACE_BEAST");
    expect(firebirdScript).toContain("c:GetPreviousRaceOnField()&RACE_WINGEDBEAST");
    expect(firebirdScript).toContain("c:IsPreviousControler(tp)");
    expect(host.loadCardScript(Number(pandaCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(firebirdCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const destroyed = host.loadScript(
      `
      local beast=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${beastVictimCode}), 0, LOCATION_MZONE, 0, nil)
      local winged=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${wingedVictimCode}), 0, LOCATION_MZONE, 0, nil)
      Debug.Message("destroyed race group " .. Duel.Destroy(Group.FromCards(beast, winged), REASON_EFFECT))
      `,
      "destroyed-race-atk-gain-trigger.lua",
    );
    expect(destroyed.ok, destroyed.error).toBe(true);
    expect(host.messages).toContain("destroyed race group 2");

    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1029",
        eventCardUid: beastVictim.uid,
        eventCode: 1029,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "destroyed",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
        },
        eventReason: 65,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [beastVictim.uid, wingedVictim.uid],
        id: "trigger-4-1",
        player: 0,
        sourceUid: panda.uid,
        triggerBucket: "turnMandatory",
      },
      {
        effectId: "lua-2-1029",
        eventCardUid: beastVictim.uid,
        eventCode: 1029,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "destroyed",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 2,
        },
        eventReason: 65,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [beastVictim.uid, wingedVictim.uid],
        id: "trigger-4-2",
        player: 0,
        sourceUid: firebird.uid,
        triggerBucket: "turnMandatory",
      },
    ]);
    expect(beastVictim.previousRace).toBe(beastRace);
    expect(wingedVictim.previousRace).toBe(wingedBeastRace);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    activateRestoredTrigger(restored, 0, panda.uid);
    activateRestoredTrigger(restored, 0, firebird.uid);
    expect(restored.session.state.pendingTriggers).toEqual([]);

    const probe = restored.host.loadScript(
      `
      local panda=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${pandaCode}), 0, LOCATION_MZONE, 0, nil)
      local firebird=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${firebirdCode}), 0, LOCATION_MZONE, 0, nil)
      Debug.Message("destroyed race attack " .. panda:GetAttack() .. "/" .. firebird:GetAttack())
      `,
      "destroyed-race-atk-gain-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("destroyed race attack 1500/1500");

    const finalRestore = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(finalRestore.restoreComplete, finalRestore.incompleteReasons.join("; ")).toBe(true);
    expect(finalRestore.missingRegistryKeys).toEqual([]);
    expect(finalRestore.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(finalRestore, 0);
    const finalProbe = finalRestore.host.loadScript(
      `
      local panda=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${pandaCode}), 0, LOCATION_MZONE, 0, nil)
      local firebird=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${firebirdCode}), 0, LOCATION_MZONE, 0, nil)
      Debug.Message("restored destroyed race attack " .. panda:GetAttack() .. "/" .. firebird:GetAttack())
      `,
      "destroyed-race-atk-gain-final-probe.lua",
    );
    expect(finalProbe.ok, finalProbe.error).toBe(true);
    expect(finalRestore.host.messages).toContain("restored destroyed race attack 1500/1500");
  });
});

function findCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): DuelAction[] {
  const actions = getLuaRestoreLegalActions(restored, player);
  const groups = getLuaRestoreLegalActionGroups(restored, player);
  expect(actions).toEqual(getLegalActions(restored.session, player));
  expect(groups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(groups.flatMap((group) => group.actions)).toEqual(actions);
  return actions;
}

function activateRestoredTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, uid: string): void {
  const action = expectRestoredLegalActions(restored, player).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === uid);
  expect(action).toBeDefined();
  const response = applyLuaRestoreResponse(restored, action!);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
