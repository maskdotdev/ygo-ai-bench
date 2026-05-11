import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { setDuelPlayerLifePoints } from "#duel/player-life.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script summon and set cost gates", () => {
  it("applies official Chain Energy summon and set costs to legal actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const chainEnergyCode = "79323590";
    const chainEnergy = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === chainEnergyCode);
    expect(chainEnergy).toBeDefined();
    const customCards: DuelCardData[] = [
      chainEnergy!,
      { code: "90000001", name: "Normal Summon Cost Target", kind: "monster" },
      { code: "90000002", name: "Monster Set Cost Target", kind: "monster" },
      { code: "90000003", name: "Spell Set Cost Target", kind: "spell" },
    ];
    const reader = createCardReader(customCards);
    const session = createDuel({ seed: 793, startingHandSize: 4, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [chainEnergyCode, "90000001", "90000002", "90000003"] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === chainEnergyCode);
    const summonTarget = session.state.cards.find((card) => card.code === "90000001");
    const setTarget = session.state.cards.find((card) => card.code === "90000002");
    const spellTarget = session.state.cards.find((card) => card.code === "90000003");
    expect(source).toBeDefined();
    expect(summonTarget).toBeDefined();
    expect(setTarget).toBeDefined();
    expect(spellTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "spellTrapZone", 0);
    source!.faceUp = true;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chainEnergyCode), workspace).ok).toBe(true);
    expect(host.loadScript(`
      c90000003={}
      function c90000003.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_ACTIVATE)
        e:SetCode(EVENT_FREE_CHAIN)
        c:RegisterEffect(e)
      end
    `, "custom-chain-energy-activation-target.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 90, sourceUid: source!.uid }),
      expect.objectContaining({ code: 91, sourceUid: source!.uid }),
      expect.objectContaining({ code: 94, sourceUid: source!.uid }),
      expect.objectContaining({ code: 95, sourceUid: source!.uid }),
    ]));

    setDuelPlayerLifePoints(session.state, 0, 500);
    let actions = getLegalActions(session, 0);
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: spellTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(actions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));

    setDuelPlayerLifePoints(session.state, 0, 501);
    actions = getLegalActions(session, 0);
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", uid: spellTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon", uid: summonTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setMonster", uid: setTarget!.uid })]));
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "setSpellTrap", uid: spellTarget!.uid })]));
    const activateSpell = actions.find((action) => action.type === "activateEffect" && action.uid === spellTarget!.uid);
    expect(activateSpell).toBeDefined();
    expect(applyResponse(session, activateSpell!).ok).toBe(true);
    expect(session.state.players[0].lifePoints).toBe(1);
  });
});
