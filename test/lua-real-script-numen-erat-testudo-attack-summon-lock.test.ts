import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Numen erat Testudo attack summon lock", () => {
  it("restores its 1800 or less ATK special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const testudoCode = "83061014";
    const lowCode = "83061015";
    const equalCode = "83061016";
    const highCode = "83061017";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === testudoCode),
      { code: lowCode, name: "Numen Low ATK Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1700, defense: 1000 },
      { code: equalCode, name: "Numen Equal ATK Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1800, defense: 1000 },
      { code: highCode, name: "Numen High ATK Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1900, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 830, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [testudoCode, lowCode, equalCode, highCode], extra: [] }, 1: { main: [] } });
    startDuel(session);
    for (const code of [testudoCode, lowCode, equalCode, highCode]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "hand", 0);
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(testudoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${testudoCode}),0,LOCATION_HAND,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e1:SetTargetRange(1,1)
      e1:SetTarget(c${testudoCode}.sumlimit)
      Duel.RegisterEffect(e1,0)
      `,
      "numen-erat-testudo-official-attack-lock.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "target:attack-below:1800",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const probe = restored.host.loadScript(
      `
      local low=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowCode}),0,LOCATION_HAND,0,nil)
      local equal=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${equalCode}),0,LOCATION_HAND,0,nil)
      local high=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highCode}),0,LOCATION_HAND,0,nil)
      Debug.Message("testudo low special " .. Duel.SpecialSummon(low,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("testudo equal special " .. Duel.SpecialSummon(equal,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("testudo high special " .. Duel.SpecialSummon(high,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "numen-erat-testudo-attack-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining(["testudo low special 0", "testudo equal special 0", "testudo high special 1"]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
