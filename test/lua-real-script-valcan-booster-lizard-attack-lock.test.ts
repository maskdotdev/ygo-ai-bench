import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script R.B. VALCan Booster Clock Lizard attack lock", () => {
  it("restores original Machine and text ATK Clock Lizard checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const boosterCode = "6821579";
    const machine1500Code = "6821580";
    const machine1000Code = "6821581";
    const machineUnknownCode = "6821582";
    const fiend1000Code = "6821583";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === boosterCode),
      { code: machine1500Code, name: "VALCan Machine 1500 Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x20, level: 6, attack: 1500, defense: 1000 },
      { code: machine1000Code, name: "VALCan Machine 1000 Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
      { code: machineUnknownCode, name: "VALCan Machine Unknown Probe", kind: "extra", typeFlags: 0x41, race: 0x20, attribute: 0x20, level: 6, attack: -2, defense: 1000 },
      { code: fiend1000Code, name: "VALCan Fiend 1000 Probe", kind: "extra", typeFlags: 0x41, race: 0x8, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 682, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [boosterCode], extra: [machine1500Code, machine1000Code, machineUnknownCode, fiend1000Code] }, 1: { main: [] } });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(boosterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${boosterCode}),0,LOCATION_DECK,0,nil)
      aux.addTempLizardCheck(c,0,function(e,c)
        local atk=c:GetTextAttack()
        return not c:IsOriginalRace(RACE_MACHINE) or atk==-2 or atk>1500
      end)
      `,
      "valcan-booster-official-machine-text-attack-lizard.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 51476410)).toMatchObject({
      luaTargetDescriptor: "target:not-original-race-text-attack-lte:32:1500",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const mutate = restored.host.loadScript(
      `
      local machine1000=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${machine1000Code}),0,LOCATION_EXTRA,0,nil)
      local attack_change=Effect.CreateEffect(machine1000)
      attack_change:SetType(EFFECT_TYPE_SINGLE)
      attack_change:SetCode(EFFECT_SET_ATTACK)
      attack_change:SetValue(1700)
      machine1000:RegisterEffect(attack_change)
      `,
      "valcan-booster-current-attack-mutation.lua",
    );
    expect(mutate.ok, mutate.error).toBe(true);
    const effect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === boosterCode);
    const machine1500 = restored.session.state.cards.find((card) => card.code === machine1500Code);
    const machine1000 = restored.session.state.cards.find((card) => card.code === machine1000Code);
    const machineUnknown = restored.session.state.cards.find((card) => card.code === machineUnknownCode);
    const fiend1000 = restored.session.state.cards.find((card) => card.code === fiend1000Code);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(machine1500).toBeDefined();
    expect(machine1000).toBeDefined();
    expect(machineUnknown).toBeDefined();
    expect(fiend1000).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(effect!.targetCardPredicate!(ctx, machine1500!)).toBe(false);
    expect(effect!.targetCardPredicate!(ctx, machine1000!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, machineUnknown!)).toBe(true);
    expect(effect!.targetCardPredicate!(ctx, fiend1000!)).toBe(true);
  });
});
