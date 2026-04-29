import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createCardReader,
  createDuel,
  getDuelLegalActions,
  loadDecks,
  makeResponseSelector,
  moveDuelCard,
  normalizeCdbRows,
  parseBanlistConf,
  runScriptedDuelFixture,
  scriptFilenameForCard,
  startDuel,
  upstreamBanlistPath,
  upstreamDatabasePath,
  upstreamScriptPath,
} from "../src/engine/index.js";
import type { DuelCardData, ScriptedDuelFixture } from "../src/engine/index.js";
import { createLuaScriptHost } from "../src/engine/lua-host.js";

describe("EDOPro compatibility harness scaffolding", () => {
  it("normalizes card database rows and banlist entries", () => {
    const cards = normalizeCdbRows(
      [
        { id: 100, type: 1, atk: 2500, def: 2100, level: 4, setcode: 0, race: 0x2, attribute: 0x20 },
        { id: 200, type: 2 },
        { id: 300, type: 4 },
      ],
      [
        { id: 100, name: "Fixture Monster" },
        { id: 200, name: "Fixture Spell" },
      ],
    );

    expect(cards.map((card) => card.kind)).toEqual(["monster", "spell", "trap"]);
    expect(cards[0]?.name).toBe("Fixture Monster");
    expect(cards[0]?.race).toBe(0x2);
    expect(cards[0]?.attribute).toBe(0x20);
    expect(scriptFilenameForCard(100)).toBe("c100.lua");
    const upstream = { root: ".upstream/ignis", coreUrl: "core", scriptsUrl: "scripts", databaseUrl: "db", lflistUrl: "lists" };
    expect(upstreamScriptPath(upstream, 100)).toBe(".upstream/ignis/script/c100.lua");
    expect(upstreamDatabasePath(upstream, "cards.cdb")).toBe(".upstream/ignis/cdb/cards.cdb");
    expect(upstreamBanlistPath(upstream, "lflist.conf")).toBe(".upstream/ignis/lflist.conf");
    expect(parseBanlistConf("100 1\n# comment\n200 0\n!header\n300 4")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);
  });

  it("runs a scripted duel fixture against the TypeScript engine", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "normal summon fixture",
        options: { seed: 4, startingHandSize: 2 },
        decks: {
          0: { main: ["100", "200"] },
          1: { main: ["300", "400"] },
        },
        responses: [makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })],
        expected: {
          locations: { monsterZone: ["100"] },
          logIncludes: ["Normal Summoned"],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("selects extra deck scripted fixture responses by material uids", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Fixture Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Fixture Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Fixture Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Fixture Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Fixture Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const fixtureBase = {
      options: { seed: 3, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["100", "300"] },
      },
    } satisfies Pick<ScriptedDuelFixture, "options" | "decks">;
    const materialUids = ["p0-deck-100-0", "p0-deck-300-1"];
    const fixtures: ScriptedDuelFixture[] = [
      {
        ...fixtureBase,
        name: "fusion fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["900"] } },
        responses: [makeResponseSelector("fusionSummon", 0, { code: "900", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["900"], graveyard: ["100", "300"] }, logIncludes: ["Fusion Summoned"] },
      },
      {
        ...fixtureBase,
        name: "synchro fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["910"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("synchroSummon", 0, { code: "910", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["910"], graveyard: ["100", "300"] }, logIncludes: ["Synchro Summoned"] },
      },
      {
        ...fixtureBase,
        name: "xyz fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["920"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("xyzSummon", 0, { code: "920", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["920"], overlay: ["100", "300"] }, logIncludes: ["Xyz Summoned"] },
      },
      {
        ...fixtureBase,
        name: "link fixture",
        decks: { ...fixtureBase.decks, 0: { ...fixtureBase.decks[0], extra: ["930"] } },
        setup: { moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone" }, { player: 0, code: "300", from: "hand", to: "monsterZone" }] },
        responses: [makeResponseSelector("linkSummon", 0, { code: "930", location: "extraDeck", materialUids })],
        expected: { locations: { monsterZone: ["930"], graveyard: ["100", "300"] }, logIncludes: ["Link Summoned"] },
      },
      {
        ...fixtureBase,
        name: "ritual fixture",
        options: { seed: 3, startingHandSize: 3 },
        decks: { ...fixtureBase.decks, 0: { main: ["100", "300", "940"] } },
        responses: [makeResponseSelector("ritualSummon", 0, { code: "940", location: "hand", materialUids })],
        expected: { locations: { monsterZone: ["940"], graveyard: ["100", "300"] }, logIncludes: ["Ritual Summoned"] },
      },
    ];

    for (const fixture of fixtures) {
      expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
    }
  });

  it("lets Lua scripts invoke scaffolded summon helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material A", kind: "monster" },
      { code: "300", name: "Material B", kind: "monster" },
      { code: "900", name: "Lua Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      { code: "910", name: "Lua Synchro", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
      { code: "920", name: "Lua Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
      { code: "930", name: "Lua Link", kind: "extra", linkMaterials: ["100", "300"] },
      { code: "940", name: "Lua Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
    ];
    const cases = [
      { label: "fusion", fn: "FusionSummon", target: "900", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_HAND", extra: ["900"], main: ["100", "300"] },
      { label: "synchro", fn: "SynchroSummon", target: "910", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["910"], main: ["100", "300"], field: true },
      { label: "xyz", fn: "XyzSummon", target: "920", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["920"], main: ["100", "300"], field: true },
      { label: "link", fn: "LinkSummon", target: "930", targetLocation: "LOCATION_EXTRA", materials: "LOCATION_MZONE", extra: ["930"], main: ["100", "300"], field: true },
      { label: "ritual", fn: "RitualSummon", target: "940", targetLocation: "LOCATION_HAND", materials: "LOCATION_HAND", main: ["940", "100", "300"] },
    ];

    for (const current of cases) {
      const session = createDuel({ seed: 5, startingHandSize: current.main.length, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: current.main, extra: current.extra ?? [] },
        1: { main: ["100", "300", "100"] },
      });
      startDuel(session);
      if (current.field) {
        for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
          moveDuelCard(session.state, card.uid, "monsterZone", 0);
        }
      }

      const host = createLuaScriptHost(session);
      const result = host.loadScript(
        `
        local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${current.target}), 0, ${current.targetLocation}, 0, 1, 1, nil):GetFirst()
        local materials = Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(300) end, 0, ${current.materials}, 0, 2, 2, target)
        Debug.Message("${current.label} " .. Duel.${current.fn}(target, materials))
        `,
        `${current.label}-summon.lua`,
      );

      expect(result.ok).toBe(true);
      expect(host.messages).toContain(`${current.label} 1`);
      expect(session.state.cards.find((card) => card.code === current.target)?.location).toBe("monsterZone");
    }
  });

  it("lets Lua scripts check, select, and release monster-zone groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release A", kind: "monster" },
      { code: "300", name: "Release B", kind: "monster" },
      { code: "500", name: "Release C", kind: "monster" },
    ];
    const session = createDuel({ seed: 8, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["100", "300", "500"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local filter = function(tc) return tc:IsCode(100) or tc:IsCode(300) end
      Debug.Message("can release two " .. tostring(Duel.CheckReleaseGroup(0, filter, 2, nil)))
      Debug.Message("can release three " .. tostring(Duel.CheckReleaseGroup(0, filter, 3, nil)))
      local g = Duel.SelectReleaseGroup(0, filter, 1, 2, nil)
      Debug.Message("selected releases " .. g:GetCount())
      Debug.Message("released " .. Duel.Release(g, REASON_COST))
      local released = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("previous location " .. tostring(released:IsPreviousLocation(LOCATION_MZONE)))
      Debug.Message("previous controller " .. tostring(released:IsPreviousControler(0)))
      Debug.Message("release reason " .. tostring(released:IsReason(REASON_RELEASE)) .. "/" .. tostring(released:IsReason(REASON_COST)))
      `,
      "release-group.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("can release two true");
    expect(host.messages).toContain("can release three false");
    expect(host.messages).toContain("selected releases 2");
    expect(host.messages).toContain("released 2");
    expect(host.messages).toContain("previous location true");
    expect(host.messages).toContain("previous controller true");
    expect(host.messages).toContain("release reason true/true");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "graveyard" && (card.code === "100" || card.code === "300"))).toHaveLength(2);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "500")?.location).toBe("monsterZone");
  });

  it("lets Lua scripts move cards to hand, deck, and extra deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Recoverable Monster", kind: "monster" },
      { code: "300", name: "Illegal Extra Return", kind: "monster" },
      { code: "900", name: "Extra Return", kind: "extra" },
    ];
    const session = createDuel({ seed: 9, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["100", "300"] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && (candidate.code === "100" || candidate.code === "300" || candidate.code === "900"))) {
      moveDuelCard(session.state, card.uid, "graveyard", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local recover = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to hand " .. Duel.SendtoHand(recover, 0, REASON_EFFECT))
      local hand = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("to deck " .. Duel.SendtoDeck(hand, 0, 0, REASON_EFFECT))
      local extra = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("to extra " .. Duel.SendtoExtraP(extra, 0, REASON_EFFECT))
      local illegal = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_GRAVE, 0, 1, 1, nil)
      Debug.Message("illegal extra " .. Duel.SendtoExtraP(illegal, 0, REASON_EFFECT))
      `,
      "movement-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("to hand 1");
    expect(host.messages).toContain("to deck 1");
    expect(host.messages).toContain("to extra 1");
    expect(host.messages).toContain("illegal extra 0");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "100")?.location).toBe("deck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "900")?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === "300")?.location).toBe("graveyard");
  });

  it("lets Lua scripts query monster zones and choose summon positions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Zone Filler A", kind: "monster" },
      { code: "200", name: "Zone Filler B", kind: "monster" },
      { code: "300", name: "Zone Filler C", kind: "monster" },
      { code: "400", name: "Zone Filler D", kind: "monster" },
      { code: "500", name: "Zone Filler E", kind: "monster" },
      { code: "600", name: "Position Summon", kind: "monster" },
    ];
    const session = createDuel({ seed: 10, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    for (const code of ["100", "200", "300", "400", "500"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local excluded = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("location count " .. Duel.GetLocationCount(0, LOCATION_MZONE))
      Debug.Message("mzone count " .. Duel.GetMZoneCount(0))
      Debug.Message("mzone with excluded " .. Duel.GetMZoneCount(0, excluded))
      local selected = Duel.SelectPosition(0, nil, POS_FACEUP_DEFENSE + POS_FACEDOWN_DEFENSE)
      Debug.Message("selected position " .. selected)
      local summon = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 600), 0, LOCATION_HAND, 0, 1, 1, nil)
      Debug.Message("summoned " .. Duel.SpecialSummon(summon, 0, 0, 1, false, false, selected))
      `,
      "summon-position.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("location count 0");
    expect(host.messages).toContain("mzone count 0");
    expect(host.messages).toContain("mzone with excluded 1");
    expect(host.messages).toContain("selected position 4");
    expect(host.messages).toContain("summoned 1");
    const summoned = session.state.cards.find((card) => card.code === "600");
    expect(summoned?.controller).toBe(1);
    expect(summoned?.location).toBe("monsterZone");
    expect(summoned?.position).toBe("faceUpDefense");
  });

  it("lets Lua scripts inspect, confirm, and move deck-top groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck A", kind: "monster" },
      { code: "200", name: "Deck B", kind: "monster" },
      { code: "300", name: "Deck C", kind: "monster" },
      { code: "400", name: "Deck D", kind: "monster" },
    ];
    const session = createDuel({ seed: 11, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const expectedTop = session.state.cards
      .filter((card) => card.controller === 0 && card.location === "deck")
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, 2)
      .map((card) => card.code);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local top = Duel.GetDecktopGroup(0, 2)
      Debug.Message("top count " .. top:GetCount())
      local first = top:GetNext()
      local second = top:GetNext()
      Debug.Message("first top " .. first:GetCode())
      Debug.Message("second top " .. second:GetCode())
      Duel.ConfirmCards(1, top)
      Debug.Message("sent top " .. Duel.SendtoHand(top, 0, REASON_EFFECT))
      Duel.ShuffleDeck(0)
      `,
      "deck-top.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("top count 2");
    expect(host.messages).toContain(`first top ${expectedTop[0]}`);
    expect(host.messages).toContain(`second top ${expectedTop[1]}`);
    expect(host.messages).toContain(`confirmed 1: ${expectedTop.join(",")}`);
    expect(host.messages).toContain("sent top 2");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && expectedTop.includes(card.code))).toHaveLength(2);
  });

  it("lets Lua scripts draw and search deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw A", kind: "monster" },
      { code: "200", name: "Draw B", kind: "monster" },
      { code: "300", name: "Search Target", kind: "monster" },
      { code: "400", name: "Draw C", kind: "monster" },
    ];
    const session = createDuel({ seed: 12, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const deckOrder = session.state.cards.filter((card) => card.controller === 0 && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
    const drawnCodes = deckOrder.slice(0, 2).map((card) => card.code);
    const searchCode = deckOrder.slice(2).find((card) => card.code === "300")?.code ?? deckOrder[2]!.code;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can draw two " .. tostring(Duel.IsPlayerCanDraw(0, 2)))
      Debug.Message("can draw five " .. tostring(Duel.IsPlayerCanDraw(0, 5)))
      Debug.Message("drawn " .. Duel.Draw(0, 2, REASON_EFFECT))
      local searched = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${searchCode}), 0, LOCATION_DECK, 0, 1, 1, nil)
      Debug.Message("searched " .. Duel.SendtoHand(searched, 0, REASON_EFFECT))
      `,
      "draw-search.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("can draw two true");
    expect(host.messages).toContain("can draw five false");
    expect(host.messages).toContain("drawn 2");
    expect(host.messages).toContain("searched 1");
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "hand" && drawnCodes.includes(card.code))).toHaveLength(2);
    expect(session.state.cards.find((card) => card.controller === 0 && card.code === searchCode)?.location).toBe("hand");
  });

  it("lets Lua scripts query field groups across both players and locations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Grave", kind: "monster" },
      { code: "200", name: "Self Banished", kind: "monster" },
      { code: "300", name: "Opponent Grave", kind: "monster" },
      { code: "400", name: "Opponent Deck", kind: "monster" },
    ];
    const session = createDuel({ seed: 13, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 0 && card.code === "100")!.uid, "graveyard", 0);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 0 && card.code === "200")!.uid, "banished", 0);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 1 && card.code === "300")!.uid, "graveyard", 1);
    moveDuelCard(session.state, session.state.cards.find((card) => card.controller === 1 && card.code === "400")!.uid, "deck", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local mixed = Duel.GetFieldGroup(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK)
      Debug.Message("mixed count " .. mixed:GetCount())
      Debug.Message("field count " .. Duel.GetFieldGroupCount(0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK))
      Debug.Message("banished count " .. Duel.GetMatchingGroupCount(Card.IsAbleToGrave, 0, LOCATION_REMOVED, 0, nil))
      local first = mixed:GetNext()
      local second = mixed:GetNext()
      local third = mixed:GetNext()
      local fourth = mixed:GetNext()
      Debug.Message("mixed codes " .. first:GetCode() .. "," .. second:GetCode() .. "," .. third:GetCode() .. "," .. fourth:GetCode())
      local own_grave = Duel.GetFieldCard(0, LOCATION_GRAVE, 0)
      local opponent_deck = Duel.GetFieldCard(1, LOCATION_DECK, 0)
      local empty = Duel.GetFieldCard(0, LOCATION_GRAVE, 3)
      Debug.Message("field card codes " .. own_grave:GetCode() .. "/" .. opponent_deck:GetCode() .. "/" .. tostring(empty == nil))
      local function match(c, code)
        return c:IsCode(code)
      end
      local first_match = Duel.GetFirstMatchingCard(match, 0, LOCATION_GRAVE + LOCATION_REMOVED, LOCATION_GRAVE + LOCATION_DECK, nil, 300)
      Debug.Message("first matching card " .. first_match:GetCode())
      Debug.Message("onfield count " .. Duel.GetFieldGroupCount(0, LOCATION_ONFIELD, LOCATION_ONFIELD))
      `,
      "field-groups.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("mixed count 4");
    expect(host.messages).toContain("field count 4");
    expect(host.messages).toContain("banished count 1");
    expect(host.messages).toContain("mixed codes 100,200,300,400");
    expect(host.messages).toContain("field card codes 100/400/true");
    expect(host.messages).toContain("first matching card 300");
    expect(host.messages).toContain("onfield count 0");
  });

  it("lets Lua scripts read card type, stats, race, and attribute", () => {
    const cards: DuelCardData[] = [
      { code: "100", alias: "900", name: "Stat Monster", kind: "monster", typeFlags: 0x21, attack: 2500, defense: 2100, level: 7, race: 0x2, attribute: 0x20 },
      { code: "200", name: "Fixture Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 14, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monsters = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsType, TYPE_MONSTER), 0, LOCATION_HAND, 0, 1, 1, nil)
      local c = monsters:GetFirst()
      Debug.Message("type " .. c:GetType())
      Debug.Message("stats " .. c:GetAttack() .. "/" .. c:GetDefense() .. "/" .. c:GetLevel())
      Debug.Message("stat predicates " .. tostring(c:IsAttack(2500)) .. "/" .. tostring(c:IsDefense(2100)) .. "/" .. tostring(c:IsLevel(7)))
      Debug.Message("code checks " .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsOriginalCode(900)) .. "/" .. tostring(c:IsOriginalCode(100)))
      Debug.Message("race " .. c:GetRace() .. " " .. tostring(c:IsRace(RACE_SPELLCASTER)))
      Debug.Message("attribute " .. c:GetAttribute() .. " " .. tostring(c:IsAttribute(ATTRIBUTE_DARK)))
      Debug.Message("spell count " .. Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsType, TYPE_SPELL), 0, LOCATION_HAND, 0, nil))
      `,
      "card-stats.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("type 33");
    expect(host.messages).toContain("stats 2500/2100/7");
    expect(host.messages).toContain("stat predicates true/true/true");
    expect(host.messages).toContain("code checks true/false/true");
    expect(host.messages).toContain("race 2 true");
    expect(host.messages).toContain("attribute 32 true");
    expect(host.messages).toContain("spell count 1");
  });

  it("passes extra filter arguments through Lua matching helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Vararg A", kind: "monster", attack: 1600 },
      { code: "200", name: "Vararg B", kind: "monster", attack: 900 },
      { code: "300", name: "Vararg C", kind: "monster", attack: 2000 },
    ];
    const session = createDuel({ seed: 23, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const handResult = host.loadScript(
      `
      local function match(c, code, minatk)
        return c:IsCode(code) and c:GetAttack() >= minatk
      end
      local selected = Duel.SelectMatchingCard(0, match, 0, LOCATION_HAND, 0, 1, 1, nil, 100, 1500)
      Debug.Message("vararg selected " .. selected:GetFirst():GetCode())
      Debug.Message("vararg count " .. Duel.GetMatchingGroupCount(match, 0, LOCATION_HAND, 0, nil, 300, 1800))
      Debug.Message("vararg existing " .. tostring(Duel.IsExistingMatchingCard(match, 0, LOCATION_HAND, 0, 1, nil, 200, 1000)))
      `,
      "matching-varargs.lua",
    );

    expect(handResult.ok).toBe(true);
    expect(host.messages).toContain("vararg selected 100");
    expect(host.messages).toContain("vararg count 1");
    expect(host.messages).toContain("vararg existing false");

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }
    const releaseResult = host.loadScript(
      `
      local function release_filter(c, minatk)
        return c:GetAttack() >= minatk
      end
      Debug.Message("vararg release check " .. tostring(Duel.CheckReleaseGroup(0, release_filter, 2, nil, 1500)))
      local g = Duel.SelectReleaseGroup(0, release_filter, 1, 2, nil, 1500)
      Debug.Message("vararg release selected " .. g:GetCount())
      `,
      "release-varargs.lua",
    );

    expect(releaseResult.ok).toBe(true);
    expect(host.messages).toContain("vararg release check true");
    expect(host.messages).toContain("vararg release selected 2");
  });

  it("lets Lua scripts mutate and filter groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Group A", kind: "monster", attack: 1000 },
      { code: "200", name: "Group B", kind: "monster", attack: 2000 },
      { code: "300", name: "Group C", kind: "monster", attack: 3000 },
    ];
    const session = createDuel({ seed: 15, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local all = Duel.GetFieldGroup(0, LOCATION_HAND, 0)
      local high = all:Filter(function(tc) return tc:GetAttack() >= 2000 end, nil)
      local vararg_high = all:Filter(function(tc,minatk) return tc:GetAttack() >= minatk end, nil, 2500)
      local c100 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local c200 = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local g = Group.CreateGroup()
      g:AddCard(c100)
      g:AddCard(c100)
      g:KeepAlive()
      Debug.Message("added unique " .. g:GetCount() .. " " .. tostring(g:IsContains(c100)))
      g:Merge(high)
      Debug.Message("merged " .. g:GetCount() .. " " .. tostring(g:IsContains(c200)))
      local clone = g:Clone()
      local selected = clone:Select(0, 1, 2, nil)
      Debug.Message("selected group " .. selected:GetCount())
      Debug.Message("exists high " .. tostring(all:IsExists(function(tc,minatk) return tc:GetAttack() >= minatk end, 2, nil, 1500)))
      Debug.Message("class count " .. all:GetClassCount(function(tc) return tc:GetAttack() >= 2000 and 1 or 0 end))
      g:RemoveCard(c100)
      g:DeleteGroup()
      Debug.Message("removed " .. g:GetCount() .. " " .. tostring(g:IsContains(c100)))
      Debug.Message("filtered high " .. high:GetCount())
      Debug.Message("vararg high " .. vararg_high:GetCount())
      `,
      "group-mutation.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("added unique 1 true");
    expect(host.messages).toContain("merged 3 true");
    expect(host.messages).toContain("selected group 2");
    expect(host.messages).toContain("exists high true");
    expect(host.messages).toContain("class count 2");
    expect(host.messages).toContain("removed 2 false");
    expect(host.messages).toContain("filtered high 2");
    expect(host.messages).toContain("vararg high 1");
  });

  it("stores Lua effect metadata setters on registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Metadata Source", kind: "monster" }];
    const session = createDuel({ seed: 16, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetDescription(1234)
        e:SetCategory(CATEGORY_DRAW + CATEGORY_SEARCH)
        e:SetProperty(EFFECT_FLAG_CARD_TARGET + EFFECT_FLAG_DELAY)
        e:SetHintTiming(TIMING_END_PHASE, TIMING_MAIN_END)
        e:SetCountLimit(2, 987)
        e:SetReset(RESET_EVENT + RESETS_STANDARD, 1)
        c:RegisterEffect(e)
      end
      `,
      "effect-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects[0]).toMatchObject({
      description: 1234,
      category: 0x180,
      property: 0x10010,
      hintTiming: [0x20, 0x4],
      countLimit: 2,
      countLimitCode: 987,
      reset: { flags: 0x3000, count: 1 },
    });
  });

  it("shares Lua keyed count limits across effect copies", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Count Source", kind: "monster" }];
    const session = createDuel({ seed: 21, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1, 700)
        e:SetOperation(function(e,c)
          Debug.Message("used " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "keyed-count-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const firstAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(firstAction).toBeDefined();
    applyResponse(session, firstAction!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("used 100");
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("lets Lua effects pass labels and label objects between callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Label Source", kind: "monster" },
      { code: "200", name: "Label Object", kind: "monster" },
    ];
    const session = createDuel({ seed: 17, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetLabel(7)
        e:SetTarget(function(e,c)
          Debug.Message("target label " .. e:GetLabel())
          e:SetLabel(e:GetLabel()+1)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          e:SetLabelObject(g)
          return true
        end)
        e:SetOperation(function(e,c)
          local g=e:GetLabelObject()
          Debug.Message("operation label " .. e:GetLabel())
          Debug.Message("label object count " .. g:GetCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-labels.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("target label 7");
    expect(host.messages).toContain("operation label 8");
    expect(host.messages).toContain("label object count 1");
  });

  it("lets Lua effects share operation info between target and operation callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Operation Source", kind: "monster" },
      { code: "200", name: "Operation Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Duel.Hint(HINT_SELECTMSG, 0, HINTMSG_TOHAND)
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          return true
        end)
        e:SetOperation(function(e,c)
          local ok,cat,g,count,p,param=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("operation info " .. tostring(ok) .. "/" .. cat .. "/" .. g:GetCount() .. "/" .. count .. "/" .. p .. "/" .. param)
          Debug.Message("target relates " .. tostring(Duel.GetFirstTarget():IsRelateToEffect(e)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("operation info true/8/1/1/0/0");
    expect(host.messages).toContain("target relates true");
  });

  it("lets Lua effects register, read, and reset duel and card flags", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Flag Source", kind: "monster" }];
    const session = createDuel({ seed: 22, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Debug.Message("duel flag register " .. Duel.RegisterFlagEffect(0, 901, RESET_EVENT, 0, 3))
          Debug.Message("card flag register " .. c:RegisterFlagEffect(902, RESET_EVENT, 0, 4))
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("duel flag count " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag count " .. c:GetFlagEffect(902))
          Debug.Message("duel flag reset " .. Duel.ResetFlagEffect(0, 901))
          Debug.Message("card flag reset " .. c:ResetFlagEffect(902))
          Debug.Message("duel flag after " .. Duel.GetFlagEffect(0, 901))
          Debug.Message("card flag after " .. c:GetFlagEffect(902))
        end)
        c:RegisterEffect(e)
      end
      `,
      "flag-effects.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("duel flag register 1");
    expect(host.messages).toContain("card flag register 1");
    expect(host.messages).toContain("duel flag count 1");
    expect(host.messages).toContain("card flag count 1");
    expect(host.messages).toContain("duel flag reset 1");
    expect(host.messages).toContain("card flag reset 1");
    expect(host.messages).toContain("duel flag after 0");
    expect(host.messages).toContain("card flag after 0");
    expect(session.state.flagEffects).toHaveLength(0);
  });

  it("provides common aux compatibility helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux A", kind: "monster" },
      { code: "200", name: "Aux B", kind: "monster" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      `,
      "aux-helpers.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("true count 2");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 1");
  });

  it("exposes summon type metadata to Lua card helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon A", kind: "monster" },
      { code: "300", name: "Summon B", kind: "monster" },
      { code: "900", name: "Summon Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
    ];
    const session = createDuel({ seed: 19, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const normalUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === normalUid);
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);

    const host = createLuaScriptHost(session);
    const normalResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("normal type " .. tostring(c:IsSummonType(SUMMON_TYPE_NORMAL)) .. "/" .. c:GetSummonType())
      `,
      "summon-type-normal.lua",
    );

    expect(normalResult.ok).toBe(true);
    expect(host.messages).toContain("normal type true/268435456");

    const fusion = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon");
    expect(fusion).toBeDefined();
    expect(applyResponse(session, fusion!).ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "900")?.summonType).toBe("fusion");

    const fusionResult = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("fusion type " .. tostring(c:IsSummonType(SUMMON_TYPE_FUSION)) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_SPECIAL)))
      cost_reason = REASON_COST
      `,
      "summon-type-fusion.lua",
    );

    expect(fusionResult.ok).toBe(true);
    expect(host.messages).toContain("fusion type true/true");
    expect(host.getGlobalNumber("cost_reason")).toBe(0x80);
  });

  it("executes smoke-test Lua scripts with EDOPro-style globals", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_player = Duel.GetTurnPlayer()
      observed_phase = Duel.GetCurrentPhase()
      Debug.Message("lua host online")
      `,
      "smoke.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("observed_player")).toBe(0);
    expect(host.getGlobalString("observed_phase")).toBe("main1");
    expect(host.messages).toContain("lua host online");
  });
});
