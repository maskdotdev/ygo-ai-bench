import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Karakuri Bonze Extra Earth Machine lock", () => {
  it("restores its Extra Deck-only Earth Machine special summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bonzeCode = "49296203";
    const targetCode = "900000501";
    const earthMachineCode = "900000502";
    const darkMachineCode = "900000503";
    const earthWarriorCode = "900000504";
    const deckCode = "900000505";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bonzeCode),
      { code: targetCode, name: "Karakuri Bonze Target Probe", kind: "monster", typeFlags: 0x1, setcodes: [0x11], race: 0x20, attribute: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: earthMachineCode, name: "Karakuri Bonze Earth Machine Probe", kind: "extra", typeFlags: 0x2001, race: 0x20, attribute: 0x1, level: 8, attack: 1000, defense: 1000 },
      { code: darkMachineCode, name: "Karakuri Bonze Dark Machine Probe", kind: "extra", typeFlags: 0x2001, race: 0x20, attribute: 0x20, level: 8, attack: 1000, defense: 1000 },
      { code: earthWarriorCode, name: "Karakuri Bonze Earth Warrior Probe", kind: "extra", typeFlags: 0x2001, race: 0x1, attribute: 0x1, level: 8, attack: 1000, defense: 1000 },
      { code: deckCode, name: "Karakuri Bonze Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x1, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 492, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bonzeCode, targetCode, deckCode], extra: [earthMachineCode, darkMachineCode, earthWarriorCode] }, 1: { main: [] } });
    startDuel(session);
    const bonze = session.state.cards.find((card) => card.code === bonzeCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(bonze).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, bonze!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bonzeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const resolve = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${bonzeCode}),0,LOCATION_HAND,0,nil)
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      local old_get_first_target=Duel.GetFirstTarget
      Duel.GetFirstTarget=function() return target end
      c${bonzeCode}.spop(e,0,nil,0,0,nil,0,0)
      Duel.GetFirstTarget=old_get_first_target
      `,
      "karakuri-bonze-official-spop.lua",
    );
    expect(resolve.ok, resolve.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.code === 22)).toMatchObject({
      luaTargetDescriptor: "special-summon-limit:not-attribute-race-extra:1:32",
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const probe = restored.host.loadScript(
      `
      local earth_machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${earthMachineCode}),0,LOCATION_EXTRA,0,nil)
      local dark_machine=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkMachineCode}),0,LOCATION_EXTRA,0,nil)
      local earth_warrior=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${earthWarriorCode}),0,LOCATION_EXTRA,0,nil)
      local deck=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${deckCode}),0,LOCATION_DECK,0,nil)
      Debug.Message("karakuri dark machine special " .. Duel.SpecialSummon(dark_machine,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("karakuri earth warrior special " .. Duel.SpecialSummon(earth_warrior,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("karakuri earth machine special " .. Duel.SpecialSummon(earth_machine,SUMMON_TYPE_SYNCHRO,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("karakuri deck special " .. Duel.SpecialSummon(deck,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "karakuri-bonze-extra-earth-machine-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toEqual(
      expect.arrayContaining([
        "karakuri dark machine special 0",
        "karakuri earth warrior special 0",
        "karakuri earth machine special 1",
        "karakuri deck special 1",
      ]),
    );

    const endTurn = getLegalActions(restored.session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    const ended = applyResponse(restored.session, endTurn!);
    expect(ended.ok, ended.error).toBe(true);
  });
});
