import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  specialSummonDuelCard,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { luaSummonTypeRitual } from "#duel/summon-type-codes.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

const setThePhantomKnights = 0x10db;
const preReleaseScript = (code: string): string => fs.readFileSync(`.upstream/ignis/script/pre-release/c${code}.lua`, "utf8");
const preReleaseAliases: Record<string, string> = {
  "2372506": "101305046",
  "24088928": "101305002",
  "24461358": "101305062",
  "24749710": "101305065",
  "44001993": "101305027",
  "50073633": "101305003",
  "70405001": "101305028",
  "97462632": "101305004",
};
const loadLocalAliasCardScript = (host: ReturnType<typeof createLuaScriptHost>, code: number | string) => host.loadScript(preReleaseScript(preReleaseAliases[String(code)]!), `c${code}.lua`);

describe("Lua card script movement helpers", () => {
  it("loads Corrupted Ritual Records from the pre-release script without a local fallback", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leave Field Mover", kind: "monster" },
      { code: "24461358", name: "Corrupted Ritual Records", kind: "spell" },
      { code: "70405001", alias: "101305028", name: "Listed Ritual Monster", kind: "monster", typeFlags: 0x81, listedNames: ["101305044"] },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "24461358", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);
    const mover = session.state.cards.find((card) => card.code === "100");
    const record = session.state.cards.find((card) => card.code === "24461358");
    const listed = session.state.cards.find((card) => card.code === "70405001");
    expect(mover).toBeTruthy();
    expect(record).toBeTruthy();
    expect(listed).toBeTruthy();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, record!.uid, "graveyard", 0);
    moveDuelCard(session.state, listed!.uid, "monsterZone", 0);
    listed!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 70405001), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
          Duel.SendtoGrave(e:GetHandler(), REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "corrupted-records-mover.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    const fallback = loadLocalAliasCardScript(host, 24461358);
    expect(fallback.ok, fallback.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const moveAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(moveAction).toBeDefined();
    applyAndAssert(session, moveAction!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === record!.uid);

    expect(session.state.cards.find((card) => card.uid === listed!.uid)).toMatchObject({ location: "graveyard", reason: 0x40 });
    expect(setAction).toBeDefined();
    applyAndAssert(session, setAction!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }
    expect(session.state.cards.find((card) => card.uid === record!.uid)).toMatchObject({ location: "hand", reason: 0x40 });
  });

  it("resolves Gurifoh's listed Spell/Trap set branch from the pre-release script", () => {
    const cards: DuelCardData[] = [
      { code: "97462632", name: "Gurifoh", kind: "monster" },
      { code: "24749710", name: "Mind Shuffle", kind: "trap", typeFlags: 0x20004, listedNames: ["101305044"] },
    ];
    const session = createDuel({ seed: 98, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["97462632", "24749710"] },
      1: { main: [] },
    });
    startDuel(session);

    const gurifoh = session.state.cards.find((card) => card.code === "97462632");
    const records = session.state.cards.find((card) => card.code === "24749710");
    expect(gurifoh).toBeDefined();
    expect(records).toBeDefined();
    moveDuelCard(session.state, gurifoh!.uid, "hand", 0);
    moveDuelCard(session.state, records!.uid, "deck", 0);

    const host = createLuaScriptHost(session, undefined, { promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }] });
    const loaded = loadLocalAliasCardScript(host, 97462632);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === gurifoh!.uid);
    expect(setAction).toBeDefined();
    applyAndAssert(session, setAction!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === gurifoh!.uid)).toMatchObject({ location: "graveyard", reason: 0x4080 });
    expect(host.promptDecisions).toEqual(expect.arrayContaining([expect.objectContaining({ api: "SelectEffect", returned: 2 })]));
    expect(session.state.cards.find((card) => card.uid === records!.uid)).toMatchObject({
      location: "spellTrapZone",
      position: "faceDown",
      faceUp: false,
    });
  });

  it("loads Mystical Celtic Sage and tributes itself to summon a listed Ritual monster", () => {
    const cards: DuelCardData[] = [
      { code: "50073633", name: "Mystical Celtic Sage", kind: "monster" },
      { code: "70405001", alias: "101305028", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", typeFlags: 0x81, listedNames: ["101305044"] },
    ];
    const session = createDuel({ seed: 99, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["50073633", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);

    const sage = session.state.cards.find((card) => card.code === "50073633");
    const ritual = session.state.cards.find((card) => card.code === "70405001");
    expect(sage).toBeDefined();
    expect(ritual).toBeDefined();
    moveDuelCard(session.state, sage!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ritual!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = loadLocalAliasCardScript(host, 50073633);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const summonAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sage!.uid);
    expect(summonAction).toBeDefined();
    applyAndAssert(session, summonAction!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === sage!.uid)).toMatchObject({ location: "graveyard", reason: 0x82 });
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
  });

  it("loads Skull Archfiend of Chaos recycle effect from the pre-release script", () => {
    const cards: DuelCardData[] = [
      { code: "24088928", name: "Skull Archfiend of Chaos", kind: "monster" },
      { code: "33599853", name: "Ritual of Light and Darkness", kind: "spell", listedNames: ["101305044"] },
      { code: "100", name: "Recycle Grave", kind: "monster" },
      { code: "200", name: "Recycle Banished", kind: "monster" },
    ];
    const session = createDuel({ seed: 100, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["24088928", "33599853", "100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "24088928");
    const ritualSpell = session.state.cards.find((card) => card.code === "33599853");
    const grave = session.state.cards.find((card) => card.code === "100");
    const banished = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(ritualSpell).toBeDefined();
    expect(grave).toBeDefined();
    expect(banished).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, ritualSpell!.uid, "graveyard", 0);
    moveDuelCard(session.state, grave!.uid, "graveyard", 0);
    moveDuelCard(session.state, banished!.uid, "banished", 0);
    ritualSpell!.faceUp = true;
    grave!.faceUp = true;
    banished!.faceUp = true;

    const host = createLuaScriptHost(session);
    const loaded = loadLocalAliasCardScript(host, 24088928);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    for (const card of [ritualSpell, grave, banished]) expect(session.state.cards.find((candidate) => candidate.uid === card!.uid)).toMatchObject({ location: "deck", reason: 0x40 });
  });

  it("loads Skull Archfiend of Chaos and searches after being sent to the GY", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Skull Sender", kind: "monster" },
      { code: "24088928", name: "Skull Archfiend of Chaos", kind: "monster" },
      { code: "33599853", name: "Ritual of Light and Darkness", kind: "spell", typeFlags: 0x82, listedNames: ["70405001", "101305028"] },
      { code: "70405001", alias: "101305028", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", typeFlags: 0x81 },
    ];
    const session = createDuel({ seed: 101, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "24088928", "33599853", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);

    const sender = session.state.cards.find((card) => card.code === "100");
    const source = session.state.cards.find((card) => card.code === "24088928");
    const ritualSpell = session.state.cards.find((card) => card.code === "33599853");
    const ritualMonster = session.state.cards.find((card) => card.code === "70405001");
    expect(sender).toBeDefined();
    expect(source).toBeDefined();
    expect(ritualSpell).toBeDefined();
    expect(ritualMonster).toBeDefined();
    moveDuelCard(session.state, sender!.uid, "monsterZone", 0);
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ritualSpell!.uid, "deck", 0);
    moveDuelCard(session.state, ritualMonster!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const mover = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 24088928), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      `,
      "skull-archfiend-sender.lua",
    );
    expect(mover.ok, mover.error).toBe(true);
    const loaded = loadLocalAliasCardScript(host, 24088928);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const sendAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sender!.uid);
    expect(sendAction).toBeDefined();
    applyAndAssert(session, sendAction!);
    const triggerAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(triggerAction).toBeDefined();
    applyAndAssert(session, triggerAction!);

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "graveyard", reason: 0x40 });
    expect(session.state.cards.find((card) => card.uid === ritualSpell!.uid)).toMatchObject({ location: "graveyard", reason: 0x80 });
    expect(session.state.cards.find((card) => card.uid === ritualMonster!.uid)).toMatchObject({ location: "hand", reason: 0x40 });
  });

  it("loads Black Chaos the Dark Chaos Magician and banishes an opponent card face-down", () => {
    const cards: DuelCardData[] = [
      { code: "44001993", name: "Black Chaos the Dark Chaos Magician", kind: "monster" },
      { code: "100", name: "Opponent Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 102, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["44001993"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "44001993");
    const target = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = loadLocalAliasCardScript(host, 44001993);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "banished",
      position: "faceDownDefense",
      faceUp: false,
      reason: 0x40,
    });
  });

  it("loads Mind Shuffle and searches a listed monster before discarding", () => {
    const cards: DuelCardData[] = [
      { code: "24749710", name: "Mind Shuffle", kind: "trap", typeFlags: 0x20004 },
      { code: "70405001", alias: "101305028", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster", listedNames: ["101305044"] },
      { code: "100", name: "Discard Fodder", kind: "monster" },
    ];
    const session = createDuel({ seed: 103, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["24749710", "70405001", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "24749710");
    const searched = session.state.cards.find((card) => card.code === "70405001");
    const fodder = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(searched).toBeDefined();
    expect(fodder).toBeDefined();
    moveDuelCard(session.state, source!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, searched!.uid, "deck", 0);
    moveDuelCard(session.state, fodder!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = loadLocalAliasCardScript(host, 24749710);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid && session.state.effects.find((effect) => effect.id === candidate.effectId)?.category === 0x20088);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    while (session.state.chain.length > 0) {
      expect(passCurrentChain(session)).toBe(true);
    }

    expect(session.state.cards.find((card) => card.uid === searched!.uid)).toMatchObject({ location: "graveyard", reason: 0x4040 });
    expect(session.state.cards.find((card) => card.uid === fodder!.uid)).toMatchObject({ location: "hand" });
  });

  it("loads Black Luster Soldier and banishes an opponent card after Special Summon", () => {
    const cards: DuelCardData[] = [
      { code: "70405001", name: "Black Luster Soldier - Soldier of Light and Darkness", kind: "monster" },
      { code: "100", name: "Opponent Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 104, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["70405001"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "70405001");
    const target = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = loadLocalAliasCardScript(host, 70405001);
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    specialSummonDuelCard(session.state, source!.uid, 0, undefined, {}, luaSummonTypeRitual);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "banished",
      faceUp: true,
      reason: 0x40,
    });
  });

  it("loads Phantom Knights Doomed Solleret and sets a Phantom Knights Spell/Trap from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "101305019", name: "The Phantom Knights of Doomed Solleret", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Phantom Knights Trap", kind: "trap", setcodes: [setThePhantomKnights] },
    ];
    const session = createDuel({ seed: 107, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305019", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305019");
    const trap = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(trap).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, trap!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305019"), "c101305019.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === source!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "spellTrapZone",
      position: "faceDown",
      faceUp: false,
    });
  });

  it("loads Phantom Knights Doomed Solleret and raises targeted Level and Rank from the GY", () => {
    const cards: DuelCardData[] = [
      { code: "101305019", name: "The Phantom Knights of Doomed Solleret", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Dark Level Target", kind: "monster", level: 3, attribute: 0x20 },
      { code: "200", name: "Dark Rank Target", kind: "extra", typeFlags: 0x800001, level: 3, attribute: 0x20 },
    ];
    const session = createDuel({ seed: 112, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305019", "100"], extra: ["200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305019");
    const levelTarget = session.state.cards.find((card) => card.code === "100");
    const rankTarget = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeDefined();
    expect(levelTarget).toBeDefined();
    expect(rankTarget).toBeDefined();
    moveDuelCard(session.state, source!.uid, "graveyard", 0);
    moveDuelCard(session.state, levelTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, rankTarget!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305019"), "c101305019.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const probe = host.loadScript(
      `
      local lv=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local rk=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("phantom level rank " .. lv:GetLevel() .. "/" .. rk:GetRank())
      `,
      "phantom-level-rank-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(host.messages).toContain("phantom level rank 4/4");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({
      location: "banished",
      reason: 0x80,
    });
  });

  it("loads Phantom Knights Decayed Cloak and searches a Phantom Knights monster from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "101305018", name: "The Phantom Knights of Decayed Cloak", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Phantom Knights Monster", kind: "monster", setcodes: [setThePhantomKnights] },
    ];
    const session = createDuel({ seed: 108, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305018", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305018");
    const searched = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(searched).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, searched!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305018"), "c101305018.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === source!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === source!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(session.state.cards.find((card) => card.uid === searched!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });

  it("loads Phantom Knights Decayed Cloak and special summons itself by revealing another Phantom Knights card", () => {
    const cards: DuelCardData[] = [
      { code: "101305018", name: "The Phantom Knights of Decayed Cloak", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Phantom Knights Reveal", kind: "trap", setcodes: [setThePhantomKnights] },
    ];
    const session = createDuel({ seed: 109, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305018", "100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "101305018");
    const revealed = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeDefined();
    expect(revealed).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, revealed!.uid, "hand", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305018"), "c101305018.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(session.state.cards.find((card) => card.uid === revealed!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });

  it("loads Phantom Knights Malevolent Scythe and detaches material to summon from Deck", () => {
    const cards: DuelCardData[] = [
      { code: "101305037", name: "The Phantom Knights of Malevolent Scythe", kind: "extra", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Phantom Knights Summon", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "200", name: "Overlay Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 110, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"], extra: ["101305037"] },
      1: { main: [] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.code === "101305037");
    const summoned = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "200");
    expect(xyz).toBeDefined();
    expect(summoned).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, summoned!.uid, "deck", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305037"), "c101305037.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === xyz!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      reason: 0x80,
    });
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
  });

  it("loads Phantom Knights Malevolent Scythe and recovers a banished Phantom Knights card when destroyed", () => {
    const cards: DuelCardData[] = [
      { code: "101305037", name: "The Phantom Knights of Malevolent Scythe", kind: "extra", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Phantom Knights Banished", kind: "trap", setcodes: [setThePhantomKnights] },
    ];
    const session = createDuel({ seed: 111, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"], extra: ["101305037"] },
      1: { main: [] },
    });
    startDuel(session);

    const xyz = session.state.cards.find((card) => card.code === "101305037");
    const recovered = session.state.cards.find((card) => card.code === "100");
    expect(xyz).toBeDefined();
    expect(recovered).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, recovered!.uid, "banished", 0);
    recovered!.faceUp = true;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305037"), "c101305037.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    destroyDuelCard(session.state, xyz!.uid, 0);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === xyz!.uid);
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(session.state.cards.find((card) => card.uid === recovered!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
  });

  it("loads Phantom Knights Umbrage Veil and summons itself as a trap monster", () => {
    const cards: DuelCardData[] = [
      { code: "101305073", name: "The Phantom Knights of Umbrage Veil", kind: "trap", setcodes: [setThePhantomKnights] },
      { code: "100", name: "Phantom Knights Anchor", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "200", name: "Opponent Attack", kind: "monster" },
    ];
    const session = createDuel({ seed: 113, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305073", "100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const trap = session.state.cards.find((card) => card.code === "101305073");
    const anchor = session.state.cards.find((card) => card.code === "100");
    const opponent = session.state.cards.find((card) => card.code === "200");
    expect(trap).toBeDefined();
    expect(anchor).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0);
    trap!.position = "faceDown";
    trap!.faceUp = false;
    moveDuelCard(session.state, anchor!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    opponent!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305073"), "c101305073.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpDefense",
      faceUp: true,
    });
    expect(session.state.cards.find((card) => card.uid === opponent!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpDefense",
    });
  });

  it("loads Phantom Knights Umbrage Veil and Xyz Summons from the GY", () => {
    const cards: DuelCardData[] = [
      { code: "101305073", name: "The Phantom Knights of Umbrage Veil", kind: "trap", setcodes: [setThePhantomKnights] },
      { code: "980", name: "Dark Rank 3 Xyz", kind: "extra", typeFlags: 0x800001, level: 3, attribute: 0x20 },
      { code: "100", name: "Level 3 Material A", kind: "monster", level: 3 },
      { code: "200", name: "Level 3 Material B", kind: "monster", level: 3 },
    ];
    const session = createDuel({ seed: 114, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305073", "100", "200"], extra: ["980"] },
      1: { main: [] },
    });
    startDuel(session);

    const trap = session.state.cards.find((card) => card.code === "101305073");
    const xyz = session.state.cards.find((card) => card.code === "980");
    const materials = session.state.cards.filter((card) => card.code === "100" || card.code === "200");
    expect(trap).toBeDefined();
    expect(xyz).toBeDefined();
    expect(materials).toHaveLength(2);
    moveDuelCard(session.state, trap!.uid, "graveyard", 0);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305073"), "c101305073.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === trap!.uid)).toMatchObject({
      location: "banished",
      reason: 0x80,
    });
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
      overlayUids: expect.arrayContaining(materials.map((card) => card.uid)),
    });
    for (const material of materials) expect(session.state.cards.find((card) => card.uid === material.uid)?.location).toBe("overlay");
  });

  it("loads Phantom Knights Rank-Up-Magic Requiem and ranks up a revived Xyz monster", () => {
    const cards: DuelCardData[] = [
      { code: "101305057", name: "The Phantom Knights' Rank-Up-Magic Requiem", kind: "spell", setcodes: [0x95] },
      { code: "100", name: "Phantom Knights Revive", kind: "monster", setcodes: [setThePhantomKnights] },
      { code: "200", name: "Dark Rank 3 Xyz", kind: "extra", typeFlags: 0x800001, level: 3, attribute: 0x20, setcodes: [setThePhantomKnights] },
      { code: "300", name: "Dark Rank 4 Xyz", kind: "extra", typeFlags: 0x800001, level: 4, attribute: 0x20, setcodes: [setThePhantomKnights] },
      { code: "400", name: "Rank-Up Overlay", kind: "monster" },
    ];
    const session = createDuel({ seed: 115, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101305057", "100", "400"], extra: ["200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const spell = session.state.cards.find((card) => card.code === "101305057");
    const revived = session.state.cards.find((card) => card.code === "100");
    const rankThree = session.state.cards.find((card) => card.code === "200");
    const rankFour = session.state.cards.find((card) => card.code === "300");
    const overlay = session.state.cards.find((card) => card.code === "400");
    expect(spell).toBeDefined();
    expect(revived).toBeDefined();
    expect(rankThree).toBeDefined();
    expect(rankFour).toBeDefined();
    expect(overlay).toBeDefined();
    moveDuelCard(session.state, spell!.uid, "hand", 0);
    moveDuelCard(session.state, revived!.uid, "graveyard", 0);
    moveDuelCard(session.state, rankThree!.uid, "monsterZone", 0);
    moveDuelCard(session.state, overlay!.uid, "overlay", 0);
    rankThree!.overlayUids.push(overlay!.uid);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305057"), "c101305057.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    host.registerInitialEffects();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === spell!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === revived!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
    });
    expect(session.state.cards.find((card) => card.uid === rankFour!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "xyz",
      overlayUids: expect.arrayContaining([rankThree!.uid]),
    });
    expect(session.state.cards.find((card) => card.uid === rankThree!.uid)).toMatchObject({
      location: "overlay",
    });
  });

  it("resolves Chaos Hats from the pre-release script without a local fallback", () => {
    const cards: DuelCardData[] = [
      { code: "2372506", name: "Chaos Hats", kind: "trap", typeFlags: 0x4 },
      { code: "100", name: "Listed Faceup Monster", kind: "monster", listedNames: ["101305044"] },
      { code: "200", name: "Listed Decoy Spell", kind: "spell", typeFlags: 0x2 },
      { code: "300", name: "Listed Decoy Trap", kind: "trap", typeFlags: 0x4 },
      { code: "400", name: "Listed Decoy Quick-Play", kind: "spell", typeFlags: 0x10002 },
      { code: "900", name: "Opponent Chain Source", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 116, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900"] },
      1: { main: ["2372506", "100", "200", "300", "400"] },
    });
    startDuel(session);

    const trap = session.state.cards.find((card) => card.code === "2372506");
    const listedMonster = session.state.cards.find((card) => card.code === "100");
    const source = session.state.cards.find((card) => card.code === "900");
    expect(trap).toBeDefined();
    expect(listedMonster).toBeDefined();
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 1);
    trap!.faceUp = false;
    moveDuelCard(session.state, listedMonster!.uid, "monsterZone", 1);
    listedMonster!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c900={}
      function c900.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_ACTIVATE)
        e:SetCode(EVENT_FREE_CHAIN)
        e:SetOperation(function(e,tp)
          Debug.Message("opponent original operation")
        end)
        c:RegisterEffect(e)
      end
      `,
      "opponent-chain-source.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    const hats = loadLocalAliasCardScript(host, 2372506);
    expect(hats.ok, hats.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const hatsAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect" && candidate.uid === trap!.uid);
    expect(hatsAction).toBeDefined();
    applyAndAssert(session, hatsAction!);
    expect(host.messages).toContain("confirmed 0: 400,200,300");
    expect(host.messages).not.toContain("opponent original operation");
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.waitingFor).toBe(0);
    expect(host.messages).not.toContain("opponent original operation");
    const hatsCards = ["100", "200", "300", "400"].map((code) => session.state.cards.find((card) => card.code === code));
    expect(hatsCards.every(Boolean)).toBe(true);
    expect(hatsCards.filter((card) => card?.location === "monsterZone" && card.controller === 1 && card.position === "faceDownDefense" && card.faceUp === false)).toHaveLength(3);
    expect(hatsCards.filter((card) => card?.location === "graveyard")).toHaveLength(1);
  });

});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function passCurrentChain(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  if (!pass) return false;
  applyAndAssert(session, pass);
  return true;
}
